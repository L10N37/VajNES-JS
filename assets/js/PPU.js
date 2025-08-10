// PPU Registers
// v/t bit layout (15 bits total): yyy NN YYYYY XXXXX
//   fine Y: bits 14..12 (yyy)
//   nametable: bits 11..10 (NN)
//   coarse Y: bits 9..5  (YYYYY)
//   coarse X: bits 4..0  (XXXXX)

let PPUregister = {
  CTRL:      0x00, // $2000 (PPUCTRL, write-only): NMI enable, VRAM inc (1/32), sprite/bg pattern tbl, sprite size, base nametable
  MASK:      0x00, // $2001 (PPUMASK, write-only): rendering/grayscale/emphasis enables
  STATUS:    0x00, // $2002 (PPUSTATUS, read-only): VBlank (bit7), sprite 0 hit (bit6), sprite overflow (bit5); read clears VBlank & write toggle
  OAMADDR:   0x00, // $2003 (write-only): OAM (sprite RAM) address
  OAMDATA:   0x00, // $2004 (read/write): OAM data port (auto-increments OAMADDR on write)
  SCROLL_X:  0x00, // $2005 first write: scroll X (coarse X to t, fine X to fineX)
  SCROLL_Y:  0x00, // $2005 second write: scroll Y (fine Y + coarse Y to t)
  ADDR_HIGH: 0x00, // $2006 first write: high 6 bits of v (t[14..8]), also clears/sets writeToggle
  ADDR_LOW:  0x00, // $2006 second write: low 8 bits of v (t[7..0]); on this write t -> v
  VRAM_ADDR: 0x0000,  // current VRAM addr if you keep a mirror
  VRAM_DATA: 0x00,    // $2007 read buffer (reads are buffered except $3F00–$3FFF palette; writes go to v then v += inc)
  t:         0x0000,  // “loopy t”: temp VRAM address (same bit layout as v), receives $2000/$2005/$2006 writes
  fineX:     0,       // 3-bit fine X scroll latch (0..7), from $2005 first write; not stored in v/t
  writeToggle:false,  // $2005/$2006 write latch: false = next write is first, true = next write is second

  /* variables for drawing the background */
  BG: { 
  bgShiftLo: 0x0000,  // (16-bit) – pattern low shifter
  bgShiftHi: 0x0000,  // (16-bit) – pattern high shifter
  ntByte: 0x00, // (8-bit) – latched nametable tile index
  atBits: 0x00, // (2-bit value 0..3) – attribute quadrant for the next 8 pixels (no need to shift it each dot)
  tileLo: 0x00, // (8-bit) – latched pattern low byte for the incoming tile
  tileHi: 0x00  // (8-bit) – latched pattern high byte for the incoming tile
  }
};

/*
Bit layout reminder for t (15 bits):

bits 0–4: coarse X

bits 5–9: coarse Y

bits 10–11: nametable select (from $2000 write)

bits 12–14: fine Y

v (current VRAM addr, “loopy v”) — 15 bits
bits: 14   13   12   11   10    9    8    7    6    5    4    3    2    1    0
      y2   y1   y0   N1   N0   Y4   Y3   Y2   Y1   Y0   X4   X3   X2   X1   X0

t (temp VRAM addr, “loopy t”) — same 15-bit layout as v
bits: 14..12 = fine Y (y2..y0)
      11..10 = nametable select (N1..N0)
       9..5  = coarse Y (Y4..Y0)
       4..0  = coarse X (X4..X0)

fineX (“x” latch) — 3 bits
bits: 2..0 = fine X (0–7)


*/

function dmaTransfer(value) {
    // value = page number (upper 8 bits of source address)
    let start = value << 8; // $XX00

    // Copy 256 bytes from CPU RAM to OAM
    for (let i = 0; i < 256; ++i) {
        // NES hardware: Only RAM ($0000–$07FF) is directly DMA'able. Mirroring applies.
        PPU_OAM[i] = systemMemory[(start + i) & 0x7FF];
    }

    // Add correct cycle penalty:
    // If CPU is on an **odd** cycle, penalty = 514 cycles
    // If CPU is on an **even** cycle, penalty = 513 cycles
    cpuCycles += (cpuCycles & 1) ? 514 : 513;
}

