// ---- Shared indices ----
const SYNC_SCANLINE = 2;
const SYNC_DOT      = 3;
const SYNC_FRAME    = 4;

// ---- Status bit helpers ----
const CLEAR_VBLANK          = () => { PPUSTATUS &= ~0x80; };
const SET_VBLANK            = () => { PPUSTATUS |=  0x80; };
const CLEAR_SPRITE0_HIT     = () => { PPUSTATUS &= ~0x40; };
const SET_SPRITE0_HIT       = () => { PPUSTATUS |=  0x40; };
const CLEAR_SPRITE_OVERFLOW = () => { PPUSTATUS &= ~0x20; };
const SET_SPRITE_OVERFLOW   = () => { PPUSTATUS |=  0x20; };

// ---- PPUMASK bits ----
const MASK_GREYSCALE      = 0x01;
const MASK_BG_SHOW_LEFT8  = 0x02;
const MASK_SPR_SHOW_LEFT8 = 0x04;
const MASK_BG_ENABLE      = 0x08;
const MASK_SPR_ENABLE     = 0x10;

let ppuInitDone = false;
let nmiAtVblankEnd = false;
let oddSkipRendering = false;

// PPUMASK rendering-enable bits become effective a few PPU dots after the
// CPU write. Keep the CPU-visible register immediate while the renderer uses
// the previous BG/SPR enable state for four complete PPU dots.
let ppumaskRenderHoldBits = 0;
let ppumaskRenderApplyAt = -1;
let ppumaskOAMHoldBits = 0;
let ppumaskOAMApplyAt = -1;

function ppuEffectiveMask() {
  if (ppumaskRenderApplyAt >= 0) {
    if (ppuCycles < ppumaskRenderApplyAt)
      return (PPUMASK & ~0x18) | (ppumaskRenderHoldBits & 0x18);

    ppumaskRenderApplyAt = -1;
    ppumaskRenderHoldBits = PPUMASK & 0x18;
  }
  return PPUMASK & 0xFF;
}

function ppuOAMMaskBits() {
  if (ppumaskOAMApplyAt >= 0) {
    if (ppuCycles < ppumaskOAMApplyAt)
      return ppumaskOAMHoldBits & 0x18;

    ppumaskOAMApplyAt = -1;
    ppumaskOAMHoldBits = PPUMASK & 0x18;
  }
  return PPUMASK & 0x18;
}

function ppuWriteMask(value) {
  const effectiveBefore = ppuEffectiveMask() & 0x18;
  const oamBefore = ppuOAMMaskBits();
  PPUMASK = value & 0xFF;
  const requested = PPUMASK & 0x18;

  if (requested === oamBefore) {
    ppumaskOAMHoldBits = requested;
    ppumaskOAMApplyAt = -1;
  } else {
    // OAM evaluation/fetch samples rendering enable one PPU dot after a CPU
    // PPUMASK write. This is distinct from the longer visual-pipeline delay.
    ppumaskOAMHoldBits = oamBefore;
    ppumaskOAMApplyAt = ppuCycles + 1;
  }

  if (requested === effectiveBefore) {
    ppumaskRenderHoldBits = requested;
    ppumaskRenderApplyAt = -1;
  } else {
    ppumaskRenderHoldBits = effectiveBefore;
    ppumaskRenderApplyAt = ppuCycles + 4;
  }
}

// "rendering" = either BG or SPR enabled, using the delayed effective state.
const renderingNow  = () => ((ppuEffectiveMask() & 0x18) !== 0);
const bgEnabledNow  = () => ((ppuEffectiveMask() & MASK_BG_ENABLE) !== 0);
const sprEnabledNow = () => ((ppuEffectiveMask() & MASK_SPR_ENABLE) !== 0);

// ---- Clock state ----
let PPUclock = { dot: 0, scanline: 261, frame: 0, oddFrame: false };

// ---- Background pipeline ----
let background = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0,
};

// Prefetch latches for the *next* scanline (321–336)
let nextLine = {
  t0: { lo:0, hi:0, at:0 },
  t1: { lo:0, hi:0, at:0 },
};

// ---- Sprite pipeline ----
const SPR_MAX = 8;

let vFetch = 0;

// External PPU address/data bus state used by CPU/PPU overlap cases.
let ppuExternalLatchLow = 0;
let ppuExternalData = 0;
let ppuCpu2007ReadUntil = -1;
let ppuCpu2006HybridUntil = -1;
let ppuCpu2006HybridLow = 0;

