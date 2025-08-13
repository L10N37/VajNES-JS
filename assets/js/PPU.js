// ============================
// PPU.js — PPU register/memory interface
// ============================

let ppuDebugLogging = true;

function postPPUSnapshot() {
  // Only the fields the worker needs for frame gen
  // not using SAB to prevent SAB races on v/t/fineX.
  ppuWorker.postMessage({
    type: 'ppuRegs',
    regs: {
      SCROLL_X:   PPUregister.SCROLL_X & 0xFF,
      SCROLL_Y:   PPUregister.SCROLL_Y & 0xFF,
      VRAM_ADDR:  PPUregister.VRAM_ADDR & 0x3FFF,
      t:          PPUregister.t & 0x7FFF,
      fineX:      PPUregister.fineX & 0x07,
      writeToggle: !!PPUregister.writeToggle
    }
  });
}

// Main PPU register state for CPU thread
let PPUregister = {
  // $2000 — PPUCTRL
  CTRL: 0x00,           // Control register (V, P, H, Sprite pattern, BG pattern, Sprite size, Master/Slave, NMI)

  // $2001 — PPUMASK
  MASK: 0x00,           // Rendering enable flags, color emphasis

  // $2002 — PPUSTATUS
  STATUS: 0x00,         // VBlank flag, sprite 0 hit, sprite overflow

  // $2003 — OAMADDR
  OAMADDR: 0x00,        // Address into OAM (sprite RAM)

  // $2004 — OAMDATA
  OAMDATA: 0x00,        // Data port for OAM (SPR-RAM [I/O])

  // $2005 — PPUSCROLL (internal latch split into coarse/fine)
  SCROLL_X: 0x00,       // First write to PPUSCROLL — fine X scroll (lower 3 bits) + coarse X
  SCROLL_Y: 0x00,       // Second write to PPUSCROLL — fine Y scroll (lower 3 bits) + coarse Y

  // $2006 — PPUADDR (split high/low writes)
  ADDR_HIGH: 0x00,      // First write (high byte of VRAM address)
  ADDR_LOW: 0x00,       // Second write (low byte of VRAM address)
  VRAM_ADDR: 0x0000,    // Full 15-bit VRAM address (from ADDR_HIGH/LOW writes)

  // Internal registers
  t: 0x0000,            // Temporary VRAM address latch
  fineX: 0,              // Fine X scroll (3 bits from PPUSCROLL first write)
  writeToggle: false,    // Latch toggle for $2005/$2006

  // $2007 — PPUDATA
  VRAM_DATA: 0x00,      // VRAM data buffer for $2007 reads/writes

  // Internal background fetch pipeline
  BG: {
    bgShiftLo: 0, bgShiftHi: 0,     // Pattern data shift registers
    atShiftLo: 0, atShiftHi: 0,     // Attribute data shift registers
    ntByte: 0,                      // Nametable byte
    atByte: 0,                      // Attribute table byte
    tileLo: 0,                      // Pattern low byte
    tileHi: 0                       // Pattern high byte
  }
};


// DMA copy from CPU RAM to PPU OAM
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

