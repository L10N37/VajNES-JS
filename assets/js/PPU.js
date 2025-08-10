// PPU Registers
let PPUregister = {
  CTRL:      0x00, // $2000
  MASK:      0x00, // $2001
  STATUS:    0x00, // $2002
  OAMADDR:   0x00, // $2003
  OAMDATA:   0x00, // $2004
  SCROLL_X:  0x00, // $2005 (first write)
  SCROLL_Y:  0x00, // $2005 (second write)
  ADDR_HIGH: 0x00, // $2006 (first write)
  ADDR_LOW:  0x00, // $2006 (second write)
  VRAM_ADDR: 0x0000, // 15-bit current VRAM address
  VRAM_DATA: 0x00, // Read buffer for $2007
  writeToggle: false
};

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

// Handles all writes to PPU registers ($2000–$2007 only, receive base/ folded address)
function ppuWrite(addr, value) {
  value &= 0xFF;
  switch (addr) {
    case 0x2000: PPUregister.CTRL = value;      cpuOpenBus = value; break;
    case 0x2001: PPUregister.MASK = value;      cpuOpenBus = value; break;


    case 0x2002: /* read-only */ 
    //window.alert("attempt made to write to PPU status (read only register)"); 
    
    //PPUregister.STATUS = value; // for test suite only
    
    break;




    case 0x2003: PPUregister.OAMADDR = value;   cpuOpenBus = value; break;
    case 0x2004:
      PPU_OAM[PPUregister.OAMADDR] = value;
      PPUregister.OAMDATA = value;
      PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF;
      cpuOpenBus = value;
      break;
    case 0x2005:
      if (!PPUregister.writeToggle) PPUregister.SCROLL_X = value;
      else                          PPUregister.SCROLL_Y = value;
      PPUregister.writeToggle = !PPUregister.writeToggle;
      cpuOpenBus = value;
      break;
    case 0x2006:
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value;
        PPUregister.VRAM_ADDR = ((value & 0x3F) << 8) | (PPUregister.VRAM_ADDR & 0xFF);
      } else {
        PPUregister.ADDR_LOW = value;
        PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & 0x3F00) | value;
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      cpuOpenBus = value;
      break;
    case 0x2007: {
      let v = PPUregister.VRAM_ADDR & 0x3FFF;
      if      (v < 0x2000)  ppuCHR[v] = value; // CHR-ROM/RAM
      else if (v < 0x3F00)  ppuNT[v & 0x0FFF] = value; // Nametables
      else if (v < 0x4000) {
        let palAddr = v & 0x1F;
        if ([0x10, 0x14, 0x18, 0x1C].includes(palAddr)) palAddr &= ~0x10;
        ppuPalette[palAddr] = value;
      }
      // VRAM increment: 1 or 32
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      cpuOpenBus = value;
      break;
    }
    default: break;
  }
}

// Handles all reads from PPU registers ($2000–$2007 only, receive base/ folded address)
function ppuRead(addr) {
  switch (addr) {
    case 0x2002: { // PPUSTATUS
      let status = PPUregister.STATUS;
      PPUregister.STATUS &= 0x7F;
      PPUregister.writeToggle = false;
      cpuOpenBus = status;
      return status;
    }
    case 0x2004: { // OAMDATA
      let val = PPU_OAM[PPUregister.OAMADDR];
      cpuOpenBus = val;
      return val;
    }
    case 0x2007: {
      let v = PPUregister.VRAM_ADDR & 0x3FFF, ret;
      if      (v < 0x2000) { ret = PPUregister.VRAM_DATA; PPUregister.VRAM_DATA = ppuCHR[v]; }
      else if (v < 0x3F00) { ret = PPUregister.VRAM_DATA; PPUregister.VRAM_DATA = ppuNT[v & 0x0FFF]; }
      else if (v < 0x4000) {
        let palAddr = v & 0x1F;
        if ([0x10, 0x14, 0x18, 0x1C].includes(palAddr)) palAddr &= ~0x10;
        ret = ppuPalette[palAddr];
        PPUregister.VRAM_DATA = ppuPalette[palAddr];
      }
      // VRAM increment: 1 or 32
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      cpuOpenBus = ret;
      return ret;
    }
    // All other registers return open bus (including write-only regs)
    default:
      return cpuOpenBus;
  }
}


function ppuTick(){
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
    - nmiPending:  boolean latch to request NMI on the CPU
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
      if (PPUCTRL bit 7 "NMI enable" == 1) set nmiPending = true
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
  - If PPUCTRL bit 7 is 1 when VBLANK is set, set nmiPending = true.
  - The CPU should check nmiPending between instructions; if true,
    push PC+P to stack and jump to the NMI vector ($FFFA/FFFB), then clear nmiPending.
  - Exact-cycle NMI suppression/cancellation quirks exist; ignore them for now.

  ============================================================
  IMPLEMENTATION ORDER (pragmatic bring-up)
  ============================================================
  A) Implement counters (scanline/dot/frame), VBLANK set/clear, nmiPending.   <-- this breaks your loop
  B) Implement loopy w/t/v/x rules for $2005/$2006 and the copy points.
  C) Implement $2007 VRAM increment (1/32) (you likely did already).
  D) Add odd-frame skip later.
  E) Add background shifters, then sprites, then exact palette/bus nuances.

  */
}