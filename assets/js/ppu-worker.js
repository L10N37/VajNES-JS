// ============================
// ppu-worker.js — PPU (BG-only) with real NES data, 1:1 with working SIM
// ============================

importScripts('/assets/js/ppu-worker-setup.js');
if (typeof setupMultiThreadVariables === 'function') setupMultiThreadVariables();

let ppuDebugLogging = false;

// ---------- Constants ----------
const NES_W = 256, NES_H = 240;
const DOTS_PER_SCANLINE = 341;
const SCANLINES_PER_FRAME = 262; // -1, 0..260; mirror at 261

// ---------- Readiness gate ----------
let romReady = false;

// ---------- Run/Pause/Step control ----------
let workerRunning  = false; // continuous run
let pumpStarted    = false; // scheduled flag
let stepBudgetDots = 0;     // PPU-only step budget
let lastStepAckId  = 0;

// Light idle polling while paused but CPU may step
const IDLE_POLL_MS = 16;

// ---------- Timing state ----------
const PPUclock = { dot: 0, scanline: -1, frame: 0, oddFrame: false };

// ---------- Frame backbuffer (palette indices 0..63) ----------
let paletteIndexFrame = new Uint8Array(NES_W * NES_H);

// ---------- BG pipeline / shifters ----------
const background = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0
};

// ---------- Helpers for combined 't' ----------
function t_get() { return ((t_hi & 0xFF) << 8) | (t_lo & 0xFF); }
function t_set(v) { v &= 0x7FFF; t_lo = v & 0xFF; t_hi = (v >> 8) & 0xFF; }

// ---------- Message handling ----------
self.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'romReady':
      romReady = true;
      if (ppuDebugLogging) console.log('[PPU-Worker] romReady = true');
      if (workerRunning || stepBudgetDots > 0) startPump();
      else scheduleIdlePoll();
      break;

    case 'set-running': {
      const on = !!msg.running;
      workerRunning = on;
      if (on) startPump();
      else { pumpStarted = false; scheduleIdlePoll(); }
      break;
    }

    case 'run':
      workerRunning = true; startPump(); break;

    case 'pause':
      workerRunning = false; pumpStarted = false; scheduleIdlePoll(); break;

    case 'step': {
      const mode  = msg.mode || 'dots';
      const count = (msg.count | 0) || 1;
      lastStepAckId = msg.ackId | 0;

      let dotsPer = 1;
      if (mode === 'scanline') dotsPer = DOTS_PER_SCANLINE;
      else if (mode === 'frame') dotsPer = DOTS_PER_SCANLINE * SCANLINES_PER_FRAME;

      stepBudgetDots += Math.max(0, count) * dotsPer;
      workerRunning = false;
      startPump();
      break;
    }

    default:
      break;
  }
};

// =============================
// Core PPU tick (per dot)
// =============================
function ppuTick() {
  if (PPUclock.scanline === -1 || PPUclock.scanline === 261) {
    preRenderScanline();
  } else {
    (scanlineLUT[PPUclock.scanline] || vblankIdleScanline)();
  }

  PPUclock.dot++;
  if (PPUclock.dot >= DOTS_PER_SCANLINE) {
    PPUclock.dot = 0;
    PPUclock.scanline++;
    if (PPUclock.scanline > 261) {
      PPUclock.scanline = 0;
      PPUclock.frame++;
      PPUclock.oddFrame = !PPUclock.oddFrame;
    }
  }
}

// =============================
// Scanline handlers (BG only)
// =============================
function preRenderScanline() {
  // -1 (261)
  if (PPUclock.dot === 1) {
    PPUSTATUS = PPUSTATUS & ~0x80; // clear vblank
    nmiPending = false;
  }
  if ((PPUMASK & 0x18) !== 0) {
    if (PPUclock.dot >= 280 && PPUclock.dot <= 304) copyVert();
  }
  if (PPUclock.dot === 339 && PPUclock.oddFrame && (PPUMASK & 0x18)) {
    // skip one dot on odd frames when rendering is enabled
    PPUclock.dot++;
  }
}