// VRAM: $0000–$1FFF (pattern tables, usually ROM, sometimes RAM)
window.ppuCHR = new Uint8Array(0x2000);

// Nametables: $2000–$2FFF (2KB, mirrors handled externally for 4-screen, etc)
window.ppuNT = new Uint8Array(0x1000); // Nametable RAM (standard NES: 2KB mirrored)

// Palette RAM: $3F00–$3F1F
window.ppuPalette = new Uint8Array(0x20);

// OAM (sprite memory)
let PPU_OAM = new Uint8Array(256);

// ---------------------------------------------------------------------------
// Handles all writes to PPU registers ($2000–$2007 only, addr is already folded)
// ---------------------------------------------------------------------------
function ppuWrite(addr, value) {
  value &= 0xFF;

  switch (addr) {

    // $2000 — PPUCTRL (write-only)
    //   bit 7: NMI on VBLANK
    //   bit 2: VRAM increment (0:+1, 1:+32)
    //   bits 1..0: base nametable -> copied to t[11:10]
    case 0x2000: {
      PPUregister.CTRL = value;
      // Copy nametable select into t (loopy rule): t[11:10] = NN
      PPUregister.t = (PPUregister.t & 0xF3FF) | ((value & 0x03) << 10);
      cpuOpenBus = value;
      break;
    }

    // $2001 — PPUMASK (write-only)
    case 0x2001: {
      PPUregister.MASK = value;
      cpuOpenBus = value;
      break;
    }

    // $2002 — PPUSTATUS (read-only)
    // Ignored on write; keep a commented line here for test harnesses if needed.
    case 0x2002: {
      // PPUregister.STATUS = value; // (test-only) allow forcing status
      break;
    }

    // $2003 — OAMADDR (write-only)
    case 0x2003: {
      PPUregister.OAMADDR = value;
      cpuOpenBus = value;
      break;
    }

    // $2004 — OAMDATA (read/write)
    // Write: store byte at current OAMADDR, then OAMADDR++
    case 0x2004: {
      PPU_OAM[PPUregister.OAMADDR] = value;
      PPUregister.OAMDATA = value;                 // mirror of the last written value
      PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF;
      cpuOpenBus = value;
      break;
    }

    // $2005 — PPUSCROLL (write-only, two writes)
    //  1st write: fine X (x = d0..2), coarse X -> t[4:0] = d3..7
    //  2nd write: fine Y -> t[14:12] = d0..2, coarse Y -> t[9:5] = d3..7
    case 0x2005: {
      if (!PPUregister.writeToggle) {
        // First write
        PPUregister.SCROLL_X = value;              // optional mirror for UI
        PPUregister.fineX = value & 0x07;          // x = d0..2
        PPUregister.t = (PPUregister.t & ~0x001F)  // t[4:0] = d3..7
                      | ((value >> 3) & 0x1F);
        PPUregister.writeToggle = true;
      } else {
        // Second write
        PPUregister.SCROLL_Y = value;              // optional mirror for UI
        PPUregister.t = (PPUregister.t & ~(0x7000 | 0x03E0))   // clear fineY + coarseY
                      | (((value & 0x07) << 12)                // t[14:12] = d0..2 (fineY)
                      |  (((value >> 3) & 0x1F) << 5));        // t[9:5]   = d3..7 (coarseY)
        PPUregister.writeToggle = false;
      }
      cpuOpenBus = value;
      break;
    }

    // $2006 — PPUADDR (write-only, two writes)
    //  1st write (high): t = (t & 0x00FF) | ((value & 0x3F) << 8) ; w=1
    //  2nd write (low):  t = (t & 0x7F00) | value ; VRAM_ADDR = t & 0x3FFF ; w=0
    // We **do not** use PPUregister.v; we drive the bus address with VRAM_ADDR.
    case 0x2006: {
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value;                    // optional mirror for UI
        PPUregister.t = (PPUregister.t & 0x00FF) | ((value & 0x3F) << 8);
        PPUregister.writeToggle = true;
      } else {
        PPUregister.ADDR_LOW = value;                     // optional mirror for UI
        PPUregister.t = (PPUregister.t & 0x7F00) | value;
        // Load current VRAM address from t (bus uses 14-bit space 0x0000–0x3FFF)
        PPUregister.VRAM_ADDR = PPUregister.t & 0x3FFF;
        PPUregister.writeToggle = false;
      }
      cpuOpenBus = value;
      break;
    }

    // $2007 — PPUDATA (read/write)
    // WRITE path here; READ path is in ppuRead($2007).
    // On write: store to CHR/NT/Palette depending on VRAM_ADDR, then increment VRAM_ADDR by 1 or 32.
    case 0x2007: {
      const addr = PPUregister.VRAM_ADDR & 0x3FFF;
      const val  = value; // already &0xFF above

      if (addr < 0x2000) {
        // Pattern tables (CHR). Writes only take effect if CHR-RAM; harmless otherwise.
        ppuCHR[addr] = val;
      } else if (addr < 0x3F00) {
        // Nametables (mirroring handled by the 4KB backing via &0x0FFF)
        ppuNT[addr & 0x0FFF] = val;
      } else {
        // Palette RAM with mirrors for $3F10/$3F14/$3F18/$3F1C -> $3F00/$3F04/$3F08/$3F0C
        let palAddr = addr & 0x1F;
        if (palAddr === 0x10 || palAddr === 0x14 || palAddr === 0x18 || palAddr === 0x1C) {
          palAddr &= ~0x10;
        }
        // NES palette entries are 6-bit values; mask if you’re storing raw indices.
        ppuPalette[palAddr] = val & 0x3F;
      }

      // Post-write VRAM increment: +1 or +32 depending on CTRL bit 2
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;

      cpuOpenBus = value;
      break;
    }

    default:
      // Any other writes to 0x2000–0x2007 range should be impossible after folding,
      // but if they sneak through, treat as open bus sink.
      cpuOpenBus = value;
      break;
  }
}

