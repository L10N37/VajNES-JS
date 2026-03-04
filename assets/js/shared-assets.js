// ======================= shared-assets.js =======================

  // Space for all CHR banks (each iNES CHR bank = 8 KB)
  const CHR_BANK_BYTES  = 0x2000; // 8 KB per bank
  const TOTAL_CHR_BANKS = Math.max(window.header?.chrBanks || 1, 1);
  const CHR_TOTAL_SIZE  = CHR_BANK_BYTES * TOTAL_CHR_BANKS;

  const NES_W = 256;
  const NES_H = 240;
  const PIXEL_COUNT = NES_W * NES_H;

  // NES output is 256 x 240 pixels.
  let paletteIndexFrame = new Uint8Array(256 * 240);          // 1 byte per pixel (palette index)
  let rgbaFrame         = new Uint8ClampedArray(256 * 240 * 4); // RGBA8888 (4 bytes per pixel)

  // -----------------------------
  // PPU registers (simple bytes)
  // -----------------------------

  let PPUCTRL = 0;
  let PPUMASK = 0;
  let PPUSTATUS = 0;
  let OAMADDR = 0;
  let OAMDATA = 0;

  let SCROLL_X = 0;
  let SCROLL_Y = 0;

  let ADDR_HIGH = 0;
  let ADDR_LOW  = 0;

  let t_lo  = 0;
  let t_hi  = 0;
  let fineX = 0;

  // latched mask
  let PPUMASK_effective = 0;

  let VRAM_DATA = 0;

  // background fetch pipeline
  let BG_ntByte = 0;
  let BG_atByte = 0;
  let BG_tileLo = 0;
  let BG_tileHi = 0;

  let PPU_FRAME_FLAGS = 0;


  // -----------------------------
  // Mapper / cartridge state
  // -----------------------------

  let mapperNumber = 0;
  let CHR_BANK_LO  = 0;
  let CHR_BANK_HI  = 0;

  // 0 = VERT, 1 = HORZ, 4 = FOUR
  let MIRRORING_MODE = 0;


  // -----------------------------
  // VRAM address register
  // -----------------------------

  let VRAM_ADDR = 0;   // 16-bit value


  // -----------------------------
  // Clock counters
  // -----------------------------

  let cpuCycles = 0;
  let ppuCycles = 0;


  // -----------------------------
  // PPU timing
  // -----------------------------

  let currentScanline = 0;
  let currentDot      = 0;
  let currentFrame    = 0;


  // -----------------------------
  // PPUMASK delayed timing
  // -----------------------------

  let ppumaskPending = false;
  let ppumaskPendingValue = 0;
  let ppumaskApplyAtPpuCycles = 0;


  // -----------------------------
  // Event flags
  // -----------------------------

  let nmiSuppression = false;
  let doNotSetVblank = false;
  let cpuStallFlag = false;
  let renderingEnabled = false;
  let chr8kModeFlag = false;