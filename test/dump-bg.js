function quickRenderNametable0() {
  const NES_W = 256, NES_H = 240;

  // Freeze the state up front to avoid tearing while the worker writes.
  // (slice() copies a snapshot out of the SharedArrayBuffer-backed views)
  const ntBase = mapNT(0x2000);
  const vramSnapshot = VRAM.slice(ntBase, ntBase + 0x400);        // $2000–$23FF (tiles + attr)
  const palSnapshot  = normalizePalette(PALETTE_RAM.slice(0, 0x20)); // $3F00–$3F1F with mirrors fixed
  const chrSnapshot  = CHR_ROM.slice(); // if mapper can bank-swap mid-frame, snapshot too

  const bgPatternBase = (PPUCTRL & 0x10) ? 0x1000 : 0x0000;

  for (let ty = 0; ty < 30; ty++) {
    for (let tx = 0; tx < 32; tx++) {
      const ntIndex   = ty * 32 + tx;                     // 0..959
      const tileIndex = vramSnapshot[ntIndex] & 0xFF;     // 8-bit tile id

      // Attribute table entry within the same nametable snapshot
      const atIndex  = 0x3C0 + ((ty >> 2) * 8) + (tx >> 2); // 0x3C0..0x3FF
      const atByte   = vramSnapshot[atIndex];

      // Using explicit quadrant bits
      const shift = ((ty & 2) ? 4 : 0) | ((tx & 2) ? 2 : 0); // 0,2,4,6
      const paletteNum = (atByte >> shift) & 0x03;

      // Tile fetch from CHR (16 bytes per tile)
      const base = bgPatternBase + (tileIndex << 4);

      for (let row = 0; row < 8; row++) {
        const lo = chrSnapshot[base + row];
        const hi = chrSnapshot[base + row + 8];

        for (let col = 0; col < 8; col++) {
          const bit0 = (lo >> (7 - col)) & 1;
          const bit1 = (hi >> (7 - col)) & 1;
          const colorIdx = (bit1 << 1) | bit0;

          // Palette index (with 0 using the universal BG color)
          const palIdx = (colorIdx === 0)
            ? 0
            : ((paletteNum << 2) | colorIdx); // 1..3 within the chosen BG subpalette

          const nesPaletteEntry = palSnapshot[palIdx] & 0x3F;

          const x = (tx << 3) | col;
          const y = (ty << 3) | row;
          if (x < NES_W && y < NES_H) {
            paletteIndexFrame[y * NES_W + x] = nesPaletteEntry;
          }
        }
      }
    }
  }

  blitNESFramePaletteIndex(paletteIndexFrame, NES_W, NES_H);

  // --- helpers ---
  function normalizePalette(p) {
    // Fix $3F10/$14/$18/$1C mirrors to match hardware rules.
    // (Some games accidentally write here; hardware treats them as mirrors)
    p[0x10] = p[0x00];
    p[0x14] = p[0x04];
    p[0x18] = p[0x08];
    p[0x1C] = p[0x0C];
    return p;
  }
}
