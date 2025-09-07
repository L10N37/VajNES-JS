// ppu-worker.js
// Notes:
// - 341 dots/scanline (0..340), 262 scanlines/frame (0..261)
// - Odd-frame short pre-render: consume 1 dot (skip work at pre-render dot 0)
importScripts('/assets/js/ppu-worker-setup.js');
console.debug('[PPU Worker init]');

// Prefetch latches for the *next* scanline (captures during 321–336)
const nextLine = {
  t0: { lo:0, hi:0, at:0 },  // first tile of next line
  t1: { lo:0, hi:0, at:0 },  // second tile of next line
};

// Debug: fine-pixel adjust ONLY the first visible row (scanline 0). -7..+7
let PPU_FIRST_ROW_FINE_SKEW = 32; //delete

// ---- Shared indices ----
const SYNC_CPU_CYCLES   = 0;
const SYNC_PPU_BUDGET   = 1;
const SYNC_SCANLINE     = 2;
const SYNC_DOT          = 3;
const SYNC_FRAME        = 4;
const SYNC_VBLANK_FLAG  = 5;
const SYNC_NMI_EDGE     = 6;

// ---- Shared setters ----
const STORE_CURRENT_SCANLINE = v => Atomics.store(SHARED.SYNC, SYNC_SCANLINE, v|0);
const STORE_CURRENT_DOT      = v => Atomics.store(SHARED.SYNC, SYNC_DOT,      v|0);
const STORE_CURRENT_FRAME    = v => Atomics.store(SHARED.SYNC, SYNC_FRAME,    v|0);
const STORE_VBLANK_FLAG      = v => Atomics.store(SHARED.SYNC, SYNC_VBLANK_FLAG, v ? 1 : 0);
const SET_NMI_EDGE           = v => Atomics.store(SHARED.SYNC, SYNC_NMI_EDGE, v|0);

// ---- Status bit helpers ----
const CLEAR_VBLANK          = () => { PPUSTATUS &= ~0x80; STORE_VBLANK_FLAG(0); };
const SET_VBLANK            = () => { PPUSTATUS |=  0x80; STORE_VBLANK_FLAG(1); };
const CLEAR_SPRITE0_HIT     = () => { PPUSTATUS &= ~0x40; };
const SET_SPRITE0_HIT       = () => { PPUSTATUS |=  0x40; };
const CLEAR_SPRITE_OVERFLOW = () => { PPUSTATUS &= ~0x20; };
const SET_SPRITE_OVERFLOW   = () => { PPUSTATUS |=  0x20; };

// ---- Geometry ----
const DOTS_PER_SCANLINE   = 341; // 0..340
const SCANLINES_PER_FRAME = 262; // 0..261
const NES_W = 256, NES_H = 240;

// Helpful masks (PPUMASK / $2001)
const MASK_BG_SHOW_LEFT8  = 0x02; // 1 = show background in leftmost 8 pixels
const MASK_SPR_SHOW_LEFT8 = 0x04; // 1 = show sprites in leftmost 8 pixels
const MASK_BG_ENABLE      = 0x08; // 1 = show background
const MASK_SPR_ENABLE     = 0x10; // 1 = show sprites

let ppuInitDone = false; // first frame we do not touch nmi/ vblank

// ---- Live rendering flag ----
Object.defineProperty(globalThis, 'rendering', {
  configurable: true,
  get() { return (PPUMASK & 0x18) !== 0; }
});

// ---- Clock state ----
const PPUclock = { dot: 0, scanline: 261, frame: 0, oddFrame: false };

// ---- Background pipeline ----
const background = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0
};

// ---- t register helpers (lo/hi are globals from setup) ----
function t_get() { return ((t_hi & 0xFF) << 8) | (t_lo & 0xFF); }
function t_set(v) { v &= 0x7FFF; t_lo = v & 0xFF; t_hi = (v >> 8) & 0xFF; }

// ---- Sync + logging accumulators ----
let prevVblank = 0;
let renderActiveThisFrame = false;

// ---- Local execution budget ----
let budgetLocal = 0; // dots available to run immediately

let VBL_lastSetCPU = 0;

