function quickRenderNametable0() {
  const NES_W = 256, NES_H = 240;
  const bgPatternBase = (PPUCTRL & 0x10) ? 0x1000 : 0x0000; // pattern table select

  for (let ty = 0; ty < 30; ty++) {
    for (let tx = 0; tx < 32; tx++) {
      const ntIndex = ty * 32 + tx;
      const tileIndex = VRAM[ntIndex]; // $2000–$23FF → VRAM[0..959]

      // Attribute table entry ($23C0–$23FF → VRAM[0x3C0..0x3FF])
      const atIndex = 0x3C0 + ((ty >> 2) * 8) + (tx >> 2);
      const atByte = VRAM[atIndex];
      const shift = ((ty & 2) << 1) | (tx & 2);
      const paletteNum = (atByte >> shift) & 3;

      // Tile fetch from CHR ROM
      for (let row = 0; row < 8; row++) {
        const base = bgPatternBase + tileIndex * 16;
        const lo = CHR_ROM[base + row];
        const hi = CHR_ROM[base + row + 8];

        for (let col = 0; col < 8; col++) {
          const bit0 = (lo >> (7 - col)) & 1;
          const bit1 = (hi >> (7 - col)) & 1;
          const colorIdx = (bit1 << 1) | bit0;

          let palByte;
          if (colorIdx === 0) {
            palByte = PALETTE_RAM[0]; // universal BG color
          } else {
            palByte = PALETTE_RAM[(paletteNum << 2) + colorIdx];
          }

          const x = tx * 8 + col;
          const y = ty * 8 + row;
          if (x < NES_W && y < NES_H) {
            paletteIndexFrame[y * NES_W + x] = palByte & 0x3F;
          }
        }
      }
    }
  }

  blitNESFramePaletteIndex(paletteIndexFrame, NES_W, NES_H);
}
