/*

PPUSim_start(60); // run
PPUSim_stop();    // stop
PPUSim_step();    // single frame

*/

// ---------- Constants (SIM) ----------
const NES_W_Sim = 256, NES_H_Sim = 240;
const DOTS_PER_SCANLINE_Sim = 341;
const SCANLINES_PER_FRAME_Sim = 262;
const TOTAL_TILES_Sim = 512;   // 2 pattern tables * 256 tiles
const TILE_BYTES_Sim  = 16;    // 16 bytes per tile

// ---------- PPU-like state (SIM) ----------
const PPUclock_Sim = { dot: 0, scanline: -1, frame: 0, odd: false };

// We keep a single internal VRAM address "v" and a temp "t" like the PPU.
// For the sim we render from v, and use t to seed wave scroll per scanline.
let v_lo_Sim = 0, v_hi_Sim = 0;                 // v = current VRAM addr (15-bit)
let t_lo_Sim = 0, t_hi_Sim = 0;                 // t = temp VRAM addr (15-bit)
let fineX_Sim = 0;                              // 0..7

function v_get_Sim() { return ((v_hi_Sim & 0x7F) << 8) | (v_lo_Sim & 0xFF); }
function v_set_Sim(val){ val&=0x7FFF; v_lo_Sim=val&0xFF; v_hi_Sim=(val>>8)&0x7F; }
function t_get_Sim() { return ((t_hi_Sim & 0x7F) << 8) | (t_lo_Sim & 0xFF); }
function t_set_Sim(val){ val&=0x7FFF; t_lo_Sim=val&0xFF; t_hi_Sim=(val>>8)&0x7F; }

// PPUCTRL/PPUMASK minimal flags (SIM). We enable BG render and PT0 by default.
let PPUCTRL_Sim = 0x00;     // bit4=BG PT select (0: $0000, 1: $1000)
let PPUMASK_Sim = 0x08;     // bit3=show background

// ---------- Mock PPU memory (SIM) ----------
let CHR_ROM_Sim       = new Uint8Array(TOTAL_TILES_Sim * TILE_BYTES_Sim); // $0000-$1FFF (SIM)
let VRAM_Sim          = new Uint8Array(0x0800);                           // $2000-$27FF mirrored
let PALETTE_RAM_Sim   = new Uint8Array(32);                                // $3F00-$3F1F

// Row LUTs (SIM) for quick pattern fetch: tileIndex*8 + fineY -> [lo, hi] row bytes
let lowPlaneLUT_Sim   = new Uint8Array(TOTAL_TILES_Sim * 8);
let highPlaneLUT_Sim  = new Uint8Array(TOTAL_TILES_Sim * 8);

// ---------- BG shifters / latches (SIM) ----------
const BG_Sim = {
  bgShiftLo: 0, bgShiftHi: 0,    // 16-bit shifters for pattern bits
  atShiftLo: 0, atShiftHi: 0,    // 16-bit shifters for attribute high bits
  ntByte: 0, atByte: 0, tileLo: 0, tileHi: 0
};

// ---------- Framebuffer (SIM) ----------
let paletteIndexFrame_Sim = new Uint8Array(NES_W_Sim * NES_H_Sim);

// ---------- Animation (SIM) ----------
let wavePhase_Sim = 0;

// =============================================
// Fake data generation (SIM)
// =============================================
function buildFakeCHR_Sim() {
  // Make planes with rich 2-bit variation across a row.
  // Pattern style: lo = (0xF0, 0x0F, 0xCC, 0x33 alternating), hi = XOR variants.
  for (let t = 0; t < TOTAL_TILES_Sim; t++) {
    for (let row = 0; row < 8; row++) {
      const sel = ((t + row) & 3);
      const lo = [0xF0, 0x0F, 0xCC, 0x33][sel];
      const hi = [0x99, 0x66, 0x3C, 0xC3][sel]; // different phases
      const base = t * 16;
      CHR_ROM_Sim[base + row]     = lo;
      CHR_ROM_Sim[base + row + 8] = hi;
    }
  }
}

function buildCHRRowLUTs_Sim() {
  for (let t = 0; t < TOTAL_TILES_Sim; t++) {
    const base = t * 16;
    for (let row = 0; row < 8; row++) {
      const idx = t * 8 + row;
      lowPlaneLUT_Sim[idx]  = CHR_ROM_Sim[base + row];
      highPlaneLUT_Sim[idx] = CHR_ROM_Sim[base + 8 + row];
    }
  }
}

