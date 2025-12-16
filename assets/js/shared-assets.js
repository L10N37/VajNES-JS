(() => {
  console.debug("[main] shared-assets.js loaded");

  window.SHARED = Object.create(null);

  console.debug("[main] Allocating SABs…");

  SHARED.SAB_CLOCKS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  SHARED.CLOCKS     = new Int32Array(SHARED.SAB_CLOCKS);
  SHARED.CLOCKS[0]  = 0;
  SHARED.CLOCKS[1]  = 0;

  SHARED.SAB_SYNC = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 8);
  SHARED.SYNC     = new Int32Array(SHARED.SAB_SYNC);
  for (let i = 0; i < SHARED.SYNC.length; i++) SHARED.SYNC[i] = 0;

  SHARED.SAB_EVENTS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  SHARED.EVENTS     = new Int32Array(SHARED.SAB_EVENTS);
  SHARED.EVENTS[0]  = 0;

  SHARED.SAB_FRAME = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  SHARED.FRAME     = new Int32Array(SHARED.SAB_FRAME);
  SHARED.FRAME[0]  = 0;

  SHARED.SAB_CPU_OPENBUS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT);
  SHARED.CPU_OPENBUS     = new Uint8Array(SHARED.SAB_CPU_OPENBUS);
  SHARED.CPU_OPENBUS[0]  = 0;

  SHARED.SAB_PPU_REGS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * 22);
  SHARED.PPU_REGS     = new Uint8Array(SHARED.SAB_PPU_REGS);

  SHARED.SAB_VRAM_ADDR = new SharedArrayBuffer(Uint16Array.BYTES_PER_ELEMENT);
  SHARED.VRAM_ADDR     = new Uint16Array(SHARED.SAB_VRAM_ADDR);

  // Space for all CHR banks (each iNES CHR bank = 8 KB)
  const CHR_BANK_BYTES  = 0x2000; // 8 KB per bank
  const TOTAL_CHR_BANKS = Math.max(window.header?.chrBanks || 1, 1);
  const CHR_TOTAL_SIZE  = CHR_BANK_BYTES * TOTAL_CHR_BANKS;

  SHARED.SAB_CHR = new SharedArrayBuffer(CHR_TOTAL_SIZE);
  SHARED.CHR_ROM = new Uint8Array(SHARED.SAB_CHR);

  console.debug(`[main] Allocated CHR SAB = ${CHR_TOTAL_SIZE.toString(16)} bytes (${TOTAL_CHR_BANKS} banks)`);

  SHARED.SAB_VRAM = new SharedArrayBuffer(0x800);
  SHARED.VRAM     = new Uint8Array(SHARED.SAB_VRAM);

  SHARED.SAB_PALETTE = new SharedArrayBuffer(0x20);
  SHARED.PALETTE_RAM = new Uint8Array(SHARED.SAB_PALETTE);

  SHARED.SAB_OAM = new SharedArrayBuffer(0x100);
  SHARED.OAM     = new Uint8Array(SHARED.SAB_OAM);

  const NES_W = 256;
  const NES_H = 240;
  const PIXEL_COUNT = NES_W * NES_H;

  // Palette index frame (one byte per pixel)
  SHARED.SAB_PALETTE_INDEX_FRAME = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * PIXEL_COUNT);
  SHARED.PALETTE_INDEX_FRAME     = new Uint8Array(SHARED.SAB_PALETTE_INDEX_FRAME);

  // RGBA frame (ready-to-blit; 4 bytes per pixel)
  SHARED.SAB_RGBA_FRAME = new SharedArrayBuffer(Uint8ClampedArray.BYTES_PER_ELEMENT * PIXEL_COUNT * 4);
  SHARED.RGBA_FRAME     = new Uint8ClampedArray(SHARED.SAB_RGBA_FRAME);

  // ---- Simple aliases (same naming style as your other SABs) ----
  Object.defineProperties(globalThis, {
    paletteIndexFrame: { get: () => SHARED.PALETTE_INDEX_FRAME, configurable: true },
    rgbaFrame:         { get: () => SHARED.RGBA_FRAME,          configurable: true },

    VRAM:        { get: () => SHARED.VRAM,        configurable: true },
    OAM:         { get: () => SHARED.OAM,         configurable: true },
    CHR_ROM:     { get: () => SHARED.CHR_ROM,     configurable: true },
    PALETTE_RAM: { get: () => SHARED.PALETTE_RAM, configurable: true },
  });

  console.debug("[main] paletteIndexFrame len =", paletteIndexFrame.length, " (expected", PIXEL_COUNT, ")");
  console.debug("[main] rgbaFrame len =", rgbaFrame.length, " (expected", (PIXEL_COUNT * 4), ")");

  // ---- Live scalar accessors ----
  const make8  = v => v & 0xFF;
  const make16 = v => v & 0xFFFF;

  Object.defineProperties(globalThis, {
    PPUCTRL:   { get: () => Atomics.load(SHARED.PPU_REGS, 0),  set: v => Atomics.store(SHARED.PPU_REGS, 0, make8(v)),  configurable: true },
    PPUMASK:   { get: () => Atomics.load(SHARED.PPU_REGS, 1),  set: v => Atomics.store(SHARED.PPU_REGS, 1, make8(v)),  configurable: true },
    PPUSTATUS: { get: () => Atomics.load(SHARED.PPU_REGS, 2),  set: v => Atomics.store(SHARED.PPU_REGS, 2, make8(v)),  configurable: true },
    OAMADDR:   { get: () => Atomics.load(SHARED.PPU_REGS, 3),  set: v => Atomics.store(SHARED.PPU_REGS, 3, make8(v)),  configurable: true },
    OAMDATA:   { get: () => Atomics.load(SHARED.PPU_REGS, 4),  set: v => Atomics.store(SHARED.PPU_REGS, 4, make8(v)),  configurable: true },
    SCROLL_X:  { get: () => Atomics.load(SHARED.PPU_REGS, 5),  set: v => Atomics.store(SHARED.PPU_REGS, 5, make8(v)),  configurable: true },
    SCROLL_Y:  { get: () => Atomics.load(SHARED.PPU_REGS, 6),  set: v => Atomics.store(SHARED.PPU_REGS, 6, make8(v)),  configurable: true },
    ADDR_HIGH: { get: () => Atomics.load(SHARED.PPU_REGS, 7),  set: v => Atomics.store(SHARED.PPU_REGS, 7, make8(v)),  configurable: true },
    ADDR_LOW:  { get: () => Atomics.load(SHARED.PPU_REGS, 8),  set: v => Atomics.store(SHARED.PPU_REGS, 8, make8(v)),  configurable: true },
    t_lo:      { get: () => Atomics.load(SHARED.PPU_REGS, 9),  set: v => Atomics.store(SHARED.PPU_REGS, 9, make8(v)),  configurable: true },
    t_hi:      { get: () => Atomics.load(SHARED.PPU_REGS, 10), set: v => Atomics.store(SHARED.PPU_REGS, 10, make8(v)), configurable: true },
    fineX:     { get: () => Atomics.load(SHARED.PPU_REGS, 11), set: v => Atomics.store(SHARED.PPU_REGS, 11, make8(v)), configurable: true },

    VRAM_DATA: { get: () => Atomics.load(SHARED.PPU_REGS, 13), set: v => Atomics.store(SHARED.PPU_REGS, 13, make8(v)), configurable: true },

    BG_ntByte: { get: () => Atomics.load(SHARED.PPU_REGS, 14), set: v => Atomics.store(SHARED.PPU_REGS, 14, make8(v)), configurable: true },
    BG_atByte: { get: () => Atomics.load(SHARED.PPU_REGS, 15), set: v => Atomics.store(SHARED.PPU_REGS, 15, make8(v)), configurable: true },
    BG_tileLo: { get: () => Atomics.load(SHARED.PPU_REGS, 16), set: v => Atomics.store(SHARED.PPU_REGS, 16, make8(v)), configurable: true },
    BG_tileHi: { get: () => Atomics.load(SHARED.PPU_REGS, 17), set: v => Atomics.store(SHARED.PPU_REGS, 17, make8(v)), configurable: true },

    PPU_FRAME_FLAGS: { get: () => Atomics.load(SHARED.PPU_REGS, 18), set: v => Atomics.store(SHARED.PPU_REGS, 18, make8(v)), configurable: true },

    mapperNumber: { get: () => Atomics.load(SHARED.PPU_REGS, 19), set: v => Atomics.store(SHARED.PPU_REGS, 19, make8(v)), configurable: true },
    CHR_BANK_LO:  { get: () => Atomics.load(SHARED.PPU_REGS, 20), set: v => Atomics.store(SHARED.PPU_REGS, 20, make8(v)), configurable: true },
    CHR_BANK_HI:  { get: () => Atomics.load(SHARED.PPU_REGS, 21), set: v => Atomics.store(SHARED.PPU_REGS, 21, make8(v)), configurable: true },

    VRAM_ADDR: { get: () => Atomics.load(SHARED.VRAM_ADDR, 0), set: v => Atomics.store(SHARED.VRAM_ADDR, 0, make16(v)), configurable: true },

    cpuCycles: { get: () => Atomics.load(SHARED.CLOCKS, 0), set: v => Atomics.store(SHARED.CLOCKS, 0, v|0), configurable: true },
    ppuCycles: { get: () => Atomics.load(SHARED.CLOCKS, 1), set: v => Atomics.store(SHARED.CLOCKS, 1, v|0), configurable: true },

    cpuOpenBus: { get: () => Atomics.load(SHARED.CPU_OPENBUS, 0), set: v => Atomics.store(SHARED.CPU_OPENBUS, 0, make8(v)), configurable: true },

    nmiSuppression: {
      get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b1) !== 0,
      set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b1) : Atomics.and(SHARED.EVENTS, 0, ~0b1); },
      configurable: true
    },
    doNotSetVblank: {
      get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b100) !== 0,
      set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b100) : Atomics.and(SHARED.EVENTS, 0, ~0b100); },
      configurable: true
    },
    cpuStallFlag: {
      get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b1000) !== 0,
      set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b1000) : Atomics.and(SHARED.EVENTS, 0, ~0b1000); },
      configurable: true
    },
    chr8kModeFlag: {
      get: () => (Atomics.load(SHARED.EVENTS, 0) & 0b00100000) !== 0,
      set: v => { v ? Atomics.or(SHARED.EVENTS, 0, 0b00100000)
                    : Atomics.and(SHARED.EVENTS, 0, ~0b00100000); },
      configurable: true
    }
  });

  console.debug("[main] Installed live scalar accessors");

  // ---- Create worker ----
  globalThis.ppuWorker = new Worker('assets/js/ppu-worker.js');
  console.debug("[main] ppuWorker created");

  // You said you don't use messages for render timing; keep this harmless
  ppuWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'ready') console.debug("[main] worker says ready");
  });

  ppuWorker.addEventListener('error', (e) => {
    console.error("[main] worker error:", e.message || e);
  });
  ppuWorker.addEventListener('messageerror', (e) => {
    console.error("[main] worker messageerror:", e);
  });

  // ---- Handshake ----
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
    SAB_PALETTE_INDEX_FRAME: SHARED.SAB_PALETTE_INDEX_FRAME,
    SAB_RGBA_FRAME:          SHARED.SAB_RGBA_FRAME
  });

  console.debug("[main] Handshake posted to worker");
})();
