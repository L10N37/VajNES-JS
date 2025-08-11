const NES_W = 256;
const NES_H = 240;
const DOTS_PER_SCANLINE = 341;
const SCANLINES_PER_FRAME = 262;

let ppuDebugLogging = true; // toggle for debug logs

// --- Pixel Buffer (stores NES palette indices for the frame) ---
let pixelColorIndex = new Uint8Array(NES_W * NES_H);

// --- OAM ---
let PPU_OAM = new Uint8Array(256);

// --- Registers ---
let PPUregister = {
  CTRL: 0x00,
  MASK: 0x00,
  STATUS: 0x00,
  OAMADDR: 0x00,
  SCROLL_X: 0x00,
  SCROLL_Y: 0x00,
  ADDR_HIGH: 0x00,
  ADDR_LOW: 0x00,
  VRAM_ADDR: 0x0000,
  t: 0x0000,
  fineX: 0,
  writeToggle: false,
  VRAM_DATA: 0x00,

  BG: {
    bgShiftLo: 0,
    bgShiftHi: 0,
    atShiftLo: 0,
    atShiftHi: 0,
    ntByte: 0,
    atByte: 0,
    tileLo: 0,
    tileHi: 0
  }
};

// --- Clock ---
const PPUclock = {
  scanline: 0,
  dot: 0,
  frame: 0,
  oddFrame: false
};

// ============================
// CPU <-> PPU Interface
// ============================
function ppuWrite(addr, value) {
  value &= 0xFF;
  switch (addr) {
    case 0x2000:
      PPUregister.CTRL = value;
      PPUregister.t = (PPUregister.t & 0xF3FF) | ((value & 0x03) << 10);
      break;
    case 0x2001:
      PPUregister.MASK = value;
      break;
    case 0x2003:
      PPUregister.OAMADDR = value;
      break;
    case 0x2004:
      PPU_OAM[PPUregister.OAMADDR] = value;
      PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF;
      break;
    case 0x2005:
      if (!PPUregister.writeToggle) {
        PPUregister.SCROLL_X = value;
        PPUregister.fineX = value & 0x07;
        PPUregister.t = (PPUregister.t & ~0x001F) | ((value >> 3) & 0x1F);
        PPUregister.writeToggle = true;
      } else {
        PPUregister.SCROLL_Y = value;
        PPUregister.t = (PPUregister.t & ~(0x7000 | 0x03E0))
          | ((value & 0x07) << 12)
          | (((value >> 3) & 0x1F) << 5);
        PPUregister.writeToggle = false;
      }
      break;
    case 0x2006:
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value;
        PPUregister.t = (PPUregister.t & 0x00FF) | ((value & 0x3F) << 8);
        PPUregister.writeToggle = true;
      } else {
        PPUregister.ADDR_LOW = value;
        PPUregister.t = (PPUregister.t & 0x7F00) | value;
        PPUregister.VRAM_ADDR = PPUregister.t & 0x3FFF;
        PPUregister.writeToggle = false;
      }
      break;
    case 0x2007: {
      const addrVRAM = PPUregister.VRAM_ADDR & 0x3FFF;
      ppuBusWrite(addrVRAM, value);
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      break;
    }
  }
}

function ppuRead(addr) {
  switch (addr) {
    case 0x2002: {
      const ret = PPUregister.STATUS;
      PPUregister.STATUS &= ~0x80;
      PPUregister.writeToggle = false;
      return ret;
    }
    case 0x2004:
      return PPU_OAM[PPUregister.OAMADDR] & 0xFF;
    case 0x2007: {
      const addrVRAM = PPUregister.VRAM_ADDR & 0x3FFF;
      let ret;
      if (addrVRAM < 0x3F00) {
        ret = PPUregister.VRAM_DATA;
        PPUregister.VRAM_DATA = ppuBusRead(addrVRAM);
      } else {
        ret = ppuBusRead(addrVRAM);
        PPUregister.VRAM_DATA = ppuBusRead(addrVRAM - 0x1000);
      }
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      return ret;
    }
  }
  return cpuOpenBus;
}

