//  TOTAL RAM 2048 BYTES: $0000 - $07FF;
// https://www.nesdev.org/wiki/CPU_memory_map -> this page is in conflict with other information?
// https://en.wikibooks.org/wiki/NES_Programming/Memory_Map

const memoryMap = new Uint8Array(0x10000);

// 2KB of work RAM
memoryMap.set(new Uint8Array(0x800), 0x0000);

// Mirror of $000-$7FF
memoryMap.set(memoryMap.slice(0x0000, 0x0800), 0x0800);
memoryMap.set(memoryMap.slice(0x0000, 0x0800), 0x1000);
memoryMap.set(memoryMap.slice(0x0000, 0x0800), 0x1800);

// PPU Ctrl Registers
memoryMap.set(new Uint8Array(0x8), 0x2000);

// Mirror of $2000-$2007
memoryMap.set(memoryMap.slice(0x2000, 0x2008), 0x2008);
memoryMap.set(memoryMap.slice(0x2000, 0x3F00), 0x2010);
memoryMap.set(memoryMap.slice(0x2000, 0x4000), 0x3000);

// Registers (Mostly APU)
memoryMap.set(new Uint8Array(0x20), 0x4000);

// Cartridge Expansion ROM
memoryMap.set(new Uint8Array(0x1FDF), 0x4020);

// SRAM
memoryMap.set(new Uint8Array(0x2000), 0x6000);

// PRG-ROM
// Note: you would need to load the actual ROM data into the appropriate memory location(s)
// 16kB ROM is mirroed to 2nd location, 32kB fills the full 32kB?
memoryMap.set(new Uint8Array(0x4000), 0x8000);
memoryMap.set(new Uint8Array(0x4000), 0xC000);

/* 
This creates a Uint8Array of size 0x10000 to represent the entire 64K address space of the 6502. 
The various memory regions are then mapped to the appropriate locations in the memoryMap array using 
the set() method. Note that for the PRG-ROM regions, you would need to load the actual ROM data into 
the appropriate memory location(s).
*/