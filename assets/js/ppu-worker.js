importScripts('/assets/js/ppu-worker-setup.js');

console.log('[PPU-Worker] loaded');

// debug logging for worker side (not a redeclaration, out of scope), can not
// toggle this one from console
ppuDebugLogging = true;

// --- Constants ---
const NES_W = 256, NES_H = 240;
const DOTS_PER_SCANLINE = 341;
const SCANLINES_PER_FRAME = 262;   // legal scanline values: -1, 0..260, and we also mirror 261 as pre-render

// --- PPU timing state ---
const PPUclock = { dot: 0, scanline: -1, frame: 0, oddFrame: false };

// --- Back buffer of palette indices (0..63) ---
let paletteIndexFrame = new Uint8Array(NES_W * NES_H);
let lastFrameRendered = -1;

// --- Worker-local background pipeline/shifters ---
const background = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0,
  tileLo: 0, tileHi: 0
};

// --- added: track when ROM is ready so the pump can run once clocks are attached ---
let romReady = false;

// =============================
// Per-scanline functions
// =============================

function preRenderScanline() {
  // -1 / 261
  // Clear vblank at dot 1. Sprite flags clear would go here if/when you wire them.
  if (PPUclock.dot === 1) {
    PPUSTATUS &= ~0x80; // clear vblank
  }
  // During dots 280..304, copy vertical scroll bits if rendering is enabled
  if ((PPUMASK & 0x18) && PPUclock.dot >= 280 && PPUclock.dot <= 304) {
    copyVert();
  }
}

function visibleScanline() {
  const renderingEnabled = true//!!(PPUMASK & 0x18);

  if (ppuDebugLogging && PPUclock.dot === 1) {
    console.log("%c[BG FETCH START]", "color: white; background: green; padding: 2px 4px");
  }

  if (renderingEnabled) {
    if ((PPUclock.dot >= 1 && PPUclock.dot <= 256) || (PPUclock.dot >= 321 && PPUclock.dot <= 336)) {
      background.bgShiftLo <<= 1; background.bgShiftHi <<= 1;
      background.atShiftLo <<= 1; background.atShiftHi <<= 1;

      switch (PPUclock.dot % 8) {
        case 1:
          if (ppuDebugLogging) console.log("%c[NT BYTE FETCH]", "color: black; background: yellow; padding: 2px 4px");
          background.ntByte = ppuBusRead(0x2000 | (VRAM_ADDR & 0x0FFF)) & 0xFF;
          break;
        case 3:
          if (ppuDebugLogging) console.log("%c[AT BYTE FETCH]", "color: white; background: purple; padding: 2px 4px");
          background.atByte = ppuBusRead(
            0x23C0 |
            (VRAM_ADDR & 0x0C00) |
            ((VRAM_ADDR >> 4) & 0x38) |
            ((VRAM_ADDR >> 2) & 0x07)
          ) & 0xFF;
          break;
        case 5:
          if (ppuDebugLogging) console.log("%c[TILE LO FETCH]", "color: black; background: cyan; padding: 2px 4px");
          background.tileLo = ppuBusRead(
            (PPUCTRL & 0x10 ? 0x1000 : 0x0000) +
            (background.ntByte * 16) +
            ((VRAM_ADDR >> 12) & 0x7)
          ) & 0xFF;
          break;
        case 7:
          if (ppuDebugLogging) console.log("%c[TILE HI FETCH]", "color: white; background: blue; padding: 2px 4px");
          background.tileHi = ppuBusRead(
            (PPUCTRL & 0x10 ? 0x1000 : 0x0000) +
            (background.ntByte * 16) +
            ((VRAM_ADDR >> 12) & 0x7) + 8
          ) & 0xFF;
          break;
        case 0:
          if (ppuDebugLogging) console.log("%c[RELOAD & COARSE X]", "color: white; background: black; padding: 2px 4px");
          reloadBGShifters();
          incCoarseX();
          break;
      }
    }

    // Sprite evaluation phase
    if (ppuDebugLogging && PPUclock.dot === 257) {
      console.log("%c[SPRITE EVAL START]", "color: white; background: red; padding: 2px 4px");
    }

    if (PPUclock.dot === 256) incY();
    if (PPUclock.dot === 257) copyHoriz();
  }

  if (PPUclock.dot >= 1 && PPUclock.dot <= 256) emitPixel();
}


