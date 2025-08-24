importScripts('/assets/js/ppu-worker-setup.js');
console.debug("[PPU Worker init]")
// ===================== PPU WORKER BOOT HEADER =====================
// #fk all this off, go back to locals, shows on but still have to toggle in console
// --- SharedArrayBuffer setup ---
if (!self.SHARED) self.SHARED = {};

// EVENTS: single Int32 cell for bit flags
if (!SHARED.SAB_EVENTS) {
  SHARED.SAB_EVENTS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  SHARED.EVENTS     = new Int32Array(SHARED.SAB_EVENTS);
  SHARED.EVENTS[0]  = 0;
}

// --- Helper to define toggleable bit flags ---
function defineFlag(name, bitMask) {
  Object.defineProperty(globalThis, name, {
    get: () => (Atomics.load(SHARED.EVENTS, 0) & bitMask) !== 0,
    set: v => {
      if (v) Atomics.or(SHARED.EVENTS, 0, bitMask);
      else   Atomics.and(SHARED.EVENTS, 0, ~bitMask);
    },
    configurable: true
  });
}

// --- Define toggles ---
defineFlag("ppuDebugLogging", 0b100);   // bit 2
defineFlag("cpuPpuSyncTiming", 0b1000); // bit 3

// --- Defaults at boot ---
let ppuDebugLogging  = false;
let cpuPpuSyncTiming = false;
// #fk all this off doesn't work properly
// --- Boot log ---
console.debug(
  `[worker boot] ppuDebugLogging=${ppuDebugLogging}  cpuPpuSyncTiming=${cpuPpuSyncTiming}`
);
console.debug(
  `%c PPU DEBUG LOGGING (toggle ppuDebugLogging): ${ppuDebugLogging ? "ON" : "OFF"} `,
  `background:${ppuDebugLogging ? "limegreen" : "crimson"}; color:white; font-weight:bold; padding:2px 6px; border-radius:4px;`
);
console.debug(
  `%c PPU/ CPU Sync Logging (toggle cpuPpuSyncTiming): ${cpuPpuSyncTiming ? "ON" : "OFF"} `,
  `background:${cpuPpuSyncTiming ? "limegreen" : "crimson"}; color:white; font-weight:bold; padding:2px 6px; border-radius:4px;`
);

// ================================================================


// ---------- Flag helpers ----------
// ========== SYNC layout  ==========
// SYNC[0] : CPU cycles
// SYNC[1] : PPU budget
// SYNC[2] : Current scanline (0..261)
// SYNC[3] : Current dot (0..340)
// SYNC[4] : Current frame counter
// SYNC[5] : VBlank flag shadow (0 = clear, 1 = set)
// SYNC[6] : NMI edge marker (packed frame/scanline/dot) or 0 when clear
// SYNC[7] : unused

// Index constants
const SYNC_CPU_CYCLES   = 0;
const SYNC_PPU_BUDGET   = 1;
const SYNC_SCANLINE     = 2;
const SYNC_DOT          = 3;
const SYNC_FRAME        = 4;
const SYNC_VBLANK_FLAG  = 5;
const SYNC_NMI_EDGE     = 6;

// helpers
const STORE_CURRENT_SCANLINE = (scanline) => Atomics.store(SHARED.SYNC, SYNC_SCANLINE, scanline|0);
const STORE_CURRENT_DOT      = (dot)      => Atomics.store(SHARED.SYNC, SYNC_DOT, dot|0);
const STORE_CURRENT_FRAME    = (frame)    => Atomics.store(SHARED.SYNC, SYNC_FRAME, frame|0);
const STORE_VBLANK_FLAG      = (flag01)   => Atomics.store(SHARED.SYNC, SYNC_VBLANK_FLAG, flag01 ? 1 : 0);
const SET_NMI_EDGE           = (marker)   => Atomics.store(SHARED.SYNC, SYNC_NMI_EDGE, marker|0);
const CLEAR_NMI_EDGE         = ()         => Atomics.store(SHARED.SYNC, SYNC_NMI_EDGE, 0);

