// ===== shared-clocks.js =====
// Clocks: [0] = cpuCycles, [1] = ppuCycles
const SAB_CLOCKS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
const CLOCKS     = new Int32Array(SAB_CLOCKS);
CLOCKS[0] = 0; // CPU
CLOCKS[1] = 0; // PPU

// Events bitfield: bit0 = NMI pending
const SAB_EVENTS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
const EVENTS     = new Int32Array(SAB_EVENTS);
EVENTS[0] = 0;

// Optional: frame counter (debug/UI)
const SAB_FRAME = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
const FRAME     = new Int32Array(SAB_FRAME);
FRAME[0] = 0;

// Legacy variable
let cpuCycles = 0;
window.SHARED = { SAB_CLOCKS, CLOCKS, SAB_EVENTS, EVENTS, SAB_FRAME, FRAME };
