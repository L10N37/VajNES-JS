importScripts('/assets/js/ppu-worker-setup.js');
console.debug('[PPU Worker init]');

// ---- Shared indices ----
const SYNC_SCANLINE = 2;
const SYNC_DOT      = 3;
const SYNC_FRAME    = 4;

// ---- Shared setters ----
const STORE_CURRENT_SCANLINE = v => Atomics.store(SHARED.SYNC, SYNC_SCANLINE, v|0);
const STORE_CURRENT_DOT      = v => Atomics.store(SHARED.SYNC, SYNC_DOT,      v|0);
const STORE_CURRENT_FRAME    = v => Atomics.store(SHARED.SYNC, SYNC_FRAME,    v|0);

// ---- Status bit helpers ----
const CLEAR_VBLANK          = () => { PPUSTATUS &= ~0x80; };
const SET_VBLANK            = () => { PPUSTATUS |=  0x80; };
const CLEAR_SPRITE0_HIT     = () => { PPUSTATUS &= ~0x40; };
const SET_SPRITE0_HIT       = () => { PPUSTATUS |=  0x40; };
const CLEAR_SPRITE_OVERFLOW = () => { PPUSTATUS &= ~0x20; };
const SET_SPRITE_OVERFLOW   = () => { PPUSTATUS |=  0x20; };

// ---- Geometry ----
const DOTS_PER_SCANLINE   = 340; // 0..340 = 341
const SCANLINES_PER_FRAME = 262; // 0..261
const NES_W = 256, NES_H = 240;

// ---- PPUMASK bits ----
const MASK_GREYSCALE      = 0x01;
const MASK_BG_SHOW_LEFT8  = 0x02;
const MASK_SPR_SHOW_LEFT8 = 0x04;
const MASK_BG_ENABLE      = 0x08;
const MASK_SPR_ENABLE     = 0x10;

let ppuInitDone = false;
let nmiAtVblankEnd = false;

// "rendering" = either BG or SPR enabled (hardware: pipelines run if either is on)
const renderingNow  = () => ((PPUMASK & 0x18) !== 0);
const bgEnabledNow  = () => ((PPUMASK & MASK_BG_ENABLE) !== 0);
const sprEnabledNow = () => ((PPUMASK & MASK_SPR_ENABLE) !== 0);

// ---- Clock state ----
const PPUclock = { dot: 0, scanline: 261, frame: 0, oddFrame: false };

// ---- Background pipeline ----
const background = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0,
};

// Prefetch latches for the *next* scanline (321–336)
const nextLine = {
  t0: { lo:0, hi:0, at:0 },
  t1: { lo:0, hi:0, at:0 },
};

// ---- Sprite pipeline ----
const SPR_MAX = 8;
const sprites = {
  count: 0,
  attr: new Uint8Array(SPR_MAX),
  xcnt: new Uint8Array(SPR_MAX),
  lo:   new Uint8Array(SPR_MAX),
  hi:   new Uint8Array(SPR_MAX),
  idx:  new Uint8Array(SPR_MAX),
};

const OAM_FRAME = new Uint8Array(256);
const oamFRead = (i) => (OAM_FRAME[i & 0xFF] & 0xFF);

const SPRITE_SIZE_16 = 0x20; // PPUCTRL bit 5
const SPR_PATTERN_T  = 0x08; // PPUCTRL bit 3 (8x8 sprites)
const SPR_Y_OFFSET   = 1;    // HW: sprite Y is top-1

// ---- Execution counters ----
let totalTicks = 0;

// ---- render-enable edge tracking (for sprite-only BG priming) ----
let renderingPrev = false;
let spriteOnlyPrimePending = false;

// ---- OAM corruption (FAIL #2 fix) ----
let oamCorruptPending = false;
let oamCorruptSeedRow = 0; // 0..31 (row = seedRow, dest = seedRow*8)
let secOAMAddr = 0;        // 0..31 simple model
let ppumaskPrev = 0;

