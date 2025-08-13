let ppuDebugLogging = true;
// --- OAM ---
let PPU_OAM = new Uint8Array(256);

// --- Palette RAM ---
let paletteRAM = new Uint8Array(0x20);

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
  VRAM_ADDR: 0x0000, // v
  t: 0x0000,         // t
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

// --- DMA Transfer Handler ---

function dmaTransfer(value) {
  let even = (cpuCycles & 1) === 0;
  const start = value << 8;
  for (let i = 0; i < 256; ++i) {
    PPU_OAM[i] = systemMemory[(start + i) & 0x7FF];
  }
  const add = even ? 513 : 514;

  // legacy
  cpuCycles = (cpuCycles + add) & 0x7fffffff;

  // shared
  Atomics.add(SHARED.CLOCKS, 0, add);

  if (ppuDebugLogging) console.log(`[PPU] DMA transfer from page ${value.toString(16).padStart(2, "0")}`);
}


// ============================
// CPU <-> PPU Interface
// ============================
function ppuWrite(addr, value) {
  addr &= 0x3FFF;
  if (addr >= 0x2000 && addr < 0x4000) addr = 0x2000 + (addr & 0x7);
  value &= 0xFF;

  switch (addr) {
    case 0x2000: { // PPUCTRL
      PPUregister.CTRL = value;
      PPUregister.t = (PPUregister.t & 0xF3FF) | ((value & 0x03) << 10);
      break;
    }
    case 0x2001: { // PPUMASK
      PPUregister.MASK = value;
      break;
    }
    case 0x2003: { // OAMADDR
      PPUregister.OAMADDR = value;
      break;
    }
    case 0x2004: { // OAMDATA
      PPU_OAM[PPUregister.OAMADDR] = value;
      PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF;
      break;
    }
    case 0x2005: { // PPUSCROLL
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
    }
    case 0x2006: { // PPUADDR
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value;
        PPUregister.t = (PPUregister.t & 0x00FF) | ((value & 0x3F) << 8);
        if (ppuDebugLogging) console.log(`[$2006 hi] ${hex8(value)} (t=${hex16(PPUregister.t)})`);
        PPUregister.writeToggle = true;
      } else {
        PPUregister.ADDR_LOW = value;
        PPUregister.t = (PPUregister.t & 0x7F00) | value;
        PPUregister.VRAM_ADDR = PPUregister.t & 0x3FFF;
        if (ppuDebugLogging) console.log(`[$2006 lo] ${hex8(value)} -> v=${hex16(PPUregister.VRAM_ADDR)}`);
        PPUregister.writeToggle = false;
      }
      break;
    }
    case 0x2007: { // PPUDATA
      const addrVRAM = PPUregister.VRAM_ADDR & 0x3FFF;
      if (ppuDebugLogging) console.log(`[$2007 W] ${hex8(value)} -> ${hex16(addrVRAM)}`);
      ppuBusWrite(addrVRAM, value);
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      break;
    }
  }
}

function ppuRead(addr) {
  addr &= 0x3FFF;
  if (addr >= 0x2000 && addr < 0x4000) addr = 0x2000 + (addr & 0x7);

  switch (addr) {
    case 0x2002: { // PPUSTATUS
      const ret = PPUregister.STATUS;
      PPUregister.STATUS &= ~0x80;     // clear vblank
      PPUregister.writeToggle = false; // reset toggle
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
        PPUregister.VRAM_DATA = ppuBusRead((addrVRAM - 0x1000) & 0x3FFF);
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
  if (addr < 0x2000) return chrRom[addr];

  if (addr < 0x3F00) {
    return systemMemoryVideo[(addr - 0x2000) & 0x07FF];
  }

  let pal = addr & 0x1F;
  if ((pal & 0x13) === 0x10) pal &= ~0x10;
  return paletteRAM[pal] & 0x3F;
}

function ppuBusWrite(addr, value) {
  addr &= 0x3FFF;
  value &= 0xFF;

  if (addr < 0x2000) { if (typeof chrIsRAM !== "undefined" && chrIsRAM) chrRom[addr] = value; return; }

  if (addr < 0x3F00) {
    systemMemoryVideo[(addr - 0x2000) & 0x07FF] = value;
    return;
  }

  let pal = addr & 0x1F;
  if ((pal & 0x13) === 0x10) pal &= ~0x10;
  paletteRAM[pal] = value & 0x3F;
}


function ppuTick(){
  //TODO - moved to ppu-worker for async/ multithreading
}

/*
Timing
------------------------------------------------------------------------------------------------------------
A Nintendo Entertainment System (NES) Picture Processing Unit (PPU) takes 341 * 262 = 89342 PPU clock cycles 
to draw a full frame on an NTSC display. Each frame consists of 262 scanlines, and each scanline takes 341 
PPU clock cycles, according to NesDev.org. 
------------------------------------------------------------------------------------------------------------
*/