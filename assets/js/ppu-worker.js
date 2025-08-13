// =============================
// ppu-worker.js  (self-driven PPU with catch-up pump)
// PPU stays in sync because ppu-worker compares CLOCKS[0] (CPU cycles) to (CPU * 3) and ticks until caught up.
// =============================
console.log('[PPU-Worker] loaded');

// Local namespace for shared views (mirrors main thread’s SHARED)
let SHARED = {};

let CLOCKS, EVENTS, FRAMECTR;
let romReady = false;

// PPU timing state
const PPUclock = { dot: 0, scanline: 0, frame: 0, oddFrame: false };

// Constants
const NES_W = 256, NES_H = 240;
const DOTS_PER_SCANLINE = 341, SCANLINES_PER_FRAME = 262;

// Back buffer of palette indices (0..63)
let paletteIndexFrame = new Uint8Array(NES_W * NES_H);
let lastFrameRendered = -1;

// only the variables needed on this thread
const PPUreg = {
  VRAM_ADDR: 0x0000,  // v
  t: 0x0000,          // t
  fineX: 0,
  writeToggle: false,
  BG: {
    bgShiftLo: 0, bgShiftHi: 0,
    atShiftLo: 0, atShiftHi: 0,
    ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0
  }
};

function mergePPUSnapshot(s) {
  if (!s) return;
  if (typeof s.SCROLL_X   === 'number') PPUreg.SCROLL_X   = s.SCROLL_X & 0xFF;
  if (typeof s.SCROLL_Y   === 'number') PPUreg.SCROLL_Y   = s.SCROLL_Y & 0xFF;
  if (typeof s.VRAM_ADDR  === 'number') PPUreg.VRAM_ADDR  = s.VRAM_ADDR & 0x3FFF;
  if (typeof s.t          === 'number') PPUreg.t          = s.t & 0x7FFF;
  if (typeof s.fineX      === 'number') PPUreg.fineX      = s.fineX & 0x07;
  if (typeof s.writeToggle=== 'boolean')PPUreg.writeToggle= s.writeToggle;
}

// ---------- Message wiring ----------
onmessage = (e) => {
  const d = e.data || {};

  if (d.SAB_CLOCKS) { SHARED.CLOCKS = new Int32Array(d.SAB_CLOCKS); CLOCKS = SHARED.CLOCKS; }
  if (d.SAB_EVENTS) { SHARED.EVENTS = new Int32Array(d.SAB_EVENTS); EVENTS = SHARED.EVENTS; }
  if (d.SAB_FRAME)  { SHARED.FRAME  = new Int32Array(d.SAB_FRAME);  FRAMECTR = SHARED.FRAME; }
  if (d.SAB_CPU_OPENBUS) { SHARED.CPU_OPENBUS = new Uint8Array(d.SAB_CPU_OPENBUS); }

  if (d.type === 'ppuRegs' && d.regs) {
  mergePPUSnapshot(d.regs);
  }

  // Mapping: 0=CTRL, 1=MASK, 2=ADDR_HIGH, 3=ADDR_LOW, 4=STATUS
  if (d.SAB_PPU_REGS) {
    SHARED.PPU_REGS = new Uint8Array(d.SAB_PPU_REGS);
  }

  if (d.SAB_ASSETS) {
    SHARED.CHR_ROM     = new Uint8Array(d.SAB_ASSETS.CHR_ROM);
    SHARED.VRAM        = new Uint8Array(d.SAB_ASSETS.VRAM);
    SHARED.PALETTE_RAM = new Uint8Array(d.SAB_ASSETS.PALETTE_RAM);
    SHARED.OAM         = new Uint8Array(d.SAB_ASSETS.OAM);
  }

  if (d.type === 'romReady') {
    romReady = true;
    startPump();
  }

  if (d.type === 'ppu-reset') {
    resetPPU();
  }
};

// ---------- Shared reg helpers ----------
function regCTRL()      { return SHARED.PPU_REGS[0] | 0; }
function regMASK()      { return SHARED.PPU_REGS[1] | 0; }
function regADDR_HIGH() { return SHARED.PPU_REGS[2] | 0; }
function regADDR_LOW()  { return SHARED.PPU_REGS[3] | 0; }
function regSTATUS()    { return SHARED.PPU_REGS[4] | 0; }
function setSTATUS(val) { SHARED.PPU_REGS[4] = val & 0xFF; }

