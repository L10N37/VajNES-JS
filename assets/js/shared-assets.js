let ppuDebugLogging = true;

/*
Legacy, new declarations at the bottom of the file
let PPUregister = {
  // ---------------------------
  // $2000 — PPUCTRL
  // ---------------------------
  CTRL:        0x00,  // Control register (V, P, H, Sprite pattern, BG pattern, Sprite size, Master/Slave, NMI)

  // ---------------------------
  // $2001 — PPUMASK
  // ---------------------------
  MASK:        0x00,  // Rendering enable flags, color emphasis

  // ---------------------------
  // $2002 — PPUSTATUS
  // ---------------------------
  STATUS:      0x00,  // VBlank flag, sprite 0 hit, sprite overflow

  // ---------------------------
  // $2003/$2004 — OAM
  // ---------------------------
  OAMADDR:     0x00,  // Address into OAM (sprite RAM)
  OAMDATA:     0x00,  // Data port for OAM (SPR-RAM I/O)

  // ---------------------------
  // $2005 — PPUSCROLL
  // ---------------------------
  SCROLL_X:    0x00,  // First write: fine X scroll (lower 3 bits) + coarse X
  SCROLL_Y:    0x00,  // Second write: fine Y scroll (lower 3 bits) + coarse Y

  // ---------------------------
  // $2006 — PPUADDR
  // ---------------------------
  ADDR_HIGH:   0x00,  // First write: high byte of VRAM address
  ADDR_LOW:    0x00,  // Second write: low byte of VRAM address
  VRAM_ADDR:   0x0000,// Full 15-bit VRAM address (from ADDR_HIGH/LOW)

  // ---------------------------
  // Internal registers
  // ---------------------------
  t:           0x0000,// Temporary VRAM address latch
  fineX:       0,     // Fine X scroll (3 bits from PPUSCROLL first write)
  writeToggle: false, // Latch toggle for $2005/$2006

  // ---------------------------
  // $2007 — PPUDATA
  // ---------------------------
  VRAM_DATA:   0x00,  // VRAM data buffer for $2007 reads/writes

  // ---------------------------
  // Internal background fetch pipeline
  // ---------------------------
  BG: {
    bgShiftLo: 0,     // Pattern data shift register low
    bgShiftHi: 0,     // Pattern data shift register high
    atShiftLo: 0,     // Attribute data shift register low
    atShiftHi: 0,     // Attribute data shift register high
    ntByte:    0,     // Nametable byte
    atByte:    0,     // Attribute table byte
    tileLo:    0,     // Pattern low byte
    tileHi:    0      // Pattern high byte
  }
};
*/

window.SHARED = {};

// our multithread workers
const ppuWorker = new Worker('assets/js/ppu-worker.js');

// --- CPU loop control ---
let cpuRunning = false;
const CPU_BATCH = 20000; // how many instructions to run per slice

function cpuLoop() {
  if (!cpuRunning) return;
  for (let i = 0; i < CPU_BATCH; i++) {
    step();
  }
  setTimeout(cpuLoop, 0); // cooperative async
}

// start/pause
function startEmu() {
  if (!cpuRunning) {
    cpuRunning = true;
    cpuLoop(); // kick off CPU execution loop
  }
  ppuWorker.postMessage({ type: 'set-running', running: true });
}

function pauseEmu() {
  cpuRunning = false;
  ppuWorker.postMessage({ type: 'set-running', running: false });
}

// ------------------------------------------------------------
// Shared state setup
// ------------------------------------------------------------

// Clocks: [0] = cpuCycles, [1] = ppuCycles
SHARED.SAB_CLOCKS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
SHARED.CLOCKS     = new Int32Array(SHARED.SAB_CLOCKS);
SHARED.CLOCKS[0] = 0; // CPU
SHARED.CLOCKS[1] = 0; // PPU

// CPU Open Bus
SHARED.SAB_CPU_OPENBUS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT);
SHARED.CPU_OPENBUS = new Uint8Array(SHARED.SAB_CPU_OPENBUS);
SHARED.CPU_OPENBUS[0] = 0;

// Events bitfield: bit0 = NMI pending, bit1 = IRQ pending
SHARED.SAB_EVENTS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
SHARED.EVENTS     = new Int32Array(SHARED.SAB_EVENTS);
SHARED.EVENTS[0] = 0;

// frame counter - not yet using
SHARED.SAB_FRAME = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
SHARED.FRAME     = new Int32Array(SHARED.SAB_FRAME);
SHARED.FRAME[0] = 0;

// Legacy variable
let cpuCycles = 0;

