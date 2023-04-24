//  TOTAL RAM 2048 BYTES: $0000 - $07FF;
// https://www.nesdev.org/wiki/CPU_memory_map
// https://en.wikibooks.org/wiki/NES_Programming/Memory_Map -> less confusing

// 65536 bytes of memory, 64KB
// TOTAL WRAM 2048 BYTES: $0000 - $07FF;

/*
The NES WRAM has a memory range of 0x0000 to 0x1FFF, 
which is a total of 8KB (8192 bytes) of memory. However, the first 512 bytes of the WRAM 
are reserved for the Zero Page and the Stack, leaving 7680 bytes of general-purpose work RAM. 
The remaining addresses (0x2000 to 0x7FFF) are used for various memory-mapped registers and hardware components.
*/

// $0000 - $00FF - 256 bytes
const  WRAMzeroPage= [256]

//  $0100-$01FF- 256 bytes
const WRAMstack = [256]

// ($0200 - $07FF) - 1536 bytes
const WRAMgeneral = [1536]

// 63,488 bytes to go
const otherMemory = [6144];

memory = [...WRAMzeroPage, ...WRAMstack, ...WRAMgeneral, ...otherMemory]

// Zero init. all memory
for (let i = 0; i < 8192; i++) {
    memory[i] = 0x00;
}

// not sure how the mirrored addresses work yet, may need to create space for them and copy RAM contents to mirrors