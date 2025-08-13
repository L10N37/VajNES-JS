// --- NES CHR Tile Viewer (Greyscale + Zoom) ---
document.addEventListener('DOMContentLoaded', () => {
  const openBtn  = document.getElementById('clickedTileView');
  const modal    = document.getElementById('tileModal');
  const closeBtn = document.getElementById('closeTileModal');

  const zoomState = { bgCanvas: 1, fgCanvas: 1 };
  const currentSource = { bgCanvas: null, fgCanvas: null };
  const ZMIN = 1, ZMAX = 8, ZSTEP = 1;

  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    try {
      if (!SHARED.CHR_ROM || !(SHARED.CHR_ROM instanceof Uint8Array) || SHARED.CHR_ROM.length === 0)
        throw new Error("CHR ROM is missing or empty.");

      // Slice the ROM into two halves
      const bgData  = SHARED.CHR_ROM.subarray(0x0000, 0x1000); // first 4KB
      const sprData = SHARED.CHR_ROM.subarray(0x1000, 0x2000); // second 4KB

      // Store sources for zoom/dblclick redraw
      currentSource.bgCanvas = bgData;
      currentSource.fgCanvas = sprData;

      // Draw each pane
      drawTilesToCanvas(bgData,  "bgCanvas", zoomState.bgCanvas);
      drawTilesToCanvas(sprData, "fgCanvas", zoomState.fgCanvas);

      // Bind zoom once
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
    if (canvas.dataset.zoomBound === "1") return;
    canvas.dataset.zoomBound = "1";

    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const dir = Math.sign(ev.deltaY);
      const key = canvasId;
      const oldZ = zoomState[key];
      const nextZ = clamp(oldZ - (dir * ZSTEP), ZMIN, ZMAX);
      if (nextZ !== oldZ) {
        zoomState[key] = nextZ;
        drawTilesToCanvas(currentSource[key], canvasId, nextZ);
      }
    }, { passive: false });

    canvas.addEventListener('dblclick', () => {
      const key = canvasId;
      zoomState[key] = 1;
      drawTilesToCanvas(currentSource[key], canvasId, 1);
    });

    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      if (e.key !== '+' && e.key !== '-' && e.key !== '=') return;
      const key = canvasId;
      const oldZ = zoomState[key];
      const delta = (e.key === '-') ? -ZSTEP : ZSTEP;
      const nextZ = clamp(oldZ + delta, ZMIN, ZMAX);
      if (nextZ !== oldZ) {
        zoomState[key] = nextZ;
        drawTilesToCanvas(currentSource[key], canvasId, nextZ);
      }
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
});

const NES_GREYS = ["#181818", "#888888", "#c0c0c0", "#fcfcfc"];

function drawTilesToCanvas(chrData, canvasId, zoom = 1) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d', { alpha: false });

  const tilesPerRow = 16;
  const tileSize = 8;
  const totalTiles = Math.floor(chrData.length / 16);

  const baseW = tilesPerRow * tileSize;
  const baseH = Math.ceil(totalTiles / tilesPerRow) * tileSize;

  const off = drawTilesImageData(chrData, baseW, baseH, tilesPerRow, tileSize);

  canvas.width = baseW * zoom;
  canvas.height = baseH * zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, baseW, baseH, 0, 0, canvas.width, canvas.height);
}

function drawTilesImageData(chrData, baseW, baseH, tilesPerRow, tileSize) {
  const off = document.createElement('canvas');
  off.width = baseW;
  off.height = baseH;
  const octx = off.getContext('2d', { alpha: false });
  const imageData = octx.createImageData(baseW, baseH);

  const totalTiles = Math.floor(chrData.length / 16);
  for (let i = 0; i < totalTiles; i++) {
    const tile = chrData.subarray(i * 16, i * 16 + 16);
    const pixels = decodeTile(tile);
    const tileX = (i % tilesPerRow) * tileSize;
    const tileY = Math.floor(i / tilesPerRow) * tileSize;

    for (let j = 0; j < 64; j++) {
      const x = tileX + (j % 8);
      const y = tileY + (j / 8) | 0;
      const pixelVal = pixels[j] & 0x03;
      const { r, g, b } = HEX_TO_RGB[NES_GREYS[pixelVal]];
      const idx = (y * baseW + x) * 4;
      imageData.data[idx]     = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
  }
  octx.putImageData(imageData, 0, 0);
  return off;
}

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
