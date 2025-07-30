// Full 64KB system memory
window.systemMemory = new Array(0x10000).fill(0x00);

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

let DMAregister = {
  OAMDMA: 0x00 // $4014
};

function memoryRead(address) {
    // --- WRAM (2KB mirrored 4x in $0000–$1FFF) ---
    if (address >= memoryMap.RAM_BASE && address <= memoryMap.RAM_MIRROR3_END) {
      return systemMemory[address];
    }
    else return systemMemory[address];
}

function memoryWrite(address, value) {

  if (address >= memoryMap.RAM_BASE && address <= memoryMap.RAM_BASE_END) {
    // add the value at the base 2KB and the 3 mirrors
    for (let i = 0; i < 4; i++) {
      systemMemory[address] = value;
      address += 2048;
    }
  }

  else systemMemory[address] = value;
}

function checkWriteOffset(address, result) {
  // === PPU Register Mirror Range ($2008–$3FFF) ===
  if (address >= memoryMap.PPU_REGISTER_SPACE_START && address <= memoryMap.PPU_REGISTER_SPACE_END) {
    memoryWrite(address, result);
    address = memoryMap.PPU_REGISTER_SPACE_START + (address % 8); // Mirror to $2000–$2007
    memoryWrite(address, result);
  }

  switch (address) {
    // === PPU Registers ($2000–$2007) ===
    case ppuRegisterOffsets.PPUCTRL:
      PPUregister.CTRL = result;
      //memoryWrite(address, PPUregister.CTRL); // ghost write
      return;

    case ppuRegisterOffsets.PPUMASK:
      PPUregister.MASK = result;
      //memoryWrite(address, PPUregister.CTRL); // ghost write
      return;

    case ppuRegisterOffsets.OAMADDR:
      PPUregister.OAMADDR = result;
      return;

    case ppuRegisterOffsets.OAMDATA:
      PPUregister.OAMDATA = result;
      return;

    case ppuRegisterOffsets.PPUSCROLL: // PPUSCROLL: write-toggled
      if (!PPUregister.writeToggle) {
        PPUregister.SCROLL_X = result;
      } else {
        PPUregister.SCROLL_Y = result;
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      return;

    case ppuRegisterOffsets.PPUADDR: // PPUADDR: write-toggled
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = result;
        PPUregister.VRAM_ADDR = (result & 0x3F) << 8;
      } else {
        PPUregister.ADDR_LOW = result;
        PPUregister.VRAM_ADDR |= result;
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      return;

    case ppuRegisterOffsets.PPUDATA:
      // Store value in VRAM
      PPUregister.VRAM_DATA = result;
      // Figure out the actual 14‑bit PPU address (0x0000–0x3FFF)
      const rawAddr = PPUregister.VRAM_ADDR & 0x3FFF;
      // Write to VRAM/Palette RAM in systemMemory
      systemMemory[rawAddr] = result;
      // Auto‑increment address for next write (by 1 or 32)
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (rawAddr + step) & 0x3FFF;
      return;

    // === APU / I/O ===
    case 0x4014: // OAMDMA
      DMAregister.OAMDMA = result;
      triggerOAMDMA(result); // must be implemented elsewhere
      return;

    case 0x4016:
      APUregister.JOYPAD1 = result;
      return;

    case 0x4017:
      APUregister.JOYPAD2 = result;
      return;

    default:
      // === Fallback for unhandled writes ===
      memoryWrite(address, result);
      return;
  }
}

function checkReadOffset(address) {
  // === Mirror PPU register space ($2008–$3FFF) ===
  if (address >= memoryMap.PPU_REGISTER_SPACE_START && address <= memoryMap.PPU_REGISTER_SPACE_END) {
    address = memoryMap.PPU_REG_BASE + (address % 8); // mirror to base
  }

  switch (address) {
    // === PPU Registers ===
    case ppuRegisterOffsets.PPUSTATUS: // PPUSTATUS (read-only)
      const status = PPUregister.STATUS;
      PPUregister.STATUS &= 0x7F; // clear VBlank flag (bit 7)
      PPUregister.writeToggle = false;
      return status;

    case ppuRegisterOffsets.OAMDATA: // OAMDATA
      return PPUregister.OAMDATA;

    case ppuRegisterOffsets.PPUDATA:  // PPUDATA read
      // 1) Return the last buffered value:
      const returnByte = PPUregister.VRAM_DATA;
      
      // 2) Refill the buffer with the *real* VRAM contents at the current address:
      const readAddr = PPUregister.VRAM_ADDR & 0x3FFF;
      PPUregister.VRAM_DATA = systemMemory[readAddr];
    
      // 3) Apply the same auto‑increment as on writes:
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (readAddr + step) & 0x3FFF;
    
      return returnByte;    

    // === APU and Controller I/O ===
    case 0x4015: // APU Status (optional stub)
      return APUregister?.STATUS ?? 0x00;

    case 0x4016: // JOYPAD1
      return APUregister?.JOYPAD1 ?? 0x00;

    case 0x4017: // JOYPAD2 / Frame IRQ
      return APUregister?.JOYPAD2 ?? 0x00;

    // === Expansion / Mapper I/O (optional) ===
    case 0x4018:
    case 0x4019:
    case 0x401A:
    case 0x401B:
    case 0x401C:
    case 0x401D:
    case 0x401E:
    case 0x401F:
      return 0x00; // disabled/test mode on real NES

    // === Default to systemMemory read ===
    default:
      return memoryRead(address);
  }
}

/*
Intercepted write addresses, not stored in actual systemMemory (won't hurt to)

$2000	1	PPUCTRL	Write-only, sets internal PPU flags
$2001	1	PPUMASK	Write-only, controls rendering
$2002	1	PPUSTATUS	Read-only, returns VBlank/NMI flags and clears them
$2003	1	OAMADDR	Sets internal sprite memory pointer
$2004	1	OAMDATA	R/W from internal OAM (256-byte sprite RAM)
$2005	1	PPUSCROLL	2-write X/Y scroll latch
$2006	1	PPUADDR	2-write VRAM address latch
$2007	1	PPUDATA	Indirect read/write to VRAM via $2006
$2008–$3FFF	8184	Mirrors of $2000–$2007 every 8 bytes	Must resolve to 0x2000 + (addr % 8)

APU + I/O Registers
Address	Name	Description	Interception Reason
$4000	APU Pulse 1	Control	Affects APU channel, not RAM
$4001–$4003		Sweep, timer, length	Internal APU registers
$4004–$4007	APU Pulse 2	Same as above	
$4008–$400B	APU Triangle		
$400C–$400F	APU Noise		
$4010–$4013	APU DMC		
$4014	OAMDMA	Triggers sprite DMA transfer from CPU RAM to OAM	Must copy 256 bytes
$4015	APU Status	Enables/disables channels	
$4016	JOYPAD1	Controller input and strobe	Reading returns controller bits
$4017	JOYPAD2 + Frame IRQ	Same as above	
$4018–$401F	Test mode	Usually ignored	Disabled in real NES

Optional: Expansion/Mapper Space
Range	Size	Description	Interception Reason
$4020–$5FFF	~8KB	Expansion ROM / Mapper registers	Used by MMC1–5, VRCs, etc.
$6000–$7FFF	8KB	Battery-backed SRAM (Cartridge)	Optional intercept for mappers

*/