function buildFakeNameAndAttr_Sim() {
  // Name table $2000: 32x30 tiles = 960 bytes
  // Put in a repeating pattern of tile IDs, animated by wavePhase_Sim for motion.
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 32; x++) {
      const i = y * 32 + x;
      // animated base id that slowly changes
      VRAM_Sim[i] = ( (y * 8 + x) + ((wavePhase_Sim >>> 2) & 0xFF) ) & 0xFF;
    }
  }

  // Attribute table $23C0..$23FF: 64 bytes, each stores 2 bits per 16x16 quadrant
  // Use a checker so all four sub-palettes are exercised across the screen.
  for (let i = 0; i < 64; i++) {
    const xBlock = i & 7;
    const yBlock = i >> 3;
    const quad = ( (xBlock + yBlock) & 1 ) ? 0b01 : 0b10; // alternate 1 and 2
    // Put same 2-bit value in all quadrants of this attribute byte to simplify
    VRAM_Sim[0x3C0 + i] = (quad << 6) | (quad << 4) | (quad << 2) | quad;
  }
}

function buildFakePalette_Sim() {
  // Map each palette entry to a distinct master color index (0..63),
  // with a slow hue cycle so color changes are visible over time.
  for (let i = 0; i < 32; i++) {
    PALETTE_RAM_Sim[i] = ((i * 2 + (wavePhase_Sim >>> 1)) % 64) & 0x3F;
  }
  // Make universal BG ($3F00) a stable visible value (e.g., 0x0F)
  PALETTE_RAM_Sim[0] = 0x0F;
}

function seedAllMemory_Sim() {
  buildFakeCHR_Sim();
  buildCHRRowLUTs_Sim();
  buildFakeNameAndAttr_Sim();
  buildFakePalette_Sim();
}

// =============================================
// PPU-like helpers (SIM)
// =============================================
function incCoarseX_Sim() {
  // v: ....F.. CCCCX (coarse X in bits 0..4, H nametable in bit 10)
  let v = v_get_Sim();
  if ((v & 0x001F) === 31) {        // if coarse X == 31
    v &= ~0x001F;                   // coarse X = 0
    v ^= 0x0400;                    // switch horizontal nametable
  } else {
    v = (v + 1) & 0x7FFF;           // coarse X++
  }
  v_set_Sim(v);
}

function incY_Sim() {
  // v: fineY in bits 12..14, coarseY in bits 5..9, V nametable bit in 11
  let v = v_get_Sim();
  if ((v & 0x7000) !== 0x7000) {
    v = (v + 0x1000) & 0x7FFF;        // fineY++
  } else {
    v &= ~0x7000;                      // fineY = 0
    let y = (v & 0x03E0) >> 5;         // coarseY
    if (y === 29) {
      y = 0;
      v ^= 0x0800;                     // switch vertical nametable
    } else if (y === 31) {
      y = 0;                           // wrap
    } else {
      y++;
    }
    v = (v & ~0x03E0) | (y << 5);
  }
  v_set_Sim(v);
}

function copyHorizFromT_Sim() {
  // Copy horizontal bits from t into v
  const v = v_get_Sim(), t = t_get_Sim();
  const newV = (v & ~0x041F) | (t & 0x041F);
  v_set_Sim(newV);
}
function copyVertFromT_Sim() {
  const v = v_get_Sim(), t = t_get_Sim();
  const newV = (v & ~0x7BE0) | (t & 0x7BE0);
  v_set_Sim(newV);
}

// Fetch helpers
function ppuBusRead_Sim(addr) {
  addr &= 0x3FFF;
  if (addr < 0x2000) {
    // pattern tables (we *could* read directly, but we fetch rows via LUT below)
    return CHR_ROM_Sim[addr] & 0xFF;
  }
  if (addr >= 0x3F00) {
    let palIdx = addr & 0x1F;
    if ((palIdx & 0x13) === 0x10) palIdx &= ~0x10; // mirrors 10/14/18/1C
    return PALETTE_RAM_Sim[palIdx] & 0x3F;
  }
  // $2000-$2FFF: nametables, mirrored to 2KB array
  return VRAM_Sim[(addr - 0x2000) & 0x07FF] & 0xFF;
}

// Pattern row fetch via LUT, obey BG pattern table select
function fetchPatternRow_BG_Sim(tile, fineY) {
  const usePT1 = !!(PPUCTRL_Sim & 0x10);
  const lutTile = (usePT1 ? (256 + (tile & 0xFF)) : (tile & 0xFF));
  const idx = (lutTile * 8) + (fineY & 7);
  return [lowPlaneLUT_Sim[idx], highPlaneLUT_Sim[idx]];
}