function presentFrame() {
  if(typeof NESAudio!=="undefined") NESAudio.frame(cpuCycles);
  blitNESFramePaletteIndex(paletteIndexFrame, NES_W, NES_H);

  // count this presented frame
  fpsCounter++;

  // start the 1-second timer ONCE
  if (!fpsTimerStarted) {
    fpsTimerStarted = true;

    setInterval(() => {
      fps = fpsCounter;       // frames in the last second
      fpsCounter = 0;         // reset for next second
      fpsOverlay.textContent = `FPS: ${fps}`;
    }, 1000);
  }
}

function makeSpriteBuf() {
  return {
    count: 0,
    attr: new Uint8Array(SPR_MAX),
    xcnt: new Uint8Array(SPR_MAX),
    lo:   new Uint8Array(SPR_MAX),
    hi:   new Uint8Array(SPR_MAX),
    idx:  new Uint8Array(SPR_MAX),
    tile: new Uint8Array(SPR_MAX),
    row: new Uint8Array(SPR_MAX),
    sprite0ListIndex: 0xFF,
  };
}

const spritesA = makeSpriteBuf();
const spritesB = makeSpriteBuf();
let spritesCur  = spritesA;
let spritesNext = spritesB;

const SPRITE_SIZE_16 = 0x20; // PPUCTRL bit 5
const SPR_PATTERN_T  = 0x08; // PPUCTRL bit 3 (8x8 sprites)
const SPR_Y_OFFSET   = 1;

// ---- render-enable edge tracking ----
let renderingPrev = false;
let spriteOnlyPrimePending = false;
let spriteXForceZeroNextFrame = false;
let sprite0FetchComplete = true;

// ---- OAM corruption ----
let oamCorruptPending = false;
let oamCorruptSeedRow = 0;
let secOAMAddr = 0;
const secondaryOAM = new Uint8Array(32);
let secOAMPrimaryAddr = 0;
let secOAMPrimaryOverflow = false;
let secOAMAddrOverflow = false;
let secOAMOverflowDetection = false;
let secOAMCopyBytes = 0;
let secOAMFetchInterrupted = false;
let frozenSecondaryFetchApplied = false;
let accuracyCoinFrozenFetchTrace = [];
let ppuOAMDataBus = 0xFF;
let spriteOverflowSetScanline = -1;
let spriteOverflowSetDot = -1;
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

function mapNametableAddr(addr) { return mapNT(addr); }

// ---- OAM Corruption helpers ----
function oamCorruptDoCopyRow(seedRow) {
  const dest = (seedRow & 0x1F) << 3;
  for (let i = 0; i < 8; i++) {
    OAM[(dest + i) & 0xFF] = OAM[i & 0xFF];
  }
}