// ---- Debug offsets ----
let BG_DEBUG_X_OFFSET = 0;
let BG_DEBUG_Y_OFFSET = 0;

// ---- Utils ----
function reverseByte(b) {
  b &= 0xFF;
  b = ((b & 0xF0) >> 4) | ((b & 0x0F) << 4);
  b = ((b & 0xCC) >> 2) | ((b & 0x33) << 2);
  b = ((b & 0xAA) >> 1) | ((b & 0x55) << 1);
  return b & 0xFF;
}

// ---- OAM Corruption helpers ----
function oamCorruptDoCopyRow(seedRow) {
  const dest = (seedRow & 0x1F) << 3;
  for (let i = 0; i < 8; i++) {
    OAM[(dest + i) & 0xFF] = OAM[i & 0xFF];
  }
}

// Minimal secondary OAM address model (enough for test’s early-dot case)
function updateSecondaryOAMAddrForDot(scanline, dot) {
  if (!renderingNow()) return;
  if (!(scanline === 261 || (scanline >= 0 && scanline <= 239))) return;

  if (dot >= 1 && dot <= 64) {
    // cycles 1-2 => 0, 3-4 => 1, ... 63-64 => 31
    secOAMAddr = ((dot - 1) >> 1) & 0x1F;
    return;
  }

  // light stub for 257..320 to avoid nonsense
  if (dot >= 257 && dot <= 320) {
    const t = dot - 257;
    const sub = t & 7;
    if (dot === 257) secOAMAddr = 0;
    if (sub === 0 || sub === 1 || sub === 2 || sub === 7) {
      secOAMAddr = (secOAMAddr + 1) & 0x1F;
    }
    return;
  }
}

// ---- Sprite fetch ----
function fetchSpritePatternBytes(tileIndex, attr, rowInSprite) {
  const flipH = (attr & 0x40) !== 0;
  const flipV = (attr & 0x80) !== 0;
  const is8x16 = (PPUCTRL & SPRITE_SIZE_16) !== 0;

  let row = rowInSprite & 0x0F;
  if (flipV) row = (is8x16 ? 15 : 7) - row;

  let addrLo = 0, addrHi = 0;

  if (!is8x16) {
    const base = (PPUCTRL & SPR_PATTERN_T) ? 0x1000 : 0x0000;
    const baseAddr = base + ((tileIndex & 0xFF) << 4) + (row & 7);
    addrLo = baseAddr;
    addrHi = baseAddr + 8;
  } else {
    const table = (tileIndex & 1) ? 0x1000 : 0x0000;
    const tileBase = (tileIndex & 0xFE) << 4;
    const baseAddr = table + tileBase + ((row & 0x0F) >= 8 ? 0x10 : 0x00) + (row & 7);
    addrLo = baseAddr;
    addrHi = baseAddr + 8;
  }

  let lo = ppuBusRead(addrLo) & 0xFF;
  let hi = ppuBusRead(addrHi) & 0xFF;

  if (flipH) { lo = reverseByte(lo); hi = reverseByte(hi); }

  return { lo, hi };
}

// sprite evaluation runs when *either* BG or SPR rendering is enabled
function evalSpritesForScanline(scanline) {
  sprites.count = 0;
  if (!renderingNow()) return;

  const is8x16 = (PPUCTRL & SPRITE_SIZE_16) !== 0;
  const sprH   = is8x16 ? 16 : 8;

  let overflow = false;

  for (let n = 0; n < 64; n++) {
    const base = n << 2;

    const y    = oamFRead(base + 0);
    if (y === 0xFF) continue;

    const tile = oamFRead(base + 1);
    const attr = oamFRead(base + 2);
    const x    = oamFRead(base + 3);

    const top = (y + SPR_Y_OFFSET) | 0;
    if (scanline < top) continue;

    const row = (scanline - top) | 0;
    if (row < 0 || row >= sprH) continue;

    if (sprites.count < SPR_MAX) {
      const i = sprites.count++;
      const pat = fetchSpritePatternBytes(tile, attr, row);

      sprites.attr[i] = attr & 0xFF;
      sprites.xcnt[i] = x & 0xFF;
      sprites.lo[i]   = pat.lo & 0xFF;
      sprites.hi[i]   = pat.hi & 0xFF;
      sprites.idx[i]  = n & 0xFF;
    } else {
      overflow = true;
      break;
    }
  }

  if (overflow) SET_SPRITE_OVERFLOW();
}