/*
Shared subset of PPU registers (8-bit only)
=============== Index mapping ===============
  0  = CTRL        ($2000)
  1  = MASK        ($2001)
  2  = STATUS      ($2002)
  3  = OAMADDR     ($2003)
  4  = OAMDATA     ($2004)
  5  = SCROLL_X    ($2005 first write)
  6  = SCROLL_Y    ($2005 second write)
  7  = ADDR_HIGH   ($2006 high byte)
  8  = ADDR_LOW    ($2006 low byte)
  9  = t (lo byte)
 10  = t (hi byte)
 11  = fineX
 12  = writeToggle
 13  = VRAM_DATA   ($2007)
 14  = BG.ntByte
 15  = BG.atByte
 16  = BG.tileLo
 17  = BG.tileHi
*/
SHARED.SAB_PPU_REGS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * 18);
SHARED.PPU_REGS     = new Uint8Array(SHARED.SAB_PPU_REGS);

// Separate shared variable for full 16-bit VRAM_ADDR
SHARED.SAB_VRAM_ADDR = new SharedArrayBuffer(Uint16Array.BYTES_PER_ELEMENT);
SHARED.VRAM_ADDR     = new Uint16Array(SHARED.SAB_VRAM_ADDR);

// Shared PPU asset memory
SHARED.SAB_CHR = new SharedArrayBuffer(0x2000); // 8 KB
SHARED.CHR_ROM = new Uint8Array(SHARED.SAB_CHR);

SHARED.SAB_VRAM = new SharedArrayBuffer(0x800); // 2 KB
SHARED.VRAM = new Uint8Array(SHARED.SAB_VRAM);


SHARED.SAB_PALETTE = new SharedArrayBuffer(0x20); // 32 bytes
SHARED.PALETTE_RAM = new Uint8Array(SHARED.SAB_PALETTE);

SHARED.SAB_OAM = new SharedArrayBuffer(0x100); // 256 bytes
SHARED.OAM = new Uint8Array(SHARED.SAB_OAM);

/*

Named variables that directly read/write shared PPU registers

examples, we can now read and write to the shared array without having to remember nesting/ indexes
AND because the worker lives in an entirely separate scope we can simply redeclare these blocks on 
the worker side and use the same variable names.

examples
--------
PPUCTRL = 0x69; <-- write using new define properties alias
105
console.log(SHARED.PPU_REGS[0]) <-- read back from nested PPU_REGS, element zero
105

VRAM[0x200] = 0x12
18
console.log(SHARED.VRAM[0x200])
18

Also, NMI pending is now seen as a regular boolean as if we weren't multithreading

nmiPending = true
true
nmiPending = false
false
console.log(nmiPending)
false

same for IRQ event handling

irqPending
false 

*/

// literally for the sake of being able to collapse this block of code its a function 
function setupMultiThreadVariables(){
// 1-byte PPU registers
Object.defineProperties(globalThis, {
  PPUCTRL:     { get: () => SHARED.PPU_REGS[0],  set: v => { SHARED.PPU_REGS[0]  = v & 0xFF; } },
  PPUMASK:     { get: () => SHARED.PPU_REGS[1],  set: v => { SHARED.PPU_REGS[1]  = v & 0xFF; } },
  PPUSTATUS:   { get: () => SHARED.PPU_REGS[2],  set: v => { SHARED.PPU_REGS[2]  = v & 0xFF; } },
  OAMADDR:     { get: () => SHARED.PPU_REGS[3],  set: v => { SHARED.PPU_REGS[3]  = v & 0xFF; } },
  OAMDATA:     { get: () => SHARED.PPU_REGS[4],  set: v => { SHARED.PPU_REGS[4]  = v & 0xFF; } },
  SCROLL_X:    { get: () => SHARED.PPU_REGS[5],  set: v => { SHARED.PPU_REGS[5]  = v & 0xFF; } },
  SCROLL_Y:    { get: () => SHARED.PPU_REGS[6],  set: v => { SHARED.PPU_REGS[6]  = v & 0xFF; } },
  ADDR_HIGH:   { get: () => SHARED.PPU_REGS[7],  set: v => { SHARED.PPU_REGS[7]  = v & 0xFF; } },
  ADDR_LOW:    { get: () => SHARED.PPU_REGS[8],  set: v => { SHARED.PPU_REGS[8]  = v & 0xFF; } },
  t_lo:        { get: () => SHARED.PPU_REGS[9],  set: v => { SHARED.PPU_REGS[9]  = v & 0xFF; } },
  t_hi:        { get: () => SHARED.PPU_REGS[10], set: v => { SHARED.PPU_REGS[10] = v & 0xFF; } },
  fineX:       { get: () => SHARED.PPU_REGS[11], set: v => { SHARED.PPU_REGS[11] = v & 0xFF; } },
  writeToggle: { get: () => SHARED.PPU_REGS[12], set: v => { SHARED.PPU_REGS[12] = v & 0xFF; } },
  VRAM_DATA:   { get: () => SHARED.PPU_REGS[13], set: v => { SHARED.PPU_REGS[13] = v & 0xFF; } },
  BG_ntByte:   { get: () => SHARED.PPU_REGS[14], set: v => { SHARED.PPU_REGS[14] = v & 0xFF; } },
  BG_atByte:   { get: () => SHARED.PPU_REGS[15], set: v => { SHARED.PPU_REGS[15] = v & 0xFF; } },
  BG_tileLo:   { get: () => SHARED.PPU_REGS[16], set: v => { SHARED.PPU_REGS[16] = v & 0xFF; } },
  BG_tileHi:   { get: () => SHARED.PPU_REGS[17], set: v => { SHARED.PPU_REGS[17] = v & 0xFF; } },

  // 16-bit VRAM address
  VRAM_ADDR:   { get: () => SHARED.VRAM_ADDR[0], set: v => { SHARED.VRAM_ADDR[0] = v & 0xFFFF; } }
});


Object.defineProperties(globalThis, {
  CHR_ROM: {
    get: () => SHARED.CHR_ROM
  },
  VRAM: {
    get: () => SHARED.VRAM
  },
  PALETTE_RAM: {
    get: () => SHARED.PALETTE_RAM
  },
  OAM: {
    get: () => SHARED.OAM
  }
});

Object.defineProperties(globalThis, {
  // Clock counters
  cpuCycles: {
    get: () => SHARED.CLOCKS[0],
    set: v  => { SHARED.CLOCKS[0] = v | 0; } // force int
  },
  ppuCycles: {
    get: () => SHARED.CLOCKS[1],
    set: v  => { SHARED.CLOCKS[1] = v | 0; }
  },

  // CPU open bus
  cpuOpenBus: {
    get: () => SHARED.CPU_OPENBUS[0],
    set: v  => { SHARED.CPU_OPENBUS[0] = v & 0xFF; }
  },

  // NMI pending flag (bit 0)
  nmiPending: {
    get: () => (SHARED.EVENTS[0] & 0b00000001) !== 0,
    set: v  => {
      if (v) SHARED.EVENTS[0] |= 0b00000001;  // set bit 0
      else   SHARED.EVENTS[0] &= ~0b00000001; // clear bit 0
    }
  },

  // IRQ pending flag (bit 1)
  irqPending: {
    get: () => (SHARED.EVENTS[0] & 0b00000010) !== 0,
    set: v  => {
      if (v) SHARED.EVENTS[0] |= 0b00000010;  // set bit 1
      else   SHARED.EVENTS[0] &= ~0b00000010; // clear bit 1
    }
  }
});
}
setupMultiThreadVariables();