// Secondary OAM bus model.  This is deliberately separate from the existing
// bulk sprite renderer: it tracks the 2C02's 5-bit secondary-OAM counter and
// primary-OAM evaluation address dot-by-dot so CPU $2004 races can observe the
// hardware state without perturbing the proven sprite rendering path.
function updateSecondaryOAMAddrForDot(scanline, dot) {
  // Secondary-OAM evaluation/fetch has its own one-dot PPUMASK sampling
  // delay, distinct from the renderer's longer visual-pipeline delay.
  if (ppuOAMMaskBits() === 0) return;
  if (!(scanline === 261 || (scanline >= 0 && scanline <= 239))) return;

  // The 2C02 clears the secondary-OAM increment freeze at specific reset
  // points only while rendering is active. Keep the address itself untouched
  // here so the already-verified $2004 bus values at dots 63/255 are stable.
  if (dot === 63 || dot === 255 || dot === 339) {
    secOAMAddrOverflow = false;
  }

  if (dot >= 1 && dot <= 64) {
    if (dot === 1) secOAMAddr = 0;
    if (dot & 1) {
      ppuOAMDataBus = 0xFF;
    } else {
      secondaryOAM[secOAMAddr & 0x1F] = 0xFF;
      secOAMAddr = (secOAMAddr + 1) & 0x1F;
      ppuOAMDataBus = 0xFF;
    }
    return;
  }

  if (dot >= 65 && dot <= 256) {
    const sprH = (PPUCTRL & SPRITE_SIZE_16) ? 16 : 8;

    if (dot === 65) {
      secOAMPrimaryAddr = OAMADDR & 0xFF;
      secOAMPrimaryOverflow = false;
      secOAMAddrOverflow = false;
      secOAMOverflowDetection = false;
      secOAMCopyBytes = 0;
      secOAMAddr = 0;
    }

    if (dot & 1) {
      const a = secOAMPrimaryAddr & 0xFF;
      let v = OAM[a] & 0xFF;
      // OAM attribute bits 2-4 are not implemented in the DRAM.  The mask is
      // visible on the internal evaluation bus as well as ordinary $2004
      // reads, so secondary OAM receives the masked byte.
      if ((a & 3) === 2) v &= 0xE3;
      ppuOAMDataBus = v;
      return;
    }

    const original = ppuOAMDataBus & 0xFF;

    if (!(secOAMPrimaryOverflow || secOAMAddrOverflow)) {
      secondaryOAM[secOAMAddr & 0x1F] = original;
    } else {
      ppuOAMDataBus = secondaryOAM[secOAMAddr & 0x1F] & 0xFF;
    }

    const moveByte = () => {
      secOAMPrimaryAddr = (secOAMPrimaryAddr + 1) & 0xFF;
      if (secOAMPrimaryAddr === 0) secOAMPrimaryOverflow = true;
      if (!secOAMAddrOverflow) {
        secOAMAddr = (secOAMAddr + 1) & 0x1F;
        if (secOAMAddr === 0) {
          secOAMAddrOverflow = true;
          secOAMOverflowDetection = true;
        }
      }
    };

    // Visible-scanline sprite evaluation does not wrap Y=$FF around to
    // scanline 0. The pre-render line has its own 8-bit comparator behavior
    // (261 & $FF == 5), used by the scanline-0 sprite quirk.
    const compareLine = scanline === 261 ? 5 : scanline;
    const inRange = scanline === 261
      ? ((((compareLine - original) & 0xFF) < sprH))
      : (original <= compareLine && (compareLine - original) < sprH);

    if (secOAMCopyBytes > 0) {
      const finalXByte = secOAMCopyBytes === 1;
      secOAMCopyBytes--;

      if (finalXByte && !inRange) {
        secOAMPrimaryAddr = (secOAMPrimaryAddr + 1) & 0xFC;
        if (secOAMPrimaryAddr === 0) secOAMPrimaryOverflow = true;

        if (!secOAMAddrOverflow) {
          secOAMAddr = (secOAMAddr + 1) & 0x1F;
          if (secOAMAddr === 0) {
            secOAMAddrOverflow = true;
            secOAMOverflowDetection = true;
          }
        }
      } else {
        moveByte();
      }
      return;
    }

    if (inRange && !(secOAMPrimaryOverflow || secOAMAddrOverflow)) {
      secOAMCopyBytes = 3;
      moveByte();
      return;
    }

    if (!secOAMOverflowDetection) {
      secOAMPrimaryAddr = (secOAMPrimaryAddr + 4) & 0xFC;
      if (secOAMPrimaryAddr === 0) secOAMPrimaryOverflow = true;
    } else if (inRange && !secOAMPrimaryOverflow) {
      // With secondary OAM full, an in-range comparison ends the diagonal
      // overflow search. The PPU then reads the remaining three bytes of the
      // candidate sprite with normal +1 primary-OAM increments while OAM2
      // remains read-only/frozen.
      secOAMOverflowDetection = false;
      secOAMCopyBytes = 3;
      moveByte();
    } else {
      // Out-of-range during the overflow search increments n and m without
      // carry: +4 to the sprite index and +1 to the byte index, i.e. the
      // characteristic +5 diagonal scan.
      secOAMPrimaryAddr =
        (((secOAMPrimaryAddr + 4) & 0xFC) |
         ((secOAMPrimaryAddr + 1) & 3)) & 0xFF;
      if ((secOAMPrimaryAddr & 0xFC) === 0) secOAMPrimaryOverflow = true;
    }
    return;
  }

  if (dot >= 257 && dot <= 320) {
    if (dot === 257) {
      secOAMFetchInterrupted = false;
      // Normal rendering cleared the freeze at dot 255, so sprite fetch starts
      // from byte 0. If rendering was disabled across dot 255, the freeze
      // survives and fetch repeatedly exposes the current OAM2 byte.
      if (!secOAMAddrOverflow) secOAMAddr = 0;
    }

    const phase = (dot - 257) & 7;
    // The secondary-OAM address advances for Y/tile/attribute and once at
    // the end of each 8-dot sprite fetch.  The X byte remains on the bus
    // through the four pattern-fetch dots.
    if (phase === 0 || phase === 1 || phase === 2 || phase === 3 || phase === 7) {
      // Y/tile/attribute advance on phases 0-2. Phase 3 places X on
      // the OAM data bus without advancing; X remains there through the
      // pattern fetches, and phase 7 performs the final address increment.
      ppuOAMDataBus = secondaryOAM[secOAMAddr & 0x1F] & 0xFF;
      if (phase !== 3 && !secOAMAddrOverflow) {
        secOAMAddr = (secOAMAddr + 1) & 0x1F;
        if (secOAMAddr === 0) secOAMAddrOverflow = true;
      }
    }
    return;
  }

  if (dot >= 321 && dot <= 340) {
    // A complete sprite-fetch sequence naturally wraps the 5-bit secondary
    // OAM address to zero. If rendering was interrupted during dots 257-320,
    // preserve the partial address so the following 321-340 reads expose the
    // misalignment instead.
    if (dot === 321 && !secOAMFetchInterrupted) secOAMAddr = 0;
    ppuOAMDataBus = secondaryOAM[secOAMAddr & 0x1F] & 0xFF;
  }
}