// ---------------------------------------------------------------------------
// Handles all reads from PPU registers ($2000–$2007 only, addr is already folded)
// ---------------------------------------------------------------------------
function ppuRead(addr) {
  switch (addr) {

    // $2002 — PPUSTATUS (read)
    // Reading returns current STATUS, then:
    //   - clears VBLANK flag (bit 7 -> 0)
    //   - resets the $2005/$2006 write toggle (w = 0)
    case 0x2002: {
      const ret = PPUregister.STATUS & 0xFF;
      PPUregister.STATUS &= 0x7F;     // clear VBL
      PPUregister.writeToggle = false;
      cpuOpenBus = ret;
      return ret;
    }

    // $2004 — OAMDATA (read)
    // Reads do NOT increment OAMADDR on the NES.
    case 0x2004: {
      const val = PPU_OAM[PPUregister.OAMADDR] & 0xFF;
      cpuOpenBus = val;
      return val;
    }

    // $2007 — PPUDATA (read)
    // Buffered read semantics:
    //   - For addr < $3F00 (CHR + nametables): return the **old** buffer,
    //     then refill the buffer from the bus at addr.
    //   - For $3F00–$3FFF (palette): return palette **immediately** (no delay).
    //     Buffer is refilled from the underlying nametable/CHR at (addr & $2FFF).
    // After the read, VRAM_ADDR increments by +1 or +32 (CTRL bit 2).
    case 0x2007: {
      const addr = PPUregister.VRAM_ADDR & 0x3FFF;
      let ret;

      if (addr < 0x3F00) {
        // Return previous buffer value, then fetch new data into the buffer
        ret = (PPUregister.VRAM_DATA & 0xFF);
        if (addr < 0x2000) {
          PPUregister.VRAM_DATA = ppuCHR[addr] & 0xFF;
        } else {
          PPUregister.VRAM_DATA = ppuNT[addr & 0x0FFF] & 0xFF;
        }
      } else {
        // Palette read: direct return with internal mirroring
        let palAddr = addr & 0x1F;
        if (palAddr === 0x10 || palAddr === 0x14 || palAddr === 0x18 || palAddr === 0x1C) {
          palAddr &= ~0x10;
        }
        ret = ppuPalette[palAddr] & 0xFF;

        // Refill buffer with underlying nametable/CHR at addr & $2FFF
        // (This matches NES quirk: palette reads don't populate buffer with palette.)
        const under = addr & 0x2FFF;
        if (under < 0x2000) {
          PPUregister.VRAM_DATA = ppuCHR[under] & 0xFF;
        } else {
          PPUregister.VRAM_DATA = ppuNT[under & 0x0FFF] & 0xFF;
        }
      }

      // Post-read VRAM increment: +1 or +32
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;

      cpuOpenBus = ret & 0xFF;
      return ret & 0xFF;
    }

    // All other registers (including write-only ones) read as open bus.
    default: {
      return cpuOpenBus & 0xFF;
    }
  }
}