function spriteShiftersTick() {
  for (let i = 0; i < sprites.count; i++) {
    if (sprites.xcnt[i] > 0) {
      sprites.xcnt[i] = (sprites.xcnt[i] - 1) & 0xFF;
    } else {
      sprites.lo[i] = ((sprites.lo[i] << 1) & 0xFF);
      sprites.hi[i] = ((sprites.hi[i] << 1) & 0xFF);
    }
  }
}

function sampleSpritePixel(x) {
  if (!sprEnabledNow()) return null;
  if (x < 8 && (PPUMASK & MASK_SPR_SHOW_LEFT8) === 0) return null;

  for (let i = 0; i < sprites.count; i++) {
    if (sprites.xcnt[i] !== 0) continue;

    const p0 = (sprites.lo[i] >> 7) & 1;
    const p1 = (sprites.hi[i] >> 7) & 1;
    const color2 = (p1 << 1) | p0;
    if (color2 === 0) continue;

    const attr = sprites.attr[i] & 0xFF;
    const pal  = (attr & 0x03) & 3;
    const priBehindBG = (attr & 0x20) !== 0;

    const palAddr = 0x3F10 | ((pal << 2) | color2);
    let palIndex6 = ppuBusRead(palAddr) & 0x3F;

    if (PPUMASK & MASK_GREYSCALE) palIndex6 &= 0x30;

    return {
      palIndex6,
      priBehindBG,
      isSprite0: (sprites.idx[i] === 0),
    };
  }

  return null;
}

// ---- Background helpers ----
function reloadBGShifters(startOfScanline = false) {
  if (startOfScanline) {
    background.bgShiftLo = (background.tileLo & 0xFF) << 8;
    background.bgShiftHi = (background.tileHi & 0xFF) << 8;

    const atLoHi = (background.atByte & 0x01) ? 0xFF00 : 0x0000;
    const atHiHi = (background.atByte & 0x02) ? 0xFF00 : 0x0000;
    background.atShiftLo = atLoHi;
    background.atShiftHi = atHiHi;
  } else {
    background.bgShiftLo = (background.bgShiftLo & 0xFF00) | (background.tileLo & 0xFF);
    background.bgShiftHi = (background.bgShiftHi & 0xFF00) | (background.tileHi & 0xFF);

    const atLo = (background.atByte & 0x01) ? 0x00FF : 0x0000;
    const atHi = (background.atByte & 0x02) ? 0x00FF : 0x0000;
    background.atShiftLo = (background.atShiftLo & 0xFF00) | atLo;
    background.atShiftHi = (background.atShiftHi & 0xFF00) | atHi;
  }
}

// Sprite-only rendering needs BG shifters clocking; prime them when we transition into sprite-only.
function primeBGForSpriteOnly() {
  const v = VRAM_ADDR & 0x7FFF;

  const nt = ppuBusRead(0x2000 | (v & 0x0FFF)) & 0xFF;

  const attAddr = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
  const shift   = ((v >> 4) & 4) | (v & 2);
  const atBits  = ((ppuBusRead(attAddr) & 0xFF) >> shift) & 3;

  const fineY = (v >> 12) & 7;
  const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + (nt << 4) + fineY;

  const lo = ppuBusRead(base) & 0xFF;
  const hi = ppuBusRead(base + 8) & 0xFF;

  background.ntByte = nt;
  background.atByte = atBits & 0x03;
  background.tileLo = lo;
  background.tileHi = hi;

  background.bgShiftLo = (lo << 8) & 0xFFFF;
  background.bgShiftHi = (hi << 8) & 0xFFFF;

  background.atShiftLo = (atBits & 0x01) ? 0xFF00 : 0x0000;
  background.atShiftHi = (atBits & 0x02) ? 0xFF00 : 0x0000;
}