// ============================
// VRAM / Palette Access
// ============================
function ppuBusRead(addr) {
  addr &= 0x3FFF;
  if (addr < 0x2000) {
    return chrRom[addr];
  } else if (addr < 0x3F00) {
    return systemMemoryVideo[addr - 0x2000];
  } else {
    let palAddr = addr & 0x1F;
    if ((palAddr & 0x13) === 0x10) palAddr &= ~0x10;
    return systemMemoryVideo[0x3F00 - 0x2000 + palAddr];
  }
}

function ppuBusWrite(addr, value) {
  addr &= 0x3FFF;
  if (ppuDebugLogging && addr >= 0x2000) {
    console.log(`[PPU] VRAM write @${addr.toString(16).padStart(4, "0")} = ${value.toString(16).padStart(2, "0")}`);
  }
  if (addr < 0x2000) {
    if (chrIsRAM) chrRom[addr] = value;
  } else if (addr < 0x3F00) {
    systemMemoryVideo[addr - 0x2000] = value;
  } else {
    let palAddr = addr & 0x1F;
    if ((palAddr & 0x13) === 0x10) palAddr &= ~0x10;
    systemMemoryVideo[0x3F00 - 0x2000 + palAddr] = value & 0x3F;
  }
}

// ============================
// Scrolling Helpers
// ============================
function incCoarseX() {
  if ((PPUregister.VRAM_ADDR & 0x001F) === 31) {
    PPUregister.VRAM_ADDR &= ~0x001F;
    PPUregister.VRAM_ADDR ^= 0x0400;
  } else {
    PPUregister.VRAM_ADDR++;
  }
}
function incY() {
  if ((PPUregister.VRAM_ADDR & 0x7000) !== 0x7000) {
    PPUregister.VRAM_ADDR += 0x1000;
  } else {
    PPUregister.VRAM_ADDR &= ~0x7000;
    let y = (PPUregister.VRAM_ADDR & 0x03E0) >> 5;
    if (y === 29) {
      y = 0;
      PPUregister.VRAM_ADDR ^= 0x0800;
    } else if (y === 31) {
      y = 0;
    } else {
      y++;
    }
    PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & ~0x03E0) | (y << 5);
  }
}
function copyHoriz() {
  PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & ~0x041F) | (PPUregister.t & 0x041F);
}
function copyVert() {
  PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & ~0x7BE0) | (PPUregister.t & 0x7BE0);
}

// ============================
// DMA (cycle-accurate)
// ============================
    function dmaTransfer(value) {
    let even = false;
    let start = value << 8;
    for (let i = 0; i < 256; ++i) {
      PPU_OAM[i] = systemMemory[(start + i) & 0x7FF];
    }
    if (cpuCycles % 2 === 0) even = true;
    if (even) for (let i = 0; i < 513 * 3; i++) ppuTick();
    else for (let i = 0; i < 514 * 3; i++) ppuTick();
    if (ppuDebugLogging) console.log(`[PPU] DMA transfer from page ${value.toString(16).padStart(2, "0")}`);
    }

// ============================
// Rendering Helpers
// ============================
function reloadBGShifters() {
  PPUregister.BG.bgShiftLo = (PPUregister.BG.bgShiftLo & 0xFF00) | PPUregister.BG.tileLo;
  PPUregister.BG.bgShiftHi = (PPUregister.BG.bgShiftHi & 0xFF00) | PPUregister.BG.tileHi;

  const at = PPUregister.BG.atByte;
  const palLo = (at & 1) ? 0xFF : 0x00;
  const palHi = (at & 2) ? 0xFF : 0x00;
  PPUregister.BG.atShiftLo = (PPUregister.BG.atShiftLo & 0xFF00) | palLo;
  PPUregister.BG.atShiftHi = (PPUregister.BG.atShiftHi & 0xFF00) | palHi;
}

function emitPixel() {
  const x = PPUclock.dot - 1;
  const y = PPUclock.scanline;
  if (x < 0 || x >= NES_W || y < 0 || y >= NES_H) return;

  const fineX = PPUregister.fineX;
  const bit0 = (PPUregister.BG.bgShiftLo >> (15 - fineX)) & 1;
  const bit1 = (PPUregister.BG.bgShiftHi >> (15 - fineX)) & 1;
  const bgPixel = (bit1 << 1) | bit0;

  const pal0 = (PPUregister.BG.atShiftLo >> (15 - fineX)) & 1;
  const pal1 = (PPUregister.BG.atShiftHi >> (15 - fineX)) & 1;
  const paletteBits = (pal1 << 1) | pal0;

  let paletteIndex = (paletteBits << 2) | bgPixel;
  if (bgPixel === 0) paletteIndex = 0;

  pixelColorIndex[y * NES_W + x] = paletteIndex & 0x3F;
}

