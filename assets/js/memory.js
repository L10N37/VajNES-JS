// 2KB Internal WRAM only ($0000–$07FF)
let systemMemory = new Uint8Array(2 * 1024);
systemMemory.fill(0x00);

// PRG-RAM (for battery-backed saves)
let prgRam = new Uint8Array(8 * 1024); // Typical size, mapper may change this
prgRam.fill(0x00);

// PRG-ROM (32KB banked window, always $8000–$FFFF)
let prgRom = new Uint8Array (32 * 1024);
prgRom.fill(0x00);

// PPU / memory
let VRAM        = new Uint8Array(2 * 1024);   // 2KB internal nametable RAM
let OAM         = new Uint8Array(256);        // 256 bytes sprite OAM
let PALETTE_RAM = new Uint8Array(32);         // 32 bytes ($3F00-$3F1F)

// CHR ROM/RAM
// Most common: 8KB CHR (1 bank). Some carts use 16KB or more via mappers.
let CHR_ROM     = new Uint8Array(8 * 1024);

// ======================================
// Full cartridge ROM storage (bank source)
// Used by large mappers like MMC3
// ======================================

// Entire PRG ROM from cartridge
let FULL_PRG_ROM = new Uint8Array(0);

// Entire CHR ROM from cartridge (can be many banks)
let FULL_CHR_ROM = new Uint8Array(0);

// helpers for mapper logic
let FULL_PRG_ROM_SIZE = 0;
let FULL_CHR_ROM_SIZE = 0;

// Bank counts (for mapper calculations)
let FULL_PRG_BANKS_16K = 0;
let FULL_CHR_BANKS_8K  = 0;