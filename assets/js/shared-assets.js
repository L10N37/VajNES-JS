// ======================= shared-assets.js =======================
(() => {
  console.debug("[main] shared-assets.js loaded (NO ATOMICS)");

  window.SHARED = Object.create(null);

  console.debug("[main] Allocating SABs…");

  // NOTE:
  // We keep SharedArrayBuffer so worker + main see the same memory (zero-copy),
  // but we do NOT use Atomics.* anywhere in this file.

  SHARED.SAB_CLOCKS = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  SHARED.CLOCKS     = new Int32Array(SHARED.SAB_CLOCKS);
  SHARED.CLOCKS[0]  = 0; // cpuCycles
  SHARED.CLOCKS[1]  = 0; // ppuCycles

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

  SHARED.SAB_PPU_REGS = new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT * 23);
  SHARED.PPU_REGS     = new Uint8Array(SHARED.SAB_PPU_REGS);

  SHARED.SAB_VRAM_ADDR = new SharedArrayBuffer(Uint16Array.BYTES_PER_ELEMENT);
  SHARED.VRAM_ADDR     = new Uint16Array(SHARED.SAB_VRAM_ADDR);

  // ---- PPUMASK latch timing (SAB) ----
  // Int32 layout:
  // [0] ppumaskPending (0/1)
  // [1] ppumaskPendingValue (low 8 bits used)
  // [2] ppumaskApplyAtPpuCycles (absolute ppuCycles threshold)
  // [3] reserved
  SHARED.SAB_PPUMASK_TIMING = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
  SHARED.PPUMASK_TIMING     = new Int32Array(SHARED.SAB_PPUMASK_TIMING);
  for (let i = 0; i < SHARED.PPUMASK_TIMING.length; i++) SHARED.PPUMASK_TIMING[i] = 0;

  // Space for all CHR banks (each iNES CHR bank = 8 KB)
  const CHR_BANK_BYTES  = 0x2000; // 8 KB per bank
  const TOTAL_CHR_BANKS = Math.max(window.header?.chrBanks || 1, 1);
  const CHR_TOTAL_SIZE  = CHR_BANK_BYTES * TOTAL_CHR_BANKS;

  SHARED.SAB_CHR = new SharedArrayBuffer(CHR_TOTAL_SIZE);
  SHARED.CHR_ROM = new Uint8Array(SHARED.SAB_CHR);

  console.debug(`[main] Allocated CHR SAB = ${CHR_TOTAL_SIZE.toString(16)} bytes (${TOTAL_CHR_BANKS} banks)`);

  SHARED.SAB_VRAM = new SharedArrayBuffer(1024 * 4); //2KB or 4KB for mirroring mode four
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

  // RGBA frame (4 bytes per pixel)
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

  // ---- Live scalar accessors (NO ATOMICS) ----
  const make8  = v => (v & 0xFF);
  const make16 = v => (v & 0xFFFF);

  // Event bit masks
  const EVT_NMI_SUPPRESS      = 0b00000001;
  const EVT_DONT_SET_VBL      = 0b00000100;
  const EVT_CPU_STALL         = 0b00001000;
  const EVT_RENDERING_ENABLED = 0b00010000;
  const EVT_CHR_8K_MODE       = 0b00100000;

  function evtGet(mask) {
    return (SHARED.EVENTS[0] & mask) !== 0;
  }
  function evtSet(mask, on) {
    let v = SHARED.EVENTS[0] | 0;
    if (on) v |= mask;
    else    v &= ~mask;
    SHARED.EVENTS[0] = v | 0;
  }

  Object.defineProperties(globalThis, {
    // PPU regs (byte array)
    PPUCTRL:   { get: () => SHARED.PPU_REGS[0]  | 0, set: v => { SHARED.PPU_REGS[0]  = make8(v); },  configurable: true },
    PPUMASK:   { get: () => SHARED.PPU_REGS[1]  | 0, set: v => { SHARED.PPU_REGS[1]  = make8(v); },  configurable: true },
    PPUSTATUS: { get: () => SHARED.PPU_REGS[2]  | 0, set: v => { SHARED.PPU_REGS[2]  = make8(v); },  configurable: true },
    OAMADDR:   { get: () => SHARED.PPU_REGS[3]  | 0, set: v => { SHARED.PPU_REGS[3]  = make8(v); },  configurable: true },
    OAMDATA:   { get: () => SHARED.PPU_REGS[4]  | 0, set: v => { SHARED.PPU_REGS[4]  = make8(v); },  configurable: true },
    SCROLL_X:  { get: () => SHARED.PPU_REGS[5]  | 0, set: v => { SHARED.PPU_REGS[5]  = make8(v); },  configurable: true },
    SCROLL_Y:  { get: () => SHARED.PPU_REGS[6]  | 0, set: v => { SHARED.PPU_REGS[6]  = make8(v); },  configurable: true },
    ADDR_HIGH: { get: () => SHARED.PPU_REGS[7]  | 0, set: v => { SHARED.PPU_REGS[7]  = make8(v); },  configurable: true },
    ADDR_LOW:  { get: () => SHARED.PPU_REGS[8]  | 0, set: v => { SHARED.PPU_REGS[8]  = make8(v); },  configurable: true },
    t_lo:      { get: () => SHARED.PPU_REGS[9]  | 0, set: v => { SHARED.PPU_REGS[9]  = make8(v); },  configurable: true },
    t_hi:      { get: () => SHARED.PPU_REGS[10] | 0, set: v => { SHARED.PPU_REGS[10] = make8(v); },  configurable: true },
    fineX:     { get: () => SHARED.PPU_REGS[11] | 0, set: v => { SHARED.PPU_REGS[11] = make8(v); },  configurable: true },

    // slot 12 used: effective PPUMASK (latched)
    PPUMASK_effective: { get: () => SHARED.PPU_REGS[12] | 0, set: v => { SHARED.PPU_REGS[12] = make8(v); }, configurable: true },

    VRAM_DATA: { get: () => SHARED.PPU_REGS[13] | 0, set: v => { SHARED.PPU_REGS[13] = make8(v); },  configurable: true },

    BG_ntByte: { get: () => SHARED.PPU_REGS[14] | 0, set: v => { SHARED.PPU_REGS[14] = make8(v); },  configurable: true },
    BG_atByte: { get: () => SHARED.PPU_REGS[15] | 0, set: v => { SHARED.PPU_REGS[15] = make8(v); },  configurable: true },
    BG_tileLo: { get: () => SHARED.PPU_REGS[16] | 0, set: v => { SHARED.PPU_REGS[16] = make8(v); },  configurable: true },
    BG_tileHi: { get: () => SHARED.PPU_REGS[17] | 0, set: v => { SHARED.PPU_REGS[17] = make8(v); },  configurable: true },

    PPU_FRAME_FLAGS: { get: () => SHARED.PPU_REGS[18] | 0, set: v => { SHARED.PPU_REGS[18] = make8(v); }, configurable: true },

    mapperNumber: { get: () => SHARED.PPU_REGS[19] | 0, set: v => { SHARED.PPU_REGS[19] = make8(v); }, configurable: true },
    CHR_BANK_LO:  { get: () => SHARED.PPU_REGS[20] | 0, set: v => { SHARED.PPU_REGS[20] = make8(v); }, configurable: true },
    CHR_BANK_HI:  { get: () => SHARED.PPU_REGS[21] | 0, set: v => { SHARED.PPU_REGS[21] = make8(v); }, configurable: true },

    // 0=VERT, 1=HORZ, 4=FOUR
    MIRRORING_MODE:  { get: () => SHARED.PPU_REGS[22] | 0, set: v => { SHARED.PPU_REGS[22] = make8(v); }, configurable: true },

    // VRAM address (Uint16)
    VRAM_ADDR: { get: () => SHARED.VRAM_ADDR[0] | 0, set: v => { SHARED.VRAM_ADDR[0] = make16(v); }, configurable: true },

    // clocks (Int32)
    cpuCycles: { get: () => SHARED.CLOCKS[0] | 0, set: v => { SHARED.CLOCKS[0] = (v|0); }, configurable: true },
    ppuCycles: { get: () => SHARED.CLOCKS[1] | 0, set: v => { SHARED.CLOCKS[1] = (v|0); }, configurable: true },

    // scanline / dot / frame
    currentScanline: { get: () => SHARED.SYNC[2] | 0, set: v => { SHARED.SYNC[2] = (v|0); }, configurable: true },
    currentDot:      { get: () => SHARED.SYNC[3] | 0, set: v => { SHARED.SYNC[3] = (v|0); }, configurable: true },
    currentFrame:    { get: () => SHARED.SYNC[4] | 0, set: v => { SHARED.SYNC[4] = (v|0); }, configurable: true },

    // ---- ppumask latch timing (Int32 SAB) ----
    ppumaskPending: {
      get: () => ((SHARED.PPUMASK_TIMING[0] | 0) !== 0),
      set: v  => { SHARED.PPUMASK_TIMING[0] = v ? 1 : 0; },
      configurable: true
    },
    ppumaskPendingValue: {
      get: () => (SHARED.PPUMASK_TIMING[1] | 0),
      set: v  => { SHARED.PPUMASK_TIMING[1] = (v | 0); },
      configurable: true
    },
    ppumaskApplyAtPpuCycles: {
      get: () => (SHARED.PPUMASK_TIMING[2] | 0),
      set: v  => { SHARED.PPUMASK_TIMING[2] = (v | 0); },
      configurable: true
    },

    // packed event flags (Int32)
    nmiSuppression: { get: () => evtGet(EVT_NMI_SUPPRESS), set: v => evtSet(EVT_NMI_SUPPRESS, !!v), configurable: true },
    doNotSetVblank: { get: () => evtGet(EVT_DONT_SET_VBL), set: v => evtSet(EVT_DONT_SET_VBL, !!v), configurable: true },
    cpuStallFlag:   { get: () => evtGet(EVT_CPU_STALL),    set: v => evtSet(EVT_CPU_STALL, !!v),    configurable: true },
    renderingEnabled:{get: () => evtGet(EVT_RENDERING_ENABLED), set: v => evtSet(EVT_RENDERING_ENABLED, !!v), configurable: true },
    chr8kModeFlag:  { get: () => evtGet(EVT_CHR_8K_MODE),  set: v => evtSet(EVT_CHR_8K_MODE, !!v),  configurable: true },
  });

  console.debug("[main] Installed live scalar accessors (NO ATOMICS)");

  // ---- Create worker ----
  globalThis.ppuWorker = new Worker('assets/js/ppu-worker.js');
  console.debug("[main] ppuWorker created");

  // Harmless message hooks (keep)
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

    SAB_PPUMASK_TIMING: SHARED.SAB_PPUMASK_TIMING,

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