// ---- Sprite fetch ----
function spritePatternAddress(tileIndex, attr, rowInSprite) {
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

  return addrLo;
}
function evalSpritesForScanline(target, scanline) {
  // Forced blank does not overwrite the already-loaded secondary sprite state.
  if (!renderingNow()) return;

  target.count = 0;
  target.sprite0ListIndex = 0xFF;

  const is8x16 = (PPUCTRL & SPRITE_SIZE_16) !== 0;
  const sprH   = is8x16 ? 16 : 8;

  let overflow = false;
  let evaluationDot = 65;
  // leave this as OAMADDR, do not force 0 here on PPU side, logic in addCycle function
  const startAddr = (OAMADDR & 0xFF);

  for (let m = 0; m < 64; m++) {
    const baseAddr = (startAddr + (m << 2)) & 0xFF;

    const y = (OAM[baseAddr] & 0xFF);
    if (y === 0xFF) { evaluationDot += 2; continue; }

    const top = (y + SPR_Y_OFFSET) | 0;
    if (scanline < top) { evaluationDot += 2; continue; }

    const row = (scanline - top) | 0;
    if (row < 0 || row >= sprH) { evaluationDot += 2; continue; }

    const tile = OAM[(baseAddr + 1) & 0xFF] & 0xFF;
    const attr = OAM[(baseAddr + 2) & 0xFF] & 0xFF;
    const x    = OAM[(baseAddr + 3) & 0xFF] & 0xFF;

    if (target.count < SPR_MAX) {
      const i = target.count++;
      target.tile[i] = tile;
      target.row[i] = row;
      target.attr[i] = attr;
      target.xcnt[i] = x;
      target.lo[i]   = 0;
      target.hi[i]   = 0;
      target.idx[i]  = baseAddr & 0xFF;

      if (m === 0) target.sprite0ListIndex = i & 0xFF;
      // Each in-range sprite consumes four read/write pairs during evaluation.
      evaluationDot += 8;
    } else {
      overflow = true;
      // The ninth in-range Y comparison completes around this dot.
      spriteOverflowSetScanline = PPUclock.scanline;
      spriteOverflowSetDot = Math.min(256, evaluationDot + 2);
      break;
    }
  }

  if (!overflow) {
    spriteOverflowSetScanline = -1;
    spriteOverflowSetDot = -1;
  }
}

function spriteShiftersTick() {

  for (let i = 0; i < spritesCur.count; i++) {
    if (spritesCur.xcnt[i] > 0) {
      spritesCur.xcnt[i] = (spritesCur.xcnt[i] - 1) & 0xFF;
    } else {
      spritesCur.lo[i] = ((spritesCur.lo[i] << 1) & 0xFF);
      spritesCur.hi[i] = ((spritesCur.hi[i] << 1) & 0xFF);
    }
  } 
}

function sampleSpritePixel(x) {
  if (!sprEnabledNow()) return null;
  if (x < 8 && (PPUMASK & MASK_SPR_SHOW_LEFT8) === 0) return null;

  for (let i = 0; i < spritesCur.count; i++) {
    if (spritesCur.xcnt[i] !== 0) continue;

    const p0 = (spritesCur.lo[i] >> 7) & 1;
    const p1 = (spritesCur.hi[i] >> 7) & 1;
    const color2 = (p1 << 1) | p0;
    if (color2 === 0) continue;

    const attr = spritesCur.attr[i] & 0xFF;
    const pal  = (attr & 0x03) & 3;
    const priBehindBG = (attr & 0x20) !== 0;

    const palAddr = 0x3F10 | ((pal << 2) | color2);
    let palIndex6 = ppuBusRead(palAddr) & 0x3F;

    if (PPUMASK & MASK_GREYSCALE) palIndex6 &= 0x30;

    return {
      palIndex6,
      priBehindBG,
      isSprite0: (i === spritesCur.sprite0ListIndex),
    };
  }

  return null;
}

