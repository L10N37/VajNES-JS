// --- Screen boot + layers ---------------------------------------------------
// These globals are read by other files because of load order; no window.* here.

const systemScreen   = document.getElementById('system-screen-modal');
const grilleScreen   = document.getElementById('grille-screen-modal');
const scanlineScreen = document.getElementById('scanline-simulation-modal');
const blackScreen    = document.getElementById('black-screen-modal');

const canvas         = document.getElementById('screen-canvas');     // main picture
const grilleCanvas   = document.getElementById('grille-canvas');     // grille / masks
const scanlineCanvas = document.getElementById('scanline-canvas');   // scanline overlay

// Use desynchronized contexts for lower latency where supported.
const ctx                = canvas.getContext('2d', { alpha: false, desynchronized: true });
const grille_ctx         = grilleCanvas ? grilleCanvas.getContext('2d', { desynchronized: true }) : null;
const scanlineCanvas_ctx = scanlineCanvas ? scanlineCanvas.getContext('2d', { desynchronized: true }) : null;

// --- Test image (handy for tuning overlays when no ROM) ----------------------
const TEST_IMAGE_STATE = { enabled: false, img: null };

// NES base res
const BASE_W = 256;
const BASE_H = 240;
let scaleFactor = Number(localStorage.getItem('scaleFactor') || 2);

// --- Pixel Aspect options ----------------------------------------------------
const ASPECT = {
  SQUARE_1_1: 1.0,                         // Square pixels
  NTSC_8_7: 8 / 7,                         // Pixel-accurate NTSC
  PAL_16_15: 16 / 15,                      // Pixel-accurate PAL
  CRT_4_3: (4 / 3) / (BASE_W / BASE_H),    // Display 4:3 => 1.333... / (256/240) = 1.25
};

// Persisted mode (default to NTSC 8:7 unless saved)
let pixelAspectMode = localStorage.getItem('pixelAspectMode') || 'NTSC_8_7';
let pixelAspectX = ASPECT[pixelAspectMode] || ASPECT.NTSC_8_7;

function setPixelAspectMode(modeKey) {
  if (!ASPECT.hasOwnProperty(modeKey)) return;
  pixelAspectMode = modeKey;
  pixelAspectX = ASPECT[modeKey];
  localStorage.setItem('pixelAspectMode', pixelAspectMode);
  applyScale();
}


function applyScale() {
  const W = Math.round(BASE_W * scaleFactor);
  const H = Math.round(BASE_H * scaleFactor);

  
  canvas.width = W;
  canvas.height = H;
  if (grilleCanvas)   { grilleCanvas.width = W;   grilleCanvas.height = H; }
  if (scanlineCanvas) { scanlineCanvas.width = W; scanlineCanvas.height = H; }

  
  const displayW = Math.round(W * pixelAspectX);

  
  if (systemScreen) {
    systemScreen.style.width = `${displayW}px`;
    systemScreen.style.height = `${H}px`;
  }
  if (grilleScreen) {
    grilleScreen.style.width = `${displayW}px`;
    grilleScreen.style.height = `${H}px`;
  }
  if (scanlineScreen) {
    scanlineScreen.style.width = `${displayW}px`;
    scanlineScreen.style.height = `${H}px`;
  }

  
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${H}px`;
  if (grilleCanvas) {
    grilleCanvas.style.width = `${displayW}px`;
    grilleCanvas.style.height = `${H}px`;
  }
  if (scanlineCanvas) {
    scanlineCanvas.style.width = `${displayW}px`;
    scanlineCanvas.style.height = `${H}px`;
  }

  
  ctx.imageSmoothingEnabled = false;
  if (grille_ctx)         grille_ctx.imageSmoothingEnabled = false;
  if (scanlineCanvas_ctx)  scanlineCanvas_ctx.imageSmoothingEnabled = false;

  // If overlays depend on size, let them redraw without coupling files
  if (typeof _resyncScanlineOverlayAfterScale === 'function') _resyncScanlineOverlayAfterScale();
  if (typeof _resyncGrilleAfterScale === 'function') _resyncGrilleAfterScale();

  // If a test image is up, refit it
  if (TEST_IMAGE_STATE.enabled) drawTestImageFitted();

  // Persist scale factor for convenience
  localStorage.setItem('scaleFactor', String(scaleFactor));
}

// Initial size
applyScale();

const screenButton = document.getElementById('clickedScreen');
if (screenButton) {
  screenButton.addEventListener('click', () => {
    if (systemScreen)   systemScreen.style.display = 'block';
    if (grilleScreen)   grilleScreen.style.display = 'block';
    if (blackScreen)    blackScreen.style.display = 'block';
    if (scanlineScreen) scanlineScreen.style.display = 'block';
    NoSignalAudio.setEnabled(true);
  });
}

const paletteOption = systemScreen?.querySelector('.optionsBar li:nth-child(3)');
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

// --- Pixel Aspect Modal ------------------------------------------------------
const pixelOption = systemScreen?.querySelector('.optionsBar li:nth-child(4)');
if (pixelOption) {
  pixelOption.style.cursor = 'pointer';
  pixelOption.addEventListener('click', openPixelModal);
}

function openPixelModal() {
  // Destroy existing instance
  const existing = document.getElementById('pixel-modal');
  if (existing) existing.remove();

  const checked = (k) => (pixelAspectMode === k ? 'checked' : '');

  const modal = document.createElement('div');
  modal.id = 'pixel-modal';
  modal.className = 'pixel-modal';
  modal.innerHTML = `
    <div class="pixel-modal-backdrop"></div>
    <div class="pixel-modal-box" role="dialog" aria-labelledby="pixelModalTitle">
      <div class="pixel-modal-header">
        <h3 id="pixelModalTitle">Pixel Aspect</h3>
        <button class="pixel-close" aria-label="Close">&times;</button>
      </div>
      <div class="pixel-modal-body">
        <label class="px-opt"><input type="radio" name="pxaspect" value="SQUARE_1_1" ${checked('SQUARE_1_1')}> Square (1:1)</label>
        <label class="px-opt"><input type="radio" name="pxaspect" value="NTSC_8_7" ${checked('NTSC_8_7')}> NTSC (8:7)</label>
        <label class="px-opt"><input type="radio" name="pxaspect" value="PAL_16_15" ${checked('PAL_16_15')}> PAL (16:15)</label>
        <label class="px-opt"><input type="radio" name="pxaspect" value="CRT_4_3" ${checked('CRT_4_3')}> CRT 4:3 (Display)</label>
      </div>
      <div class="pixel-modal-footer">
        <button class="pixel-apply">Apply</button>
        <button class="pixel-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const backdrop = modal.querySelector('.pixel-modal-backdrop');
  const closeBtn = modal.querySelector('.pixel-close');
  const cancelBtn = modal.querySelector('.pixel-cancel');
  const applyBtn = modal.querySelector('.pixel-apply');

  function close() { modal.remove(); }

  applyBtn.addEventListener('click', () => {
    const sel = modal.querySelector('input[name="pxaspect"]:checked');
    if (sel) setPixelAspectMode(sel.value);
    close();
  });

  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  }, { once: true });
}