// Flag helpers
const CLEAR_VBLANK          = () => { PPUSTATUS &= ~0x80; STORE_VBLANK_FLAG(0); };
const SET_VBLANK            = () => { PPUSTATUS |=  0x80; STORE_VBLANK_FLAG(1); };
const CLEAR_SPRITE0_HIT     = () => { PPUSTATUS &= ~0x40; };
const SET_SPRITE0_HIT       = () => { PPUSTATUS |=  0x40; };
const CLEAR_SPRITE_OVERFLOW = () => { PPUSTATUS &= ~0x20; };
const SET_SPRITE_OVERFLOW   = () => { PPUSTATUS |=  0x20; };

const DOTS_PER_SCANLINE   = 341;
const SCANLINES_PER_FRAME = 262; // -1,0..260

const NES_W = 256;
const NES_H = 240;

// start at pre-render scanline 261
const PPUclock = { dot: 0, scanline: 261, frame: 0, oddFrame: false };

const background = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0
};

function t_get() { return ((t_hi & 0xFF) << 8) | (t_lo & 0xFF); }
function t_set(v) { v &= 0x7FFF; t_lo = v & 0xFF; t_hi = (v >> 8) & 0xFF; }

function ppuTick() {
  // run handler for the current scanline at the current dot
  scanlineLUT[PPUclock.scanline](PPUclock.dot);

  // advance dot/scanline/frame counters
  PPUclock.dot++;
  if (PPUclock.dot >= DOTS_PER_SCANLINE) {
    PPUclock.dot = 0;
    PPUclock.scanline++;
    // wrap around, back to the first scanline when incremented above scanline count
    if (PPUclock.scanline > 261) {
      PPUclock.scanline = 0;
      PPUclock.frame++;
      PPUclock.oddFrame = !PPUclock.oddFrame;
    }
  }

  // publish timing into SABs
  STORE_CURRENT_SCANLINE(PPUclock.scanline);
  STORE_CURRENT_DOT(PPUclock.dot);
  STORE_CURRENT_FRAME(PPUclock.frame);
}

// --- Globals for synchronisation bugging in pre render ---
let maxDrift = 0;
let driftSum = 0;
let driftFrames = 0;
let expectedCycles = 0;
let expectedCarry  = 0;

// toggle this to turn logging on/off
let syncLogging = false;  

function preRenderScanline(currentDot) {
  if (currentDot === 1) {
    CLEAR_VBLANK();
    CLEAR_SPRITE0_HIT();
    CLEAR_SPRITE_OVERFLOW();
    if (ppuDebugLogging) {
      console.debug(
        `%c[PPU] Pre-render clear @ Frame=${PPUclock.frame}, Scanline=${PPUclock.scanline}`,
        "color: cyan; font-weight: bold;"
      );
    }
  }

  if ((PPUMASK & 0x18) !== 0 && currentDot >= 280 && currentDot <= 304) {
    copyVert();
  }

  if (currentDot === 339 && PPUclock.oddFrame && (PPUMASK & 0x18)) {
    PPUclock.dot++;
    if (ppuDebugLogging) {
      console.debug(
        `%c[PPU] Odd-frame cycle skip @ Frame=${PPUclock.frame}`,
        "color: orange; font-weight: bold;"
      );
    }
  }

  if (currentDot === 340) {
    postMessage({ type: "frame", frame: PPUclock.frame });

    if (PPUclock.frame > 0 && syncLogging) {
      // exact NTSC ratio: 29780 + 2/3
      expectedCycles += 29780;
      expectedCarry  += 2; 

      if (expectedCarry >= 3) {
        expectedCycles += 1; // add +1 every 3 frames
        expectedCarry  -= 3;
      }

      const expected = expectedCycles;
      const drift    = cpuCycles - expected;

      driftFrames++;
      driftSum += drift;
      if (Math.abs(drift) > Math.abs(maxDrift)) {
        maxDrift = drift;
      }
      const avgDrift = Math.round(driftSum / driftFrames);

      // Ignore harmless NTSC fractional drift (~±126)
      const driftThreshold = 130;  

      if (Math.abs(drift) > driftThreshold) {
        console.warn(
          `%c[SYNC WARN] Frame=${PPUclock.frame} | cpuCycles=${cpuCycles} | expected=${expected} | drift=${drift} | max=${maxDrift} | avg=${avgDrift}`,
          "color: red; font-weight: bold;"
        );
      } else {
        console.debug(
          `%c[SYNC OK] Frame=${PPUclock.frame} | cpuCycles=${cpuCycles} | expected=${expected} | drift=${drift} | max=${maxDrift} | avg=${avgDrift}`,
          "color: limegreen; font-weight: bold;"
        );
      }
    }
  }
}