function visibleScanline() {
  // 0..239
  const rendering = (PPUMASK & 0x18) !== 0;

  if (rendering) {
    // Tick shifters during fetch region, like hardware
    const inFetch = (PPUclock.dot >= 2 && PPUclock.dot <= 257) || (PPUclock.dot >= 321 && PPUclock.dot <= 336);
    if (inFetch) {
      background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
      background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
      background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
      background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
    }

    // fetch pipeline 2..257 and 321..336
    if (inFetch) {
      const phase = (PPUclock.dot - 1) % 8;
      const t = t_get();

      switch (phase) {
        case 1: { // nametable
          const v = ppuBusRead(0x2000 | (t & 0x0FFF));
          background.ntByte = v; BG_ntByte = v;
          break;
        }
        case 3: { // attribute
          const attAddr = 0x23C0 | (t & 0x0C00) | ((t >> 4) & 0x38) | ((t >> 2) & 0x07);
          const shift = ((t >> 4) & 4) | (t & 2);
          const atBits = (ppuBusRead(attAddr) >> shift) & 3; // 0..3
          const v = (atBits << 2) & 0xFF;
          background.atByte = v; BG_atByte = v;
          break;
        }
        case 5: { // pattern low
          const fineY = (t >> 12) & 0x7;
          const tile  = background.ntByte;
          const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + (tile << 4) + fineY;
          const v = ppuBusRead(base);
          background.tileLo = v; BG_tileLo = v;
          break;
        }
        case 7: { // pattern high
          const fineY = (t >> 12) & 0x7;
          const tile  = background.ntByte;
          const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + (tile << 4) + fineY + 8;
          const v = ppuBusRead(base);
          background.tileHi = v; BG_tileHi = v;
          break;
        }
        case 0: { // reload shifters + coarse X or Y inc at 256
          reloadBGShifters();
          if (PPUclock.dot === 256) incY(); else incCoarseX();
          break;
        }
      }
    }

    // emit pixel on 1..256 (hardware palette rule)
    if (PPUclock.dot >= 1 && PPUclock.dot <= 256) {
      emitPixelHardwarePalette();
    }
  }

  // Copy horizontal at 257
  if (PPUclock.dot === 257 && rendering) copyHoriz();
}

function postRenderScanline() {
  // 240 idle
}

function vblankStartScanline() {
  // 241, dot 1
  if (PPUclock.dot === 1) {
    PPUSTATUS = PPUSTATUS | 0x80; // set vblank
    if (PPUCTRL & 0x80) {
      nmiPending = true;
      if (ppuDebugLogging) console.log("%cPPU NMI", "color:#fff;background:#c00;font-weight:bold;padding:2px 6px;border-radius:3px");
    }
  }
}

function firstVblankIdleScanline() {
  // 242 — send the frame
  try {
    postMessage(
      { type: 'frame', format: 'indices', bpp: 8, w: NES_W, h: NES_H, buffer: paletteIndexFrame.buffer },
      [paletteIndexFrame.buffer]
    );
  } catch {
    postMessage({ type: 'frame', format: 'indices', bpp: 8, w: NES_W, h: NES_H, buffer: paletteIndexFrame.buffer });
  }
  paletteIndexFrame = new Uint8Array(NES_W * NES_H);
}

function vblankIdleScanline() {
  // 243..260 idle
}

// =============================
// LUT
// =============================
const scanlineLUT = new Array(262);
for (let i = 0; i <= 239; i++) scanlineLUT[i] = visibleScanline;
scanlineLUT[240] = postRenderScanline;
scanlineLUT[241] = vblankStartScanline;
scanlineLUT[242] = firstVblankIdleScanline;
for (let i = 243; i <= 260; i++) scanlineLUT[i] = vblankIdleScanline;
scanlineLUT[261] = preRenderScanline;

// =============================
// Helpers
// =============================
function reloadBGShifters() {
  background.bgShiftLo = (background.bgShiftLo & 0xFF00) | (background.tileLo & 0xFF);
  background.bgShiftHi = (background.bgShiftHi & 0xFF00) | (background.tileHi & 0xFF);

  const atLo = (background.atByte & 0x01) ? 0xFF : 0x00;
  const atHi = (background.atByte & 0x02) ? 0xFF : 0x00;
  background.atShiftLo = (background.atShiftLo & 0xFF00) | atLo;
  background.atShiftHi = (background.atShiftHi & 0xFF00) | atHi;
}

// Hardware-accurate BG palette mapping (final 0..63 index)
function emitPixelHardwarePalette() {
  const fx = (fineX & 7);

  const p0  = (background.bgShiftLo >> (15 - fx)) & 1;
  const p1  = (background.bgShiftHi >> (15 - fx)) & 1;
  const a0  = (background.atShiftLo >> (15 - fx)) & 1;
  const a1  = (background.atShiftHi >> (15 - fx)) & 1;

  const color2 = (p1 << 1) | p0;  // 0..3
  const attr2  = (a1 << 1) | a0;  // 0..3

  let finalIndex;
  if (color2 === 0) {
    // universal background at $3F00
    finalIndex = ppuBusRead(0x3F00) & 0x3F;
  } else {
    // sub-palette entries 1..3 of palette selected by attr2
    const low5 = ((attr2 << 2) + (1 + color2)) & 0x1F;
    finalIndex = ppuBusRead(0x3F00 | low5) & 0x3F;
  }

  const x = (PPUclock.dot - 1) | 0;
  const y = PPUclock.scanline | 0;
  if (x >= 0 && x < NES_W && y >= 0 && y < NES_H) {
    paletteIndexFrame[y * NES_W + x] = finalIndex;
  }
}