const exitOption = systemScreen?.querySelector('.optionsBar li:nth-child(6)');
if (exitOption) {
  exitOption.addEventListener('click', () => {
    if (systemScreen)   systemScreen.style.display   = 'none';
    if (grilleScreen)   grilleScreen.style.display   = 'none';
    if (blackScreen)    blackScreen.style.display    = 'none';
    if (scanlineScreen) scanlineScreen.style.display = 'none';
    if (typeof NoSignalAudio !== 'undefined' && NoSignalAudio && typeof NoSignalAudio.setEnabled === 'function') {
      NoSignalAudio.setEnabled(false);
    }
  });
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (systemScreen)   systemScreen.style.display   = 'none';
    if (grilleScreen)   grilleScreen.style.display   = 'none';
    if (blackScreen)    blackScreen.style.display    = 'none';
    if (scanlineScreen) scanlineScreen.style.display = 'none';
    if (typeof NoSignalAudio !== 'undefined' && NoSignalAudio && typeof NoSignalAudio.setEnabled === 'function') {
      NoSignalAudio.setEnabled(false);
    }
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

  // Keep aspect; letterbox as needed (into integer backing buffer)
  const sw = img.width, sh = img.height;
  const dw = canvas.width, dh = canvas.height;
  const sA = sw / sh, dA = dw / dh;

  let rw = dw, rh = Math.round(dw / sA);
  if (rh > dh) { rh = dh; rw = Math.round(dh * sA); }

  const dx = (dw - rw) >> 1;
  const dy = (dh - rh) >> 1;

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

// --- Palette-aware blit (0..63 indices → RGBA via currentPalette) -----------

let _firstRealFrameSeen = false;

// --- Palette LUTs (byte + packed 32b) --------------------------------------
const _LITTLE_ENDIAN = (() => {
  const b = new ArrayBuffer(4);
  new DataView(b).setUint32(0, 0x0a0b0c0d, true);
  return new Uint8Array(b)[0] === 0x0d;
})();

let _PAL_BYTES = new Uint8ClampedArray(64 * 4);
let _PAL_U32   = new Uint32Array(64);

function _hexToRgb(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(hex.slice(1, 3), 16) | 0,
    g: parseInt(hex.slice(3, 5), 16) | 0,
    b: parseInt(hex.slice(5, 7), 16) | 0
  };
}

function _rebuildPaletteLUT() {
  const pal = (typeof currentPalette !== 'undefined') ? currentPalette : null;
  for (let i = 0; i < 64; i++) {
    const hex = pal && pal[i] ? pal[i] : '#000000';
    const { r, g, b } = _hexToRgb(hex);
    const p = i * 4;
    _PAL_BYTES[p    ] = r;
    _PAL_BYTES[p + 1] = g;
    _PAL_BYTES[p + 2] = b;
    _PAL_BYTES[p + 3] = 255;

    _PAL_U32[i] = _LITTLE_ENDIAN
      ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
  }
}

