// =============================
// ppu-worker.js
// =============================
console.log('[PPU-Worker] loaded');

let CLOCKS, STATUS, EVENTS, FRAMECTR;
let ppuLoopStarted = false;
let romReady = false; // added

// Shared assets
const ASSETS = {
  CHR_ROM: null,
  VRAM: null,
  PALETTE_RAM: null,
  OAM: null
};

const PPUclock = { dot: 0, scanline: 0, frame: 0, oddFrame: false };

const NES_W = 256, NES_H = 240;
const DOTS_PER_SCANLINE = 341, SCANLINES_PER_FRAME = 262;
const PPU_CYCLES_PER_FRAME = DOTS_PER_SCANLINE * SCANLINES_PER_FRAME;
const CPU_CYCLES_PER_FRAME = Math.floor(PPU_CYCLES_PER_FRAME / 3);

let paletteIndexFrame = new Uint8Array(NES_W * NES_H);

const PPUreg = {
  CTRL: 0x00, MASK: 0x00, STATUS: 0x00,
  OAMADDR: 0x00,
  SCROLL_X: 0x00, SCROLL_Y: 0x00,
  ADDR_HIGH: 0x00, ADDR_LOW: 0x00,
  VRAM_ADDR: 0x0000, t: 0x0000,
  fineX: 0,
  writeToggle: false,
  BG: { bgShiftLo: 0, bgShiftHi: 0, atShiftLo: 0, atShiftHi: 0, ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0 }
};

// ---------- Message wiring ----------
onmessage = (e) => {
  const d = e.data;

  if (d.SAB_CLOCKS) CLOCKS = new Int32Array(d.SAB_CLOCKS);
  if (d.SAB_STATUS) STATUS = new Uint8Array(d.SAB_STATUS);
  if (d.SAB_EVENTS) EVENTS = new Int32Array(d.SAB_EVENTS);
  if (d.SAB_FRAME)  FRAMECTR = new Int32Array(d.SAB_FRAME);

  if (d.SAB_ASSETS) attachAssets(d.SAB_ASSETS);
  if (d.type === 'assetsUpdate' && d.SAB_ASSETS) attachAssets(d.SAB_ASSETS);

  if (d.type === 'romReady') romReady = true; // added

  if ((d.type === 'ppuState' || d.type === 'ppuRegs') && d.PPUregister) {
    mergeCPURegisterWrites(d.PPUregister);
  }

  if (!ppuLoopStarted && romReady && CLOCKS && STATUS && EVENTS) {
    waitUntilCPUStarts();
  }
};

function attachAssets(a) {
  if (a.CHR_ROM)     ASSETS.CHR_ROM     = new Uint8Array(a.CHR_ROM);
  if (a.VRAM)        ASSETS.VRAM        = new Uint8Array(a.VRAM);
  if (a.PALETTE_RAM) ASSETS.PALETTE_RAM = new Uint8Array(a.PALETTE_RAM);
  if (a.OAM)         ASSETS.OAM         = new Uint8Array(a.OAM);
}

function waitUntilCPUStarts() {
  if (Atomics.load(CLOCKS, 0) > 0) {
    ppuLoopStarted = true;
    startLoopFrameLead();
  } else {
    setTimeout(waitUntilCPUStarts, 0);
  }
}

function mergeCPURegisterWrites(src) {
  PPUreg.CTRL        = src.CTRL & 0xFF;
  PPUreg.MASK        = src.MASK & 0xFF;
  PPUreg.OAMADDR     = src.OAMADDR & 0xFF;
  PPUreg.SCROLL_X    = src.SCROLL_X & 0xFF;
  PPUreg.SCROLL_Y    = src.SCROLL_Y & 0xFF;
  PPUreg.ADDR_HIGH   = src.ADDR_HIGH & 0xFF;
  PPUreg.ADDR_LOW    = src.ADDR_LOW & 0xFF;
  PPUreg.VRAM_ADDR   = src.VRAM_ADDR & 0x3FFF;
  PPUreg.t           = src.t & 0x7FFF;
  PPUreg.fineX       = src.fineX & 0x07;
  PPUreg.writeToggle = !!src.writeToggle;
}

// ---------- Main loop ----------
function startLoopFrameLead() {
  console.log("%c[PPU-Worker] Frame-based loop (PPU leads, CPU catches up)",
              "background:#222; color:#0f0; font-weight:bold");
  let cpuOverflow = 0;
  let lastPPUCounter = 0;

  (function loop() {
    for (let i = 0; i < PPU_CYCLES_PER_FRAME; i++) ppuTick();
    lastPPUCounter += PPU_CYCLES_PER_FRAME;
    if (CLOCKS) Atomics.store(CLOCKS, 1, lastPPUCounter);
    renderFrameIndices();
    if (FRAMECTR) Atomics.add(FRAMECTR, 0, 1);

    const cpuStart = Atomics.load(CLOCKS, 0);
    const waitTarget = Math.max(0, CPU_CYCLES_PER_FRAME - cpuOverflow);

    (function waitCPU() {
      const now = Atomics.load(CLOCKS, 0);
      const delta = now - cpuStart;
      if (delta >= waitTarget) {
        cpuOverflow = (delta - waitTarget) > 0 ? (delta - waitTarget) : 0;
        setTimeout(loop, 0);
      } else {
        setTimeout(waitCPU, 0);
      }
    })();
  })();
}