// ---------- PPU tick ----------
function ppuTick() {
  const renderingEnabled = !!(regMASK() & 0x18);

  if (PPUclock.scanline >= 0 && PPUclock.scanline < 240) {
    if (renderingEnabled) {
      if ((PPUclock.dot >= 1 && PPUclock.dot <= 256) || (PPUclock.dot >= 321 && PPUclock.dot <= 336)) {
        PPUreg.BG.bgShiftLo <<= 1; PPUreg.BG.bgShiftHi <<= 1;
        PPUreg.BG.atShiftLo <<= 1; PPUreg.BG.atShiftHi <<= 1;

        switch (PPUclock.dot % 8) {
          case 1:
            PPUreg.BG.ntByte = ppuBusRead(0x2000 | (PPUreg.VRAM_ADDR & 0x0FFF));
            break;
          case 3:
            PPUreg.BG.atByte = ppuBusRead(
              0x23C0 |
              (PPUreg.VRAM_ADDR & 0x0C00) |
              ((PPUreg.VRAM_ADDR >> 4) & 0x38) |
              ((PPUreg.VRAM_ADDR >> 2) & 0x07)
            );
            break;
          case 5:
            PPUreg.BG.tileLo = ppuBusRead(
              (regCTRL() & 0x10 ? 0x1000 : 0x0000) +
              (PPUreg.BG.ntByte * 16) +
              ((PPUreg.VRAM_ADDR >> 12) & 0x7)
            );
            break;
          case 7:
            PPUreg.BG.tileHi = ppuBusRead(
              (regCTRL() & 0x10 ? 0x1000 : 0x0000) +
              (PPUreg.BG.ntByte * 16) +
              ((PPUreg.VRAM_ADDR >> 12) & 0x7) + 8
            );
            break;
          case 0:
            reloadBGShifters();
            incCoarseX();
            break;
        }
      }
      if (PPUclock.dot === 256) incY();
      if (PPUclock.dot === 257) copyHoriz();
    }
    if (PPUclock.dot >= 1 && PPUclock.dot <= 256) emitPixel();
  }

  if (PPUclock.scanline === 241 && PPUclock.dot === 1) {
    setSTATUS(regSTATUS() | 0x80);
    if (regCTRL() & 0x80) Atomics.or(EVENTS, 0, 0x1);

    if (PPUclock.frame !== lastFrameRendered) {
      renderFrameIndices();
      if (FRAMECTR) Atomics.add(FRAMECTR, 0, 1);
      lastFrameRendered = PPUclock.frame;
    }
  }

  if (PPUclock.scanline === -1 || PPUclock.scanline === 261) {
    if (PPUclock.dot === 1) setSTATUS(regSTATUS() & ~0x80);
    if (renderingEnabled && PPUclock.dot >= 280 && PPUclock.dot <= 304) copyVert();
  }

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

  if (CLOCKS) Atomics.add(CLOCKS, 1, 1);
}

// ---------- Helpers ----------
function reloadBGShifters() {
  PPUreg.BG.bgShiftLo = (PPUreg.BG.bgShiftLo & 0xFF00) | PPUreg.BG.tileLo;
  PPUreg.BG.bgShiftHi = (PPUreg.BG.bgShiftHi & 0xFF00) | PPUreg.BG.tileHi;

  const at = PPUreg.BG.atByte;
  const palLo = (at & 1) ? 0xFF : 0x00;
  const palHi = (at & 2) ? 0xFF : 0x00;
  PPUreg.BG.atShiftLo = (PPUreg.BG.atShiftLo & 0xFF00) | palLo;
  PPUreg.BG.atShiftHi = (PPUreg.BG.atShiftHi & 0xFF00) | palHi;
}

function emitPixel() {
  const x = PPUclock.dot - 1, y = PPUclock.scanline;
  if (x < 0 || x >= NES_W || y < 0 || y >= NES_H) return;

  const fineX = PPUreg.fineX & 0x7;

  const bit0 = (PPUreg.BG.bgShiftLo >> (15 - fineX)) & 1;
  const bit1 = (PPUreg.BG.bgShiftHi >> (15 - fineX)) & 1;
  const bgPix = (bit1 << 1) | bit0;

  const pal0 = (PPUreg.BG.atShiftLo >> (15 - fineX)) & 1;
  const pal1 = (PPUreg.BG.atShiftHi >> (15 - fineX)) & 1;
  const palSel = (pal1 << 1) | pal0;

  let index = (palSel << 2) | bgPix;
  if (bgPix === 0) index = 0;

  paletteIndexFrame[y * NES_W + x] = index & 0x3F;
}

function incCoarseX() {
  if ((PPUreg.VRAM_ADDR & 0x001F) !== 31) {
    PPUreg.VRAM_ADDR = (PPUreg.VRAM_ADDR + 1) & 0x7FFF;
  } else {
    PPUreg.VRAM_ADDR = (PPUreg.VRAM_ADDR & ~0x001F) ^ 0x0400;
  }
}

function incY() {
  if ((PPUreg.VRAM_ADDR & 0x7000) !== 0x7000) {
    PPUreg.VRAM_ADDR = (PPUreg.VRAM_ADDR + 0x1000) & 0x7FFF;
  } else {
    PPUreg.VRAM_ADDR &= ~0x7000;
    let y = (PPUreg.VRAM_ADDR & 0x03E0) >> 5;
    if (y === 29) {
      y = 0; PPUreg.VRAM_ADDR ^= 0x0800;
    } else if (y === 31) {
      y = 0;
    } else {
      y++;
    }
    PPUreg.VRAM_ADDR = (PPUreg.VRAM_ADDR & ~0x03E0) | (y << 5);
  }
}