// ---- Tick ----
function ppuTick() {
  // Odd-frame short pre-render: skip dot 0 when rendering
  if (PPUclock.scanline === 261 && PPUclock.dot === 0 && PPUclock.oddFrame && rendering) {
    PPUclock.dot = 1;
    STORE_CURRENT_SCANLINE(PPUclock.scanline);
    STORE_CURRENT_DOT(PPUclock.dot);
    STORE_CURRENT_FRAME(PPUclock.frame);
    return;
  }

  // Execute one dot
  scanlineLUT[PPUclock.scanline](PPUclock.dot);

  // Advance dot/scanline
  if (PPUclock.dot === DOTS_PER_SCANLINE - 1) {
    PPUclock.dot = 0;

    if (PPUclock.scanline === 260) {
      PPUclock.scanline = 261;
    } else if (PPUclock.scanline === 261) {
      PPUclock.scanline = 0;
      PPUclock.frame++;
      PPUclock.oddFrame = !PPUclock.oddFrame;
    } else {
      PPUclock.scanline++;
    }
  } else {
    PPUclock.dot++;
  }

  // Publish new position
  STORE_CURRENT_SCANLINE(PPUclock.scanline);
  STORE_CURRENT_DOT(PPUclock.dot);
  STORE_CURRENT_FRAME(PPUclock.frame);
}

// ---- Scanline handlers ----
function preRenderScanline(dot) {
  if (dot === 1) {
    CLEAR_VBLANK();

    const delta    = (cpuCycles - VBL_lastSetCPU) | 0;
    const shortPre = (PPUclock.oddFrame && (PPUMASK & 0x18) !== 0) ? 1 : 0;
    const expDots  = 20 * 341 - shortPre;
    const expLo    = Math.floor(expDots / 3) - 2;
    const expHi    = Math.ceil(expDots / 3) + 2;
    const ok       = (delta >= expLo && delta <= expHi);
    // generally 2273/2274 depending on odd or even frame
    console.debug(
      `Vblank Clear: ${cpuCycles} Δ ${delta} ${ok ? 'PASS' : 'FAIL'} [exp ${expLo}..${expHi}]`
    );

    if (!ppuInitDone) ppuInitDone = true;
    renderActiveThisFrame = (PPUMASK & 0x18) !== 0;
    prevVblank = 0;
    CLEAR_SPRITE0_HIT();
    CLEAR_SPRITE_OVERFLOW();
  }

  if (rendering && dot === 256) incY();
  if (rendering && dot === 257) copyHoriz();
  if (rendering && dot >= 280 && dot <= 304) copyVert();

  const inFetch = (dot >= 2 && dot <= 256) || (dot >= 321 && dot <= 336);
  const phase   = (dot - 1) & 7;

  if (rendering && dot >= 2 && dot <= 256) {
    background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
    background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
    background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
    background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
  }

  if (rendering && inFetch) {
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
        const fineY = (v >> 12) & 0x7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) +
                      ((background.ntByte & 0xFF) << 4) + fineY;
        background.tileLo = ppuBusRead(base);
        BG_tileLo = background.tileLo;
        break;
      }
      case 7: {
        const fineY = (v >> 12) & 0x7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) +
                      ((background.ntByte & 0xFF) << 4) + fineY + 8;
        background.tileHi = ppuBusRead(base);
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
    PPU_FRAME_FLAGS = 0x01;
  }
}