// ---------- PPU tick ----------
function ppuTick() {
  const renderingEnabled = !!(PPUreg.MASK & 0x18); // bg or sprites

  // Visible scanlines
  if (PPUclock.scanline >= 0 && PPUclock.scanline < 240) {
    if (renderingEnabled) {
      if ((PPUclock.dot >= 1 && PPUclock.dot <= 256) || (PPUclock.dot >= 321 && PPUclock.dot <= 336)) {
        PPUreg.BG.bgShiftLo <<= 1; 
        PPUreg.BG.bgShiftHi <<= 1;
        PPUreg.BG.atShiftLo <<= 1; 
        PPUreg.BG.atShiftHi <<= 1;

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
              (PPUreg.CTRL & 0x10 ? 0x1000 : 0x0000) +
              (PPUreg.BG.ntByte * 16) +
              ((PPUreg.VRAM_ADDR >> 12) & 0x7)
            );
            break;
          case 7:
            PPUreg.BG.tileHi = ppuBusRead(
              (PPUreg.CTRL & 0x10 ? 0x1000 : 0x0000) +
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

  // VBlank start
  if (PPUclock.scanline === 241 && PPUclock.dot === 1) {
    console.log(`[PPU Worker] Enter VBlank @ frame=${PPUclock.frame} scanline=${PPUclock.scanline} dot=${PPUclock.dot}`);
    Atomics.or(STATUS, 0, 0x80);
    if (PPUreg.CTRL & 0x80) {
      console.log("[PPU Worker] NMI asserted");
      Atomics.or(EVENTS, 0, 0x1);
    }
  }

  // Pre-render scanline
  if (PPUclock.scanline === -1 || PPUclock.scanline === 261) {
    if (PPUclock.dot === 1) {
      console.log(`[PPU Worker] Clear VBlank @ frame=${PPUclock.frame}`);
      Atomics.and(STATUS, 0, ~0x80);
      // sprite0hit/sprite overflow clear here if needed
    }
    if (renderingEnabled && PPUclock.dot >= 280 && PPUclock.dot <= 304) copyVert();
  }

  // Advance dot/scanline/frame counters
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
  if (addr < 0x2000) return ASSETS.CHR_ROM ? ASSETS.CHR_ROM[addr] : 0;
  if (addr < 0x3F00) return ASSETS.VRAM ? ASSETS.VRAM[(addr - 0x2000) & 0x07FF] : 0;
  let pal = addr & 0x1F;
  if ((pal & 0x13) === 0x10) pal &= ~0x10;
  return ASSETS.PALETTE_RAM ? (ASSETS.PALETTE_RAM[pal] & 0x3F) : 0;
}

// ---------- Frame compositor ----------
function renderFrameIndices() {
  const TILE_BYTES = 16, TILES_X = 32, TILES_Y = 30;
  const totalTiles = ASSETS.CHR_ROM ? (ASSETS.CHR_ROM.length / TILE_BYTES) | 0 : 0;
  const lowLUT  = new Uint8Array(totalTiles * 8);
  const highLUT = new Uint8Array(totalTiles * 8);

  for (let t = 0; t < totalTiles; t++) {
    const base = t * 16;
    for (let row = 0; row < 8; row++) {
      const li = t * 8 + row;
      lowLUT[li]  = ASSETS.CHR_ROM ? ASSETS.CHR_ROM[base + row]     : 0;
      highLUT[li] = ASSETS.CHR_ROM ? ASSETS.CHR_ROM[base + row + 8] : 0;
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
      const tileIndex = ASSETS.VRAM ? ASSETS.VRAM[NAME_BASE + ntIndex] : 0;
      const lutIndex = tileIndex * 8 + rowInTile;
      const lowB  = lowLUT[lutIndex];
      const highB = highLUT[lutIndex];
      const bit = 7 - (x & 7);
      const pix = ((highB >> bit) & 1) << 1 | ((lowB >> bit) & 1);
      const attrX = (tileX / 4) | 0;
      const attrY = (tileY / 4) | 0;
      const attrIndex = attrY * 8 + attrX;
      const attrByte  = ASSETS.VRAM ? ASSETS.VRAM[ATTR_BASE + attrIndex] : 0;
      const shift = ((tileY & 2) << 1) | (tileX & 2);
      const palNum = (attrByte >> shift) & 0x03;
      const palBase = (palNum * 4) | 0;
      const palIdx  = ASSETS.PALETTE_RAM ? (ASSETS.PALETTE_RAM[(palBase + pix) & 0x1F] & 0x3F) : 0;
      paletteIndexFrame[out++] = palIdx;
    }
  }

  postMessage(
    { type: 'frame', format: 'indices', bpp: 8, w: NES_W, h: NES_H, buffer: paletteIndexFrame.buffer },
    [paletteIndexFrame.buffer]
  );
  paletteIndexFrame = new Uint8Array(NES_W * NES_H);
}
