// ============================
// PPU.js — PPU register/memory interface
// ============================

let ppuDebugLogging = true;

let PPUregister = {
  CTRL: 0x00, MASK: 0x00, STATUS: 0x00,
  OAMADDR: 0x00,
  SCROLL_X: 0x00, SCROLL_Y: 0x00,
  ADDR_HIGH: 0x00, ADDR_LOW: 0x00,
  VRAM_ADDR: 0x0000,
  t: 0x0000,
  fineX: 0,
  writeToggle: false,
  VRAM_DATA: 0x00,
  BG: { bgShiftLo: 0, bgShiftHi: 0, atShiftLo: 0, atShiftHi: 0, ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0 }
};

function dmaTransfer(value) {
  let even = (cpuCycles & 1) === 0;
  const start = value << 8;
  for (let i = 0; i < 256; ++i) {
    SHARED.OAM[i] = systemMemory[(start + i) & 0x7FF];
  }
  const add = even ? 513 : 514;
  cpuCycles = (cpuCycles + add) & 0x7fffffff;
  Atomics.add(SHARED.CLOCKS, 0, add);
}

function ppuWrite(addr, value) {
  addr &= 0x3FFF;
  if (addr >= 0x2000 && addr < 0x4000) addr = 0x2000 + (addr & 0x7);
  value &= 0xFF;

  switch (addr) {
    case 0x2000: PPUregister.CTRL = value; PPUregister.t = (PPUregister.t & 0xF3FF) | ((value & 0x03) << 10); break;
    case 0x2001: PPUregister.MASK = value; break;
    case 0x2003: PPUregister.OAMADDR = value; break;
    case 0x2004: SHARED.OAM[PPUregister.OAMADDR] = value; PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF; break;
    case 0x2005:
      if (!PPUregister.writeToggle) {
        PPUregister.SCROLL_X = value; PPUregister.fineX = value & 0x07;
        PPUregister.t = (PPUregister.t & ~0x001F) | ((value >> 3) & 0x1F);
        PPUregister.writeToggle = true;
      } else {
        PPUregister.SCROLL_Y = value;
        PPUregister.t = (PPUregister.t & ~(0x7000 | 0x03E0))
          | ((value & 0x07) << 12) | (((value >> 3) & 0x1F) << 5);
        PPUregister.writeToggle = false;
      }
      break;
    case 0x2006:
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value; PPUregister.t = (PPUregister.t & 0x00FF) | ((value & 0x3F) << 8);
        PPUregister.writeToggle = true;
      } else {
        PPUregister.ADDR_LOW = value; PPUregister.t = (PPUregister.t & 0x7F00) | value;
        PPUregister.VRAM_ADDR = PPUregister.t & 0x3FFF;
        PPUregister.writeToggle = false;
      }
      break;
    case 0x2007:
      ppuBusWrite(PPUregister.VRAM_ADDR & 0x3FFF, value);
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      break;
  }
}

function ppuRead(addr) {
  addr &= 0x3FFF;
  if (addr >= 0x2000 && addr < 0x4000) addr = 0x2000 + (addr & 0x7);
  switch (addr) {
    case 0x2002:
      const val = Atomics.load(SHARED.STATUS, 0);
      PPUregister.STATUS &= ~0x80;
      Atomics.and(SHARED.STATUS, 0, ~0x80);
      PPUregister.writeToggle = false;
      return val;
    case 0x2004: return SHARED.OAM[PPUregister.OAMADDR] & 0xFF;
    case 0x2007:
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
  return cpuOpenBus;
}

function ppuBusRead(addr) {
  addr &= 0x3FFF;
  if (addr < 0x2000) return SHARED.CHR_ROM[addr];
  if (addr < 0x3F00) return SHARED.VRAM[(addr - 0x2000) & 0x07FF];
  let pal = addr & 0x1F;
  if ((pal & 0x13) === 0x10) pal &= ~0x10;
  return SHARED.PALETTE_RAM[pal] & 0x3F;
}

function ppuBusWrite(addr, value) {
  addr &= 0x3FFF;
  value &= 0xFF;
  if (addr < 0x2000) { if (typeof chrIsRAM !== "undefined" && chrIsRAM) SHARED.CHR_ROM[addr] = value; return; }
  if (addr < 0x3F00) { SHARED.VRAM[(addr - 0x2000) & 0x07FF] = value; return; }
  let pal = addr & 0x1F;
  if ((pal & 0x13) === 0x10) pal &= ~0x10;
  SHARED.PALETTE_RAM[pal] = value & 0x3F;
}
