importScripts('/assets/js/ppu-worker-setup.js');

console.debug("[PPU Worker init]");

// ---------- Constants ----------
const DOTS_PER_SCANLINE   = 341;
const SCANLINES_PER_FRAME = 262;
const NES_W = 256, NES_H = 240;

// ---------- Timing state ----------
const PPUclock = { dot: 0, scanline: -1, frame: 0, oddFrame: false };

// ---------- Background pipeline state ----------
const BG = {
  bgShiftLo: 0, bgShiftHi: 0,
  atShiftLo: 0, atShiftHi: 0,
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0
};

// ---------- VRAM address helpers ----------
function v_get() {
  return ((t_hi & 0x7F) << 8) | (t_lo & 0xFF);
}
function v_set(val) {
  val &= 0x7FFF;
  t_lo = val & 0xFF;
  t_hi = (val >> 8) & 0x7F;
}
function t_get() {
  return ((t_hi & 0x7F) << 8) | (t_lo & 0xFF);
}
function t_set(val) {
  val &= 0x7FFF;
  t_lo = val & 0xFF;
  t_hi = (val >> 8) & 0x7F;
}

// ---------- Address increments ----------
function incCoarseX() {
  let v = v_get();
  if ((v & 0x001F) === 31) {
    v &= ~0x001F;
    v ^= 0x0400;
  } else {
    v = (v + 1) & 0x7FFF;
  }
  v_set(v);
}
function incY() {
  let v = v_get();
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
  v_set(v);
}
function copyHoriz() {
  const v = v_get(), t = t_get();
  v_set((v & ~0x041F) | (t & 0x041F));
}
function copyVert() {
  const v = v_get(), t = t_get();
  v_set((v & ~0x7BE0) | (t & 0x7BE0));
}

// ---------- PPU bus ----------
function ppuBusRead(addr) {
  addr &= 0x3FFF;
  if (addr < 0x2000) return CHR_ROM[addr] & 0xFF;
  if (addr < 0x3F00) return VRAM[mapNT(addr)] & 0xFF;
  return PALETTE_RAM[paletteIndex(addr)] & 0x3F;
}

// ---------- Shifters ----------
function reloadBGShifters() {
  BG.bgShiftLo = (BG.bgShiftLo & 0xFF00) | BG.tileLo;
  BG.bgShiftHi = (BG.bgShiftHi & 0xFF00) | BG.tileHi;
  const atLo = (BG.atByte & 0x01) ? 0xFF : 0x00;
  const atHi = (BG.atByte & 0x02) ? 0xFF : 0x00;
  BG.atShiftLo = (BG.atShiftLo & 0xFF00) | atLo;
  BG.atShiftHi = (BG.atShiftHi & 0xFF00) | atHi;
}

// ---------- Pixel output ----------
function emitPixel() {
  const fx = fineX & 7;
  const p0  = (BG.bgShiftLo >> (15 - fx)) & 1;
  const p1  = (BG.bgShiftHi >> (15 - fx)) & 1;
  const a0  = (BG.atShiftLo >> (15 - fx)) & 1;
  const a1  = (BG.atShiftHi >> (15 - fx)) & 1;

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

// ---------- Scanline handlers ----------
function preRenderScanline() {
  if (PPUclock.dot === 1) {
    PPUSTATUS &= ~0xE0; // clear VBlank, sprite 0 hit, overflow
    nmiPending = false;
  }
  if ((PPUMASK & 0x18) !== 0) {
    if (PPUclock.dot >= 280 && PPUclock.dot <= 304) copyVert();
  }
  if (PPUclock.dot === 339 && PPUclock.oddFrame && (PPUMASK & 0x18)) {
    PPUclock.dot++;
  }
}

function visibleScanline() {
  const rendering = (PPUMASK & 0x18) !== 0;

  if (rendering) {
    const inFetch = (PPUclock.dot >= 2 && PPUclock.dot <= 257) ||
                    (PPUclock.dot >= 321 && PPUclock.dot <= 336);
    if (inFetch) {
      BG.bgShiftLo = (BG.bgShiftLo << 1) & 0xFFFF;
      BG.bgShiftHi = (BG.bgShiftHi << 1) & 0xFFFF;
      BG.atShiftLo = (BG.atShiftLo << 1) & 0xFFFF;
      BG.atShiftHi = (BG.atShiftHi << 1) & 0xFFFF;
    }

    if (inFetch) {
      const phase = (PPUclock.dot - 1) % 8;
      const v = v_get();
      switch (phase) {
        case 1: BG.ntByte = ppuBusRead(0x2000 | (v & 0x0FFF)); break;
        case 3: {
          const attAddr = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
          const shift = ((v >> 4) & 4) | (v & 2);
          const atBits = (ppuBusRead(attAddr) >> shift) & 3;
          BG.atByte = (atBits << 2) & 0xFF;
          break;
        }
        case 5: {
          const fineY = (v >> 12) & 7;
          const base = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + (BG.ntByte << 4) + fineY;
          BG.tileLo = ppuBusRead(base);
          break;
        }
        case 7: {
          const fineY = (v >> 12) & 7;
          const base = (PPUCTRL & 0x10 ? 0x1000 : 0x0000) + (BG.ntByte << 4) + fineY + 8;
          BG.tileHi = ppuBusRead(base);
          break;
        }
        case 0: reloadBGShifters(); (PPUclock.dot === 256) ? incY() : incCoarseX(); break;
      }
    }

    if (PPUclock.dot >= 1 && PPUclock.dot <= 256) emitPixel();
  }

  if (PPUclock.dot === 257 && rendering) copyHoriz();
}

function postRenderScanline() { /* idle */ }

function vblankScanline() {
  if (PPUclock.scanline === 241 && PPUclock.dot === 1) {
    // Enter VBlank, request blit
    PPUSTATUS |= 0x80;
    if (PPUCTRL & 0x80) nmiPending = true;

    // Signal main thread to blit
    PPU_FRAME_FLAGS = 0x01;

    // hang until main clears the flag post frame render ----
    while (PPU_FRAME_FLAGS !== 0x00) {
    }
  }
}

// ---------- Tick ----------
function ppuTick() {
  if (PPUclock.scanline === -1 || PPUclock.scanline === 261) preRenderScanline();
  else if (PPUclock.scanline >= 0 && PPUclock.scanline <= 239) visibleScanline();
  else if (PPUclock.scanline === 240) postRenderScanline();
  else if (PPUclock.scanline >= 241 && PPUclock.scanline <= 260) vblankScanline();

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

// ---------- Loop ----------
function startPPULoop() {
  let last = 0;
  while (true) {
    while ((Atomics.load(SHARED.EVENTS, 0) & 0b00000100) !== 0b00000100) {}
    const now = Atomics.load(SHARED.CLOCKS, 1);
    const budget = now - last;
    last = now;
    for (let i = 0; i < budget; i++) ppuTick();
    Atomics.store(SHARED.SYNC, 0, budget);
    Atomics.store(SHARED.SYNC, 1, budget);
  }
}
