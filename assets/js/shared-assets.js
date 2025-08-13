// Start PPU worker thread to run asynchronously with CPU
const ppuWorker = new Worker('assets/js/ppu-worker.js');

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

// Legacy variable (some code still uses this)
let cpuCycles = 0;

// Attach to SHARED global
window.SHARED = { SAB_CLOCKS, CLOCKS, SAB_EVENTS, EVENTS, SAB_FRAME, FRAME };

// PPU STATUS byte (bit7 = VBlank)
SHARED.SAB_STATUS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT);
SHARED.STATUS = new Uint8Array(SHARED.SAB_STATUS);
SHARED.STATUS[0] = 0;

// ===============================
// Shared PPU asset memory
// ===============================

// CHR-ROM (pattern tables) — start with 8KB default; may be resized by loader
SHARED.SAB_CHR = new SharedArrayBuffer(0x2000); // 8192 bytes
SHARED.CHR_ROM = new Uint8Array(SHARED.SAB_CHR);

// VRAM (nametable + attribute tables) — 2KB
SHARED.SAB_VRAM = new SharedArrayBuffer(0x800); // 2048 bytes
SHARED.VRAM = new Uint8Array(SHARED.SAB_VRAM);

// Palette RAM — 32 bytes
SHARED.SAB_PALETTE = new SharedArrayBuffer(0x20);
SHARED.PALETTE_RAM = new Uint8Array(SHARED.SAB_PALETTE);

// OAM — 256 bytes (64 sprites * 4 bytes)
SHARED.SAB_OAM = new SharedArrayBuffer(0x100);
SHARED.OAM = new Uint8Array(SHARED.SAB_OAM);

// (Optional) Prefill palette with a rotating index so you see *something* if you blit early
for (let i = 0; i < SHARED.PALETTE_RAM.length; i++) SHARED.PALETTE_RAM[i] = i & 63;

// Initial handshake to the worker
ppuWorker.postMessage({
  SAB_CLOCKS: SHARED.SAB_CLOCKS,
  SAB_STATUS: SHARED.SAB_STATUS,
  SAB_EVENTS: SHARED.SAB_EVENTS,
  SAB_FRAME:  SHARED.SAB_FRAME,
  SAB_ASSETS: {
    CHR_ROM:     SHARED.SAB_CHR,
    VRAM:        SHARED.SAB_VRAM,
    PALETTE_RAM: SHARED.SAB_PALETTE,
    OAM:         SHARED.SAB_OAM,
  },
});
