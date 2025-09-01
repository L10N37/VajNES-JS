importScripts('/assets/js/ppu-worker-setup.js');
console.debug("[PPU Worker init]");

let prevVblank = 0;

const SYNC_CPU_CYCLES   = 0;
const SYNC_PPU_BUDGET   = 1;
const SYNC_SCANLINE     = 2;
const SYNC_DOT          = 3;
const SYNC_FRAME        = 4;
const SYNC_VBLANK_FLAG  = 5;
const SYNC_NMI_EDGE     = 6;

const STORE_CURRENT_SCANLINE = (scanline) => Atomics.store(SHARED.SYNC, SYNC_SCANLINE, scanline|0);
const STORE_CURRENT_DOT      = (dot)      => Atomics.store(SHARED.SYNC, SYNC_DOT, dot|0);
const STORE_CURRENT_FRAME    = (frame)    => Atomics.store(SHARED.SYNC, SYNC_FRAME, frame|0);
const STORE_VBLANK_FLAG      = (flag01)   => Atomics.store(SHARED.SYNC, SYNC_VBLANK_FLAG, flag01 ? 1 : 0);
const SET_NMI_EDGE           = (marker)   => Atomics.store(SHARED.SYNC, SYNC_NMI_EDGE, marker|0);
const CLEAR_NMI_EDGE         = ()         => Atomics.store(SHARED.SYNC, SYNC_NMI_EDGE, 0);

const CLEAR_VBLANK          = () => { PPUSTATUS &= ~0x80; STORE_VBLANK_FLAG(0); };
const SET_VBLANK            = () => { PPUSTATUS |=  0x80; STORE_VBLANK_FLAG(1); };
const CLEAR_SPRITE0_HIT     = () => { PPUSTATUS &= ~0x40; };
const SET_SPRITE0_HIT       = () => { PPUSTATUS |=  0x40; };
const CLEAR_SPRITE_OVERFLOW = () => { PPUSTATUS &= ~0x20; };
const SET_SPRITE_OVERFLOW   = () => { PPUSTATUS |=  0x20; };

const DOTS_PER_SCANLINE   = 341;
const SCANLINES_PER_FRAME = 262;

Object.defineProperty(globalThis, "rendering", {
  configurable: true,
  get() { return (PPUMASK & 0x18) !== 0; }  // evaluates when read
});

//const rendering = (PPUMASK & 0x18) !== 0;

const NES_W = 256;
const NES_H = 240;

// NES first frame is always odd, which we are calling frame zero here instead of 1
const PPUclock = { dot: 0, scanline: 0, frame: 0, oddFrame: true };

const background = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0
};

function t_get() {
  return ((t_hi & 0xFF) << 8) | (t_lo & 0xFF);
}
function t_set(v) {
  v &= 0x7FFF;
  t_lo = v & 0xFF;
  t_hi = (v >> 8) & 0xFF;
}

function ppuTick() {
  scanlineLUT[PPUclock.scanline](PPUclock.dot);

  // Increment dot normally
  PPUclock.dot++;

  // --- Odd frame skip (shorten pre-render by 1 dot) ---
  if (
    PPUclock.scanline === 0 &&         // pre-render scanline in YOUR system
    PPUclock.dot === 0 &&              // we just wrapped past last dot
    PPUclock.oddFrame &&
    (PPUMASK & 0x18) !== 0
  ) {
    // Skip dot 0 → jump ahead one extra
    PPUclock.dot++;
  }

  // --- Wrap dot/scanline/frame ---
  if (PPUclock.dot >= DOTS_PER_SCANLINE) {
    PPUclock.dot = 0;
    PPUclock.scanline++;

    if (PPUclock.scanline >= SCANLINES_PER_FRAME) {
      PPUclock.scanline = 0;
      PPUclock.frame++;
      PPUclock.oddFrame = !PPUclock.oddFrame;
    }
  }

  STORE_CURRENT_SCANLINE(PPUclock.scanline);
  STORE_CURRENT_DOT(PPUclock.dot);
  STORE_CURRENT_FRAME(PPUclock.frame);
}


let maxDrift = 0;
let driftSum = 0;
let driftFrames = 0;
let expectedCycles = 0;
let expectedCarry  = 0;