// ---- Pixel output ----
function emitPixelHardwarePalette() {
  const bgOn = bgEnabledNow();

  let bgColor2 = 0;
  let bgAttr2  = 0;

  if (bgOn) {
    const fx  = (fineX & 7);
    const bit = 15 - fx;

    const p0 = (background.bgShiftLo >> bit) & 1;
    const p1 = (background.bgShiftHi >> bit) & 1;
    const a0 = (background.atShiftLo >> bit) & 1;
    const a1 = (background.atShiftHi >> bit) & 1;

    bgColor2 = (p1 << 1) | p0;
    bgAttr2  = (a1 << 1) | a0;
  }

  let x = (PPUclock.dot - 1) + BG_DEBUG_X_OFFSET;
  let y = (PPUclock.scanline) - BG_DEBUG_Y_OFFSET;

  if (x < 0 || x >= NES_W) return;
  if (y < 0 || y >= NES_H) return;

  if (bgOn && x < 8 && (PPUMASK & MASK_BG_SHOW_LEFT8) === 0) bgColor2 = 0;

  let bgPalIndex6;
  if (bgColor2 === 0) {
    bgPalIndex6 = PALETTE_RAM[0] & 0x3F;
  } else {
    const palLow5 = ((bgAttr2 << 2) | bgColor2) & 0x1F;
    bgPalIndex6 = ppuBusRead(0x3F00 | palLow5) & 0x3F;
  }

  if (PPUMASK & MASK_GREYSCALE) bgPalIndex6 &= 0x30;

  const spr = sampleSpritePixel(x);

  let finalIndex6 = bgPalIndex6;

  if (spr) {
    const bgOpaque = bgOn && (bgColor2 !== 0);

    if (spr.isSprite0 && bgOpaque &&
        PPUclock.scanline >= 0 && PPUclock.scanline < 240 &&
        PPUclock.dot >= 1 && PPUclock.dot <= 256) {
      SET_SPRITE0_HIT();
    }

    if (!spr.priBehindBG || !bgOpaque) {
      finalIndex6 = spr.palIndex6;
    }
  }

  paletteIndexFrame[y * NES_W + x] = finalIndex6;
}

// ---- Scanline handlers ----
function preRenderScanline(dot) {
  const ren = renderingNow();

  // OAM corruption triggers: first eligible dot after rendering is re-enabled
  if (dot === 1 && oamCorruptPending && ren) {
    oamCorruptDoCopyRow(oamCorruptSeedRow);
    oamCorruptPending = false;
  }

  if (dot === 0 && nmiAtVblankEnd && ppuInitDone) {
    CLEAR_VBLANK();
  }

  if (dot === 1 && ppuInitDone) {
    CLEAR_VBLANK();
    nmiSuppression = false;
    doNotSetVblank = false;

    CLEAR_SPRITE0_HIT();
    CLEAR_SPRITE_OVERFLOW();

    OAM_FRAME.set(OAM);
  }

  if (ren && dot === 256) incY();
  if (ren && dot === 257) copyHoriz();
  if (ren && dot >= 280 && dot <= 304) copyVert();

  const inFetch = (dot >= 2 && dot <= 256) || (dot >= 321 && dot <= 336);
  const phase   = (dot - 1) & 7;

  // keep pre-render cadence matching visible for shifter reload
  if (ren && phase === 0 && dot >= 9 && dot <= 257) {
    reloadBGShifters(false);
  }

  if (ren && dot >= 2 && dot <= 256) {
    background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
    background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
    background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
    background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
  }

  if (ren && inFetch) {
    const v = VRAM_ADDR;
    switch (phase) {
      case 1: {
        background.ntByte = ppuBusRead(0x2000 | (v & 0x0FFF));
        BG_ntByte = background.ntByte;
        break;
      }
      case 3: {
        const attAddr = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
        const shift   = ((v >> 4) & 4) | (v & 2);
        const atBits  = (ppuBusRead(attAddr) >> shift) & 3;
        background.atByte = atBits & 0x03;
        BG_atByte = background.atByte;
        break;
      }
      case 5: {
        const fineY = (v >> 12) & 7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY;
        background.tileLo = ppuBusRead(base) & 0xFF;
        BG_tileLo = background.tileLo;
        break;
      }
      case 7: {
        const fineY = (v >> 12) & 7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY + 8;
        background.tileHi = ppuBusRead(base) & 0xFF;
        BG_tileHi = background.tileHi;

        if (dot === 328) {
          nextLine.t0.lo = background.tileLo;
          nextLine.t0.hi = background.tileHi;
          nextLine.t0.at = background.atByte & 0x03;
        } else if (dot === 336) {
          nextLine.t1.lo = background.tileLo;
          nextLine.t1.hi = background.tileHi;
          nextLine.t1.at = background.atByte & 0x03;
        }

        incCoarseX();
        break;
      }
    }
  }

  if (dot === 340) {
    PPU_FRAME_FLAGS |= 0b00000001;
    if (!ppuInitDone) ppuInitDone = true;
  }
}

