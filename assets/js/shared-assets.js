(() => {
  console.debug("[main] shared-assets.js loaded");

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

  // #scalar these for readability with atomics on both cores
  // --- PPU/CPU sync SAB ---
  SHARED.SAB_SYNC = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 8);
  SHARED.SYNC     = new Int32Array(SHARED.SAB_SYNC);

  // Init all to 0
  for (let i = 0; i < SHARED.SYNC.length; i++) SHARED.SYNC[i] = 0;

  /*
    SYNC[0] : CPU cycles
    SYNC[1] : PPU budget
    SYNC[2] : Current scanline (0..261)
    SYNC[3] : Current dot (0..340)
    SYNC[4] : Current frame counter
    SYNC[5] : VBlank flag shadow (0 = clear, 1 = set)
    SYNC[6] : NMI edge marker (frame number or dot when NMI was asserted)
    SYNC[7] : unused
  */

  // Events bitfield (bit0=NMI, bit1=IRQ #?? IRQ ) #clean up comments
  // bit 2 is now ppuDebugLogging, bit 3 is for comparing PPU/CPU timing, i.e. is the PPU up to the 
  // correct scanline/ dot for the cpu cycles that have burnt
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
  const PIXEL_COUNT = 256 * 240;
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
  PPUCTRL:     { get: () => Atomics.load(SHARED.PPU_REGS, 0),  set: v => Atomics.store(SHARED.PPU_REGS, 0, make8(v)), configurable: true },
  PPUMASK:     { get: () => Atomics.load(SHARED.PPU_REGS, 1),  set: v => Atomics.store(SHARED.PPU_REGS, 1, make8(v)), configurable: true },
  PPUSTATUS:   { get: () => Atomics.load(SHARED.PPU_REGS, 2),  set: v => Atomics.store(SHARED.PPU_REGS, 2, make8(v)), configurable: true },
  OAMADDR:     { get: () => Atomics.load(SHARED.PPU_REGS, 3),  set: v => Atomics.store(SHARED.PPU_REGS, 3, make8(v)), configurable: true },
  OAMDATA:     { get: () => Atomics.load(SHARED.PPU_REGS, 4),  set: v => Atomics.store(SHARED.PPU_REGS, 4, make8(v)), configurable: true },
  SCROLL_X:    { get: () => Atomics.load(SHARED.PPU_REGS, 5),  set: v => Atomics.store(SHARED.PPU_REGS, 5, make8(v)), configurable: true },
  SCROLL_Y:    { get: () => Atomics.load(SHARED.PPU_REGS, 6),  set: v => Atomics.store(SHARED.PPU_REGS, 6, make8(v)), configurable: true },
  ADDR_HIGH:   { get: () => Atomics.load(SHARED.PPU_REGS, 7),  set: v => Atomics.store(SHARED.PPU_REGS, 7, make8(v)), configurable: true },
  ADDR_LOW:    { get: () => Atomics.load(SHARED.PPU_REGS, 8),  set: v => Atomics.store(SHARED.PPU_REGS, 8, make8(v)), configurable: true },
  t_lo:        { get: () => Atomics.load(SHARED.PPU_REGS, 9),  set: v => Atomics.store(SHARED.PPU_REGS, 9, make8(v)), configurable: true },
  t_hi:        { get: () => Atomics.load(SHARED.PPU_REGS, 10), set: v => Atomics.store(SHARED.PPU_REGS, 10, make8(v)), configurable: true },
  fineX:       { get: () => Atomics.load(SHARED.PPU_REGS, 11), set: v => Atomics.store(SHARED.PPU_REGS, 11, make8(v)), configurable: true },
  writeToggle: { get: () => Atomics.load(SHARED.PPU_REGS, 12), set: v => Atomics.store(SHARED.PPU_REGS, 12, make8(v)), configurable: true },
  VRAM_DATA:   { get: () => Atomics.load(SHARED.PPU_REGS, 13), set: v => Atomics.store(SHARED.PPU_REGS, 13, make8(v)), configurable: true },
  BG_ntByte:   { get: () => Atomics.load(SHARED.PPU_REGS, 14), set: v => Atomics.store(SHARED.PPU_REGS, 14, make8(v)), configurable: true },
  BG_atByte:   { get: () => Atomics.load(SHARED.PPU_REGS, 15), set: v => Atomics.store(SHARED.PPU_REGS, 15, make8(v)), configurable: true },
  BG_tileLo:   { get: () => Atomics.load(SHARED.PPU_REGS, 16), set: v => Atomics.store(SHARED.PPU_REGS, 16, make8(v)), configurable: true },
  BG_tileHi:   { get: () => Atomics.load(SHARED.PPU_REGS, 17), set: v => Atomics.store(SHARED.PPU_REGS, 17, make8(v)), configurable: true },
  PPU_FRAME_FLAGS: { get: () => Atomics.load(SHARED.PPU_REGS, 18), set: v => Atomics.store(SHARED.PPU_REGS, 18, make8(v)), configurable: true },

  // 16-bit VRAM address
  VRAM_ADDR:   { get: () => Atomics.load(SHARED.VRAM_ADDR, 0), set: v => Atomics.store(SHARED.VRAM_ADDR, 0, make16(v)), configurable: true },

  // clocks
  cpuCycles:   { get: () => Atomics.load(SHARED.CLOCKS, 0), set: v => Atomics.store(SHARED.CLOCKS, 0, v|0), configurable: true },
  ppuCycles:   { get: () => Atomics.load(SHARED.CLOCKS, 1), set: v => Atomics.store(SHARED.CLOCKS, 1, v|0), configurable: true },

  // open bus
  cpuOpenBus:  { get: () => Atomics.load(SHARED.CPU_OPENBUS, 0), set: v => Atomics.store(SHARED.CPU_OPENBUS, 0, make8(v)), configurable: true },

  // events (bit flags)
  nmiPending: {
    get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b1) !== 0,
    set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b1) : Atomics.and(SHARED.EVENTS, 0, ~0b1); },
    configurable: true
  },
  ppuDebugLogging: {
    get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b100) !== 0,
    set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b100) : Atomics.and(SHARED.EVENTS, 0, ~0b100); },
    configurable: true
  },
  cpuPpuSyncTiming: {
    get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b1000) !== 0,
    set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b1000) : Atomics.and(SHARED.EVENTS, 0, ~0b1000); },
    configurable: true
  },
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