// ============================
// PPU Main Tick
// ============================
function ppuTick() {
  const renderingEnabled = (PPUregister.MASK & 0x08) || (PPUregister.MASK & 0x10);

  if (PPUclock.scanline === 0 && PPUclock.dot === 0 && ppuDebugLogging) {
    console.log(`[PPU] Frame ${PPUclock.frame} start`);
  }

  if (PPUclock.scanline >= 0 && PPUclock.scanline < 240) {
    if (renderingEnabled) {
      if ((PPUclock.dot >= 1 && PPUclock.dot <= 256) || (PPUclock.dot >= 321 && PPUclock.dot <= 336)) {
        PPUregister.BG.bgShiftLo <<= 1;
        PPUregister.BG.bgShiftHi <<= 1;
        PPUregister.BG.atShiftLo <<= 1;
        PPUregister.BG.atShiftHi <<= 1;

        switch (PPUclock.dot % 8) {
          case 1:  PPUregister.BG.ntByte = ppuBusRead(0x2000 | (PPUregister.VRAM_ADDR & 0x0FFF)); break;
          case 3:  PPUregister.BG.atByte = ppuBusRead(0x23C0 | (PPUregister.VRAM_ADDR & 0x0C00) | ((PPUregister.VRAM_ADDR >> 4) & 0x38) | ((PPUregister.VRAM_ADDR >> 2) & 0x07)); break;
          case 5:  PPUregister.BG.tileLo = ppuBusRead(((PPUregister.CTRL & 0x10) ? 0x1000 : 0x0000) + (PPUregister.BG.ntByte * 16) + ((PPUregister.VRAM_ADDR >> 12) & 7)); break;
          case 7:  PPUregister.BG.tileHi = ppuBusRead(((PPUregister.CTRL & 0x10) ? 0x1000 : 0x0000) + (PPUregister.BG.ntByte * 16) + ((PPUregister.VRAM_ADDR >> 12) & 7) + 8); break;
          case 0:  reloadBGShifters(); incCoarseX(); break;
        }
      }
      if (PPUclock.dot === 256) incY();
      if (PPUclock.dot === 257) copyHoriz();
    }
    if (PPUclock.dot >= 1 && PPUclock.dot <= 256) emitPixel();
  }

  if (PPUclock.scanline === 241 && PPUclock.dot === 1) {
    PPUregister.STATUS |= 0x80;
    if (ppuDebugLogging) console.log(`[PPU] VBlank start`);
    if (PPUregister.CTRL & 0x80) nmiPending = true;
  }

  if (PPUclock.scanline === -1 || PPUclock.scanline === 261) {
    if (PPUclock.dot === 1) {
      PPUregister.STATUS &= ~0x80;
      if (ppuDebugLogging) console.log(`[PPU] VBlank end`);
    }
    if (renderingEnabled && PPUclock.dot >= 280 && PPUclock.dot <= 304) copyVert();
  }

  PPUclock.dot++;
  if (PPUclock.dot >= DOTS_PER_SCANLINE) {
    PPUclock.dot = 0;
    PPUclock.scanline++;
    if (PPUclock.scanline >= SCANLINES_PER_FRAME) {
      renderFrame();
      if (ppuDebugLogging) console.log(`[PPU] Frame ${PPUclock.frame} complete`);
      PPUclock.scanline = -1;
      PPUclock.frame++;
      PPUclock.oddFrame = !PPUclock.oddFrame;
    }
  }
}

// ============================
// Batch Render to Canvas
// ============================
function renderFrame() {
  const rgbFrame = new Uint32Array(NES_W * NES_H);
  for (let i = 0; i < pixelColorIndex.length; i++) {
    const col = getColorForNESByte(pixelColorIndex[i]);
    rgbFrame[i] =
      (255 << 24) |
      (parseInt(col.substr(1, 2), 16) << 16) |
      (parseInt(col.substr(3, 2), 16) << 8) |
      parseInt(col.substr(5, 2), 16);
  }
  blitNESFramePaletteIndex(rgbFrame, NES_W, NES_H);
}