function visibleScanline(dot) {
  const ren   = renderingNow();
  const phase = (dot - 1) & 7;
  const inFetch = (dot >= 2 && dot <= 256) || (dot >= 321 && dot <= 336);

  // OAM corruption triggers: first eligible dot after rendering is re-enabled
  if (dot === 1 && oamCorruptPending && ren) {
    oamCorruptDoCopyRow(oamCorruptSeedRow);
    oamCorruptPending = false;
  }

  if (ren && dot === 1) {
    if (spriteOnlyPrimePending && sprEnabledNow() && !bgEnabledNow()) {
      primeBGForSpriteOnly();
      spriteOnlyPrimePending = false;
    }

    background.bgShiftLo = (nextLine.t0.lo & 0xFF) << 8;
    background.bgShiftHi = (nextLine.t0.hi & 0xFF) << 8;

    const atLoHi0 = (nextLine.t0.at & 0x01) ? 0xFF00 : 0x0000;
    const atHiHi0 = (nextLine.t0.at & 0x02) ? 0xFF00 : 0x0000;
    background.atShiftLo = atLoHi0;
    background.atShiftHi = atHiHi0;

    background.bgShiftLo |= (nextLine.t1.lo & 0xFF);
    background.bgShiftHi |= (nextLine.t1.hi & 0xFF);

    const atLo1 = (nextLine.t1.at & 0x01) ? 0x00FF : 0x0000;
    const atHi1 = (nextLine.t1.at & 0x02) ? 0x00FF : 0x0000;
    background.atShiftLo |= atLo1;
    background.atShiftHi |= atHi1;
  }

  if (dot === 1) {
    evalSpritesForScanline(PPUclock.scanline);
  }

  if (ren && phase === 0 && dot >= 9 && dot <= 257) {
    reloadBGShifters(false);
  }

  if (dot >= 1 && dot <= 256) {
    emitPixelHardwarePalette();

    // BG shifters clock when either pipeline is active (ren)
    if (ren && dot >= 2 && dot <= 256) {
      background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
      background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
      background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
      background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
    }

    // sprite shifters tick when rendering is active
    if (ren && dot >= 1 && dot <= 256) {
      spriteShiftersTick();
    }
  }

  if (ren && inFetch) {
    const v = VRAM_ADDR;
    switch (phase) {
      case 1: {
        background.ntByte = ppuBusRead(0x2000 | (v & 0x0FFF));
        BG_ntByte = background.ntByte;
        break;
      }
      case 3: {
        const attAddr = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
        const shift   = ((v >> 4) & 4) | (v & 2);
        const atBits  = (ppuBusRead(attAddr) >> shift) & 3;
        background.atByte = atBits & 0x03;
        BG_atByte = background.atByte;
        break;
      }
      case 5: {
        const fineY = (v >> 12) & 7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY;
        background.tileLo = ppuBusRead(base) & 0xFF;
        BG_tileLo = background.tileLo;
        break;
      }
      case 7: {
        const fineY = (v >> 12) & 7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY + 8;
        background.tileHi = ppuBusRead(base) & 0xFF;
        BG_tileHi = background.tileHi;

        if (dot === 328) {
          nextLine.t0.lo = background.tileLo;
          nextLine.t0.hi = background.tileHi;
          nextLine.t0.at = background.atByte & 0x03;
        } else if (dot === 336) {
          nextLine.t1.lo = background.tileLo;
          nextLine.t1.hi = background.tileHi;
          nextLine.t1.at = background.atByte & 0x03;
        }

        incCoarseX();
        break;
      }
    }
  }

  if (ren && dot === 256) incY();
  if (ren && dot === 257) copyHoriz();
}

