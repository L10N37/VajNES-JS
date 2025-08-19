(() => {
  console.debug("[main] shared-assets.js loaded");

  // Ensure NES dimensions exist before allocating pixel buffer.
  if (typeof NES_W === "undefined") globalThis.NES_W = 256;
  if (typeof NES_H === "undefined") globalThis.NES_H = 240;

  // Shared namespace
  window.SHARED = Object.create(null);

  // ------------------------------------------------------------
  // Allocate SABs + Views
  // ------------------------------------------------------------
  console.debug("[main] Allocating SABs…");

  // Clocks: [0]=CPU, [1]=PPU
  SHARED.SAB_CLOCKS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  SHARED.CLOCKS     = new Int32Array(SHARED.SAB_CLOCKS);
  SHARED.CLOCKS[0]  = 0;
  SHARED.CLOCKS[1]  = 0;

  // for PPU ticks consumed as theyre otherwise local to the worker
  SHARED.SAB_SYNC = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  SHARED.SYNC     = new Int32Array(SHARED.SAB_SYNC);
  SHARED.SYNC[0]  = 0;

  // Events bitfield (bit0=NMI, bit1=IRQ)
  // Run bit lives in EVENTS[0] (bit 2). Main sets/clears it. Worker only reads it.
  SHARED.SAB_EVENTS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  SHARED.EVENTS     = new Int32Array(SHARED.SAB_EVENTS);
  SHARED.EVENTS[0]  = 0;

  // Frame counter
  SHARED.SAB_FRAME = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  SHARED.FRAME     = new Int32Array(SHARED.SAB_FRAME);
  SHARED.FRAME[0]  = 0;

  // CPU open bus
  SHARED.SAB_CPU_OPENBUS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT);
  SHARED.CPU_OPENBUS     = new Uint8Array(SHARED.SAB_CPU_OPENBUS);
  SHARED.CPU_OPENBUS[0]  = 0;

  // PPU regs (8-bit)
  // 0:PPUCTRL 1:PPUMASK 2:PPUSTATUS 3:OAMADDR 4:OAMDATA
  // 5:SCROLL_X 6:SCROLL_Y 7:ADDR_HIGH 8:ADDR_LOW
  // 9:t_lo 10:t_hi 11:fineX 12:writeToggle 13:VRAM_DATA
  // 14:BG_ntByte 15:BG_atByte 16:BG_tileLo 17:BG_tileHi
  // 18:PPU_FRAME_FLAGS (bit0 = frame-ready)
  SHARED.SAB_PPU_REGS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * 19);
  SHARED.PPU_REGS     = new Uint8Array(SHARED.SAB_PPU_REGS);

  // VRAM_ADDR (16-bit at index 0)
  SHARED.SAB_VRAM_ADDR = new SharedArrayBuffer(Uint16Array.BYTES_PER_ELEMENT);
  SHARED.VRAM_ADDR     = new Uint16Array(SHARED.SAB_VRAM_ADDR);

  // Assets
  SHARED.SAB_CHR     = new SharedArrayBuffer(0x2000); // 8KB CHR ROM
  SHARED.CHR_ROM     = new Uint8Array(SHARED.SAB_CHR);

  SHARED.SAB_VRAM    = new SharedArrayBuffer(0x800); // 2KB VRAM
  SHARED.VRAM        = new Uint8Array(SHARED.SAB_VRAM);

  SHARED.SAB_PALETTE = new SharedArrayBuffer(0x20); // 32B Palette RAM
  SHARED.PALETTE_RAM = new Uint8Array(SHARED.SAB_PALETTE);

  SHARED.SAB_OAM     = new SharedArrayBuffer(0x100); // 256B OAM
  SHARED.OAM         = new Uint8Array(SHARED.SAB_OAM);

  // Pixel buffer (palette indices per pixel)
  const PIXEL_COUNT = NES_W * NES_H;
  SHARED.SAB_PALETTE_INDEX_FRAME = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * PIXEL_COUNT);
  SHARED.PALETTE_INDEX_FRAME     = new Uint8Array(SHARED.SAB_PALETTE_INDEX_FRAME);

  // ------------------------------------------------------------
  // Read-only accessors to shared views (no rebinding, no copies)
  // ------------------------------------------------------------
  Object.defineProperties(globalThis, {
    paletteIndexFrame: { get: () => SHARED.PALETTE_INDEX_FRAME, configurable: true },
    VRAM:              { get: () => SHARED.VRAM,                configurable: true },
    OAM:               { get: () => SHARED.OAM,                 configurable: true },
    CHR_ROM:           { get: () => SHARED.CHR_ROM,             configurable: true },
    PALETTE_RAM:       { get: () => SHARED.PALETTE_RAM,         configurable: true },
  });

  console.debug("[main] paletteIndexFrame len =", paletteIndexFrame.length, " (expected", PIXEL_COUNT, ")");

