// 2KB Internal WRAM only ($0000–$07FF)
let systemMemory = new Uint8Array(0x800);
systemMemory.fill(0x00);

// 2KB Internal WRAM only ($0000–$07FF)
let systemMemoryVideo = new Uint8Array(0x800);
systemMemoryVideo.fill(0x00);

// PRG-RAM (for battery-backed saves)
let prgRam = new Uint8Array(0x2000); // Typical size, mapper may change this
prgRam.fill(0x00);

// PRG-ROM (32KB banked window, always $8000–$FFFF)
// 1MB array, maximum size, to copy loadedROM variable across to. 1MB for down the track when adding mapper support
//let prgRom = new Uint8Array;
//prgRom.fill(0x00);

// Last value placed on the CPU bus ("open bus" behavior)
let cpuOpenBus = 0x00;

// CPU RAM read/write (called *after* folding)
function cpuRead(addr) {
  let val = systemMemory[addr & 0x7FF];
  cpuOpenBus = val;
  return val;
}
function cpuWrite(addr, value) {
  systemMemory[addr & 0x7FF] = value & 0xFF;
  cpuOpenBus = value & 0xFF;
}
