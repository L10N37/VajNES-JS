
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

// Events bitfield: bit0 = NMI pending
SHARED.SAB_EVENTS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
SHARED.EVENTS     = new Int32Array(SHARED.SAB_EVENTS);
SHARED.EVENTS[0] = 0;

// Optional: frame counter
SHARED.SAB_FRAME = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
SHARED.FRAME     = new Int32Array(SHARED.SAB_FRAME);
SHARED.FRAME[0] = 0;

// Legacy variable
let cpuCycles = 0;

// Shared subset of PPU registers
/*=============== Index mapping: 0=CTRL, 1=MASK, 2=ADDR_HIGH, 3=ADDR_LOW 4=STATUS =============== */
SHARED.SAB_PPU_REGS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * 5);
SHARED.PPU_REGS = new Uint8Array(SHARED.SAB_PPU_REGS)

// Shared PPU asset memory
SHARED.SAB_CHR = new SharedArrayBuffer(0x2000); // 8 KB
SHARED.CHR_ROM = new Uint8Array(SHARED.SAB_CHR);

SHARED.SAB_VRAM = new SharedArrayBuffer(0x800); // 2 KB
SHARED.VRAM = new Uint8Array(SHARED.SAB_VRAM);


/*
const vramArray = new Uint8Array(SHARED.SAB_VRAM);


SHARED.VRAM = new Proxy(vramArray, {
  set(target, prop, value) {
    if (!isNaN(prop)) { // filter out weird internal props like 'length'
      console.warn(
        `[VRAM WRITE DETECTED] index=${prop} value=$${value.toString(16).padStart(2, "0")}`,
        new Error().stack // shows where it came from
      );
    }
    target[prop] = value;
    return true;
  }
});
*/

SHARED.SAB_PALETTE = new SharedArrayBuffer(0x20); // 32 bytes
SHARED.PALETTE_RAM = new Uint8Array(SHARED.SAB_PALETTE);

SHARED.SAB_OAM = new SharedArrayBuffer(0x100); // 256 bytes
SHARED.OAM = new Uint8Array(SHARED.SAB_OAM);

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

// ROM gate
ppuWorker.postMessage({ type: 'romReady' });
