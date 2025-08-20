importScripts('/assets/js/ppu-worker-setup.js');

console.log("[PPU Worker init]")

// ---------- Constants ----------
const DOTS_PER_SCANLINE   = 341;
const SCANLINES_PER_FRAME = 262; // -1,0..260

// ---------- Timing state ----------
const PPUclock = { dot: 0, scanline: 261, frame: 0, oddFrame: false };

// ---------- BG pipeline / shifters ----------
const background = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0
};

// ---------- Helpers for combined 't' ----------
function t_get() { return ((t_hi & 0xFF) << 8) | (t_lo & 0xFF); }
function t_set(v) { v &= 0x7FFF; t_lo = v & 0xFF; t_hi = (v >> 8) & 0xFF; }

// =============================
// Core PPU tick (per dot)
// =============================
function ppuTick() {
  // run handler for the current scanline at the current dot
  scanlineLUT[PPUclock.scanline](PPUclock.dot);

  // advance dot/scanline/frame counters
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

  // publish timing into SAB (optional)
  SHARED.SYNC[2] = PPUclock.scanline;
  SHARED.SYNC[3] = PPUclock.dot;
  SHARED.SYNC[4] = PPUclock.frame;
}

// =============================
// Scanline handlers (BG only)
// =============================
function preRenderScanline(currentDot) {
  if (currentDot === 1) {
    //console.log(`[PPU] Pre-render clear @ Frame=${PPUclock.frame}, Scanline=${PPUclock.scanline}`);

    PPU_FRAME_FLAGS = 0b00000001;
    while (PPU_FRAME_FLAGS !== 0x00) {}

    PPUSTATUS &= ~0x80; // clear VBlank
    PPUSTATUS &= ~0x40; // clear sprite0
    PPUSTATUS &= ~0x20; // clear overflow
    Atomics.store(SHARED.SYNC, 3, 0);
  }

  if ((PPUMASK & 0x18) !== 0) {
    if (currentDot >= 280 && currentDot <= 304) copyVert();
  }

  if (currentDot === 339 && PPUclock.oddFrame && (PPUMASK & 0x18)) {
    PPUclock.dot++;
    //console.log(`[PPU] Odd-frame cycle skip @ Frame=${PPUclock.frame}`);
  }
}

function visibleScanline(currentDot) {
  // Visible scanlines 0..239
  const rendering = (PPUMASK & 0x18) !== 0;

  if (rendering) {
    // Tick shifters during fetch region, like hardware
    const inFetch = (currentDot >= 2 && currentDot <= 257) || (currentDot >= 321 && currentDot <= 336);
    if (inFetch) {
      background.bgShiftLo = (background.bgShiftLo << 1) & 0xFFFF;
      background.bgShiftHi = (background.bgShiftHi << 1) & 0xFFFF;
      background.atShiftLo = (background.atShiftLo << 1) & 0xFFFF;
      background.atShiftHi = (background.atShiftHi << 1) & 0xFFFF;
    }

    // fetch pipeline 2..257 and 321..336
    if (inFetch) {
      const phase = (currentDot - 1) % 8;
      const t = t_get();

      switch (phase) {
        case 1: { // nametable
          const v = ppuBusRead(0x2000 | (t & 0x0FFF));
          background.ntByte = v; BG_ntByte = v;
          break;
        }
        case 3: { // attribute
          const attAddr = 0x23C0 | (t & 0x0C00) | ((t >> 4) & 0x38) | ((t >> 2) & 0x07);
          const shift   = ((t >> 4) & 4) | (t & 2);
          const atBits  = (ppuBusRead(attAddr) >> shift) & 3; // 0..3
          const v       = (atBits << 2) & 0xFF;
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
          if (currentDot === 256) incY(); else incCoarseX();
          break;
        }
      }
    }

    // emit pixel on 1..256 (hardware palette rule)
    if (currentDot >= 1 && currentDot <= 256) {
      emitPixelHardwarePalette();
    }
  }

  // Copy horizontal at 257
  if (currentDot === 257 && rendering) {
    copyHoriz();
  }
}

function postRenderScanline(currentDot) {
  // 240 idle
}

function vblankStartScanline(currentDot) {
  if (currentDot === 1) {
    PPUSTATUS |= 0x80;
    Atomics.store(SHARED.SYNC, 3, 1);

    console.log(`[PPU] VBlank SET @ Frame=${PPUclock.frame}, Scanline=${PPUclock.scanline}, Dot=${currentDot}`);

    if (PPUCTRL & 0x80) { // NMI enabled
      const edgeMarker =
        ((PPUclock.frame & 0xFFFF) << 16) |
        ((PPUclock.scanline & 0x1FF) << 7) |
        (currentDot & 0x7F);

      Atomics.store(SHARED.SYNC, 4, edgeMarker);

      console.log(`[PPU] NMI EDGE -> Frame=${PPUclock.frame}, Scanline=${PPUclock.scanline}, Dot=${currentDot}, EdgeMarker=0x${edgeMarker.toString(16)}`);
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

// ---------- Bus access (real SHARED arrays) ----------
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


function resetPPU() {// #fix and use
  PPUclock.dot = 0; PPUclock.scanline = -1; PPUclock.frame = 0; PPUclock.oddFrame = false;
  t_set(0); fineX = 0;
  if (paletteIndexFrame && paletteIndexFrame.fill) paletteIndexFrame.fill(0);
}

function startPPULoop() {
  let last = 0;

  while (true) {
    
    while ((Atomics.load(SHARED.EVENTS, 0) & 0b00000100) !== 0b00000100) {}

    // snapshot → budget → burn
    const now    = Atomics.load(SHARED.CLOCKS, 1);
    const budget = now - last;
    last = now;

    if (budget > 0) {
      let burned = 0;

      for (let i = 0; i < budget; i++) {
        ppuTick();
        burned++;
      }

      // publish stats
      Atomics.store(SHARED.SYNC, 0, budget); // cycles available this interval
      Atomics.store(SHARED.SYNC, 1, burned); // cycles actually burned
    }
  }
}

// for console 
/*

window.snap = () => {
  const ev   = Atomics.load(SHARED.EVENTS, 0);
  const cpu  = Atomics.load(SHARED.CLOCKS, 0);
  const ppu  = Atomics.load(SHARED.CLOCKS, 1);
  const done = SHARED.SYNC ? Atomics.load(SHARED.SYNC, 0) : null;

  const evBits = ev.toString(2).padStart(8, "0");
  const runOn  = (ev & 0b100) ? "ON" : "OFF";

  const last = window.__s || { cpu, ppu, t: performance.now() };
  const dcpu = cpu - last.cpu;
  const dppu = ppu - last.ppu;
  const expected = 3 * dcpu;         // production this interval
  const dt   = (performance.now() - last.t).toFixed(1);

  console.log(
    `EVENTS[0]: ${ev} (bits ${evBits})  RUN=${runOn}\n` +
    `CPU total: ${cpu}   ΔCPU=${dcpu}\n` +
    `PPU total: ${ppu}   ΔPPU(produced)=${dppu}\n` +
    (done !== null ? `PPU burned (worker): ${done}\n` : ``) +
    `Expected ΔPPU = 3×ΔCPU = ${expected}\n` +
    `Interval: ${dt} ms`
  );

  window.__s = { cpu, ppu, t: performance.now() };
};


*/