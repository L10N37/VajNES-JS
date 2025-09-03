// ppu-worker.js
// Notes:
// - 341 dots/scanline (0..340), 262 scanlines/frame (0..261)
// - Odd-frame short pre-render: consume 1 dot (skip work at pre-render dot 0)
// - Drift = cpuCycles - expectedCycles - floor(backlogPPU/3); backlogPPU = local + queued
// - If drift > 0 at frame end, immediately grant drift*3 PPU dots into local budget
// - Logging uses baseline offset for stable green on static scenes

importScripts('/assets/js/ppu-worker-setup.js');
console.debug('[PPU Worker init]');

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

let expectedCycles = 0;  // expected CPU cycles to date
let expectedPpuRem = 0;  // carry of PPU%3

let driftBaseline = null;
let driftFrames = 0, driftSum = 0, maxDrift = 0;
let syncLogging = false;

// ---- Local execution budget ----
let budgetLocal = 0; // dots available to run immediately

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
  if (PPUclock.dot === DOTS_PER_SCANLINE - 1) {   // 340 → wrap
    PPUclock.dot = 0;

    if (PPUclock.scanline === 260) {
      // End of vblank idle → pre-render (261)
      PPUclock.scanline = 261;

    } else if (PPUclock.scanline === 261) {
      // End of pre-render → start new frame at visible 0
      PPUclock.scanline = 0;
      PPUclock.frame++;
      PPUclock.oddFrame = !PPUclock.oddFrame;

    } else {
      // Visible/post/vblank start → next line
      PPUclock.scanline++;
    }

  } else {
    PPUclock.dot++;
  }

  // Publish
  STORE_CURRENT_SCANLINE(PPUclock.scanline);
  STORE_CURRENT_DOT(PPUclock.dot);
  STORE_CURRENT_FRAME(PPUclock.frame);
}

// ---- Scanline handlers ----
function preRenderScanline(dot) {
  
  if (dot === 1) {
    if (!ppuInitDone) ppuInitDone = true;
    renderActiveThisFrame = (PPUMASK & 0x18) !== 0;
    prevVblank = 0;
    CLEAR_VBLANK();
    CLEAR_SPRITE0_HIT();
    CLEAR_SPRITE_OVERFLOW();
   // paletteIndexFrame.fill(0); // clear our pixel data/ frame else always render last frame during 'blank' screens
  }

  if (rendering && dot === 256) incY();
  if (rendering && dot === 257) copyHoriz();
  if (rendering && dot >= 280 && dot <= 304) copyVert();

  const inFetch = (dot >= 2 && dot <= 256) || (dot >= 321 && dot <= 336);
  const phase   = (dot - 1) & 7;

  // reload only like a visible line would: phase-0 in 9..257 (never 321..336)
  if (rendering && phase === 0 && dot >= 9 && dot <= 257) reloadBGShifters();

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
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY;
        background.tileLo = ppuBusRead(base);
        BG_tileLo = background.tileLo;
        break;
      }
      case 7: {
        const fineY = (v >> 12) & 0x7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY + 8;
        background.tileHi = ppuBusRead(base);
        BG_tileHi = background.tileHi;
        incCoarseX();
        break;
      }
    }
  }

  // Frame end
  if (dot === 340) {

    const finishedFrame = PPUclock.frame;
    const shortPre      = (PPUclock.oddFrame && renderActiveThisFrame);

    // Expected CPU cycles += PPU-per-frame / 3 with remainder carry
    if (finishedFrame > 0) {
      const ppuThis = 89342 - (shortPre ? 1 : 0);
      expectedCycles += (ppuThis / 3) | 0;     // 29780
      expectedPpuRem += (ppuThis % 3);         // +1/+2
      if (expectedPpuRem >= 3) { expectedCycles++; expectedPpuRem -= 3; }
    }

    // notify main thread that a frame is ready
    PPU_FRAME_FLAGS = 0x01;
    //postMessage({ type: 'frame', frame: finishedFrame });

    // Backlog-aware drift (CPU cycles)
    const queued = Atomics.load(SHARED.CLOCKS, SYNC_PPU_BUDGET) | 0;
    const backlogPPU = (budgetLocal + queued) | 0;
    const backlogCPU = (backlogPPU / 3) | 0; // floor
    const rawDriftCPU = (cpuCycles - expectedCycles - backlogCPU) | 0;

    // Immediate self-correction: grant exact deficit (in PPU dots)
    if (rawDriftCPU > 0) {
      budgetLocal += (rawDriftCPU * 3) | 0;
    }

    // Logging (baseline keeps stable "green" on static scenes)
    if (finishedFrame > 0 && syncLogging) {
      const frameType = PPUclock.oddFrame ? (shortPre ? 'ODD(render, short pre)' : 'ODD(idle)') : 'EVEN';
      if (driftBaseline === null) driftBaseline = rawDriftCPU;
      const drift = rawDriftCPU - driftBaseline;

      driftFrames++;
      driftSum += drift;
      if (Math.abs(drift) > Math.abs(maxDrift)) maxDrift = drift;
      const avg = Math.round(driftSum / driftFrames);
      const warn = Math.abs(drift) > 130;

      const color = warn
        ? 'color:red;font-weight:bold;'
        : (frameType.startsWith('ODD(render') ? 'color:lightgreen;font-weight:bold;' : 'color:limegreen;font-weight:bold;');

      const msg =
        `[SYNC ${warn ? 'WARN' : 'OK'}] ` +
        `Frame=${finishedFrame} (${frameType}) | cpuCycles=${cpuCycles} | ` +
        `expected=${expectedCycles} | backlogPPU=${backlogPPU} | ` +
        `drift=${drift} | max=${maxDrift} | avg=${avg}`;
      console[warn ? 'warn' : 'debug'](`%c${msg}`, color);
    }
  }
}