function postRenderScanline() {
  // 240 — idle (post-render)
}

function vblankStartScanline() {
  // 241, dot 1
  if (PPUclock.dot === 1) {
    PPUSTATUS |= 0x80; // set vblank
    if (PPUCTRL & 0x80) {
      nmiPending = true;
      console.log("%cNMI fired", "color:#fff;background:#c00;font-weight:bold;padding:2px 6px;border-radius:3px");
    }
  }
}

function firstVblankIdleScanline() {
  // 242

  // For now we still transfer the buffer (NES is small, this is fine). Swap to SAB + signal later if needed
  // or use this thread to render
  postMessage(
    { type: 'frame', format: 'indices', bpp: 8, w: NES_W, h: NES_H, buffer: paletteIndexFrame.buffer },
    [paletteIndexFrame.buffer]
  );
  paletteIndexFrame = new Uint8Array(NES_W * NES_H);
}

function vblankIdleScanline() {
  // 243..260 — nothing special
}

// =============================
// Scanline LUT (array index == scanline; -1 is placed at index 261)
// =============================

const scanlineLUT = new Array(262);

// 0..239 visible
for (let i = 0; i <= 239; i++) scanlineLUT[i] = visibleScanline;

// 240 post-render
scanlineLUT[240] = postRenderScanline;

// 241 vblank start
scanlineLUT[241] = vblankStartScanline;

// 242 we will use this scanline to send our frame
scanlineLUT[242] = firstVblankIdleScanline;

// 242..260 vblank idle
for (let i = 243; i <= 260; i++) scanlineLUT[i] = vblankIdleScanline;

// 261 pre-render (mirror of -1)
scanlineLUT[261] = preRenderScanline;

//console.log(JSON.stringify(scanlineLUT.map(fn => fn ? fn.name : null)));


// =============================
// One-dot tick
// =============================
function ppuTick() {

  const renderingEnabled = !!(PPUMASK & 0x18);

  // odd frame: skip dot 0 on pre-render if rendering is on
  if (PPUclock.scanline === -1 && PPUclock.dot === 0 && renderingEnabled && PPUclock.oddFrame) {
    PPUclock.dot = 1;
  }

  // dispatch to the scanline function
  // map scanline -1 → index 261; otherwise direct
  const idx = (PPUclock.scanline === -1) ? 261 : PPUclock.scanline;
  const fn = scanlineLUT[idx];
  if (fn) fn();

  // advance dot / scanline
  PPUclock.dot++;
  if (PPUclock.dot >= DOTS_PER_SCANLINE) {
    PPUclock.dot = 0;
    PPUclock.scanline++;
    if (PPUclock.scanline >= SCANLINES_PER_FRAME) {
      PPUclock.scanline = -1;
      PPUclock.frame++;
      PPUclock.oddFrame = !PPUclock.oddFrame;
    }
  }
}

// =============================
// Helpers (BG pipeline + VRAM logic)
// =============================

function reloadBGShifters() {
  background.bgShiftLo = (background.bgShiftLo & 0xFF00) | (background.tileLo & 0xFF);
  background.bgShiftHi = (background.bgShiftHi & 0xFF00) | (background.tileHi & 0xFF);

  const at = background.atByte & 0x03;  // we only care about two bits for palette select
  const palLo = (at & 0x01) ? 0xFF : 0x00;
  const palHi = (at & 0x02) ? 0xFF : 0x00;
  background.atShiftLo = (background.atShiftLo & 0xFF00) | palLo;
  background.atShiftHi = (background.atShiftHi & 0xFF00) | palHi;
}