function visibleScanline(dot) {
  const phase = (dot - 1) & 7;
  const inFetch = (dot >= 2 && dot <= 256) || (dot >= 321 && dot <= 336);

  if ((PPUMASK & MASK_BG_ENABLE) && dot === 1) {
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

  if ((PPUMASK & MASK_BG_ENABLE) && phase === 0 && dot >= 9 && dot <= 257) {
    reloadBGShifters(false);
  }

  if ((PPUMASK & MASK_BG_ENABLE) && dot >= 1 && dot <= 256) {
    emitPixelHardwarePalette();
    if (dot < 256) {
      background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
      background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
      background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
      background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
    }
  }

  if ((PPUMASK & MASK_BG_ENABLE) && inFetch) {
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
        const fineY = (v >> 12) & 0x7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY;
        background.tileLo = ppuBusRead(base) & 0xFF;
        BG_tileLo = background.tileLo;
        break;
      }
      case 7: {
        const fineY = (v >> 12) & 0x7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY + 8;
        background.tileHi = (ppuBusRead(base) & 0xFF);
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

  if (rendering && dot === 256) incY();
  if (rendering && dot === 257) copyHoriz();
}

function postRenderScanline(dot) { return; }

// Gated first frame (PPU INIT)
function vblankStartScanline(dot) {
  if (dot !== 1) return;
  if (!ppuInitDone) return;

  SET_VBLANK();
  console.debug("Vblank Set", cpuCycles);
  VBL_lastSetCPU = cpuCycles;

  if (!prevVblank) {
    prevVblank = 1;
    if (PPUCTRL & 0x80) {
      const marker =
        ((PPUclock.frame & 0xFFFF) << 16) |
        ((PPUclock.scanline & 0x1FF) << 7) |
        (dot & 0x7F);
      SET_NMI_EDGE(marker);
    }
  }
}

function vblankIdleScanline(_) { /* no-op */ }

// ---- Scanline LUT (0-based; 0 = pre-render) ----
const scanlineLUT = new Array(262);
for (let i = 0; i <= 239; i++) scanlineLUT[i] = visibleScanline; // visible 0–239
scanlineLUT[240] = postRenderScanline;                           // post-render
scanlineLUT[241] = vblankStartScanline;                          // vblank start
for (let i = 242; i <= 260; i++) scanlineLUT[i] = vblankIdleScanline; // vblank idle
scanlineLUT[261] = preRenderScanline;                            // pre-render (last)

// ---- Helpers: shifters, pixels, scroll, bus ----
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

// debug horizontal offset in pixels
let BG_DEBUG_X_OFFSET = 0;     // shift frame left (negative number of dots) or right (positive)
let BG_DEBUG_Y_OFFSET = 0;     // shift frame up or down a number of scanlines

function emitPixelHardwarePalette() {
  const fx  = (fineX & 7);
  const bit = 15 - fx;

  const p0 = (background.bgShiftLo >> bit) & 1;
  const p1 = (background.bgShiftHi >> bit) & 1;
  const a0 = (background.atShiftLo >> bit) & 1;
  const a1 = (background.atShiftHi >> bit) & 1;

  let color2 = (p1 << 1) | p0;
  const attr2 = (a1 << 1) | a0;

  let x = (PPUclock.dot - 1) + BG_DEBUG_X_OFFSET;
  let y = (PPUclock.scanline) - BG_DEBUG_Y_OFFSET;

  if (x < 0 || x >= NES_W) return;
  if (y < 0 || y >= NES_H) return;

  if (x < 8 && (PPUMASK & MASK_BG_SHOW_LEFT8) === 0) {
      color2 = 0;
  }

  let palIndex6;
  if (color2 === 0) {
    palIndex6 = PALETTE_RAM[0] & 0x3F;
  } else {
    const palLow5 = ((attr2 << 2) | color2) & 0x1F;
    palIndex6 = ppuBusRead(0x3F00 | palLow5) & 0x3F;
  }

  if (PPUMASK & 0x01) palIndex6 &= 0x30;

  paletteIndexFrame[y * NES_W + x] = palIndex6;
}

function incCoarseX() {
  if (!rendering) return;
  let v = VRAM_ADDR;
  if ((v & 0x001F) === 31) { v &= ~0x001F; v ^= 0x0400; }
  else { v = (v + 1) & 0x7FFF; }
  VRAM_ADDR = v;
}

function incY() {
  if (!rendering) return;
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
  if (!rendering) return;
  const t = (t_hi << 8) | t_lo;
  VRAM_ADDR = (VRAM_ADDR & ~0x041F) | (t & 0x041F);
}

function copyVert() {
  if (!rendering) return;
  const t = (t_hi << 8) | t_lo;
  VRAM_ADDR = (VRAM_ADDR & ~0x7BE0) | (t & 0x7BE0);
}

function ppuBusRead(addr) {
  addr &= 0x3FFF;
  if (addr < 0x2000) return CHR_ROM[addr & 0x1FFF] & 0xFF;
  if (addr < 0x3F00)  return VRAM[(addr - 0x2000) & 0x07FF] & 0xFF;
  let p = addr & 0x1F;
  if ((p & 0x13) === 0x10) p &= ~0x10; // $3F10/$14/$18/$1C mirrors
  return PALETTE_RAM[p] & 0x3F;
}

// ---- Main loop (drains shared queue to local; local is visible to frame-end logic) ----
function startPPULoop() {
  while (true) {
    const pulled = Atomics.exchange(SHARED.CLOCKS, SYNC_PPU_BUDGET, 0)|0;
    if (pulled) budgetLocal += pulled;

    if (budgetLocal <= 0) continue;

    do {
      ppuTick();
    } while (--budgetLocal != 0);
  }
}