// Build once now…
_rebuildPaletteLUT();
// …and watch for palette radio changes (palettes.js may also bind its own listeners)
document.querySelectorAll('input[name="palette"]').forEach(r => {
  r.addEventListener('change', _rebuildPaletteLUT);
});

// Offscreen scratch so we can scale with drawImage (no ctx.scale headaches)
function _ensureOffscreen(offObj, w, h) {
  if (!offObj.canvas) {
    offObj.canvas = document.createElement('canvas');
    offObj.ctx    = offObj.canvas.getContext('2d', { alpha: false });
    offObj.img    = null;
    offObj._out32 = null; // cached Uint32 view over img.data.buffer
  }
  if (offObj.canvas.width !== w || offObj.canvas.height !== h) {
    offObj.canvas.width  = w;
    offObj.canvas.height = h;
    offObj.img           = offObj.ctx.createImageData(w, h);
    offObj._out32        = null; // buffer changed; refresh next blit
  }
}

const _offRGBA = {};   // for blitNESFrameRGBA
const _offIndex = {};  // for blitNESFramePaletteIndex

function blitNESFrameRGBA(rgbaUint8ClampedArray, width = BASE_W, height = BASE_H) {
  if (!rgbaUint8ClampedArray || rgbaUint8ClampedArray.length !== width * height * 4) return;
  if (!_firstRealFrameSeen) { stopAnimation(); _firstRealFrameSeen = true; }

  _ensureOffscreen(_offRGBA, width, height);

  const imgData = new ImageData(rgbaUint8ClampedArray, width, height);
  _offRGBA.ctx.putImageData(imgData, 0, 0);

  ctx.drawImage(_offRGBA.canvas, 0, 0, width, height, 0, 0, canvas.width, canvas.height);

  if (typeof registerFrameUpdate === 'function') registerFrameUpdate();
}

// Path 2 (FAST): NES indices (0..63) → RGBA via packed Uint32 LUT.
function blitNESFramePaletteIndex(indexUint8Array, width = BASE_W, height = BASE_H) {
  if (!indexUint8Array || indexUint8Array.length !== width * height) return;
  if (!_firstRealFrameSeen) { stopAnimation(); _firstRealFrameSeen = true; }

  _ensureOffscreen(_offIndex, width, height);

  let out32 = _offIndex._out32;
  if (!out32 || out32.length !== indexUint8Array.length) {
    out32 = _offIndex._out32 = new Uint32Array(_offIndex.img.data.buffer);
  }

  const src = indexUint8Array;
  const pal = _PAL_U32;
  const n   = src.length;

  for (let i = 0; i < n; i++) {
    out32[i] = pal[src[i] & 0x3F];
  }

  _offIndex.ctx.putImageData(_offIndex.img, 0, 0);

  ctx.drawImage(_offIndex.canvas, 0, 0, width, height, 0, 0, canvas.width, canvas.height);

  window._lastIndexFrame = indexUint8Array;
  window._lastIndexSize  = { w: width, h: height };

  if (typeof registerFrameUpdate === 'function') registerFrameUpdate();
}

// Blur slider remains
const slider = document.getElementById('composite-blur-slider');
if (slider) {
  slider.addEventListener('input', (event) => {
    const v = Math.min(Math.max(+event.target.value || 0, 0), 5);
    document.getElementById('screen-canvas').style.filter = `blur(${v.toFixed(1)}px)`;
  });
}

function redrawWithCurrentPalette() {
  if (!window._lastIndexFrame || !window._lastIndexSize) return;
  if (typeof window._rebuildPaletteLUT === 'function') {
    window._rebuildPaletteLUT(); // Refresh internal colour table from palettes.js
  }
  const { w, h } = window._lastIndexSize;
  blitNESFramePaletteIndex(window._lastIndexFrame, w, h);
}
window.redrawWithCurrentPalette = redrawWithCurrentPalette;

// --- FPS overlay -------------------------------------------------------------
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
fpsOverlay.textContent = "FPS: 0";
systemScreen.appendChild(fpsOverlay);

// FPS tracking
let frameCount = 0;
let fps = 0;

setInterval(() => {
  fps = frameCount;
  frameCount = 0;
  if (fpsOverlay.style.display !== "none") {
    fpsOverlay.textContent = `FPS: ${fps}`;
  }
}, 1000);

function registerFrameUpdate() {
  frameCount++;
}
window.registerFrameUpdate = registerFrameUpdate;


const fpsOption = systemScreen?.querySelector(".optionsBar li:nth-child(5)");
if (fpsOption) {
  fpsOption.addEventListener("click", () => {
    if (fpsOverlay.style.display === "none") {
      fpsOverlay.style.display = "block";
      fpsOverlay.textContent = "FPS: 0";
    } else {
      fpsOverlay.style.display = "none";
    }
  });
}
