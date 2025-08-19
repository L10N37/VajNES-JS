importScripts('/assets/js/ppu-worker-setup.js');

console.debug("[PPU Worker init]")

let debugLogging = false;

// ---------- Constants ----------
const DOTS_PER_SCANLINE   = 341;
const SCANLINES_PER_FRAME = 262; // -1, 0..260; pre-render at 261

// ---------- Timing state ----------
const PPUclock = { dot: 0, scanline: -1, frame: 0, oddFrame: false };

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
// Scanline handlers
// =============================
function preRenderScanline() {
  // 261: setup for next frame
  if (PPUclock.dot === 0) {
    PPU_FRAME_FLAGS = 0b00000001; // tell main to blit
  }
  if (PPUclock.dot === 1) {
    PPUSTATUS &= ~0x80; // clear VBlank
    PPUSTATUS &= ~0x40; // clear sprite 0 hit
    PPUSTATUS &= ~0x20; // clear sprite overflow
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
  // 240: just idle 1 scanline
  const idleCycles = DOTS_PER_SCANLINE;
  Atomics.sub(SHARED.SYNC, 0, idleCycles);
  Atomics.add(SHARED.SYNC, 1, idleCycles);
  PPUclock.dot = DOTS_PER_SCANLINE; // fast-forward
}

function vblankScanline() {
  // 241: set VBlank + maybe NMI
  if (PPUclock.scanline === 241) {
    PPUSTATUS |= 0x80;
    if (PPUCTRL & 0x80) {
      nmiPending = true;
      if (debugLogging) {
        console.debug("%cPPU NMI", "color:#fff;background:#c00;font-weight:bold;padding:2px 6px;border-radius:3px");
      }
    }
  }

  // 241–260: all idle
  const idleCycles = DOTS_PER_SCANLINE;
  Atomics.sub(SHARED.SYNC, 0, idleCycles);
  Atomics.add(SHARED.SYNC, 1, idleCycles);
  PPUclock.dot = DOTS_PER_SCANLINE; // fast-forward
}

// =============================
// LUT
// =============================
const scanlineLUT = new Array(262);

// Visible
for (let i = 0; i <= 239; i++) scanlineLUT[i] = visibleScanline;
// Post-render (240)
scanlineLUT[240] = postRenderScanline;
// VBlank (241–260)
for (let i = 241; i <= 260; i++) scanlineLUT[i] = vblankScanline;
// Pre-render (261)
scanlineLUT[261] = preRenderScanline;

// =============================
// Helpers
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
  // v: ....F.. CCCCX (coarse X in bits 0..4, H nametable in bit 10)
  let v = v_get_Sim();
  if ((v & 0x001F) === 31) {        // if coarse X == 31
    v &= ~0x001F;                   // coarse X = 0
    v ^= 0x0400;                    // switch horizontal nametable
  } else {
    v = (v + 1) & 0x7FFF;           // coarse X++
  }
  v_set_Sim(v);
}

function incY() {
  // v: fineY in bits 12..14, coarseY in bits 5..9, V nametable bit in 11
  let v = v_get_Sim();
  if ((v & 0x7000) !== 0x7000) {
    v = (v + 0x1000) & 0x7FFF;        // fineY++
  } else {
    v &= ~0x7000;                      // fineY = 0
    let y = (v & 0x03E0) >> 5;         // coarseY
    if (y === 29) {
      y = 0;
      v ^= 0x0800;                     // switch vertical nametable
    } else if (y === 31) {
      y = 0;                           // wrap
    } else {
      y++;
    }
    v = (v & ~0x03E0) | (y << 5);
  }
  v_set_Sim(v);
}

function copyHoriz() {
  // Copy horizontal bits from t into v
  const v = v_get_Sim(), t = t_get_Sim();
  const newV = (v & ~0x041F) | (t & 0x041F);
  v_set_Sim(newV);
}
function copyVert() {
  const v = v_get_Sim(), t = t_get_Sim();
  const newV = (v & ~0x7BE0) | (t & 0x7BE0);
  v_set_Sim(newV);
}

function ppuBusRead(addr14) {
  const v = addr14 & 0x3FFF;
  if (v < 0x2000) return chrRead(v);
  if (v < 0x3F00) return VRAM[mapNT(v)] & 0xFF;
  return PALETTE_RAM[paletteIndex(v)] & 0x3F;
}

function resetPPU() {
  PPUclock.dot = 0; PPUclock.scanline = -1; PPUclock.frame = 0; PPUclock.oddFrame = false;
  t_set(0); fineX = 0;
  if (paletteIndexFrame && paletteIndexFrame.fill) paletteIndexFrame.fill(0);
}

function burnIdleScanline() {
  // Consume one scanline worth of cycles (341)
  const idleCycles = DOTS_PER_SCANLINE;
  Atomics.sub(SHARED.SYNC, 0, idleCycles);
  Atomics.add(SHARED.SYNC, 1, idleCycles);

  // Advance dot/scanline counters as if we ticked
  PPUclock.dot = 0;
  PPUclock.scanline++;
  if (PPUclock.scanline > 261) {
    PPUclock.scanline = 0;
    PPUclock.frame++;
    PPUclock.oddFrame = !PPUclock.oddFrame;
  }
}

function startPPULoop() {
  let last = 0;

  while (true) {
    // Wait until RUN bit set
    while ((Atomics.load(SHARED.EVENTS, 0) & 0b00000100) !== 0b00000100) {}

    const now    = Atomics.load(SHARED.CLOCKS, 1);
    const budget = now - last;
    last = now;

    if (budget > 0) {
      let burned = 0;

      while (burned < budget) {
        // Visible or pre-render → step dot by dot
        if ((PPUclock.scanline >= 0 && PPUclock.scanline <= 239) ||
            PPUclock.scanline === 261 || PPUclock.scanline === -1) {
          ppuTick();
          burned++;
        }
        // Post-render (240) or VBlank (241–260) → burn whole scanline at once
        else if (PPUclock.scanline === 240 || 
                 (PPUclock.scanline >= 241 && PPUclock.scanline <= 260)) {
          // Special case: dot 1 of 241 must set vblank + maybe NMI
          if (PPUclock.scanline === 241 && PPUclock.dot === 0) {
            PPUSTATUS |= 0x80;
            if (PPUCTRL & 0x80) {
              nmiPending = true;
              if (debugLogging) {
                console.debug("%cPPU NMI", "color:#fff;background:#c00;font-weight:bold;padding:2px 6px;border-radius:3px");
              }
            }
          }

          burnIdleScanline();
          burned += DOTS_PER_SCANLINE;
        }
      }

      // publish stats
      Atomics.store(SHARED.SYNC, 0, budget);
      Atomics.store(SHARED.SYNC, 1, burned);
    }
  }
}