function copyHoriz() {
  PPUreg.VRAM_ADDR = (PPUreg.VRAM_ADDR & ~0x041F) | (PPUreg.t & 0x041F);
}

function copyVert() {
  PPUreg.VRAM_ADDR = (PPUreg.VRAM_ADDR & ~0x7BE0) | (PPUreg.t & 0x7BE0);
}

function ppuBusRead(addr) {
  addr &= 0x3FFF;
  if (addr < 0x2000) {
    return SHARED.CHR_ROM ? SHARED.CHR_ROM[addr] : 0;
  }
  if (addr < 0x3F00) {
    return SHARED.VRAM ? SHARED.VRAM[(addr - 0x2000) & 0x07FF] : 0;
  }
  let pal = addr & 0x1F;
  if ((pal & 0x13) === 0x10) pal &= ~0x10;
  return SHARED.PALETTE_RAM ? (SHARED.PALETTE_RAM[pal] & 0x3F) : 0;
}

function renderFrameIndices() {
  const TILE_BYTES = 16, TILES_X = 32, TILES_Y = 30;
  const totalTiles = SHARED.CHR_ROM ? (SHARED.CHR_ROM.length / TILE_BYTES) | 0 : 0;

  const lowLUT  = new Uint8Array(totalTiles * 8);
  const highLUT = new Uint8Array(totalTiles * 8);

  for (let t = 0; t < totalTiles; t++) {
    const base = t * 16;
    for (let row = 0; row < 8; row++) {
      const li = t * 8 + row;
      lowLUT[li]  = SHARED.CHR_ROM ? SHARED.CHR_ROM[base + row]     : 0;
      highLUT[li] = SHARED.CHR_ROM ? SHARED.CHR_ROM[base + row + 8] : 0;
    }
  }

  const NAME_BASE = 0x000;
  const ATTR_BASE = 0x3C0;

  let out = 0;
  for (let y = 0; y < NES_H; y++) {
    const tileY = (y / 8) | 0;
    const rowInTile = y & 7;

    for (let x = 0; x < NES_W; x++) {
      const tileX = (x / 8) | 0;

      const ntIndex   = tileY * TILES_X + tileX;
      const tileIndex = SHARED.VRAM ? SHARED.VRAM[NAME_BASE + ntIndex] : 0;

      const lutIndex  = tileIndex * 8 + rowInTile;
      const lowB  = lowLUT[lutIndex];
      const highB = highLUT[lutIndex];

      const bit = 7 - (x & 7);
      const pix = ((highB >> bit) & 1) << 1 | ((lowB >> bit) & 1);

      const attrX = (tileX / 4) | 0;
      const attrY = (tileY / 4) | 0;
      const attrIndex = attrY * 8 + attrX;
      const attrByte  = SHARED.VRAM ? SHARED.VRAM[ATTR_BASE + attrIndex] : 0;

      const shift   = ((tileY & 2) << 1) | (tileX & 2);
      const palNum  = (attrByte >> shift) & 0x03;

      const palBase = (palNum * 4) | 0;
      const palIdx  = SHARED.PALETTE_RAM ? (SHARED.PALETTE_RAM[(palBase + pix) & 0x1F] & 0x3F) : 0;

      paletteIndexFrame[out++] = palIdx;
    }
  }

  postMessage(
    { type: 'frame', format: 'indices', bpp: 8, w: NES_W, h: NES_H, buffer: paletteIndexFrame.buffer },
    [paletteIndexFrame.buffer]
  );
  paletteIndexFrame = new Uint8Array(NES_W * NES_H);
}

function resetPPU() {
  PPUclock.dot = 0;
  PPUclock.scanline = 0;
  PPUclock.frame = 0;
  PPUclock.oddFrame = false;
  lastFrameRendered = -1;

  PPUreg.OAMADDR = 0;
  PPUreg.SCROLL_X = PPUreg.SCROLL_Y = 0;
  PPUreg.VRAM_ADDR = PPUreg.t = 0;
  PPUreg.fineX = 0;
  PPUreg.writeToggle = false;

  PPUreg.BG.bgShiftLo = PPUreg.BG.bgShiftHi =
  PPUreg.BG.atShiftLo = PPUreg.BG.atShiftHi = 0;
  PPUreg.BG.ntByte = PPUreg.BG.atByte = PPUreg.BG.tileLo = PPUreg.BG.tileHi = 0;
}

let pumpStarted = false;
function pump() {
  if (!romReady || !CLOCKS) { setTimeout(pump, 0); return; }

  const cpu    = Atomics.load(CLOCKS, 0) | 0;
  const target = (cpu * 3) | 0;
  let   ppu    = Atomics.load(CLOCKS, 1) | 0;

  let steps = 0, MAX = 50000;
  while (ppu < target && steps < MAX) { ppuTick(); ppu++; steps++; }

  setTimeout(pump, 0);
}

function startPump() {
  if (!pumpStarted) { pumpStarted = true; setTimeout(pump, 0); }
}
