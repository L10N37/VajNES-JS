// Full 64KB system memory
window.systemMemory = new Array(0x10000).fill(0x00);

// Memory map reference (exposed for tests / GUI)
window.memoryMap = {
  workRAM:           { addr: 0x0000, size: 0x0800 },
  workRAMMirror1:    { addr: 0x0800, size: 0x0800 },
  workRAMMirror2:    { addr: 0x1000, size: 0x0800 },
  workRAMMirror3:    { addr: 0x1800, size: 0x0800 },
  ppuCtrlReg:        { addr: 0x2000, size: 0x0008 },
  ppuCtrlRegMirror:  { addr: 0x2008, size: 0x1FF8 },
  registers:         { addr: 0x4000, size: 0x0020 },
  expansionROM:      { addr: 0x4020, size: 0x1FDF },
  sram:              { addr: 0x6000, size: 0x2000 },
  prgRomLower:       { addr: 0x8000, size: 0x4000 },
  prgRomUpper:       { addr: 0xC000, size: 0x4000 }
};

//32-byte array for $4000–$401F where the APU and I/O registers live.
window.APU_IO_Registers = new Array(0x20).fill(0x00);

// CPU Read
window.cpuRead = function(addr) {
  addr &= 0xFFFF;
  if (addr <= 0x1FFF) {
    // work RAM + mirrors
    return window.systemMemory[addr & 0x07FF];
  } else if (addr <= 0x3FFF) {
    // PPU registers + mirrors
    const reg = addr & 0x0007;
    if (typeof window.ppuRead === 'function') {
      return window.ppuRead(reg);
    } else {
      return window.systemMemory[addr];
    }
  } else if (addr <= 0x401F) {
    // APU / I/O
    return window.systemMemory[addr] ?? 0x00;
  } else if (addr <= 0x5FFF) {
    // expansion ROM / unused
    return window.systemMemory[addr];
  } else if (addr <= 0x7FFF) {
    // cartridge SRAM
    return window.systemMemory[addr];
  } else {
    // PRG-ROM / test writes
    return window.systemMemory[addr];
  }
};

// CPU Write
window.cpuWrite = function(addr, value) {
  addr &= 0xFFFF;
  value &= 0xFF;
  if (addr <= 0x1FFF) {
    // work RAM + mirrors
    window.systemMemory[addr & 0x07FF] = value;
  } else if (addr <= 0x3FFF) {
    // PPU registers + mirrors
    const reg = addr & 0x0007;
    if (typeof window.ppuWrite === 'function') {
      window.ppuWrite(reg, value);
    } else {
      window.systemMemory[addr] = value;
    }
  } else if (addr <= 0x401F) {
    // APU / I/O
    window.APU_IO_Registers[addr & 0x001F] = value;
  } else if (addr <= 0x7FFF) {
    // SRAM or expansion ROM
    window.systemMemory[addr] = value;
  } else {
    // PRG-ROM area (allowed for tests)
    window.systemMemory[addr] = value;
  }
};

// Re-expose PPU globals for GUI/tests
window.PPUregisters  = window.PPUregisters;
window.PPU_VARIABLES = window.PPU_VARIABLES;
