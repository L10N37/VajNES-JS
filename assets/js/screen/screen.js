// --- Screen boot + layers ---------------------------------------------------
// These globals are read by other files because of load order; no window.* here.

const systemScreen   = document.getElementById('system-screen-modal');
const grilleScreen   = document.getElementById('grille-screen-modal');
const scanlineScreen = document.getElementById('scanline-simulation-modal');
const blackScreen    = document.getElementById('black-screen-modal');

const canvas         = document.getElementById('screen-canvas');     // main picture
const grilleCanvas   = document.getElementById('grille-canvas');     // grille / masks
const scanlineCanvas = document.getElementById('scanline-canvas');   // scanline overlay

const ctx                = canvas.getContext('2d', { alpha: false });
const grille_ctx         = grilleCanvas.getContext('2d');
const scanlineCanvas_ctx = scanlineCanvas.getContext('2d');

// --- Test image (handy for tuning overlays when no ROM) ----------------------
const TEST_IMAGE_STATE = { enabled: false, img: null };

// NES base res
const BASE_W = 256;
const BASE_H = 240;
let scaleFactor = 2;

// Keep all scaling in one place so every layer stays the same size.
function applyScale() {
  const W = Math.round(BASE_W * scaleFactor);
  const H = Math.round(BASE_H * scaleFactor);

  // 1) Internal pixel size
  canvas.width = grilleCanvas.width = scanlineCanvas.width = W;
  canvas.height = grilleCanvas.height = scanlineCanvas.height = H;

  // 2) Shells follow
  systemScreen.style.width = grilleScreen.style.width = scanlineScreen.style.width = `${W}px`;
  systemScreen.style.height = grilleScreen.style.height = scanlineScreen.style.height = `${H}px`;

  // 3) Nearest-neighbour everywhere
  ctx.imageSmoothingEnabled = false;
  grille_ctx.imageSmoothingEnabled = false;
  scanlineCanvas_ctx.imageSmoothingEnabled = false;

  // If overlays depend on size, let them redraw without coupling files
  if (typeof _resyncScanlineOverlayAfterScale === 'function') _resyncScanlineOverlayAfterScale();
  if (typeof _resyncGrilleAfterScale === 'function') _resyncGrilleAfterScale();

  // If a test image is up, refit it
  if (TEST_IMAGE_STATE.enabled) drawTestImageFitted();
}

// Initial size
applyScale();

// --- Screen open/close (IDs + clicks as you do elsewhere) -------------------
const screenButton = document.getElementById('clickedScreen');
screenButton.addEventListener('click', () => {
  systemScreen.style.display   = 'block';
  grilleScreen.style.display   = 'block';
  blackScreen.style.display    = 'block';
  scanlineScreen.style.display = 'block';
  NoSignalAudio.setEnabled(true);
});
const paletteOption = systemScreen.querySelector('.optionsBar li:nth-child(3)');
if (paletteOption) {
  paletteOption.style.cursor = 'pointer';
  paletteOption.addEventListener('click', openPaletteModal);
}