let syncLogging = true;  

let renderActiveThisFrame = false;

// --- preRenderScanline ---
function preRenderScanline(currentDot) {
  switch (true) {
    case (currentDot === 1):
      // latch rendering state for THIS frame at dot 1 of pre-render
      renderActiveThisFrame = (PPUMASK & 0x18) !== 0;

      prevVblank = 0;
      CLEAR_VBLANK();
      CLEAR_SPRITE0_HIT();
      CLEAR_SPRITE_OVERFLOW();
      break;

    case (currentDot >= 280 && currentDot <= 304):
      copyVert();
      break;

    case (currentDot === 340): {
      const justFinishedFrame = PPUclock.frame;
      const isOdd = (justFinishedFrame & 1) === 1;

      // Short frame only if odd + rendering was latched ON at dot 1
      const skippedFrame = (isOdd && renderActiveThisFrame);

      // Always advance expectedCycles (skip changes count to 29781)
      if (justFinishedFrame > 0) {
        expectedCycles += skippedFrame ? 29781 : 29780;
      }

      // Only notify renderer when not a skipped frame
      if (!skippedFrame) {
        postMessage({ type: "frame", frame: justFinishedFrame });
      }

      // Logging/drift (ignore bootstrap 0)
      if (justFinishedFrame > 0 && syncLogging) {
        const frameType =
          skippedFrame ? "ODD(render)" :
          isOdd        ? "ODD(idle)"   :
                         "EVEN";

        const expected = expectedCycles;
        const drift    = cpuCycles - expected;

        driftFrames++;
        driftSum += drift;
        if (Math.abs(drift) > Math.abs(maxDrift)) maxDrift = drift;
        const avgDrift = Math.round(driftSum / driftFrames);

        const warn = Math.abs(drift) > 130;
        const color = warn
          ? "color:red;font-weight:bold;"
          : (frameType === "ODD(render)" ? "color:lightgreen;font-weight:bold;"
                                         : "color:limegreen;font-weight:bold;");

        const msg =
          `[SYNC ${warn ? "WARN" : "OK"}] ` +
          `Frame=${justFinishedFrame} (${frameType}) | cpuCycles=${cpuCycles} | expected=${expected} ` +
          `| drift=${drift} | max=${maxDrift} | avg=${avgDrift}`;

        console[warn ? "warn" : "debug"](`%c${msg}`, color);
      }
      break;
    }
  }
}

function visibleScanline(currentDot) {
  
  const inFetch   = (currentDot >= 2 && currentDot <= 257) || (currentDot >= 321 && currentDot <= 336);
  const phase     = (currentDot - 1) & 7;

  const shiftNow = (PPUMASK & 0x18) && currentDot >= 2 && currentDot <= 256;
  if (shiftNow) {
    background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
    background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
    background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
    background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
  }

  if (inFetch) {
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
        const tile  = background.ntByte;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + (tile << 4) + fineY;
        background.tileLo = ppuBusRead(base);
        BG_tileLo = background.tileLo;
        break;
      }
      case 7: {
        const fineY = (v >> 12) & 0x7;
        const tile  = background.ntByte;
        const base  = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + (tile << 4) + fineY + 8;
        background.tileHi = ppuBusRead(base);
        BG_tileHi = background.tileHi;
        break;
      }
      case 0: {
        reloadBGShifters();
        if (currentDot === 256) incY(); else incCoarseX();
        break;
      }
    }
  }

  if (currentDot === 257) copyHoriz();
  if (currentDot === 1) reloadBGShifters();
  if (rendering && currentDot >= 1 && currentDot <= 256) {
    emitPixelHardwarePalette();
  }
}

function postRenderScanline(currentDot) {
}

function vblankStartScanline(currentDot) {
  if (currentDot === 1) {
    PPUSTATUS |= 0x80;
    Atomics.store(SHARED.SYNC, 5, 1);

    if (!prevVblank) {
      prevVblank = 1;
      if (PPUCTRL & 0x80) {
        const edgeMarker =
          ((PPUclock.frame & 0xFFFF) << 16) |
          ((PPUclock.scanline & 0x1FF) << 7) |
          (currentDot & 0x7F);
        Atomics.store(SHARED.SYNC, 6, edgeMarker);
      }
    }
  }
}