// =============================================
// Visible scanline pipeline (SIM)
// =============================================
function visibleScanline_Sim() {
  const rendering = (PPUMASK_Sim & 0x08) !== 0;
  if (rendering) {
    // 1) Shifters tick during fetch region
    const inFetch = (PPUclock_Sim.dot >= 2 && PPUclock_Sim.dot <= 257) || (PPUclock_Sim.dot >= 321 && PPUclock_Sim.dot <= 336);
    if (inFetch) {
      BG_Sim.bgShiftLo = ((BG_Sim.bgShiftLo << 1) & 0xFFFF);
      BG_Sim.bgShiftHi = ((BG_Sim.bgShiftHi << 1) & 0xFFFF);
      BG_Sim.atShiftLo = ((BG_Sim.atShiftLo << 1) & 0xFFFF);
      BG_Sim.atShiftHi = ((BG_Sim.atShiftHi << 1) & 0xFFFF);
    }

    // 2) BG fetch sequence (2..257, 321..336): NT, AT, pattern lo, pattern hi, reload+inc
    if (inFetch) {
      const phase = (PPUclock_Sim.dot - 1) % 8;
      const v = v_get_Sim();
      switch (phase) {
        case 1: { // NT
          BG_Sim.ntByte = ppuBusRead_Sim(0x2000 | (v & 0x0FFF));
          break;
        }
        case 3: { // AT
          const attAddr = 0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 0x07);
          const shift = ((v >> 4) & 4) | (v & 2);
          const at = (ppuBusRead_Sim(attAddr) >> shift) & 0x3;  // 0..3
          BG_Sim.atByte = (at << 2);                             // store as hi bits<<2
          break;
        }
        case 5: { // pattern low
          const fineY = (v >> 12) & 0x7;
          const [lo] = fetchPatternRow_BG_Sim(BG_Sim.ntByte, fineY);
          BG_Sim.tileLo = lo;
          break;
        }
        case 7: { // pattern high
          const fineY = (v >> 12) & 0x7;
          const [, hi] = fetchPatternRow_BG_Sim(BG_Sim.ntByte, fineY);
          BG_Sim.tileHi = hi;
          break;
        }
        case 0: { // reload shifters + scroll step
          // Reload new tile row into low 8 bits; previous 8 remain (pipeline)
          BG_Sim.bgShiftLo = (BG_Sim.bgShiftLo & 0xFF00) | (BG_Sim.tileLo & 0xFF);
          BG_Sim.bgShiftHi = (BG_Sim.bgShiftHi & 0xFF00) | (BG_Sim.tileHi & 0xFF);
          const atLo = (BG_Sim.atByte & 0x01) ? 0xFF : 0x00;
          const atHi = (BG_Sim.atByte & 0x02) ? 0xFF : 0x00;
          BG_Sim.atShiftLo = (BG_Sim.atShiftLo & 0xFF00) | atLo;
          BG_Sim.atShiftHi = (BG_Sim.atShiftHi & 0xFF00) | atHi;

          if (PPUclock_Sim.dot === 256) incY_Sim();
          else incCoarseX_Sim();
          break;
        }
      }
    }

    // 3) Emit BG pixel on dots 1..256
    if (PPUclock_Sim.dot >= 1 && PPUclock_Sim.dot <= 256) {
      const x = (PPUclock_Sim.dot - 1) | 0;
      const y = PPUclock_Sim.scanline | 0;

      // Read shifter bits at bit (15 - fineX)
      const bit = 15 - (fineX_Sim & 7);
      const p0 = (BG_Sim.bgShiftLo >> bit) & 1;
      const p1 = (BG_Sim.bgShiftHi >> bit) & 1;
      const a0 = (BG_Sim.atShiftLo >> bit) & 1;
      const a1 = (BG_Sim.atShiftHi >> bit) & 1;

      const color2 = ((p1 << 1) | p0) & 0x3;     // 0..3
      const attr2  = ((a1 << 1) | a0) & 0x3;     // 0..3

      // Hardware palette rule
      let masterIdx;
      if (color2 === 0) {
        masterIdx = ppuBusRead_Sim(0x3F00) & 0x3F;
      } else {
        const palLow5 = ((attr2 << 2) + (1 + color2)) & 0x1F; // entries 1..3 within sub-palette
        masterIdx = ppuBusRead_Sim(0x3F00 | palLow5) & 0x3F;
      }

      if (x >= 0 && x < NES_W_Sim && y >= 0 && y < NES_H_Sim) {
        paletteIndexFrame_Sim[y * NES_W_Sim + x] = masterIdx;
      }
    }

    // 4) Horizontal copy at dot 257 (we render from v directly; copy=t→v)
    if (PPUclock_Sim.dot === 257) copyHorizFromT_Sim();
  }
}

