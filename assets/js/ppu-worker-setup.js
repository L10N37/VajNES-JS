console.debug("[worker] ppu-worker-setup.js loaded (NO ATOMICS)");

let SHARED = Object.create(null);

// ---- Views exposed to ppu-worker.js ----
var CHR_ROM, VRAM, PALETTE_RAM, OAM, paletteIndexFrame, rgbaFrame;

function installLiveScalars() {
  const make8  = v => (v & 0xFF);
  const make16 = v => (v & 0xFFFF);

  // Event bit masks (same as before)
  const EVT_NMI_SUPPRESS = 0b00000001;
  const EVT_DONT_SET_VBL = 0b00000100;
  const EVT_CPU_STALL    = 0b00001000;
  const EVT_CHR_8K_MODE  = 0b00100000;

  function evtGet(mask) {
    return ((SHARED.EVENTS[0] | 0) & mask) !== 0;
  }
  function evtSet(mask, on) {
    let v = SHARED.EVENTS[0] | 0;
    if (on) v |= mask;
    else    v &= ~mask;
    SHARED.EVENTS[0] = v | 0;
  }

  Object.defineProperties(globalThis, {
    // ---- PPU regs (byte array) ----
    PPUCTRL:   { get: () => (SHARED.PPU_REGS[0]  | 0), set: v => { SHARED.PPU_REGS[0]  = make8(v); }, configurable: true },
    PPUMASK:   { get: () => (SHARED.PPU_REGS[1]  | 0), set: v => { SHARED.PPU_REGS[1]  = make8(v); }, configurable: true },
    PPUSTATUS: { get: () => (SHARED.PPU_REGS[2]  | 0), set: v => { SHARED.PPU_REGS[2]  = make8(v); }, configurable: true },
    OAMADDR:   { get: () => (SHARED.PPU_REGS[3]  | 0), set: v => { SHARED.PPU_REGS[3]  = make8(v); }, configurable: true },
    OAMDATA:   { get: () => (SHARED.PPU_REGS[4]  | 0), set: v => { SHARED.PPU_REGS[4]  = make8(v); }, configurable: true },
    SCROLL_X:  { get: () => (SHARED.PPU_REGS[5]  | 0), set: v => { SHARED.PPU_REGS[5]  = make8(v); }, configurable: true },
    SCROLL_Y:  { get: () => (SHARED.PPU_REGS[6]  | 0), set: v => { SHARED.PPU_REGS[6]  = make8(v); }, configurable: true },
    ADDR_HIGH: { get: () => (SHARED.PPU_REGS[7]  | 0), set: v => { SHARED.PPU_REGS[7]  = make8(v); }, configurable: true },
    ADDR_LOW:  { get: () => (SHARED.PPU_REGS[8]  | 0), set: v => { SHARED.PPU_REGS[8]  = make8(v); }, configurable: true },
    t_lo:      { get: () => (SHARED.PPU_REGS[9]  | 0), set: v => { SHARED.PPU_REGS[9]  = make8(v); }, configurable: true },
    t_hi:      { get: () => (SHARED.PPU_REGS[10] | 0), set: v => { SHARED.PPU_REGS[10] = make8(v); }, configurable: true },
    fineX:     { get: () => (SHARED.PPU_REGS[11] | 0), set: v => { SHARED.PPU_REGS[11] = make8(v); }, configurable: true },

    // (12 unused in your mapping)
    VRAM_DATA: { get: () => (SHARED.PPU_REGS[13] | 0), set: v => { SHARED.PPU_REGS[13] = make8(v); }, configurable: true },

    BG_ntByte: { get: () => (SHARED.PPU_REGS[14] | 0), set: v => { SHARED.PPU_REGS[14] = make8(v); }, configurable: true },
    BG_atByte: { get: () => (SHARED.PPU_REGS[15] | 0), set: v => { SHARED.PPU_REGS[15] = make8(v); }, configurable: true },
    BG_tileLo: { get: () => (SHARED.PPU_REGS[16] | 0), set: v => { SHARED.PPU_REGS[16] = make8(v); }, configurable: true },
    BG_tileHi: { get: () => (SHARED.PPU_REGS[17] | 0), set: v => { SHARED.PPU_REGS[17] = make8(v); }, configurable: true },

    PPU_FRAME_FLAGS: { get: () => (SHARED.PPU_REGS[18] | 0), set: v => { SHARED.PPU_REGS[18] = make8(v); }, configurable: true },

    mapperNumber: { get: () => (SHARED.PPU_REGS[19] | 0), set: v => { SHARED.PPU_REGS[19] = make8(v); }, configurable: true },
    CHR_BANK_LO:  { get: () => (SHARED.PPU_REGS[20] | 0), set: v => { SHARED.PPU_REGS[20] = make8(v); }, configurable: true },
    CHR_BANK_HI:  { get: () => (SHARED.PPU_REGS[21] | 0), set: v => { SHARED.PPU_REGS[21] = make8(v); }, configurable: true },

    // 0=VERT, 1=HORZ, 4=FOUR
    MIRRORING_MODE:  { get: () => SHARED.PPU_REGS[22] | 0, set: v => { SHARED.PPU_REGS[22] = make8(v); }, configurable: true },

    // ---- VRAM address (Uint16) ----
    VRAM_ADDR: { get: () => (SHARED.VRAM_ADDR[0] | 0), set: v => { SHARED.VRAM_ADDR[0] = make16(v); }, configurable: true },

    // ---- clocks (Int32) ----
    cpuCycles: { get: () => (SHARED.CLOCKS[0] | 0), set: v => { SHARED.CLOCKS[0] = (v|0); }, configurable: true },
    ppuCycles: { get: () => (SHARED.CLOCKS[1] | 0), set: v => { SHARED.CLOCKS[1] = (v|0); }, configurable: true },

    // scanline / dot / frame
    currentScanline: { get: () => SHARED.SYNC[2] | 0, set: v => { SHARED.SYNC[2] = (v|0); }, configurable: true },
    currentDot: { get: () => SHARED.SYNC[3] | 0, set: v => { SHARED.SYNC[3] = (v|0); }, configurable: true },
    currentFrame: { get: () => SHARED.SYNC[4] | 0, set: v => { SHARED.SYNC[4] = (v|0); }, configurable: true },

    // ---- packed event flags (Int32) ----
    nmiSuppression: { get: () => evtGet(EVT_NMI_SUPPRESS), set: v => evtSet(EVT_NMI_SUPPRESS, !!v), configurable: true },
    doNotSetVblank: { get: () => evtGet(EVT_DONT_SET_VBL), set: v => evtSet(EVT_DONT_SET_VBL, !!v), configurable: true },
    cpuStallFlag:   { get: () => evtGet(EVT_CPU_STALL),    set: v => evtSet(EVT_CPU_STALL, !!v),    configurable: true },
    chr8kModeFlag:  { get: () => evtGet(EVT_CHR_8K_MODE),  set: v => evtSet(EVT_CHR_8K_MODE, !!v),  configurable: true },
  });

  console.debug("[worker] Installed live scalar accessors (NO ATOMICS)");
}

