// --- NES CHR Tile Viewer (Greyscale Only) ---
// Always reads tiles from global chrRom (null if not present)
// No palette, just greyscale

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('clickedTileView');
  const modal = document.getElementById('tileModal');
  const closeBtn = document.getElementById('closeTileModal');

  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    try {
      if (!chrRom || !(chrRom instanceof Uint8Array) || chrRom.length === 0)
        throw new Error("CHR ROM is missing or empty.");

      drawTilesToCanvas(chrRom, "bgCanvas");
      drawTilesToCanvas(chrRom, "fgCanvas");
    } catch (err) {
      console.error("[TileViewer] ERROR:", err.message);
      console.debug(err);
    }
  });

  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  window.addEventListener('click', e => {
    if (e.target === modal) modal.style.display = 'none';
  });
});

// NES greys: 0=black, 3=white
const NES_GREYS = ["#181818", "#888888", "#c0c0c0", "#fcfcfc"];

// Draws all tiles in CHR-ROM as 8x8, 2bpp greyscale
function drawTilesToCanvas(chrData, canvasId) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const tilesPerRow = 16;
  const tileSize = 8;
  const totalTiles = Math.floor(chrData.length / 16);

  canvas.width = tilesPerRow * tileSize;
  canvas.height = Math.ceil(totalTiles / tilesPerRow) * tileSize;
  const imageData = ctx.createImageData(canvas.width, canvas.height);

  for (let i = 0; i < totalTiles; i++) {
    const tile = chrData.slice(i * 16, i * 16 + 16);
    const pixels = decodeTile(tile);
    const tileX = (i % tilesPerRow) * tileSize;
    const tileY = Math.floor(i / tilesPerRow) * tileSize;

    for (let j = 0; j < 64; j++) {
      const x = tileX + (j % 8);
      const y = tileY + Math.floor(j / 8);
      const pixelVal = pixels[j] & 0x03;
      const colorHex = NES_GREYS[pixelVal];
      const { r, g, b } = hexToRgb(colorHex);
      const idx = (y * canvas.width + x) * 4;
      imageData.data[idx    ] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// Decodes a single NES 8x8 tile from 16 bytes (2bpp)
function decodeTile(tileBytes) {
  const pixels = [];
  for (let row = 0; row < 8; row++) {
    const plane1 = tileBytes[row];
    const plane2 = tileBytes[row + 8];
    for (let col = 0; col < 8; col++) {
      const bit0 = (plane1 >> (7 - col)) & 1;
      const bit1 = (plane2 >> (7 - col)) & 1;
      pixels.push((bit1 << 1) | bit0);
    }
  }
  return pixels;
}

// Converts "#RRGGBB" hex to {r,g,b}
function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  };
}