//================================= PPU per tick Emulation section =================================

// ── PPU timing state
const PPUclock = {
  scanline:   261,    // pre-render scanline
  dot:        0,      // 0..340
  frame:      0,      // running counter
  odd:        0,      // 0 even, 1 odd
  //nmiPending: false,  // bit 7 of PPUCTRL, now global
  ticks:      0       // total PPU ticks since start
};

// Reset counters & status
function ppuResetCounters() {
  PPUclock.scanline   = 261;
  PPUclock.dot        = 0;
  PPUclock.frame      = 0;
  PPUclock.odd        = 0;
  PPUclock.ticks      = 0;

  // loopy registers (15-bit v/t), fine X, write toggle (w)
  PPUregister.t = 0;
  PPUregister.fineX = 0;
  PPUregister.VRAM_ADDR = 0x0000;
 
  PPUregister.STATUS = 0x00;
  PPUregister.writeToggle = false;
}

// Advance one PPU tick
function ppuTick() {
  PPUclock.ticks++;

    // Horizontal copy (t -> current) at dot 257 on visible & pre-render scanlines
  if (PPUclock.dot === 257) {
    // copy coarse X (bits 0..4) and nametable X (bit 10)
    PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & ~0x041F) | (PPUregister.t & 0x041F);
  }

  // Vertical copy (t -> current) on pre-render scanline, dots 280..304 inclusive
  if (PPUclock.scanline === 261 && PPUclock.dot >= 280 && PPUclock.dot <= 304) {
    // copy fine Y (14..12), coarse Y (9..5), nametable Y (11)
    PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & ~0x7BE0) | (PPUregister.t & 0x7BE0);
  }


  // ---- VBLANK start ----
  if (PPUclock.scanline === 241 && PPUclock.dot === 1) {
    PPUregister.STATUS |= 0x80; // set vblank flag
    if (PPUregister.CTRL & 0x80) { // check bit 7 PPUCTRL
      // service NMI next CPU step (servicing directly here could cause edge case bugs (test roms))
      nmiPending = true;
    }
    if (debugLogging) {
      console.log(`[PPU] Enter VBLANK frame=${PPUclock.frame} ticks=${PPUclock.ticks}`);
    }
  }

  // ---- VBLANK clear ----
  if (PPUclock.scanline === 261 && PPUclock.dot === 1) {
    PPUregister.STATUS &= 0x1F; // clear vblank/sprite0/overflow
    PPUregister.writeToggle = false;
    if (debugLogging) {
      console.log(`[PPU] Leave VBLANK frame=${PPUclock.frame} ticks=${PPUclock.ticks}`);
    }
  }

  // ---- optional heartbeat ----
  if (debugLogging && (PPUclock.ticks % 10000 === 0)) {
    console.log(`[PPU] tick=${PPUclock.ticks} scanline=${PPUclock.scanline} dot=${PPUclock.dot}`);
  }

  // ---- advance counters ----
  PPUclock.dot++;
  if (PPUclock.dot > 340) {
    PPUclock.dot = 0;
    PPUclock.scanline++;
    if (PPUclock.scanline > 261) {
      PPUclock.scanline = 0;
      PPUclock.frame++;
      PPUclock.odd ^= 1;
    }
  }
}

  /*
  ============================================================
  NES PPU TICK OVERVIEW  (called once per PPU dot / pixel)
  ============================================================

  Timing constants (NTSC):
    - 3 PPU ticks per 1 CPU cycle. You already call ppuTick() 3× per CPU cycle.
    - 1 scanline = 341 PPU ticks (a.k.a. "dots" or "cycles")
    - 1 frame = 262 scanlines:
        visible:   0..239
        postrend:  240
        vblank:    241..260
        pre-render:261  (often referred to as -1)
    - Odd-frame cycle skip: when background rendering is enabled,
      the pre-render scanline (261) has one PPU cycle skipped
      (the classic “odd frame” shortening by 1 dot). You can add
      this later; it’s not required to get basic boot working.

  PPU state you should maintain globally:
    - scanline:    0..261  (use 261 for pre-render)
    - dot:         0..340  (tick index within scanline)
    - frameParity: 0 or 1  (even/odd)
    - registers:   PPUCTRL ($2000), PPUMASK ($2001), PPUSTATUS ($2002)
    - loopy regs:  v (current VRAM addr), t (temp VRAM addr), x (fine X), w (write toggle)
    - shifters:    bg pattern shifters + attribute shifters (can add after you see tiles)
    - sprites:     secondary OAM, sprite eval state (add later)
    - nmiPending:  boolean latch to request NMI on the CPU - sorted
    - spriteZeroHit, spriteOverflow: status bits you’ll set later

  ============================================
  1) PER-TICK COUNTERS AND ODD-FRAME SKIP
  ============================================
  - Advance (dot, scanline); wrap at dot==341 -> next scanline, wrap at scanline==262 -> frame++.
  - If you implement odd-frame skip: on pre-render scanline (261), dot==339,
    and if rendering is enabled (PPUMASK shows BG or Sprites), skip the dot:
      - increment to next scanline without producing a tick at 340.
    (This makes the frame 89341 PPU cycles instead of 89342.)

  ============================================
  2) VBLANK & NMI TIMING (the thing your ROM waits for)
  ============================================
  - When scanline == 241 and dot == 1:
      set PPUSTATUS bit 7 (VBLANK) = 1
      if (PPUCTRL bit 7 "NMI enable" == 1) set nmiPending = true  - sorted
      (CPU will service NMI at/after the next instruction boundary.)
  - When scanline == 261 (pre-render) and dot == 1:
      clear PPUSTATUS bit 7 (VBLANK) = 0
      clear spriteZeroHit (bit 6) and spriteOverflow (bit 5)
      (A read of $2002 also clears VBLANK and resets the w toggle; you already do that in your bus.)

  ============================================
  3) VISIBLE SCANLINES (0..239): background/sprite pipeline landmarks
  ============================================
  - Dots 1..256:
      * Output pixels (if rendering enabled in PPUMASK). For first bring-up,
        you can skip actual drawing until shifters are ready.
      * Each tick:
          - shift BG shifters (once you implement them)
          - fetch pipeline runs on a repeating 8-cycle cadence:
              1: fetch nametable byte
              3: fetch attribute byte
              5: fetch BG pattern low
              7: fetch BG pattern high
              8: reload shifters with fetched tile data
          - increment coarse X each 8 dots (or per-dot with the internal carry rules).
      * At dot 256:
          - increment vertical position (fine Y and coarse Y) per the loopy v rules.
      * At dot 257:
          - copy horizontal scroll bits from t -> v (coarse X + nametable X).
  - Dots 257..320:
      * Sprite evaluation for NEXT scanline: copy up to 8 sprites into secondary OAM.
        (You can stub this at first; many ROMs will still proceed.)
  - Dots 321..340:
      * Fetch the first two background tiles for the NEXT scanline
        (so shifters are primed when the next scanline starts).
  - Dot 0:
      * Idle / internal. (Some docs start from dot 1; you can treat dot 0 as a no-op.)

  ============================================
  4) POST-RENDER SCANLINE (240)
  ============================================
  - No rendering; idle. (Games may do VRAM updates here if rendering is disabled.)

  ============================================
  5) VBLANK SCANLINES (241..260)
  ============================================
  - VBLANK is active. No rendering. NMI may fire once if enabled in PPUCTRL.
  - Remember: reading $2002 clears VBLANK immediately (your bus does this).

  ============================================
  6) PRE-RENDER SCANLINE (261)
  ============================================
  - This scanline “preps” the next frame.
  - At dot 1: clear VBLANK, spriteZeroHit, spriteOverflow.
  - Dots 280..304 (inclusive): copy vertical scroll bits from t -> v
      (fine Y + coarse Y + nametable Y). This only happens when rendering is enabled.
  - Dots 321..340: fetch the first two tiles for scanline 0 (same as visible lines).

  ============================================
  7) SCROLL/COPY RULES (loopy v/t/x/w)
  ============================================
  - Writes to $2005/$2006 with the w toggle set up t, x, and v:
      * $2005 write #1: set fine X (x = value & 7), coarse X (t bits 0..4)
      * $2005 write #2: set fine Y (t bits 12..14), coarse Y (t bits 5..9)
      * $2006 write #1: t high byte (t bits 8..13)
      * $2006 write #2: t low byte  (t bits 0..7), then v = t
      * Any read of $2002 clears w = 0
  - During rendering:
      * Horizontal copy (t->v) at dot 257 of visible & pre-render scanlines.
      * Vertical copy (t->v) at dots 280..304 of pre-render scanline.
      * Horizontal increment (coarse X) each tile (every 8 dots).
      * Vertical increment at dot 256 (fine Y + coarse Y carry).

  ============================================
  8) $2007 VRAM INCREMENT RULES
  ============================================
  - After each CPU read/write of $2007, v += (PPUCTRL bit 2 ? 32 : 1).
    You’re handling this in your ppuRead/ppuWrite of $2007 (recommended).
  - $3F00-$3F1F palette reads are special (no read buffer); you can add later.

  ============================================
  9) HOW THIS UNBLOCKS YOUR VBLANK WAIT LOOP
  ============================================
  - Your ROM polls $2002 and branches until bit 7 (VBLANK) is 1.
  - Make sure ppuTick() sets VBLANK at (scanline==241 && dot==1).
  - Because you call ppuTick() 3× per CPU cycle, VBLANK will be reached in
    ~29780 CPU cycles per frame (NTSC). On your first frame, once that milestone is hit,
    PPUSTATUS bit 7 flips to 1, your `AND #$80` becomes nonzero, and the loop falls through.
  - On the *read* of $2002, VBLANK is cleared immediately by your bus (correct).
    That matches hardware and the game proceeds to VRAM upload.

  ============================================
  10) NMI DELIVERY (simple model)
  ============================================
  - If PPUCTRL bit 7 is 1 when VBLANK is set, set nmiPending = true - sorted
  - The CPU should check nmiPending between instructions; if true,
    push PC+P to stack and jump to the NMI vector ($FFFA/FFFB), then clear nmiPending - sorted
  - Exact-cycle NMI suppression/cancellation quirks exist; ignore them for now.

  ============================================================
  IMPLEMENTATION ORDER (pragmatic bring-up)
  ============================================================
  A) Implement counters (scanline/dot/frame), VBLANK set/clear, nmiPending.      (done)
  B) Implement loopy w/t/v/x rules for $2005/$2006 and the copy points. (done)
  C) Implement $2007 VRAM increment (1/32) (you likely did already). (done)

  D) Add odd-frame skip later.

  E) Add background shifters, then sprites, then exact palette/bus nuances.

  */