let _initDone = false;

self.addEventListener("message", (e) => {
  const d = e.data;
  if (!d) return;

  if (d.SAB_CLOCKS && !_initDone) {
    console.debug("[worker] Handshake received. Keys:", Object.keys(d));

    SHARED.SAB_CLOCKS      = d.SAB_CLOCKS;
    SHARED.SAB_EVENTS      = d.SAB_EVENTS;
    SHARED.SAB_FRAME       = d.SAB_FRAME;
    SHARED.SAB_SYNC        = d.SAB_SYNC;
    SHARED.SAB_CPU_OPENBUS = d.SAB_CPU_OPENBUS;
    SHARED.SAB_PPU_REGS    = d.SAB_PPU_REGS;
    SHARED.SAB_VRAM_ADDR   = d.SAB_VRAM_ADDR;

    SHARED.SAB_PALETTE_INDEX_FRAME = d.SAB_PALETTE_INDEX_FRAME;
    SHARED.SAB_RGBA_FRAME          = d.SAB_RGBA_FRAME;

    const A = d.SAB_ASSETS || {};
    SHARED.SAB_CHR     = A.CHR_ROM;
    SHARED.SAB_VRAM    = A.VRAM;
    SHARED.SAB_PALETTE = A.PALETTE_RAM;
    SHARED.SAB_OAM     = A.OAM;

    SHARED.CLOCKS      = new Int32Array(SHARED.SAB_CLOCKS);
    SHARED.EVENTS      = new Int32Array(SHARED.SAB_EVENTS);
    SHARED.FRAME       = new Int32Array(SHARED.SAB_FRAME);
    SHARED.SYNC        = new Int32Array(SHARED.SAB_SYNC);
    SHARED.CPU_OPENBUS = new Uint8Array(SHARED.SAB_CPU_OPENBUS);
    SHARED.PPU_REGS    = new Uint8Array(SHARED.SAB_PPU_REGS);
    SHARED.VRAM_ADDR   = new Uint16Array(SHARED.SAB_VRAM_ADDR);

    SHARED.CHR_ROM     = new Uint8Array(SHARED.SAB_CHR);
    SHARED.VRAM        = new Uint8Array(SHARED.SAB_VRAM);
    SHARED.PALETTE_RAM = new Uint8Array(SHARED.SAB_PALETTE);
    SHARED.OAM         = new Uint8Array(SHARED.SAB_OAM);

    SHARED.PALETTE_INDEX_FRAME = new Uint8Array(SHARED.SAB_PALETTE_INDEX_FRAME);
    SHARED.RGBA_FRAME          = new Uint8ClampedArray(SHARED.SAB_RGBA_FRAME);

    // ---- Aliases used by ppu-worker.js ----
    CHR_ROM           = SHARED.CHR_ROM;
    VRAM              = SHARED.VRAM;
    PALETTE_RAM       = SHARED.PALETTE_RAM;
    OAM               = SHARED.OAM;
    paletteIndexFrame = SHARED.PALETTE_INDEX_FRAME;
    rgbaFrame         = SHARED.RGBA_FRAME;

    installLiveScalars();

    console.debug("[worker] Views ready:");
    console.debug("  CLOCKS len =", SHARED.CLOCKS.length, "EVENTS len =", SHARED.EVENTS.length);
    console.debug("  PPU_REGS len =", SHARED.PPU_REGS.length, "VRAM_ADDR len =", SHARED.VRAM_ADDR.length);
    console.debug("  CHR len =", CHR_ROM.length, "VRAM len =", VRAM.length, "PALETTE len =", PALETTE_RAM.length, "OAM len =", OAM.length);
    console.debug("[worker] CHR_ROM byteLength =", SHARED.CHR_ROM.byteLength);

    const pixLen = paletteIndexFrame.length;
    const mid = (pixLen >>> 1) | 0;
    const last = pixLen - 1;
    console.debug("[worker] paletteIndexFrame len =", pixLen);
    console.debug("[worker] sentinels:", "[0]=", paletteIndexFrame[0].toString(16),
                                   "[mid]=", paletteIndexFrame[mid].toString(16),
                                   "[last]=", paletteIndexFrame[last].toString(16));

    const rgbaLen = rgbaFrame.length;
    console.debug("[worker] rgbaFrame len =", rgbaLen, "(expected", (pixLen * 4), ")");

    _initDone = true;

    // not used for timing, but it's useful to know init succeeded
    postMessage({ type: "ready" });

    startPPULoop();
    return;
  }
});