// ---- Background helpers ----
// this never runs
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
        PPUclock.dot >= 1 && PPUclock.dot <= 255) {
      SET_SPRITE0_HIT();
    }

    if (!spr.priBehindBG || !bgOpaque) {
      finalIndex6 = spr.palIndex6;
    }
  }

  const idx = (y << 8) + x;
  paletteIndexFrame[idx] = finalIndex6 & 0x3F;
}

// ---- Scroll / VRAM address ops ----
// PPUDATA clocks both scrolling counters on rendering scanlines. The linear
// increment setting only applies during blanking or when rendering is off.
function incrementPPUDataAddress() {
  const sl = PPUclock.scanline;
  if (renderingNow() && (sl < 240 || sl === 261)) {
    incCoarseX();
    incY();
  } else {
    VRAM_ADDR = (VRAM_ADDR + ((PPUCTRL & 0x04) ? 32 : 1)) & 0x7FFF;
  }
}

function incCoarseX() {
  if (!renderingNow()) return;
  let v = VRAM_ADDR;
  if ((v & 0x001F) === 31) { v &= ~0x001F; v ^= 0x0400; }
  else { v = (v & ~0x001F) | ((v + 1) & 0x001F); }
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
    VRAM_ADDR = (VRAM_ADDR & ~0x7FE0) | (t & 0x7FE0);
}

// ---- PPU bus read ----
function ppuBusRead(addr) {
    addr &= 0x3FFF;
    //if (mapperNumber === 4) mmc3Irq(addr);

    if (addr < 0x2000) {
        return cartridgeChrRead(addr) & 0xFF;
    }

    if (addr < 0x3F00) {
        const mapped = mapNametableAddr(0x2000 | (addr & 0x0FFF));
        return VRAM[mapped] & 0xFF;
    }

    // Palette
    let p = addr & 0x1F;
    if ((p & 0x13) === 0x10) p &= ~0x10;
    return PALETTE_RAM[p] & 0x3F;
}
function ppuBackgroundRead(addr, kind) {
  addr &= 0x3FFF;
  let effective = addr;

  if (kind === 'patternLo' && ppuCpu2007ReadUntil >= ppuCycles) {
    effective = (addr & 0x3F00) | (ppuExternalData & 0xFF);
    ppuCpu2007ReadUntil = -1;
  } else if (kind === 'nametable' && ppuCpu2006HybridUntil >= ppuCycles) {
    effective = (addr & 0x3F00) | (ppuCpu2006HybridLow & 0xFF);
    ppuCpu2006HybridUntil = -1;
  }

  ppuExternalLatchLow = effective & 0xFF;
  const value = ppuBusRead(effective) & 0xFF;
  ppuExternalData = value;
  return value;
}

