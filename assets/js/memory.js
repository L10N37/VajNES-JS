// Full 64KB system memory
window.systemMemory = new Array(0x10000).fill(0x00);

// Holds the last value placed on the CPU data bus ("open bus").
//
// This is required for accurate NES emulation, as certain games (e.g. Battletoads, Stage 2 - "Wookie Hole")
// depend on reading from write-only or unmapped PPU registers to return the last bus value.
//
// Without this, graphics in Battletoads and some test ROMs will break,
// because they expect an "open bus" read to return the previous data value, not a static memory cell.
//
// Updated on every valid CPU/PPU memory read or write.
let cpuOpenBus = 0x00;


window.memoryMap = {
  // === WRAM: CPU Internal RAM and Mirrors (2KB mirrored 3x) ===
  RAM_BASE:         0x0000, // $0000–$07FF
  RAM_BASE_END:     0x07FF,
  RAM_MIRROR1:      0x0800, // $0800–$0FFF
  RAM_MIRROR1_END:  0x0FFF,
  RAM_MIRROR2:      0x1000, // $1000–$17FF
  RAM_MIRROR2_END:  0x17FF,
  RAM_MIRROR3:      0x1800, // $1800–$1FFF
  RAM_MIRROR3_END:  0x1FFF,

  // === PPU Registers and Mirrors (CPU visible, $2000–$3FFF, every 8 bytes) ===
  PPU_REG_BASE:     0x2000, // $2000–$2007
  PPU_REG_END:      0x2007,
  PPU_REG_MIRROR:   0x2008, // $2008–$3FFF (mirrors $2000–$2007 every 8 bytes)
  PPU_REG_MIRROR_END:0x3FFF,

  // === PPU Address Space ($0000–$3FFF, only via PPU) ===
  PPU_PATTERN_0:     0x0000, // $0000–$0FFF (CHR ROM/RAM pattern tiles)
  PPU_PATTERN_1:     0x1000, // $1000–$1FFF

  // === PPU Address Space ($0000–$3FFF, only via PPU) ===
  PPU_REGISTER_SPACE_START: 0x2008,
  PPU_REGISTER_SPACE_END:   0x3FFF,

  // Name tables
  PPU_NAMETABLE_0:   0x2000, // $2000–$23FF
  PPU_NAMETABLE_1:   0x2400, // $2400–$27FF
  PPU_NAMETABLE_2:   0x2800, // $2800–$2BFF
  PPU_NAMETABLE_3:   0x2C00, // $2C00–$2FFF
  PPU_NT_MIRROR:     0x3000, // $3000–$3EFF mirrors $2000–$2EFF

  // Palettes
  PPU_PALETTE_BASE:     0x3F00, // $3F00–$3F0F (background)
  PPU_PALETTE_SPR:      0x3F10, // $3F10–$3F1F (sprite)
  PPU_PALETTE_MIRRORS:  0x3F20, // $3F20–$3FFF mirrors $3F00–$3F1F

  // === PRG-ROM ===
  prgRomLower: { addr: 0x8000, size: 0x4000 }, // $8000–$BFFF
  prgRomUpper: { addr: 0xC000, size: 0x4000 }  // $C000–$FFFF
};

const ppuRegisterOffsets = {
  PPUCTRL:   0x2000,
  PPUMASK:   0x2001,
  PPUSTATUS: 0x2002,
  OAMADDR:   0x2003,
  OAMDATA:   0x2004,
  PPUSCROLL: 0x2005, // this register is write-toggled
  PPUADDR:   0x2006, // this register is write-toggled
  PPUDATA:   0x2007
};

// possibly move these 2 functions to 6502.js
function cpuRead(address) {
  // ROM, Expansion, I/O, etc — just fetch value, update open bus
  cpuOpenBus = systemMemory[address];
  return systemMemory[address];
}

function cpuWrite(address, value) {
    // write directly, update open bus
    systemMemory[address] = value;
    cpuOpenBus = value;
  }

  /*

      // some tests will write to mirrored locations, not the base. weird. Swapped this out
      // moved all mirror logic, centralised at mirrorHandler.js
          for (let i = 0; i < 4; i++) {
      systemMemory[address] = value;
      address += 2048;
    }

  */