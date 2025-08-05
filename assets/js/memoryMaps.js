const memoryMap = {
  // === CPU Address Space ===

  // 2KB Internal WRAM and Mirrors ($0000–$1FFF)
  WRAM_BASE:        0x0000,  // $0000–$07FF
  WRAM_END:         0x07FF,
  WRAM_MIRROR1:     0x0800,  // $0800–$0FFF
  WRAM_MIRROR1_END: 0x0FFF,
  WRAM_MIRROR2:     0x1000,  // $1000–$17FF
  WRAM_MIRROR2_END: 0x17FF,
  WRAM_MIRROR3:     0x1800,  // $1800–$1FFF
  WRAM_MIRROR3_END: 0x1FFF,

  // PPU Registers and Mirrors ($2000–$3FFF)
  PPU_REG_BASE:     0x2000,  // $2000–$2007
  PPU_REG_END:      0x2007,
  PPU_REG_MIRROR:   0x2008,  // $2008–$3FFF (every 8 bytes)
  PPU_REG_MIRROR_END:0x3FFF,

  // APU and I/O Registers ($4000–$401F)
  APU_IO_REG_BASE:  0x4000,  // $4000–$401F
  APU_IO_REG_END:   0x401F,

  // Cartridge Expansion ROM/RAM ($4020–$5FFF)
  EXP_ROM_BASE:     0x4020,  // $4020–$5FFF
  EXP_ROM_END:      0x5FFF,

  // PRG-RAM (Cartridge RAM) ($6000–$7FFF)
  PRG_RAM_BASE:     0x6000,  // $6000–$7FFF
  PRG_RAM_END:      0x7FFF,

  // PRG-ROM (Cartridge ROM)
  PRG_ROM_LOWER:    0x8000,  // $8000–$BFFF
  PRG_ROM_LOWER_END:0xBFFF,
  PRG_ROM_UPPER:    0xC000,  // $C000–$FFFF
  PRG_ROM_UPPER_END:0xFFFF,

  // === Special/Individual Registers ===

  // PPU Registers ($2000–$2007)
  PPUCTRL:          0x2000,
  PPUMASK:          0x2001,
  PPUSTATUS:        0x2002,
  OAMADDR:          0x2003,
  OAMDATA:          0x2004,
  PPUSCROLL:        0x2005,
  PPUADDR:          0x2006,
  PPUDATA:          0x2007,

  // APU Registers ($4000–$4017)
  SQ1_VOL:          0x4000,
  SQ1_SWEEP:        0x4001,
  SQ1_LO:           0x4002,
  SQ1_HI:           0x4003,
  SQ2_VOL:          0x4004,
  SQ2_SWEEP:        0x4005,
  SQ2_LO:           0x4006,
  SQ2_HI:           0x4007,
  TRI_LINEAR:       0x4008,
  TRI_LO:           0x400A,
  TRI_HI:           0x400B,
  NOISE_VOL:        0x400C,
  NOISE_LO:         0x400E,
  NOISE_HI:         0x400F,
  DMC_FREQ:         0x4010,
  DMC_RAW:          0x4011,
  DMC_START:        0x4012,
  DMC_LEN:          0x4013,
  SND_CHN:          0x4015,
  FRAME_CNT:        0x4017,

  // Joypad/Controller ($4016–$4017)
  JOYPAD1:          0x4016,
  JOYPAD2:          0x4017,

  // OAM DMA ($4014)
  OAMDMA:           0x4014,

  // Test Mode Register (Unused, Famicom Test Mode) ($4018–$401F)
  TEST_MODE_START:  0x4018,
  TEST_MODE_END:    0x401F,

  // === PPU Address Space ($0000–$3FFF, only via PPU) ===

  // Pattern Tables
  PPU_PATTERN_TABLE0: 0x0000, // $0000–$0FFF
  PPU_PATTERN_TABLE1: 0x1000, // $1000–$1FFF

  // Nametables ($2000–$2FFF)
  PPU_NAMETABLE0:     0x2000, // $2000–$23FF
  PPU_NAMETABLE1:     0x2400, // $2400–$27FF
  PPU_NAMETABLE2:     0x2800, // $2800–$2BFF
  PPU_NAMETABLE3:     0x2C00, // $2C00–$2FFF

  // Nametable Mirror Region ($3000–$3EFF, mirrors $2000–$2EFF)
  PPU_NAMETABLE_MIRROR: 0x3000, // $3000–$3EFF

  // Palette RAM ($3F00–$3FFF, mirrors every $20)
  PPU_PALETTE_BASE:  0x3F00, // $3F00–$3F0F (background)
  PPU_PALETTE_SPR:   0x3F10, // $3F10–$3F1F (sprite)
  PPU_PALETTE_MIRROR:0x3F20, // $3F20–$3FFF mirrors $3F00–$3F1F

  // === Miscellaneous ===
  VECTOR_NMI:        0xFFFA, // $FFFA–$FFFB
  VECTOR_RESET:      0xFFFC, // $FFFC–$FFFD
  VECTOR_IRQ:        0xFFFE, // $FFFE–$FFFF

  // === Unmapped/Open Bus regions (documenting for debugging) ===
  // $4020–$5FFF: Expansion, may be open bus
  // $6000–$7FFF: PRG RAM (mapper dependent)
  // $8000–$FFFF: PRG ROM (mapper dependent)
};