function postRenderScanline(dot) {}

function vblankStartScanline(dot) {
  if (!ppuInitDone) return;

  if (dot === 0) {
    PPU_FRAME_FLAGS |= 0b00000010;
    const nmiBitIsSet = (PPUCTRL & 0x80) !== 0;
    if (nmiBitIsSet) PPU_FRAME_FLAGS |= 0b00000100;
  }

  if (dot === 1) {
    if (!doNotSetVblank) SET_VBLANK();

    vblankBitIsSet = (PPUSTATUS & 0b1000000) !== 0;
    const nmiBitIsSet = (PPUCTRL & 0x80) !== 0;
    if (nmiBitIsSet && !nmiSuppression && vblankBitIsSet) {
      PPU_FRAME_FLAGS |= 0b00000100;
    }
  }
}

function vblankIdleScanline(dot) {
  const nmiEdgeExists = (PPU_FRAME_FLAGS & 0b00000100) !== 0;
  if (nmiEdgeExists && PPUclock.scanline === 260 && dot === 340) {
    nmiAtVblankEnd = true;
  }
}

// ---- Scanline LUT ----
const scanlineLUT = new Array(262);
for (let i = 0; i <= 239; i++) scanlineLUT[i] = visibleScanline;
scanlineLUT[240] = postRenderScanline;
scanlineLUT[241] = vblankStartScanline;
for (let i = 242; i <= 260; i++) scanlineLUT[i] = vblankIdleScanline;
scanlineLUT[261] = preRenderScanline;

// ---- Scroll / VRAM address ops ----
function incCoarseX() {
  if (!renderingNow()) return;
  let v = VRAM_ADDR;
  if ((v & 0x001F) === 31) { v &= ~0x001F; v ^= 0x0400; }
  else { v = (v + 1) & 0x7FFF; }
  VRAM_ADDR = v;
}

function incY() {
  if (!renderingNow()) return;
  let v = VRAM_ADDR;
  if ((v & 0x7000) !== 0x7000) {
    v = (v + 0x1000) & 0x7FFF;
  } else {
    v &= ~0x7000;
    let y = (v & 0x03E0) >> 5;
    if (y === 29) { y = 0; v ^= 0x0800; }
    else if (y === 31) { y = 0; }
    else { y++; }
    v = (v & ~0x03E0) | (y << 5);
  }
  VRAM_ADDR = v;
}

function copyHoriz() {
  if (!renderingNow()) return;
  const t = (t_hi << 8) | t_lo;
  VRAM_ADDR = (VRAM_ADDR & ~0x041F) | (t & 0x041F);
}

function copyVert() {
  if (!renderingNow()) return;
  const t = (t_hi << 8) | t_lo;
  VRAM_ADDR = (VRAM_ADDR & ~0x7BE0) | (t & 0x7BE0);
}

