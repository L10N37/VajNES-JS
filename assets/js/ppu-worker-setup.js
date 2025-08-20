console.debug("[worker] ppu-worker-setup.js loaded");

// Shared container (SABs + typed views)
let SHARED = Object.create(null);

// Array aliases (bound on global in worker)
var CHR_ROM, VRAM, PALETTE_RAM, OAM, paletteIndexFrame;

// Install live scalar accessors (PPU regs, clocks, events, open bus, VRAM_ADDR)
function installLiveScalars() {
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
  });

  console.debug("[worker] Installed live scalar accessors");
}

// Handshake (use addEventListener so other handlers can coexist)
let _initDone = false;
self.addEventListener("message", (e) => {
  const d = e.data;
  if (!d) return;

  // First packet from main: SAB hookup
  if (d.SAB_CLOCKS && !_initDone) {
    console.debug("[worker] Handshake received. Keys:", Object.keys(d));

    // SABs
    SHARED.SAB_CLOCKS              = d.SAB_CLOCKS;
    SHARED.SAB_EVENTS              = d.SAB_EVENTS;
    SHARED.SAB_FRAME               = d.SAB_FRAME;
    SHARED.SAB_SYNC                = d.SAB_SYNC;
    SHARED.SAB_CPU_OPENBUS         = d.SAB_CPU_OPENBUS;
    SHARED.SAB_PPU_REGS            = d.SAB_PPU_REGS;
    SHARED.SAB_VRAM_ADDR           = d.SAB_VRAM_ADDR;
    SHARED.SAB_PALETTE_INDEX_FRAME = d.SAB_PALETTE_INDEX_FRAME;

    const A = d.SAB_ASSETS || {};
    SHARED.SAB_CHR     = A.CHR_ROM;
    SHARED.SAB_VRAM    = A.VRAM;
    SHARED.SAB_PALETTE = A.PALETTE_RAM;
    SHARED.SAB_OAM     = A.OAM;

    // Views
    SHARED.CLOCKS              = new Int32Array(SHARED.SAB_CLOCKS);
    SHARED.EVENTS              = new Int32Array(SHARED.SAB_EVENTS);
    SHARED.FRAME               = new Int32Array(SHARED.SAB_FRAME);
    SHARED.SYNC                = new Int32Array(SHARED.SAB_SYNC);
    SHARED.CPU_OPENBUS         = new Uint8Array(SHARED.SAB_CPU_OPENBUS);
    SHARED.PPU_REGS            = new Uint8Array(SHARED.SAB_PPU_REGS);
    SHARED.VRAM_ADDR           = new Uint16Array(SHARED.SAB_VRAM_ADDR);
    SHARED.CHR_ROM             = new Uint8Array(SHARED.SAB_CHR);
    SHARED.VRAM                = new Uint8Array(SHARED.SAB_VRAM);
    SHARED.PALETTE_RAM         = new Uint8Array(SHARED.SAB_PALETTE);
    SHARED.OAM                 = new Uint8Array(SHARED.SAB_OAM);
    SHARED.PALETTE_INDEX_FRAME = new Uint8Array(SHARED.SAB_PALETTE_INDEX_FRAME);

    // Direct array aliases (still pointing at the SAB-backed views)
    CHR_ROM           = SHARED.CHR_ROM;
    VRAM              = SHARED.VRAM;
    PALETTE_RAM       = SHARED.PALETTE_RAM;
    OAM               = SHARED.OAM;
    paletteIndexFrame = SHARED.PALETTE_INDEX_FRAME;

    installLiveScalars();

    // Debug dump
    console.debug("[worker] Views ready:");
    console.debug("  CLOCKS len =", SHARED.CLOCKS.length, "EVENTS len =", SHARED.EVENTS.length);
    console.debug("  PPU_REGS len =", SHARED.PPU_REGS.length, "VRAM_ADDR len =", SHARED.VRAM_ADDR.length);
    console.debug("  CHR len =", CHR_ROM.length, "VRAM len =", VRAM.length, "PALETTE len =", PALETTE_RAM.length, "OAM len =", OAM.length);

    // Pixel buffer sanity
    const pixLen = paletteIndexFrame.length;
    const mid = (pixLen >>> 1) | 0;
    const last = pixLen - 1;
    console.debug("[worker] paletteIndexFrame len =", pixLen);
    console.debug("[worker] sentinels:", "[0]=", paletteIndexFrame[0].toString(16),
                                   "[mid]=", paletteIndexFrame[mid].toString(16),
                                   "[last]=", paletteIndexFrame[last].toString(16));

    _initDone = true;

    // Tell main we’re ready
    postMessage({ type: "ready" });

    // Start PPU burn loop now that SAB is safe
    startPPULoop();
    return;
  }
});