function openPaletteModal() {
  // Destroy any existing instance
  const existing = document.getElementById('palette-modal');
  if (existing) existing.remove();

  // Modal shell
  const modal = document.createElement('div');
  modal.id = 'palette-modal';
  modal.className = 'palette-modal';
  modal.innerHTML = `
    <div class="palette-modal-backdrop"></div>
    <div class="palette-modal-box" role="dialog" aria-labelledby="paletteModalTitle">
      <div class="palette-modal-header">
        <h3 id="paletteModalTitle">Select Palette</h3>
        <button class="palette-close" aria-label="Close">&times;</button>
      </div>
      <div class="palette-modal-body">
        <label class="pal-opt"><input type="radio" name="palette" value="nesClassic" ${window.currentPaletteName === 'nesClassic' ? 'checked' : ''}> NES Classic</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fceuxDefault" ${window.currentPaletteName === 'fceuxDefault' ? 'checked' : ''}> FCEUX Default</label>
        <label class="pal-opt"><input type="radio" name="palette" value="smc2005" ${window.currentPaletteName === 'smc2005' ? 'checked' : ''}> SMC 2005</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxMagnum" ${window.currentPaletteName === 'fbxMagnum' ? 'checked' : ''}> FBX Magnum</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxSmooth" ${window.currentPaletteName === 'fbxSmooth' ? 'checked' : ''}> FBX Smooth</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxCompositeDirectFinal" ${window.currentPaletteName === 'fbxCompositeDirectFinal' ? 'checked' : ''}> FBX Composite Direct Final</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxVibrant" ${window.currentPaletteName === 'fbxVibrant' ? 'checked' : ''}> FBX Vibrant</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxSmoothBalancedGreys" ${window.currentPaletteName === 'fbxSmoothBalancedGreys' ? 'checked' : ''}> FBX Smooth Balanced Greys</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxNesClassic" ${window.currentPaletteName === 'fbxNesClassic' ? 'checked' : ''}> FBX NES Classic</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxYuvV3" ${window.currentPaletteName === 'fbxYuvV3' ? 'checked' : ''}> FBX YUV V3</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxUnsaturatedFinal" ${window.currentPaletteName === 'fbxUnsaturatedFinal' ? 'checked' : ''}> FBX Unsaturated Final</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxD93PvmStyle" ${window.currentPaletteName === 'fbxD93PvmStyle' ? 'checked' : ''}> FBX D93 PVM Style</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxD65PvmStyle" ${window.currentPaletteName === 'fbxD65PvmStyle' ? 'checked' : ''}> FBX D65 PVM Style</label>
        <label class="pal-opt"><input type="radio" name="palette" value="fbxOriginalHardware" ${window.currentPaletteName === 'fbxOriginalHardware' ? 'checked' : ''}> FBX Original Hardware</label>
      </div>
      <div class="palette-modal-footer">
        <button class="palette-apply">Apply</button>
        <button class="palette-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const backdrop = modal.querySelector('.palette-modal-backdrop');
  const closeBtn = modal.querySelector('.palette-close');
  const cancelBtn = modal.querySelector('.palette-cancel');
  const applyBtn = modal.querySelector('.palette-apply');

  function close() { modal.remove(); }

  // Apply: set palette + rebuild screen LUT
  applyBtn.addEventListener('click', () => {
    const sel = modal.querySelector('input[name="palette"]:checked');
    if (sel && typeof window.setCurrentPalette === 'function') {
      window.setCurrentPalette(sel.value);
    }
    if (typeof window._rebuildPaletteLUT === 'function') {
      window._rebuildPaletteLUT();
    }
    close();
  });

  // Cancel/close behaviors
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  }, { once: true });
}

const exitOption = systemScreen.querySelector('.optionsBar li:nth-child(5)');
exitOption.addEventListener('click', () => {
  systemScreen.style.display   = 'none';
  grilleScreen.style.display   = 'none';
  blackScreen.style.display    = 'none';
  scanlineScreen.style.display = 'none';
  NoSignalAudio.setEnabled(false);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    systemScreen.style.display   = 'none';
    grilleScreen.style.display   = 'none';
    blackScreen.style.display    = 'none';
    scanlineScreen.style.display = 'none';
    NoSignalAudio.setEnabled(false);
  }
});

// --- F2: quick cycle scales (2 → 3 → 4 → 5 → 5.4 → 2) -----------------------
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'F2') return;
  scaleFactor = (function next(f) {
    if (f === 2) return 3;
    if (f === 3) return 4;
    if (f === 4) return 5;
    if (f === 5) return 5.4;
    return 2;
  })(scaleFactor);
  applyScale();
});

// --- RF fuzz while nothing is rendered --------------------------------------
let requestId = 0;

function generateNoiseImageData(w, h) {
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return id;
}

function animate() {
  const id = generateNoiseImageData(canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'difference';
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.putImageData(id, 0, 0);
  requestId = requestAnimationFrame(animate);
}

function stopAnimation() {
  if (requestId) cancelAnimationFrame(requestId);
  requestId = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Start with fuzz; first real frame turns it off.
animate();

function drawTestImageFitted() {
  if (!TEST_IMAGE_STATE.enabled || !TEST_IMAGE_STATE.img) return;
  const img = TEST_IMAGE_STATE.img;

  // Keep aspect; letterbox as needed
  const sw = img.width, sh = img.height;
  const dw = canvas.width, dh = canvas.height;
  const sA = sw / sh, dA = dw / dh;

  let rw = dw, rh = Math.round(dw / sA);
  if (rh > dh) { rh = dh; rw = Math.round(dh * sA); }

  const dx = (dw - rw) >> 1;
  const dy = (dh - rh) >> 1;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, dw, dh);
  ctx.drawImage(img, 0, 0, sw, sh, dx, dy, rw, rh);
}

function enableTestImage(src) {
  stopAnimation();
  const img = new Image();
  img.onload = () => {
    TEST_IMAGE_STATE.enabled = true;
    TEST_IMAGE_STATE.img = img;
    drawTestImageFitted();
  };
  img.src = src;
}
function disableTestImage() {
  TEST_IMAGE_STATE.enabled = false;
  TEST_IMAGE_STATE.img = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  animate();
}

// --- New: palette-aware blit (0..63 indices → RGBA via currentPalette) ------
// Your emulator should push a Uint8Array of length (w*h) with NES palette indices.
// We expand to RGBA using the palette chosen in palettes.js (currentPalette).

let _firstRealFrameSeen = false;

// Little LUT so we don’t parse hex every pixel. Rebuilt on palette change.
let _PAL_BYTES = new Uint8ClampedArray(64 * 4);

function _hexToRgb(hex) {
  // Accept "#RRGGBB" (palettes.js uses that). If something weird, return black.
  if (!hex || hex[0] !== '#' || hex.length < 7) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(hex.slice(1, 3), 16) | 0,
    g: parseInt(hex.slice(3, 5), 16) | 0,
    b: parseInt(hex.slice(5, 7), 16) | 0
  };
}

function _rebuildPaletteLUT() {
  // currentPalette is defined in palettes.js (global by load order)
  const pal = (typeof currentPalette !== 'undefined') ? currentPalette : null;
  for (let i = 0; i < 64; i++) {
    const hex = pal && pal[i] ? pal[i] : '#000000';
    const { r, g, b } = _hexToRgb(hex);
    const p = i * 4;
    _PAL_BYTES[p] = r;
    _PAL_BYTES[p + 1] = g;
    _PAL_BYTES[p + 2] = b;
    _PAL_BYTES[p + 3] = 255;
  }
}

// Build once now…
_rebuildPaletteLUT();
// …and watch for palette radio changes (palettes.js already binds its own listeners; we piggyback)
document.querySelectorAll('input[name="palette"]').forEach(r => {
  r.addEventListener('change', _rebuildPaletteLUT);
});

// Offscreen scratch so we can scale with drawImage (no ctx.scale headaches)
function _ensureOffscreen(offObj, w, h) {
  if (!offObj.canvas) {
    offObj.canvas = document.createElement('canvas');
    offObj.ctx = offObj.canvas.getContext('2d', { alpha: false });
    offObj.img = null;
  }
  if (offObj.canvas.width !== w || offObj.canvas.height !== h) {
    offObj.canvas.width = w;
    offObj.canvas.height = h;
    offObj.img = offObj.ctx.createImageData(w, h);
  }
}

const _offRGBA = {};   // for blitNESFrameRGBA
const _offIndex = {};  // for blitNESFramePaletteIndex

// Path 1: RGBA frame (already expanded). Handy for quick tests or alt PPU paths.
function blitNESFrameRGBA(rgbaUint8ClampedArray, width = BASE_W, height = BASE_H) {
  if (!rgbaUint8ClampedArray || rgbaUint8ClampedArray.length !== width * height * 4) return;
  if (!_firstRealFrameSeen) { stopAnimation(); _firstRealFrameSeen = true; }

  _ensureOffscreen(_offRGBA, width, height);

  // put → scale
  const imgData = new ImageData(rgbaUint8ClampedArray, width, height);
  _offRGBA.ctx.putImageData(imgData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(_offRGBA.canvas, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
}

// Path 2: NES indices (0..63). This is the one you asked for.
function blitNESFramePaletteIndex(indexUint8Array, width = BASE_W, height = BASE_H) {
  if (!indexUint8Array || indexUint8Array.length !== width * height) return;
  if (!_firstRealFrameSeen) { stopAnimation(); _firstRealFrameSeen = true; }

  _ensureOffscreen(_offIndex, width, height);

  // Expand indices → RGBA using the LUT
  const out = _offIndex.img ? _offIndex.img.data : (_offIndex.img = _offIndex.ctx.createImageData(width, height)).data;
  for (let i = 0, p = 0; i < indexUint8Array.length; i++, p += 4) {
    const idx = indexUint8Array[i] & 0x3F;
    const q = idx * 4;
    out[p    ] = _PAL_BYTES[q    ];
    out[p + 1] = _PAL_BYTES[q + 1];
    out[p + 2] = _PAL_BYTES[q + 2];
    out[p + 3] = 255; // opaque
  }

  _offIndex.ctx.putImageData(_offIndex.img, 0, 0);

  // Scale to whatever size applyScale() set
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(_offIndex.canvas, 0, 0, width, height, 0, 0, canvas.width, canvas.height);

  // Remember last frame so palette changes can re-blit instantly
  window._lastIndexFrame = indexUint8Array;
  window._lastIndexSize  = { w: width, h: height };

}

// Small quality-of-life: a blur slider already exists
const slider = document.getElementById('composite-blur-slider');
slider.addEventListener('input', (event) => {
  const v = Math.min(Math.max(+event.target.value || 0, 0), 5);
  document.getElementById('screen-canvas').style.filter = `blur(${v.toFixed(1)}px)`;
});

function redrawWithCurrentPalette() {
  if (!window._lastIndexFrame || !window._lastIndexSize) return;
  if (typeof window._rebuildPaletteLUT === 'function') {
    window._rebuildPaletteLUT(); // Refresh internal colour table from palettes.js
  }
  const { w, h } = window._lastIndexSize;
  blitNESFramePaletteIndex(window._lastIndexFrame, w, h);
}
window.redrawWithCurrentPalette = redrawWithCurrentPalette;

// --- setup overlay ---
const fpsOverlay = document.createElement("div");
fpsOverlay.id = "fps-overlay";
fpsOverlay.style.position = "absolute";
fpsOverlay.style.top = "5px";
fpsOverlay.style.right = "10px";
fpsOverlay.style.color = "#0f0";
fpsOverlay.style.fontFamily = "monospace";
fpsOverlay.style.fontSize = "14px";
fpsOverlay.style.background = "rgba(0,0,0,0.5)";
fpsOverlay.style.padding = "2px 6px";
fpsOverlay.style.borderRadius = "4px";
fpsOverlay.style.display = "none"; // hidden by default
fpsOverlay.textContent = "FPS: 0"; // show 0 by default
systemScreen.appendChild(fpsOverlay);

// --- FPS tracking ---
let frameCount = 0;
let fps = 0;

// update FPS once per second
setInterval(() => {
  fps = frameCount;
  frameCount = 0;
  if (fpsOverlay.style.display !== "none") {
    fpsOverlay.textContent = `FPS: ${fps}`;
  }
}, 1000);

// whenever the system screen modal gets a frame update, call this:
function registerFrameUpdate() {
  frameCount++;
}

// --- toggle button ---
const fpsOption = systemScreen.querySelector(".optionsBar li:nth-child(4)");
fpsOption.addEventListener("click", () => {
  if (fpsOverlay.style.display === "none") {
    fpsOverlay.style.display = "block";
    fpsOverlay.textContent = "FPS: 0"; // reset display on show
  } else {
    fpsOverlay.style.display = "none";
  }
});