// ------------------------------------------------------------
// Initial handshake to the worker (after SHARED is populated)
// ------------------------------------------------------------
ppuWorker.postMessage({
  SAB_CLOCKS: SHARED.SAB_CLOCKS,
  SAB_EVENTS: SHARED.SAB_EVENTS,
  SAB_FRAME:  SHARED.SAB_FRAME,
  SAB_CPU_OPENBUS: SHARED.SAB_CPU_OPENBUS,
  SAB_PPU_REGS: SHARED.SAB_PPU_REGS,
  SAB_ASSETS: {
    CHR_ROM:     SHARED.SAB_CHR,
    VRAM:        SHARED.SAB_VRAM,
    PALETTE_RAM: SHARED.SAB_PALETTE,
    OAM:         SHARED.SAB_OAM,
  },
});

// DMA copy from CPU RAM to PPU OAM
function dmaTransfer(value) {
  let even = (cpuCycles & 1) === 0;
  const start = value << 8;
  for (let i = 0; i < 256; ++i) {
    OAM[i] = systemMemory[(start + i) & 0x7FF];
  }
  const add = even ? 513 : 514;
  Atomics.add(SHARED.CLOCKS, 0, add);
  // atomics ensures update is seen straight away by other threads using the variable
  // likely not crucial here as we increment cycles per opcode in step()
  // lets just the cycles as soon as dma is done in this case
}

// ===== NMI handler =====
function serviceNMI() {
  const pc = CPUregisters.PC & 0xFFFF;

  // Push PC high
  checkWriteOffset(0x0100 + (CPUregisters.S & 0xFF), (pc >>> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Push PC low
  checkWriteOffset(0x0100 + (CPUregisters.S & 0xFF), pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Push P with B=0, bit5 set
  const pushedP = ((CPUregisters.P & ~0x10) | 0x20) & 0xFF;
  checkWriteOffset(0x0100 + (CPUregisters.S & 0xFF), pushedP);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Set I flag
  CPUregisters.P = (CPUregisters.P | 0x04) & 0xFF;

  // Fetch NMI vector
  const lo = checkReadOffset(0xFFFA) & 0xFF;
  const hi = checkReadOffset(0xFFFB) & 0xFF;
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;
  // insta add cycles for ppu worker to see
  Atomics.add(SHARED.CLOCKS, 0, 7);
}

// ROM gate
ppuWorker.postMessage({ type: 'romReady' });

PPUCTRL = PPUMASK = PPUSTATUS = OAMADDR = ADDR_HIGH = ADDR_LOW = VRAM_DATA = OAMDATA = 0x00;
VRAM.fill(0x00);