// ---- Scanline handlers ----
function preRenderScanline(dot) {
  const ren = renderingNow();

  if (dot === 1 && oamCorruptPending && ren) {
    oamCorruptDoCopyRow(oamCorruptSeedRow);
    oamCorruptPending = false;
  }

  if (dot === 0 && nmiAtVblankEnd && ppuInitDone) {
    CLEAR_VBLANK();
  }

  if (dot === 1 && ppuInitDone) {
    CLEAR_VBLANK();
    CLEAR_SPRITE0_HIT();
    CLEAR_SPRITE_OVERFLOW();

    nmiSuppression = false;
    doNotSetVblank = false;
  }

  if (dot === 65) evalSpritesForScanline(spritesNext, 0);

  if (ren && dot === 256) incY();
  if (ren && dot === 257) copyHoriz();
  if (ren && dot >= 280 && dot <= 304) copyVert();

  const inFetch = (dot >= 2 && dot <= 256) || (dot >= 321 && dot <= 336);
  const phase   = (dot - 1) & 7;

  if (ren && phase === 0 && dot >= 9 && dot <= 257) reloadBGShifters(false);

  if (ren && dot >= 2 && dot <= 256) {
    background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
    // Fixed serial inputs in the 2C02 pattern shifters: low plane shifts in
    // logical 0 while the high plane shifts in logical 1.
    background.bgShiftHi = ((background.bgShiftHi << 1) | 1) & 0xFFFF;
    background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
    background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
  }

    if (ren && inFetch) {

      if (phase === 1) {
        vFetch = VRAM_ADDR;
      }

      const v = vFetch;

      switch (phase) {
      case 1: {
        background.ntByte = ppuBackgroundRead(0x2000 | (v & 0x0FFF), 'nametable');
        BG_ntByte = background.ntByte;
        break;
      }
      case 3: {
        const attAddr = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
        const shift   = ((v >> 4) & 4) | (v & 2);
        const atBits  = (ppuBackgroundRead(attAddr, 'attribute') >> shift) & 3;
        background.atByte = atBits & 0x03;
        BG_atByte = background.atByte;
        break;
      }
      case 5: {
        const fineY = (v >> 12) & 7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY;
        background.tileLo = ppuBackgroundRead(base, 'patternLo') & 0xFF;
        BG_tileLo = background.tileLo;
        break;
      }
      case 7: {
        const fineY = (v >> 12) & 7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY + 8;
        background.tileHi = ppuBackgroundRead(base, 'patternHi') & 0xFF;
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

  if (dot === 339) {
    spriteXForceZeroNextFrame = !renderingNow();
  }

  if (dot === 340) {
    if (!ppuInitDone) ppuInitDone = true;
  }
}

function visibleScanline(dot) {
  const ren   = renderingNow();
  const phase = (dot - 1) & 7;
  const inFetch = (dot >= 2 && dot <= 256) || (dot >= 321 && dot <= 336);

  if (dot === 257) sprite0FetchComplete = ren;
  else if (dot > 257 && dot <= 264 && !ren) sprite0FetchComplete = false;

  if (PPUclock.scanline === spriteOverflowSetScanline && dot === spriteOverflowSetDot) {
    SET_SPRITE_OVERFLOW();
    spriteOverflowSetScanline = -1;
    spriteOverflowSetDot = -1;
  }

  if (dot === 1 && oamCorruptPending && ren) {
    oamCorruptDoCopyRow(oamCorruptSeedRow);
    oamCorruptPending = false;
  }

  if (dot === 1) {
    if (spriteOnlyPrimePending && sprEnabledNow() && !bgEnabledNow()) {
      primeBGForSpriteOnly();
      spriteOnlyPrimePending = false;
    }

    if (!sprite0FetchComplete && spritesCur.count > 0 && spritesNext.count > 0) {
      // Sprite 0's HBlank reload was interrupted. Keep the active counter and
      // shifters, while the rest of the newly evaluated sprite list proceeds.
      spritesNext.attr[0] = spritesCur.attr[0];
      spritesNext.xcnt[0] = spritesCur.xcnt[0];
      spritesNext.lo[0] = spritesCur.lo[0];
      spritesNext.hi[0] = spritesCur.hi[0];
      spritesNext.idx[0] = spritesCur.idx[0];
      if (spritesCur.sprite0ListIndex === 0) spritesNext.sprite0ListIndex = 0;
    }

    const tmp = spritesCur;
    spritesCur = spritesNext;
    spritesNext = tmp;
    sprite0FetchComplete = true;

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

  if (dot === 65) evalSpritesForScanline(spritesNext, (PPUclock.scanline + 1) | 0);

  if (ren && phase === 0 && dot >= 9 && dot <= 257) reloadBGShifters(false);

  if (dot >= 1 && dot <= 256) {
    emitPixelHardwarePalette();

    if (ren && dot >= 1 && dot <= 256) {
      background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
      background.bgShiftHi = ((background.bgShiftHi << 1) | 1) & 0xFFFF;
      background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
      background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
    }

    if (ren) {
      if (!spriteXForceZeroNextFrame) {
        spriteShiftersTick();
      } else {
        // If dot 339 occurred during forced blank, the freshly loaded sprite
        // counters remain halted. They therefore draw immediately when
        // rendering resumes.
        for (let i = 0; i < spritesCur.count; i++) spritesCur.xcnt[i] = 0;
        spriteXForceZeroNextFrame = false;
      }
    } else {
      // Forced blank pauses sprite pattern shifters, but X counters that are
      // already counting continue toward zero.
      for (let i = 0; i < spritesCur.count; i++) {
        if (spritesCur.xcnt[i] > 0) spritesCur.xcnt[i]--;
      }
    }
  }

    if (ren && inFetch) {

      if (phase === 1) {
        vFetch = VRAM_ADDR;
      }

      const v = vFetch;

      switch (phase) {
      case 1: {
        background.ntByte = ppuBackgroundRead(0x2000 | (v & 0x0FFF), 'nametable');
        BG_ntByte = background.ntByte;
        break;
      }
      case 3: {
        const attAddr = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
        const shift   = ((v >> 4) & 4) | (v & 2);
        const atBits  = (ppuBackgroundRead(attAddr, 'attribute') >> shift) & 3;
        background.atByte = atBits & 0x03;
        BG_atByte = background.atByte;
        break;
      }
      case 5: {
        const fineY = (v >> 12) & 7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY;
        background.tileLo = ppuBackgroundRead(base, 'patternLo') & 0xFF;
        BG_tileLo = background.tileLo;
        break;
      }
      case 7: {
        const fineY = (v >> 12) & 7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY + 8;
        background.tileHi = ppuBackgroundRead(base, 'patternHi') & 0xFF;
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

  // Dot 339 selects whether freshly loaded sprite X counters enter counting
  // mode on every rendering scanline, not just the pre-render line.
  if (dot === 339) spriteXForceZeroNextFrame = !renderingNow();

}

function postRenderScanline(dot) {}

function vblankStartScanline(dot) {
  if (!ppuInitDone) return;

  function setNmiEdge(){
    PPU_FRAME_FLAGS |= 0b00000100;
  }

  function clearNmiEdge(){
    PPU_FRAME_FLAGS &= ~0b00000100;
  }

  function isNmiBitSet(){
    return (PPUCTRL & 0x80) !== 0;
  }

  function isVblankBitSet() {
    return (PPUSTATUS & 0x80) !== 0;
 } 

  // vblank signal might be rising
  if (dot === 0) {
    if (isNmiBitSet()){
    setNmiEdge();
    }
  }

  if (dot === 1) {
    SET_VBLANK(); 

    if (!isNmiBitSet()) clearNmiEdge();
    if (doNotSetVblank) CLEAR_VBLANK();
  }

  if (dot === 2){ 
    if (doNotSetVblank) CLEAR_VBLANK();
    if (!isNmiBitSet()) clearNmiEdge();
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

// When the secondary-OAM increment freeze survives into sprite fetch, the
// same OAM2 byte is presented for Y, tile, attribute and X for every slot.
// Keep this override isolated to the frozen-latch case so the established
// bulk renderer remains untouched during normal fetches.
function applyFrozenSecondaryOAMFetch(scanline) {
  const v = secondaryOAM[secOAMAddr & 0x1F] & 0xFF;
  const targetLine = scanline === 261 ? 0 : ((scanline + 1) | 0);
  const top = (v + SPR_Y_OFFSET) | 0;
  let row = targetLine - top;
  if (row < 0) row = 0;
  row &= 0x0F;

  const oldSprite0 = spritesNext.sprite0ListIndex;
  if (accuracyCoinFrozenFetchTrace.length < 64) {
    accuracyCoinFrozenFetchTrace.push({
      scanline: scanline|0,
      dot: PPUclock.dot|0,
      value: v,
      secAddr: secOAMAddr & 0x1F,
      frozen: !!secOAMAddrOverflow,
      oamMask: ppuOAMMaskBits() & 0x18,
      visualMask: ppuEffectiveMask() & 0x18,
      targetLine,
      row,
      oldCount: spritesNext.count|0,
      oldSprite0: oldSprite0|0,
      oldTile0: spritesNext.tile[0] & 0xFF,
      oldAttr0: spritesNext.attr[0] & 0xFF,
      oldX0: spritesNext.xcnt[0] & 0xFF
    });
  }
  spritesNext.count = SPR_MAX;
  for (let i = 0; i < SPR_MAX; i++) {
    spritesNext.tile[i] = v;
    spritesNext.attr[i] = v;
    spritesNext.xcnt[i] = v;
    spritesNext.row[i] = row;
    spritesNext.lo[i] = 0;
    spritesNext.hi[i] = 0;
  }
  // Preserve provenance from the evaluation stage; in AccuracyCoin's frozen
  // cases OAM2[0] is sprite zero, so slot 0 remains the sprite-zero unit.
  spritesNext.sprite0ListIndex = oldSprite0;
}

// Fetch sprite patterns at their bus phases, using the live sprite-size setting.
// MMC3 observes the same addresses. Palette lookups and
// bulk sprite evaluation are internal renderer work and must not clock A12.
function renderingBusTick() {
  const d=PPUclock.dot+1,sl=PPUclock.scanline;

  // OAM fetch enable is sampled independently of the visual pipeline.
  // Arm at the start of sprite fetch, then apply the frozen secondary-OAM
  // bytes on the first OAM-active dot before the pattern fetch phases begin.
  // A CPU PPUMASK write around dot 256 can make that first active dot occur
  // just after 257 because OAM uses its own one-dot sampling delay.
  if (d === 257) frozenSecondaryFetchApplied = false;
  if (!frozenSecondaryFetchApplied &&
      d >= 257 && d <= 261 &&
      secOAMAddrOverflow && ppuOAMMaskBits() !== 0 &&
      (sl <= 239 || sl === 261)) {
    applyFrozenSecondaryOAMFetch(sl);
    frozenSecondaryFetchApplied = true;
  }

  if(mapperNumber!==4 && (d<257 || d>320))return;
  if(!renderingNow() || (sl>239 && sl!==261)){mmc3Irq(VRAM_ADDR);return;}
  if(PPUclock.dot>=336){
    if(PPUclock.dot===337 || PPUclock.dot===339)mmc3Irq(0x2000|(VRAM_ADDR&0xfff));
    return;
  }
  if(!(d&1) || d===0)return;
  if(d>=257 && d<=320) {
    const slot=(d-257)>>3,phase=(d-257)&7;
    if(phase<4)mmc3Irq(0x2000|(VRAM_ADDR&0xfff));
    else {
      const address=slot<spritesNext.count?
        spritePatternAddress(spritesNext.tile[slot],spritesNext.attr[slot],spritesNext.row[slot]):
        spritePatternAddress(255,255,0);
      const fetchAddress=address+(phase===6?8:0);
      mmc3Irq(fetchAddress);
      if(slot<spritesNext.count) {
        let data=ppuBusRead(fetchAddress);
        if(spritesNext.attr[slot]&0x40)data=reverseByte(data);
        if(phase===4)spritesNext.lo[slot]=data;else spritesNext.hi[slot]=data;
      }
    }
  } else if(d<=256 || d>=321) {
    const phase=(d-1)&7;
    if(d>=337 || phase<4)mmc3Irq(0x2000|(VRAM_ADDR&0xfff));
    else mmc3Irq((PPUCTRL&16?0x1000:0)+(background.ntByte<<4)+
      ((VRAM_ADDR>>12)&7)+(phase===6?8:0));
  }
}

// ---- Tick ----
function ppuTick() {
  renderingBusTick();
  const maskNow = PPUMASK & 0xFF;
  const renNow  = (maskNow & 0x18) !== 0;
  const renPrev = ((ppumaskPrev & 0x18) !== 0);

  updateSecondaryOAMAddrForDot(PPUclock.scanline, PPUclock.dot);

  if (renPrev && !renNow) {
    if (PPUclock.scanline === 261 || (PPUclock.scanline >= 0 && PPUclock.scanline <= 239)) {
      if (PPUclock.dot >= 257 && PPUclock.dot <= 320) {
        secOAMFetchInterrupted = true;
      }
      oamCorruptSeedRow = secOAMAddr & 0x1F;
      oamCorruptPending = true;
    }
  }

  ppumaskPrev = maskNow;

  const renNow2 = renderingNow();
  if (!renderingPrev && renNow2) {
    if (sprEnabledNow() && !bgEnabledNow()) spriteOnlyPrimePending = true;
  }
  renderingPrev = renNow2;

  if(PPUclock.scanline===261 && PPUclock.dot===338)
    oddSkipRendering=(PPUMASK&0x18)!==0;

  if (PPUclock.oddFrame && oddSkipRendering &&
      PPUclock.scanline === 261 && PPUclock.dot === 339) {
      PPUclock.scanline = 0;
      PPUclock.dot = -1;
      PPUclock.oddFrame = false;
      nmiAtVblankEnd = false;
      return;
    }

  scanlineLUT[PPUclock.scanline](PPUclock.dot);

  if (renNow2) {
    const sl = PPUclock.scanline | 0;
    const d  = PPUclock.dot | 0;

    const visible   = (sl >= 0 && sl <= 239);
    const preRender = (sl === 261);
    const visOrPre  = visible || preRender;

    if (visible && d >= 65 && d <= 256) {
      if ((d & 1) === 0) {
        OAMADDR = (OAMADDR + 1) & 0xFF;
      }
    }

    if (visOrPre && d >= 257 && d <= 320) {
      OAMADDR = 0;
    }
  }

  if (PPUclock.scanline === 260 && PPUclock.dot === 340) PPUclock.frame++;

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
    for (let ticks = 0; ticks < 3; ticks++) {
      current.dot = PPUclock.dot;
      current.frame = PPUclock.frame;
      current.scanline = PPUclock.scanline;

      ppuTick();
      PPUclock.dot++;

      ppuCycles++;
    }
}