// verify pixel buffer sharing without corrupting framebuffer
try {
  console.debug("[main] paletteIndexFrame sanity check:");
  console.debug("  length =", paletteIndexFrame.length);
  console.debug("  BYTES_PER_ELEMENT =", paletteIndexFrame.BYTES_PER_ELEMENT);
  console.debug("  buffer.byteLength =", paletteIndexFrame.buffer.byteLength);
  console.debug("  buffer identity =", paletteIndexFrame.buffer);

  // Send a message to worker so it can log the same buffer identity
  if (typeof worker !== "undefined") {
    worker.postMessage({
      type: "verifyBuffer",
      bufferId: paletteIndexFrame.buffer
    });
  }
} catch (e) {
  console.warn("[main] buffer sanity check failed:", e);
}

  // ------------------------------------------------------------
  // LIVE scalars via accessors
  // ------------------------------------------------------------
  const make8  = v => v & 0xFF;
  const make16 = v => v & 0xFFFF;

  Object.defineProperties(globalThis, {
    // 8-bit regs
    PPUCTRL:     { get: () => SHARED.PPU_REGS[0],  set: v => { SHARED.PPU_REGS[0]  = make8(v); }, configurable: true },
    PPUMASK:     { get: () => SHARED.PPU_REGS[1],  set: v => { SHARED.PPU_REGS[1]  = make8(v); }, configurable: true },
    PPUSTATUS:   { get: () => SHARED.PPU_REGS[2],  set: v => { SHARED.PPU_REGS[2]  = make8(v); }, configurable: true },
    OAMADDR:     { get: () => SHARED.PPU_REGS[3],  set: v => { SHARED.PPU_REGS[3]  = make8(v); }, configurable: true },
    OAMDATA:     { get: () => SHARED.PPU_REGS[4],  set: v => { SHARED.PPU_REGS[4]  = make8(v); }, configurable: true },
    SCROLL_X:    { get: () => SHARED.PPU_REGS[5],  set: v => { SHARED.PPU_REGS[5]  = make8(v); }, configurable: true },
    SCROLL_Y:    { get: () => SHARED.PPU_REGS[6],  set: v => { SHARED.PPU_REGS[6]  = make8(v); }, configurable: true },
    ADDR_HIGH:   { get: () => SHARED.PPU_REGS[7],  set: v => { SHARED.PPU_REGS[7]  = make8(v); }, configurable: true },
    ADDR_LOW:    { get: () => SHARED.PPU_REGS[8],  set: v => { SHARED.PPU_REGS[8]  = make8(v); }, configurable: true },
    t_lo:        { get: () => SHARED.PPU_REGS[9],  set: v => { SHARED.PPU_REGS[9]  = make8(v); }, configurable: true },
    t_hi:        { get: () => SHARED.PPU_REGS[10], set: v => { SHARED.PPU_REGS[10] = make8(v); }, configurable: true },
    fineX:       { get: () => SHARED.PPU_REGS[11], set: v => { SHARED.PPU_REGS[11] = make8(v); }, configurable: true },
    writeToggle: { get: () => SHARED.PPU_REGS[12], set: v => { SHARED.PPU_REGS[12] = make8(v); }, configurable: true },
    VRAM_DATA:   { get: () => SHARED.PPU_REGS[13], set: v => { SHARED.PPU_REGS[13] = make8(v); }, configurable: true },
    BG_ntByte:   { get: () => SHARED.PPU_REGS[14], set: v => { SHARED.PPU_REGS[14] = make8(v); }, configurable: true },
    BG_atByte:   { get: () => SHARED.PPU_REGS[15], set: v => { SHARED.PPU_REGS[15] = make8(v); }, configurable: true },
    BG_tileLo:   { get: () => SHARED.PPU_REGS[16], set: v => { SHARED.PPU_REGS[16] = make8(v); }, configurable: true },
    BG_tileHi:   { get: () => SHARED.PPU_REGS[17], set: v => { SHARED.PPU_REGS[17] = make8(v); }, configurable: true },
    PPU_FRAME_FLAGS: { get: () => SHARED.PPU_REGS[18], set: v => { SHARED.PPU_REGS[18] = make8(v); }, configurable: true },

    // 16-bit VRAM address
    VRAM_ADDR:   { get: () => SHARED.VRAM_ADDR[0], set: v => { SHARED.VRAM_ADDR[0] = make16(v); }, configurable: true },

    // clocks
    cpuCycles:   { get: () => SHARED.CLOCKS[0],    set: v => { SHARED.CLOCKS[0] = v|0; }, configurable: true },
    ppuCycles:   { get: () => SHARED.CLOCKS[1],    set: v => { SHARED.CLOCKS[1] = v|0; }, configurable: true },

    // open bus
    cpuOpenBus:  { get: () => SHARED.CPU_OPENBUS[0], set: v => { SHARED.CPU_OPENBUS[0] = make8(v); }, configurable: true },

    // events
    nmiPending:  { get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b1) !== 0,
                    set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b1)
                                  : Atomics.and(SHARED.EVENTS, 0, ~0b1); }, configurable: true },
    irqPending:  { get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b10) !== 0,
                    set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b10)
                                  : Atomics.and(SHARED.EVENTS, 0, ~0b10); }, configurable: true },

  });

  console.debug("[main] Installed live scalar accessors");

  // ------------------------------------------------------------
  // Worker boot + handshake (export worker globally)
  // ------------------------------------------------------------
  globalThis.ppuWorker = new Worker('assets/js/ppu-worker.js');

  console.debug("[main] ppuWorker created");

  ppuWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'ready') {
      console.debug("[main] worker says ready");
    } else {
      console.debug("[main] worker message:", d);
    }
  });

  ppuWorker.addEventListener('error', (e) => {
    console.error("[main] worker error:", e.message || e);
  });
  ppuWorker.addEventListener('messageerror', (e) => {
    console.error("[main] worker messageerror:", e);
  });

  // Send all SABs
  ppuWorker.postMessage({
    SAB_CLOCKS: SHARED.SAB_CLOCKS,
    SAB_EVENTS: SHARED.SAB_EVENTS,
    SAB_FRAME:  SHARED.SAB_FRAME,
    SAB_CPU_OPENBUS: SHARED.SAB_CPU_OPENBUS,
    SAB_PPU_REGS: SHARED.SAB_PPU_REGS,
    SAB_VRAM_ADDR: SHARED.SAB_VRAM_ADDR,
    SAB_SYNC: SHARED.SAB_SYNC,
    SAB_ASSETS: {
      CHR_ROM:     SHARED.SAB_CHR,
      VRAM:        SHARED.SAB_VRAM,
      PALETTE_RAM: SHARED.SAB_PALETTE,
      OAM:         SHARED.SAB_OAM,
    },
    SAB_PALETTE_INDEX_FRAME: SHARED.SAB_PALETTE_INDEX_FRAME
  });

  console.debug("[main] Handshake posted to worker");

})();

