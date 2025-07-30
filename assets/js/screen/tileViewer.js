// tile view modal and tile drawing logic

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('clickedTileView');
  const modal = document.getElementById('tileModal');
  const closeBtn = document.getElementById('closeTileModal');

  openBtn.addEventListener('click', () => {
    console.log("[TileViewer] Button clicked.");
    modal.style.display = 'flex';

    try {
      if (!isRomLoaded) throw new Error("ROM not loaded (isRomLoaded is false)");
      if (!loadedROM || !(loadedROM instanceof Uint8Array)) throw new Error("loadedROM is missing or not a Uint8Array");

      console.log("[TileViewer] ROM size (bytes):", loadedROM.length);

      const chrData = extractCHRData(loadedROM);
      if (!chrData || chrData.length === 0) throw new Error("CHR data is missing or empty.");

      console.log("[TileViewer] CHR data length:", chrData.length);

      drawTilesToCanvas(chrData, "bgCanvas");
      drawTilesToCanvas(chrData, "fgCanvas");

      console.log("[TileViewer] Tile draw complete.");
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

function extractCHRData(romData) {
  const header = window.lastNesHeader;
  if (!header || !(header instanceof Uint8Array) || header.length < 16) {
    console.error("NES header not available or invalid. Cannot extract CHR.");
    return null;
  }

  const prgCount = header[4];
  const chrCount = header[5];
  const prgSize = prgCount * 16 * 1024;
  const chrSize = chrCount * 8 * 1024;
  const chrStart = prgSize;
  const chrEnd = chrStart + chrSize;

  if (romData.length < chrEnd) {
    console.warn(`[extractCHRData] ROM too small. Expected at least ${chrEnd} bytes, got ${romData.length}.`);
    return null;
  }

  console.log(`[extractCHRData] CHR offset range: ${chrStart} - ${chrEnd}`);
  return romData.slice(chrStart, chrEnd);
}

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

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  };
}

function drawTilesToCanvas(chrData, canvasId) {
  const fallbackColors = ["#AAAAAA", "#CCCCCC", "#EEEEEE", "#FFFFFF"];
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const tilesPerRow = 16;
  const tileSize = 8;
  const totalTiles = Math.floor(chrData.length / 16);

  canvas.width = tilesPerRow * tileSize;
  canvas.height = Math.ceil(totalTiles / tilesPerRow) * tileSize;

  const imageData = ctx.createImageData(canvas.width, canvas.height);

  // Check if palette RAM at $3F00 is loaded (non-zero)
  const firstPaletteByte = memoryRead(0x3F01);
  const useColor = firstPaletteByte !== 0;
  console.log(`[TileViewer] Palette loaded: ${useColor ? 'yes' : 'no'} (first byte = 0x${firstPaletteByte.toString(16).padStart(2,'0')})`);

  for (let i = 0; i < totalTiles; i++) {
    const tile = chrData.slice(i * 16, i * 16 + 16);
    const pixels = decodeTile(tile);
    const tileX = (i % tilesPerRow) * tileSize;
    const tileY = Math.floor(i / tilesPerRow) * tileSize;

    for (let j = 0; j < 64; j++) {
      const x = tileX + (j % 8);
      const y = tileY + Math.floor(j / 8);
      const pixelVal = pixels[j] & 0x03;

      let colorHex;
      if (useColor) {
        const paletteByte = memoryRead(0x3F00 + pixelVal);
        const mapped = getColorForNESByte(paletteByte);
        colorHex = mapped || fallbackColors[pixelVal];
      } else {
        colorHex = fallbackColors[pixelVal];
      }

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