// ---- PPU bus read ----
function ppuBusRead(addr) {
  addr &= 0x3FFF;
  let value = 0xFF;
  let index = 0;

  const chrIsRAM = !!(PPU_FRAME_FLAGS & 0x80);

  if (addr < 0x2000) {
    addr &= 0x1FFF;

    if (mapperNumber === 1) {
      if (chr8kModeFlag) {
        index = addr & 0x1FFF;
        if (index < CHR_ROM.length) value = CHR_ROM[index] & 0xFF;
      } else {
        if (addr < 0x1000) {
          index = (CHR_BANK_LO << 12) + addr;
          if (index < CHR_ROM.length) value = CHR_ROM[index] & 0xFF;
        } else {
          index = (CHR_BANK_HI << 12) + (addr - 0x1000);
          if (index < CHR_ROM.length) value = CHR_ROM[index] & 0xFF;
        }
      }
    } else {
      index = addr & 0x1FFF;
      value = CHR_ROM[index] & 0xFF;
    }

    return value;
  }

  if (addr < 0x3F00) {
    const base = addr & 0x07FF;
    return VRAM[base] & 0xFF;
  }

  if (addr >= 0x3F00 && addr < 0x4000) {
    let p = addr & 0x1F;
    if ((addr & 0x13) === 0x10) p &= ~0x10;
    return PALETTE_RAM[p] & 0x3F;
  }

  return 0xFF;
}

// ---- Tick ----
function ppuTick() {
  // ---- OAM Corruption FAIL #2 fix: seed on render disable, trigger after re-enable ----
  const maskNow = PPUMASK & 0xFF;
  const renNow  = (maskNow & 0x18) !== 0;
  const renPrev = ((ppumaskPrev & 0x18) !== 0);

  // secondary OAM address model (for early-dot seeding)
  updateSecondaryOAMAddrForDot(PPUclock.scanline, PPUclock.dot);

  // Seed when rendering is DISABLED during pre-render..239
  if (renPrev && !renNow) {
    if (PPUclock.scanline === 261 || (PPUclock.scanline >= 0 && PPUclock.scanline <= 239)) {
      oamCorruptSeedRow = secOAMAddr & 0x1F;
      oamCorruptPending = true;
    }
  }

  ppumaskPrev = maskNow;

  // sprite-only BG priming edge tracking
  const renNow2 = renderingNow();
  if (!renderingPrev && renNow2) {
    if (sprEnabledNow() && !bgEnabledNow()) spriteOnlyPrimePending = true;
  }
  renderingPrev = renNow2;

  // odd-frame short tick: skip pre-render dot 339 when rendering enabled
  if (PPUclock.oddFrame && renNow2 &&
      PPUclock.scanline === 261 && PPUclock.dot === 339) {
    PPUclock.scanline = 0;
    PPUclock.dot = -1;
    PPUclock.oddFrame = false;
    nmiAtVblankEnd = false;
    return;
  }

  scanlineLUT[PPUclock.scanline](PPUclock.dot);

  if (PPUclock.scanline === 260 && PPUclock.dot === 340) {
    PPUclock.frame++;
  }

  if (PPUclock.scanline === 261 && PPUclock.dot === 340) {
    PPUclock.scanline = 0;
    PPUclock.dot = -1;
    PPUclock.oddFrame = !PPUclock.oddFrame;
  } else if (PPUclock.dot === 340) {
    PPUclock.dot = -1;
    PPUclock.scanline++;
  }
}

// ---- Main PPU Loop ----
function startPPULoop() {
  while (1) {
    while (!cpuStallFlag) {}

    const target = ppuCycles;

    while (totalTicks < target) {
      ppuTick();

      STORE_CURRENT_FRAME(PPUclock.frame);
      STORE_CURRENT_DOT(PPUclock.dot);
      STORE_CURRENT_SCANLINE(PPUclock.scanline);

      PPUclock.dot++;
      totalTicks++;
    }

    cpuStallFlag = false;
  }
}