// --- CPU writes to PPU registers ---
function ppuWrite(addr, value) {
  addr &= 0x3FFF;
  if (addr >= 0x2000 && addr < 0x4000) addr = 0x2000 + (addr & 0x7);
  value &= 0xFF;

  let notify = false;

  switch (addr) {
    case 0x2000: // PPUCTRL
      PPUregister.CTRL = value;
      SHARED.PPU_REGS[0] = value;
      PPUregister.t = (PPUregister.t & 0xF3FF) | ((value & 0x03) << 10);
      notify = true;
      postPPUSnapshot();
      break;

    case 0x2001: // PPUMASK
      PPUregister.MASK = value;
      SHARED.PPU_REGS[1] = value;
      notify = true;
      break;

    case 0x2003: // OAMADDR
      PPUregister.OAMADDR = value;
      notify = true;
      break;

    case 0x2004: // OAMDATA
      SHARED.OAM[PPUregister.OAMADDR] = value;
      PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF;
      break;

    case 0x2005: // PPUSCROLL
      if (!PPUregister.writeToggle) {
        PPUregister.SCROLL_X = value;
        PPUregister.fineX = value & 0x07;
        PPUregister.t = (PPUregister.t & ~0x001F) | ((value >> 3) & 0x1F);
      } else {
        PPUregister.SCROLL_Y = value;
        PPUregister.t = (PPUregister.t & ~(0x7000 | 0x03E0)) |
                        ((value & 0x07) << 12) |
                        (((value >> 3) & 0x1F) << 5);
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      notify = true;
      postPPUSnapshot();  
      break;

    case 0x2006: // PPUADDR
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value;
        SHARED.PPU_REGS[2] = value;
        PPUregister.t = (PPUregister.t & 0x00FF) | ((value & 0x3F) << 8);
      } else {
        PPUregister.ADDR_LOW = value;
        SHARED.PPU_REGS[3] = value;
        PPUregister.t = (PPUregister.t & 0x7F00) | value;
        PPUregister.VRAM_ADDR = PPUregister.t & 0x3FFF;
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      notify = true;
      break;

    case 0x2007: // PPUDATA
      ppuBusWrite(PPUregister.VRAM_ADDR & 0x3FFF, value);
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      postPPUSnapshot();
      break;
  }

  if (notify) {
    ppuWorker.postMessage({ type: 'ppuRegs', PPUregister });
  }
}

// --- CPU reads from PPU registers ---
function ppuRead(addr) {
  addr &= 0x3FFF;
  if (addr >= 0x2000 && addr < 0x4000) addr = 0x2000 + (addr & 0x7);

  switch (addr) {
    case 0x2002: { // PPUSTATUS
      const val = Atomics.load(SHARED.PPU_REGS, 4); // STATUS is index 4
      PPUregister.STATUS = val & ~0x80;
      Atomics.and(SHARED.PPU_REGS, 4, ~0x80);
      PPUregister.writeToggle = false;
      return val;
    }

    case 0x2004: // OAMDATA
      return SHARED.OAM[PPUregister.OAMADDR] & 0xFF;

    case 0x2007: { // PPUDATA
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

  return SHARED.CPU_OPENBUS[0];
}

// --- PPU bus read ---
function ppuBusRead(addr) {
  addr &= 0x3FFF;

  if (addr < 0x2000) {
    return SHARED.CHR_ROM[addr];
  }
  if (addr >= 0x3F00) {
    let pal = addr & 0x1F;
    if ((pal & 0x13) === 0x10) pal &= ~0x10;
    return SHARED.PALETTE_RAM[pal] & 0x3F;
  }
  return SHARED.VRAM[(addr - 0x2000) & 0x07FF];
}

// --- PPU bus write ---
function ppuBusWrite(addr, value) {
  addr &= 0x3FFF;
  value &= 0xFF;

  if (addr < 0x2000) {
    if (typeof chrIsRAM !== "undefined" && chrIsRAM) {
      SHARED.CHR_ROM[addr] = value;
    }
    return;
  }
  if (addr >= 0x3F00) {
    let pal = addr & 0x1F;
    if ((pal & 0x13) === 0x10) pal &= ~0x10;
    const palVal = value & 0x3F;
    SHARED.PALETTE_RAM[pal] = palVal;
    if (ppuDebugLogging) {
      const type = pal < 0x10 ? "BG" : "SPR";
      const slot = pal % 4;
      console.log(
        `[PPU PALETTE W] ${type} palette set ${Math.floor(pal / 4)}, colour ${slot} ` +
        `($${(0x3F00 + pal).toString(16).toUpperCase().padStart(4, "0")}) <= ` +
        `$${palVal.toString(16).toUpperCase().padStart(2, "0")}`
      );
    }
    return;
  }
  SHARED.VRAM[(addr - 0x2000) & 0x07FF] = value;
}
