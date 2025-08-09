// --- NES CHR Tile Viewer (Greyscale + Zoom) ---
document.addEventListener('DOMContentLoaded', () => {
  const openBtn  = document.getElementById('clickedTileView');
  const modal    = document.getElementById('tileModal');
  const closeBtn = document.getElementById('closeTileModal');

  // Per-canvas zoom state
  const zoomState = { bgCanvas: 1, fgCanvas: 1 };
  const ZMIN = 1, ZMAX = 8, ZSTEP = 1;

  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    try {
      if (!chrRom || !(chrRom instanceof Uint8Array) || chrRom.length === 0)
        throw new Error("CHR ROM is missing or empty.");

      // Initial draw at current zoom
      drawTilesToCanvas(chrRom, "bgCanvas", zoomState.bgCanvas);
      drawTilesToCanvas(chrRom, "fgCanvas", zoomState.fgCanvas);

      // Attach zoom controls once (idempotent)
      attachZoomControls("bgCanvas");
      attachZoomControls("fgCanvas");
    } catch (err) {
      console.error("[TileViewer] ERROR:", err.message);
      console.debug(err);
    }
  });

  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  window.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  function attachZoomControls(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (canvas.dataset.zoomBound === "1") return; // already bound
    canvas.dataset.zoomBound = "1";

    // Mouse wheel zoom (Ctrl not required)
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const dir = Math.sign(ev.deltaY); // down = positive
      const key = canvasId === "bgCanvas" ? "bgCanvas" : "fgCanvas";
      const oldZ = zoomState[key];
      const nextZ = clamp(oldZ - (dir * ZSTEP), ZMIN, ZMAX);
      if (nextZ !== oldZ) {
        zoomState[key] = nextZ;
        drawTilesToCanvas(chrRom, canvasId, nextZ);
      }
    }, { passive: false });

    // Double-click to reset
    canvas.addEventListener('dblclick', () => {
      const key = canvasId === "bgCanvas" ? "bgCanvas" : "fgCanvas";
      zoomState[key] = 1;
      drawTilesToCanvas(chrRom, canvasId, 1);
    });

    // Optional: keyboard + / - when canvas focused
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      if (e.key !== '+' && e.key !== '-' && e.key !== '=') return;
      const key = canvasId === "bgCanvas" ? "bgCanvas" : "fgCanvas";
      const oldZ = zoomState[key];
      const delta = (e.key === '-') ? -ZSTEP : ZSTEP;
      const nextZ = clamp(oldZ + delta, ZMIN, ZMAX);
      if (nextZ !== oldZ) {
        zoomState[key] = nextZ;
        drawTilesToCanvas(chrRom, canvasId, nextZ);
      }
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
});

// NES greys: 0=black, 3=white
const NES_GREYS = ["#181818", "#888888", "#c0c0c0", "#fcfcfc"];

// Draws all tiles in CHR-ROM as 8x8, 2bpp greyscale, with integer zoom
function drawTilesToCanvas(chrData, canvasId, zoom = 1) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d', { alpha: false });

  const tilesPerRow = 16;
  const tileSize = 8;
  const totalTiles = Math.floor(chrData.length / 16);

  // Base (1x) dimensions
  const baseW = tilesPerRow * tileSize;
  const baseH = Math.ceil(totalTiles / tilesPerRow) * tileSize;

  // Prepare offscreen base render
  const off = drawTilesImageData(chrData, baseW, baseH, tilesPerRow, tileSize);

  // Scale to visible canvas using nearest-neighbor
  canvas.width = baseW * zoom;
  canvas.height = baseH * zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, baseW, baseH, 0, 0, canvas.width, canvas.height);
}

function drawTilesImageData(chrData, baseW, baseH, tilesPerRow, tileSize) {
  // Render pixels at 1x to an offscreen canvas
  const off = document.createElement('canvas');
  off.width = baseW;
  off.height = baseH;
  const octx = off.getContext('2d', { alpha: false });
  const imageData = octx.createImageData(baseW, baseH);

  const totalTiles = Math.floor(chrData.length / 16);
  for (let i = 0; i < totalTiles; i++) {
    const tile = chrData.subarray(i * 16, i * 16 + 16); // no copy
    const pixels = decodeTile(tile);
    const tileX = (i % tilesPerRow) * tileSize;
    const tileY = Math.floor(i / tilesPerRow) * tileSize;

    for (let j = 0; j < 64; j++) {
      const x = tileX + (j % 8);
      const y = tileY + (j / 8) | 0;
      const pixelVal = pixels[j] & 0x03;
      const { r, g, b } = HEX_TO_RGB[NES_GREYS[pixelVal]];
      const idx = (y * baseW + x) * 4;
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
  }
  octx.putImageData(imageData, 0, 0);
  return off;
}

// Decodes a single NES 8x8 tile from 16 bytes (2bpp)
function decodeTile(tileBytes) {
  const pixels = new Uint8Array(64);
  for (let row = 0; row < 8; row++) {
    const p0 = tileBytes[row];
    const p1 = tileBytes[row + 8];
    for (let col = 0; col < 8; col++) {
      const bit0 = (p0 >> (7 - col)) & 1;
      const bit1 = (p1 >> (7 - col)) & 1;
      pixels[row * 8 + col] = (bit1 << 1) | bit0;
    }
  }
  return pixels;
}

// Tiny cached hex->rgb map to avoid repeated parseInt
const HEX_TO_RGB = (() => {
  const m = {};
  for (const hex of ["#181818", "#888888", "#c0c0c0", "#fcfcfc"]) {
    m[hex] = {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }
  return m;
})();
