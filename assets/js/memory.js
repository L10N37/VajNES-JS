//  TOTAL RAM 2048 BYTES: $0000 - $07FF;
// https://www.nesdev.org/wiki/CPU_memory_map
// https://en.wikibooks.org/wiki/NES_Programming/Memory_Map -> less confusing

// 65536 bytes of memory, 64KB
// TOTAL WRAM 2048 BYTES: $0000 - $07FF;

// $0000 - $00FF - 256 bytes
const  WRAMzeroPage= [256]

//  $0100-$01FF- 256 bytes
const WRAMstack = [256]

// ($0200 - $07FF) - 1536 bytes
const WRAMgeneral = [1536]

// 63,488 bytes to go
const otherMemory = [6144];

let systemMemory = [...WRAMzeroPage, ...WRAMstack, ...WRAMgeneral, ...otherMemory]

// Zero init. all memory
for (let i = 0; i < 8192; i++) {
    systemMemory[i] = 0x00;
}

// these convert to hex numbers when used outside the object automatically
const memoryMap = {
    workRAM: { addr: parseInt('0000', 16), size: parseInt('800', 16) },
    workRAMMirror1: { addr: parseInt('0800', 16), size: parseInt('800', 16) },
    workRAMMirror2: { addr: parseInt('1000', 16), size: parseInt('800', 16) },
    workRAMMirror3: { addr: parseInt('1800', 16), size: parseInt('800', 16) },
    ppuCtrlReg: { addr: parseInt('2000', 16), size: parseInt('8', 16) },
    ppuCtrlRegMirror: { addr: parseInt('2008', 16), size: parseInt('1FF8', 16) },
    registers: { addr: parseInt('4000', 16), size: parseInt('20', 16) },
    expansionROM: { addr: parseInt('4020', 16), size: parseInt('1FDF', 16) },
    sram: { addr: parseInt('6000', 16), size: parseInt('2000', 16) },
    prgRomLower: { addr: parseInt('8000', 16), size: parseInt('4000', 16) },
    prgRomUpper: { addr: parseInt('C000', 16), size: parseInt('4000', 16) }
};