// =============================================
// Non-visible scanlines (SIM)
// =============================================
function preRenderScanline_Sim() {
  if (PPUclock_Sim.dot === 1) {
    // would clear VBL here
  }
  // during 280..304 copy vertical (t→v)
  if (PPUclock_Sim.dot >= 280 && PPUclock_Sim.dot <= 304) copyVertFromT_Sim();
}

function startVBlank_Sim() {
  if (PPUclock_Sim.dot === 1) {
    // Blit the finished frame
    if (typeof blitNESFramePaletteIndex === 'function') {
      blitNESFramePaletteIndex(new Uint8Array(paletteIndexFrame_Sim), NES_W_Sim, NES_H_Sim);
    }

    // Debug: dump first 16 pixels of first scanline
    const row0 = paletteIndexFrame_Sim.slice(0, 16);
    console.debug(`[PPUSim] frame ${PPUclock_Sim.frame} row0:`,
      Array.from(row0).map((v, i) => `${i}:${v}`).join(' ')
    );

    // Clear for next frame
    paletteIndexFrame_Sim = new Uint8Array(NES_W_Sim * NES_H_Sim);

    // Advance animation phase (slow and smooth)
    wavePhase_Sim = (wavePhase_Sim + 1) & 0xFFFF;
  }
}

// =============================================
// Core tick (SIM)
// =============================================
function ppuTick_Sim() {
  if (PPUclock_Sim.scanline === -1 || PPUclock_Sim.scanline === 261) {
    preRenderScanline_Sim();
  } else if (PPUclock_Sim.scanline >= 0 && PPUclock_Sim.scanline <= 239) {
    visibleScanline_Sim();
  } else if (PPUclock_Sim.scanline === 241) {
    startVBlank_Sim();
  } // 242..260 idle

  // Advance dot/scanline/frame
  PPUclock_Sim.dot++;
  if (PPUclock_Sim.dot >= DOTS_PER_SCANLINE_Sim) {
    PPUclock_Sim.dot = 0;
    PPUclock_Sim.scanline++;
    if (PPUclock_Sim.scanline >= SCANLINES_PER_FRAME_Sim) {
      PPUclock_Sim.scanline = 0;
      PPUclock_Sim.frame++;
      PPUclock_Sim.odd = !PPUclock_Sim.odd;
    }
  }
}

// =============================================
// Per-frame setup: seed t/v from wave scroll
// =============================================
// We simulate a horizontal wave by setting coarseX+fineX per scanline.
// That’s done at the *start* of each visible scanline by writing t and copying to v at dot 257.
function beginScanlineScrollSetup_Sim() {
  if (PPUclock_Sim.dot !== 0) return;
  if (PPUclock_Sim.scanline >= 0 && PPUclock_Sim.scanline <= 239) {
    const y = PPUclock_Sim.scanline | 0;
    const wave = Math.floor(6 * Math.sin((y + (wavePhase_Sim / 4)) * (Math.PI / 64))); // slow wave
    const coarseX = ((wave >>> 3) & 31);
    fineX_Sim = (wave & 7);

    // Set t: fineY= (y%8), coarseY=(y/8), coarseX from wave, nametable 0
    const fineY = (y & 7);
    const coarseY = ((y >> 3) & 31);
    let t = 0;
    t |= (fineY << 12);
    t |= (coarseY << 5);
    t |= coarseX;
    t_set_Sim(t);

    // At dot 257 we copy horiz t->v; until then, v carries from previous line.
    // To make the first tile correct for the line, we redundantly copy horiz here too:
    copyHorizFromT_Sim();
  }
}

// =============================================
// Public API (SIM)
// =============================================
let PPUSim_timer = null;

function PPUSim_start(fps = 60) {
  // Seed memory and reset state
  PPUclock_Sim.dot = 0; PPUclock_Sim.scanline = -1; PPUclock_Sim.frame = 0; PPUclock_Sim.odd = false;
  v_set_Sim(0); t_set_Sim(0); fineX_Sim = 0; wavePhase_Sim = 0;
  seedAllMemory_Sim();

  const frameDots = DOTS_PER_SCANLINE_Sim * SCANLINES_PER_FRAME_Sim;
  const intervalMs = Math.max(1, (1000 / Math.max(1, fps)) | 0);

  if (PPUSim_timer) clearInterval(PPUSim_timer);
  PPUSim_timer = setInterval(() => {
    // Simulate one full frame worth of PPU dots
    for (let i = 0; i < frameDots; i++) {
      beginScanlineScrollSetup_Sim();
      ppuTick_Sim();
    }
    // Refresh fake memory slightly for next frame (motion & palette cycle)
    buildFakeNameAndAttr_Sim();
    buildFakePalette_Sim();
  }, intervalMs);
}

function PPUSim_stop() {
  if (PPUSim_timer) clearInterval(PPUSim_timer);
  PPUSim_timer = null;
}