function visibleScanline(currentDot) {
  const rendering = (PPUMASK & 0x18) !== 0; // background or sprite enabled
  const inFetch   = (currentDot >= 2 && currentDot <= 257) || (currentDot >= 321 && currentDot <= 336);
  const phase     = (currentDot - 1) & 7; // same as %8 but cheaper
  const t         = t_get();

  // --- Shifters tick during fetch region regardless of rendering ---
  if (inFetch) {
    background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
    background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
    background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
    background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
  }

  // --- Tile/attribute/pattern fetches only if rendering enabled ---
  if (rendering && inFetch) {
    switch (phase) {
      case 1: { // nametable
        const v = ppuBusRead(0x2000 | (t & 0x0FFF));
        background.ntByte = v; BG_ntByte = v;
        break;
      }
      case 3: { // attribute
        const attAddr = 0x23C0 | (t & 0x0C00) | ((t >> 4) & 0x38) | ((t >> 2) & 0x07);
        const shift   = ((t >> 4) & 4) | (t & 2);
        const atBits  = (ppuBusRead(attAddr) >> shift) & 3;
        background.atByte = (atBits << 2) & 0xFF;
        BG_atByte = background.atByte;
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
      case 0: { // reload shifters + coarse X or Y inc at dot 256
        reloadBGShifters();
        if (currentDot === 256) incY(); else incCoarseX();
        break;
      }
    }
  }

  // --- Copy horizontal at 257 (always happens) ---
  if (currentDot === 257) copyHoriz();

  // --- Emit pixels if rendering enabled ---
  if (rendering && currentDot >= 1 && currentDot <= 256) {
    emitPixelHardwarePalette();
  }
}

function postRenderScanline(currentDot) {
  // 240 idle
}

function vblankStartScanline(currentDot) {
  if (currentDot === 1) {
    // Set VBlank flag
    PPUSTATUS |= 0x80;
    Atomics.store(SHARED.SYNC, 5, 1); // VBlank flag shadow = 1

    // Assert NMI only if enabled before VBlank start
    if (PPUCTRL & 0x80) {
      const edgeMarker =
        ((PPUclock.frame & 0xFFFF) << 16) |
        ((PPUclock.scanline & 0x1FF) << 7) |
        (currentDot & 0x7F);

      // Store the exact frame/scanline/dot of the edge
      Atomics.store(SHARED.SYNC, 6, edgeMarker);
    }

    if (ppuDebugLogging) {
      console.debug(
        `%c[PPU] NMI EDGE -> Frame=${PPUclock.frame}, Scanline=${PPUclock.scanline}, Dot=${currentDot}`,
        "color: magenta; font-weight: bold;"
      );
    }
  }
}

function vblankIdleScanline(currentDot) {
}

// =============================
// LUT
// =============================
const scanlineLUT = new Array(262);
for (let i = 0; i <= 239; i++) scanlineLUT[i] = visibleScanline;
scanlineLUT[240] = postRenderScanline;
scanlineLUT[241] = vblankStartScanline;
for (let i = 242; i <= 260; i++) scanlineLUT[i] = vblankIdleScanline;
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

// ---------- Bus access  ----------
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


function resetPPU() {// #fix and use
  PPUclock.dot = 0; PPUclock.scanline = -1; PPUclock.frame = 0; PPUclock.oddFrame = false;
  t_set(0); fineX = 0;
  if (paletteIndexFrame && paletteIndexFrame.fill) paletteIndexFrame.fill(0);
}

function startPPULoop() {
  while (true) {
    // Atomically grab the full budget and clear it
    let budget = Atomics.exchange(SHARED.CLOCKS, 1, 0);

    if (budget > 0) {
      while (budget-- > 0) {
        ppuTick();
      }

      if (cpuPpuSyncTiming) {
        const cpuCycles = Atomics.load(SHARED.CLOCKS, 0);
        console.debug(
          `[SYNC] Frame=${PPUclock.frame} SL=${PPUclock.scanline} DOT=${PPUclock.dot} CPU=${cpuCycles}`
        );
      }
    }
  }
}