function incCoarseX() {
  let t = t_get();
  if ((t & 0x001F) === 31) {
    t &= ~0x001F;
    t ^= 0x0400;
  } else {
    t = (t + 1) & 0x7FFF;
  }
  t_set(t);
}

function incY() {
  let t = t_get();
  if ((t & 0x7000) !== 0x7000) {
    t = (t + 0x1000) & 0x7FFF;
  } else {
    t &= ~0x7000;
    let y = (t & 0x03E0) >> 5;
    if (y === 29) {
      y = 0;
      t ^= 0x0800;
    } else if (y === 31) {
      y = 0;
    } else {
      y++;
    }
    t = (t & ~0x03E0) | (y << 5);
  }
  t_set(t);
}

function copyHoriz() {
  // Copy horizontal bits from t to VRAM_ADDR (v)
  const t = t_get();
  VRAM_ADDR = (VRAM_ADDR & ~0x041F) | (t & 0x041F);
}
function copyVert() {
  const t = t_get();
  VRAM_ADDR = (VRAM_ADDR & ~0x7BE0) | (t & 0x7BE0);
}

// ---------- Bus access (real SHARED arrays) ----------
function ppuBusRead(addr) {
  addr &= 0x3FFF;
  if (addr < 0x2000) {            // pattern tables
    return CHR_ROM[addr] & 0xFF;
  }
  if (addr >= 0x3F00) {           // palettes
    let pal = addr & 0x1F;
    if ((pal & 0x13) === 0x10) pal &= ~0x10;  // mirrors 10/14/18/1C
    return PALETTE_RAM[pal] & 0x3F;
  }
  // nametables (mirrored 2KB)
  return VRAM[(addr - 0x2000) & 0x07FF] & 0xFF;
}

// ---------- Reset (optional) ----------
function resetPPU() {
  PPUclock.dot = 0; PPUclock.scanline = -1; PPUclock.frame = 0; PPUclock.oddFrame = false;
  t_set(0); fineX = 0;
  paletteIndexFrame = new Uint8Array(NES_W * NES_H);
}

// =============================
// Pump: run/pause/step (ROM ready gated)
//  - Running: catch up PPU to cpuCycles*3
//  - Paused:  if cpuCycles advanced (you called step(true)), catch up once
//  - Step budget: optional PPU-only stepping via message
// =============================
function pump() {
  if (!romReady || !self.SHARED || !SHARED.CLOCKS) {
    if (workerRunning || stepBudgetDots > 0) setTimeout(pump, 0);
    return;
  }

  let cpuNow = cpuCycles | 0;
  let ppuNow = ppuCycles | 0;

  let steps = 0, MAX = 60000;
  let stepped = false;

  if (stepBudgetDots > 0) {
    const targetPPU = ppuNow + stepBudgetDots;
    while (ppuNow < targetPPU && steps < MAX) { ppuTick(); ppuNow++; steps++; }
    stepBudgetDots = Math.max(0, stepBudgetDots - steps);
    stepped = (stepBudgetDots === 0);
  } else if (workerRunning) {
    const targetPPU = (cpuNow * 3) | 0;
    while (ppuNow < targetPPU && steps < MAX) { ppuTick(); ppuNow++; steps++; }
  } else {
    // Paused: auto-follow CPU step(true)
    const targetPPU = (cpuNow * 3) | 0;
    if (ppuNow < targetPPU) {
      while (ppuNow < targetPPU && steps < MAX) { ppuTick(); ppuNow++; steps++; }
    } else {
      pumpStarted = false;
      scheduleIdlePoll();
      return;
    }
  }

  ppuCycles = ppuNow | 0;

  if (stepped) {
    pumpStarted = false;
    try { postMessage({ type: 'stepped', ackId: lastStepAckId, ppuCycles: ppuNow|0 }); } catch {}
    return;
  }

  setTimeout(pump, 0);
}

function startPump() {
  if (!pumpStarted) {
    pumpStarted = true;
    setTimeout(pump, 0);
  }
}

function scheduleIdlePoll() {
  if (pumpStarted || !romReady) return;
  setTimeout(() => {
    if (!workerRunning) {
      const c = (self.SHARED && SHARED.CLOCKS) ? (cpuCycles | 0) : 0;
      const p = (self.SHARED && SHARED.CLOCKS) ? (ppuCycles | 0) : 0;
      if (c * 3 > p) startPump(); else scheduleIdlePoll();
    }
  }, IDLE_POLL_MS);
}