function vblankIdleScanline(currentDot) {
}

// Scanline LUT (0-based, where 0 = hardware pre-render/-1)
const scanlineLUT = new Array(262);

scanlineLUT[0] = preRenderScanline;             // pre-render (-1)
for (let i = 1; i <= 240; i++)                  // visible (0–239)
  scanlineLUT[i] = visibleScanline;
scanlineLUT[241] = postRenderScanline;          // post-render (240)
scanlineLUT[242] = vblankStartScanline;         // vblank start (241)
for (let i = 243; i <= 261; i++)                // vblank idle (242–260)
  scanlineLUT[i] = vblankIdleScanline;


function reloadBGShifters() {
  background.bgShiftLo = (background.bgShiftLo & 0xFF00) | (background.tileLo & 0xFF);
  background.bgShiftHi = (background.bgShiftHi & 0xFF00) | (background.tileHi & 0xFF);
  const atLo = (background.atByte & 0x01) ? 0xFF : 0x00;
  const atHi = (background.atByte & 0x02) ? 0xFF : 0x00;
  background.atShiftLo = (background.atShiftLo & 0xFF00) | atLo;
  background.atShiftHi = (background.atShiftHi & 0xFF00) | atHi;
}

function emitPixelHardwarePalette() {
  const fx = (fineX & 7);
  const p0  = (background.bgShiftLo >> (15 - fx)) & 1;
  const p1  = (background.bgShiftHi >> (15 - fx)) & 1;
  const a0  = (background.atShiftLo >> (15 - fx)) & 1;
  const a1  = (background.atShiftHi >> (15 - fx)) & 1;
  const color2 = (p1 << 1) | p0;
  const attr2  = (a1 << 1) | a0;
  let finalIndex;
  if (color2 === 0) {
    finalIndex = ppuBusRead(0x3F00) & 0x3F;
  } else {
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
  if (!rendering) return;                  // only advance when rendering
  let v = VRAM_ADDR;
  if ((v & 0x001F) === 31) {
    v &= ~0x001F;
    v ^= 0x0400;
  } else {
    v = (v + 1) & 0x7FFF;
  }
  VRAM_ADDR = v;
}

function incY() {
  if (!rendering) return;                  // only advance when rendering
  let v = VRAM_ADDR;
  if ((v & 0x7000) !== 0x7000) {
    v = (v + 0x1000) & 0x7FFF;
  } else {
    v &= ~0x7000;
    let y = (v & 0x03E0) >> 5;
    if (y === 29) {
      y = 0; v ^= 0x0800;
    } else if (y === 31) {
      y = 0;
    } else {
      y++;
    }
    v = (v & ~0x03E0) | (y << 5);
  }
  VRAM_ADDR = v;
}

function copyHoriz() {
  if (!rendering) return;                  // only copy when rendering
  const t = (t_hi << 8) | t_lo;
  VRAM_ADDR = (VRAM_ADDR & ~0x041F) | (t & 0x041F);
}

function copyVert() {
  if (!rendering) return;                  // only copy when rendering
  const t = (t_hi << 8) | t_lo;
  VRAM_ADDR = (VRAM_ADDR & ~0x7BE0) | (t & 0x7BE0);
}

function ppuBusRead(addr) {
  addr &= 0x3FFF;

  if (addr < 0x2000) {
    return CHR_ROM[addr & 0x1FFF] & 0xFF;
  }
  if (addr < 0x3F00) {
    return VRAM[(addr - 0x2000) & 0x07FF] & 0xFF;
  }

  // Palette read: mirror $3F10/14/18/1C → $3F00/04/08/0C
  let p = addr & 0x1F;
  if ((p & 0x13) === 0x10) p &= ~0x10;
  return PALETTE_RAM[p] & 0x3F;
}

// add reset and be able to call from main, message to here to reset variables

function startPPULoop() {
  while (true) {
    let budget = Atomics.exchange(SHARED.CLOCKS, 1, 0);
    if (budget > 0) {
      while (budget-- > 0) {
        ppuTick();
      }
    }
  }
}