function visibleScanline(dot) {
  const phase = (dot - 1) & 7;
  const inFetch = (dot >= 2 && dot <= 256) || (dot >= 321 && dot <= 336);

  // Dot 1: load the first tile fetched at 321–336 into the shifters
  if ((PPUMASK & MASK_BG_ENABLE) && dot === 1) {
    reloadBGShifters();
  }

  // Phase-0 reloads every 8 pixels in 9..257
  if ((PPUMASK & MASK_BG_ENABLE) && phase === 0 && dot >= 9 && dot <= 257) {
    reloadBGShifters();
  }

  // Emit + shift pixels 1..256 (shift only if < 256 so 257 is ready for next scanline)
  if ((PPUMASK & MASK_BG_ENABLE) && dot >= 1 && dot <= 256) {
    emitPixelHardwarePalette();
    if (dot < 256) {
      background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
      background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
      background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
      background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
    }
  }

  // Tile fetches (no reload here)
  if ((PPUMASK & MASK_BG_ENABLE) && inFetch) {
    const v = VRAM_ADDR;
    switch (phase) {
      case 1: background.ntByte = ppuBusRead(0x2000 | (v & 0x0FFF)); BG_ntByte = background.ntByte; break;
      case 3: {
        const attAddr = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
        const shift   = ((v >> 4) & 4) | (v & 2);
        const atBits  = (ppuBusRead(attAddr) >> shift) & 3;
        background.atByte = atBits & 0x03; BG_atByte = background.atByte; break;
      }
      case 5: {
        const fineY = (v >> 12) & 0x7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY;
        background.tileLo = ppuBusRead(base); BG_tileLo = background.tileLo; break;
      }
      case 7: {
        const fineY = (v >> 12) & 0x7;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + ((background.ntByte & 0xFF) << 4) + fineY + 8;
        background.tileHi = ppuBusRead(base); BG_tileHi = background.tileHi; incCoarseX(); break;
      }
    }
  }

  if (rendering && dot === 256) incY();
  if (rendering && dot === 257) copyHoriz();
}

function postRenderScanline(_) { /* no-op */ }

// Gated first frame (PPU INIT)
function vblankStartScanline(dot) {
  if (dot !== 1) return;
  if (!ppuInitDone) return;

  SET_VBLANK();
  
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
function reloadBGShifters() {
// Real hardware: reload happens at phase 0 *after* the last pixel of the previous tile
// So the first 8 pixels after dot 1 come from whatever junk was in the shifters
background.bgShiftLo = (background.bgShiftLo & 0xFF00) | (background.tileLo & 0xFF);
background.bgShiftHi = (background.bgShiftHi & 0xFF00) | (background.tileHi & 0xFF);

const atLo = (background.atByte & 0x01) ? 0xFF : 0x00;
const atHi = (background.atByte & 0x02) ? 0xFF : 0x00;
background.atShiftLo = (background.atShiftLo & 0xFF00) | atLo;
background.atShiftHi = (background.atShiftHi & 0xFF00) | atHi;
}

function emitPixelHardwarePalette() {
  const fx  = (fineX & 7);
  const bit = 15 - fx;

  const p0 = (background.bgShiftLo >> bit) & 1;
  const p1 = (background.bgShiftHi >> bit) & 1;
  const a0 = (background.atShiftLo >> bit) & 1;
  const a1 = (background.atShiftHi >> bit) & 1;

  // 2-bit pattern and attribute
  let color2 = (p1 << 1) | p0;      // 0..3
  const attr2  = (a1 << 1) | a0;    // 0..3

  const x = (PPUclock.dot - 1) | 0;
  const y = PPUclock.scanline | 0;
  if (y >= 240) return; // guard: no pixels on pre-render/vblank

  // Left-8 BG mask: force background transparency in x<8 if disabled
  if (x < 8 && (PPUMASK & 0x02) === 0) {
    color2 = 0;
  }

  // Resolve palette index (6-bit)
  let palIndex6;
  if (color2 === 0) {
    // Use universal background color exactly from $3F00
    palIndex6 = PALETTE_RAM[0] & 0x3F;
  } else {
    const palLow5 = ((attr2 << 2) | color2) & 0x1F; // 1..15 within subpalette
    palIndex6 = ppuBusRead(0x3F00 | palLow5) & 0x3F;
  }

  // Optional: greyscale bit (PPUMASK bit 0)
  if (PPUMASK & 0x01) palIndex6 &= 0x30;

  if (x >= 0 && x < NES_W && y >= 0 && y < NES_H) {
    paletteIndexFrame[y * NES_W + x] = palIndex6;
  }
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
    const pulled = Atomics.exchange(SHARED.CLOCKS, SYNC_PPU_BUDGET, 0) | 0;
    if (pulled) budgetLocal += pulled;

    if (budgetLocal <= 0) continue;

    do {
      ppuTick();
    } while (--budgetLocal > 0);
  }
}