function emitPixel() {
  const x = (PPUclock.dot - 1) | 0;
  const y = PPUclock.scanline | 0;
  if ((x >>> 0) >= NES_W || (y >>> 0) >= NES_H) return;

  const fx = fineX & 0x07;

  const bit0 = (background.bgShiftLo >> (15 - fx)) & 1;
  const bit1 = (background.bgShiftHi >> (15 - fx)) & 1;
  const bgPix = (bit1 << 1) | bit0;

  const pal0 = (background.atShiftLo >> (15 - fx)) & 1;
  const pal1 = (background.atShiftHi >> (15 - fx)) & 1;
  const palSel = (pal1 << 1) | pal0;

  let index = (palSel << 2) | bgPix;
  if (bgPix === 0) index = 0;

  paletteIndexFrame[(y * NES_W + x) | 0] = index & 0x3F;
}

function incCoarseX() {
  if ((VRAM_ADDR & 0x001F) !== 31) {
    VRAM_ADDR = (VRAM_ADDR + 1) & 0x7FFF;
  } else {
    VRAM_ADDR = (VRAM_ADDR & ~0x001F) ^ 0x0400;
  }
}

function incY() {
  if ((VRAM_ADDR & 0x7000) !== 0x7000) {
    VRAM_ADDR = (VRAM_ADDR + 0x1000) & 0x7FFF;
  } else {
    VRAM_ADDR &= ~0x7000;
    let y = (VRAM_ADDR & 0x03E0) >> 5;
    if (y === 29) {
      y = 0; VRAM_ADDR ^= 0x0800;
    } else if (y === 31) {
      y = 0;
    } else {
      y++;
    }
    VRAM_ADDR = (VRAM_ADDR & ~0x03E0) | ((y & 0x1F) << 5);
  }
}

function copyHoriz() {
  const t = ((t_hi << 8) | t_lo) & 0x7FFF;
  VRAM_ADDR = (VRAM_ADDR & ~0x041F) | (t & 0x041F);
}

function copyVert() {
  const t = ((t_hi << 8) | t_lo) & 0x7FFF;
  VRAM_ADDR = (VRAM_ADDR & ~0x7BE0) | (t & 0x7BE0);
}

function ppuBusRead(addr) {
  addr &= 0x3FFF;

  // Pattern tables
  if (addr < 0x2000) {
    return CHR_ROM[addr] & 0xFF;
  }

  // Palette RAM + mirrors
  if (addr >= 0x3F00) {
    let pal = addr & 0x1F;
    // $3F10,14,18,1C mirror $3F00,04,08,0C
    if ((pal & 0x13) === 0x10) pal &= ~0x10;
    return PALETTE_RAM[pal] & 0x3F; // palette uses 6 bits
  }

  // Nametables (2 KB, mirrored every 2 KB over $2000–$2FFF)
  return VRAM[(addr - 0x2000) & 0x07FF] & 0xFF;
}

// =============================
// Reset
// =============================
function resetPPU() {
  PPUclock.dot = 0;
  PPUclock.scanline = -1;
  PPUclock.frame = 0;
  PPUclock.oddFrame = false;
  lastFrameRendered = -1;

  OAMADDR = 0;
  SCROLL_X = SCROLL_Y = 0;
  VRAM_ADDR = 0;
  t_lo = 0; t_hi = 0;
  fineX = 0;
  writeToggle = false;

  background.bgShiftLo = background.bgShiftHi = 0;
  background.atShiftLo = background.atShiftHi = 0;
  background.ntByte = background.atByte = 0;
  background.tileLo = background.tileHi = 0;
}

// =============================
// Pump (CPU→PPU catch-up)
// =============================
let pumpStarted = false;
function pump() {
  // wait for ROM + SABs from setup
  if (!romReady || !SHARED.CLOCKS) { 
    setTimeout(pump, 0); 
    return; 
  }

  // use the actual shared array values
  let cpuNow    = SHARED.CLOCKS[0] | 0; 
  let ppuNow    = SHARED.CLOCKS[1] | 0;
  let targetPPU = cpuNow * 3;

  let steps = 0, MAX = 50000;
  while (ppuNow < targetPPU && steps < MAX) {
    ppuTick();
    ppuNow++;
    steps++;
  }

  // write back PPU cycles
  cpuCycles = ppuNow | 0;

  setTimeout(pump, 0);
}

function startPump() {
  if (!pumpStarted) { 
    pumpStarted = true; 
    setTimeout(pump, 0); 
  }
}