// ===== OAM DMA ($4014) =====
// Copies 256 bytes from CPU RAM page (value << 8) into PPU OAM.
// Adds 513 cycles if CPU is on even cycle, 514 if odd.
function dmaTransfer(value) {
  const start = (value & 0xFF) << 8;
  const end   = start + 0x100;

  for (let src = start, i = 0; src < end; src++, i++) {
    OAM[i] = systemMemory[src & 0x7FF];
  }
  //set our stall flag
  dmaTransferOcurred = true;
  // add our cycles, topping up the PPU budget by 513/514 * 3
  const curCycles = Atomics.load(SHARED.CLOCKS, 0);
  if (curCycles % 2 === 0) addExtraCycles(513);
  else addExtraCycles(514);
}

// ======== Interrupts ======== 
// https://www.nesdev.org/wiki/CPU_interrupts
function serviceNMI() {
  if (debugLogging) {
    console.debug("%cNMI fired", "color: white; background-color: red; font-weight: bold; padding: 2px 6px; border-radius: 3px");
  }
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
  // 7-cycle stall, visible immediately to PPU thread
  addExtraCycles(7);
}

function BRK_IMP() {
  const ret = (CPUregisters.PC + 2) & 0xFFFF;

  checkWriteOffset(0x0100 | CPUregisters.S, (ret >> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  checkWriteOffset(0x0100 | CPUregisters.S, ret & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  let p = (1 << 5) | (1 << 4);
  if (CPUregisters.P.N) p |= 0x80;
  if (CPUregisters.P.V) p |= 0x40;
  if (CPUregisters.P.D) p |= 0x08;
  if (CPUregisters.P.I) p |= 0x04;
  if (CPUregisters.P.Z) p |= 0x02;
  if (CPUregisters.P.C) p |= 0x01;

  checkWriteOffset(0x0100 | CPUregisters.S, p);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  CPUregisters.P.I = 1;
  CPUregisters.P.B = 1;

  const lo = checkReadOffset(0xFFFE) & 0xFF;
  const hi = checkReadOffset(0xFFFF) & 0xFF;
  CPUregisters.PC = (hi << 8) | lo;

  addExtraCycles(7);
}

function serviceIRQ() {
  // Only fire if I flag (Interrupt Disable) is clear
  if ((CPUregisters.P & 0x04) === 0) {

    // Push PC high, PC low, then status with B flag clear
    checkWriteOffset(0x0100 + CPUregisters.SP, (CPUregisters.PC >> 8) & 0xFF);
    CPUregisters.SP = (CPUregisters.SP - 1) & 0xFF;

    checkWriteOffset(0x0100 + CPUregisters.SP, CPUregisters.PC & 0xFF);
    CPUregisters.SP = (CPUregisters.SP - 1) & 0xFF;

    // Push status with B=0, bit 5 forced set
    let status = CPUregisters.P & ~0x10;
    status |= 0x20;
    checkWriteOffset(0x0100 + CPUregisters.SP, status);
    CPUregisters.SP = (CPUregisters.SP - 1) & 0xFF;

    // Fetch new PC from vector $FFFE/FFFF
    const lo = checkReadOffset(0xFFFE);
    const hi = checkReadOffset(0xFFFF);
    CPUregisters.PC = (hi << 8) | lo;

    // Set interrupt disable
    CPUregisters.P |= 0x04;

    // IRQ takes 7 cycles total
    addExtraCycles(7);
  }
}

// ============ Disassembler SAB set up ============
/*
DISASM.RING record layout (per instruction step)

Bytes 0..1 : PC16      // Uint16
Byte  2    : OPC       // opcode byte
Byte  3    : OP1       // first operand
Byte  4    : OP2       // second operand
Byte  5    : A         // accumulator register
Byte  6    : X         // X register
Byte  7    : Y         // Y register
Byte  8    : S         // stack pointer
Byte  9    : P.C       // Carry flag (0/1)
Byte 10    : P.Z       // Zero flag
Byte 11    : P.I       // Interrupt Disable
Byte 12    : P.D       // Decimal Mode
Byte 13    : P.B       // Break Command
Byte 14    : P.U       // Unused flag (always 1 on NES CPU)
Byte 15    : P.V       // Overflow flag
Byte 16    : P.N       // Negative flag
*/

// create SABs and start worker
window.DISASM = window.DISASM || {};

// --- RAW FACTS RING (CPU writes; worker reads) -------------------------------
const RING_CAPACITY    = 2048;  // tune 1024–4096 later
const RING_RECORD_SIZE = 5;     // PC16 + OPC + OP1 + OP2

DISASM.SAB = DISASM.SAB || {};
DISASM.SAB.RING = new SharedArrayBuffer(RING_CAPACITY * RING_RECORD_SIZE);
DISASM.RING_U8   = new Uint8Array(DISASM.SAB.RING);
DISASM.RING_U16  = new Uint16Array(DISASM.SAB.RING);
DISASM.CAPACITY    = RING_CAPACITY;
DISASM.RECORD_SIZE = RING_RECORD_SIZE;

// --- HTML PIPE (worker writes HTML; disasm.html reads) -----------------------
const HTML_HEADER_WORDS = 2;                        // [U32 COMMIT_OFFSET, U32 EPOCH]
const HTML_HEADER_BYTES = HTML_HEADER_WORDS * 4;    // 8 bytes
const HTML_DATA_BYTES   = 512 * 1024;               // 512 KiB

DISASM.SAB.HTML = new SharedArrayBuffer(HTML_HEADER_BYTES + HTML_DATA_BYTES);
DISASM.HTML_U32 = new Uint32Array(DISASM.SAB.HTML, 0, HTML_HEADER_WORDS);
DISASM.HTML_U8  = new Uint8Array(DISASM.SAB.HTML, HTML_HEADER_BYTES);
DISASM.HTML_DATA_BYTES = HTML_DATA_BYTES;

// --- Start worker (non-module) ----------------------------------------------
DISASM.worker = new Worker("disasm/disasm-worker.js");
DISASM.worker.postMessage({
  type: "init",
  sab:  { RING: DISASM.SAB.RING, HTML: DISASM.SAB.HTML },
  ring: { cap: RING_CAPACITY, stride: RING_RECORD_SIZE },
  html: { headerBytes: HTML_HEADER_BYTES, dataBytes: HTML_DATA_BYTES }
});

// ===== Serve SABs to disasm.html via BroadcastChannel ========================
(function () {
  const bc = new BroadcastChannel("nes-disasm");
  bc.onmessage = (e) => {
    const m = e && e.data;
    if (!m) return;
    if (m.type === "disasm.attachRequest") {
      bc.postMessage({
        type: "disasm.attachGrant",
        sab:  { RING: DISASM.SAB.RING, HTML: DISASM.SAB.HTML },
        ring: { cap: DISASM.CAPACITY, stride: DISASM.RECORD_SIZE },
        html: { dataBytes: DISASM.HTML_DATA_BYTES } // header is 8 bytes fixed
      });
    }
  };
})();
