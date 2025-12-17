// --- Screen boot + layers ---------------------------------------------------
// These globals are read by other files because of load order; no window.* here.

const systemScreen   = document.getElementById('system-screen-modal');
const grilleScreen   = document.getElementById('grille-screen-modal');
const scanlineScreen = document.getElementById('scanline-simulation-modal');
const blackScreen    = document.getElementById('black-screen-modal');

const canvas         = document.getElementById('screen-canvas');     // main picture (WEBGL now)
const grilleCanvas   = document.getElementById('grille-canvas');     // grille / masks
const scanlineCanvas = document.getElementById('scanline-canvas');   // scanline overlay

// 2D contexts remain for overlays only (grille + scanlines)
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
  SQUARE_1_1: 1.0,
  NTSC_8_7: 8 / 7,
  PAL_16_15: 16 / 15,
  CRT_4_3: (4 / 3) / (BASE_W / BASE_H),
};

let pixelAspectMode = localStorage.getItem('pixelAspectMode') || 'NTSC_8_7';
let pixelAspectX = ASPECT[pixelAspectMode] || ASPECT.NTSC_8_7;

function setPixelAspectMode(modeKey) {
  if (!ASPECT.hasOwnProperty(modeKey)) return;
  pixelAspectMode = modeKey;
  pixelAspectX = ASPECT[modeKey];
  localStorage.setItem('pixelAspectMode', pixelAspectMode);
  applyScale();
}

// ---------------------------------------------------------------------------
// WebGL presenter: uploads RGBA and draws a full-screen quad (nearest)
// ---------------------------------------------------------------------------

let GL = null;                // WebGLRenderingContext
let _glReady = false;

let _prog = null;
let _vb = null;

let _aPos = -1;
let _aUV  = -1;
let _uTex = null;
let _uMode = null;
let _uTime = null;
let _uSrcSize = null;

let _texFrame = null;

let _srcW = BASE_W;
let _srcH = BASE_H;

// staging RGBA (heap, not shared)
let _stageBytes = null;
let _stageU32   = null;
let _stagePixels = 0;

function _glCompile(type, src) {
  const s = GL.createShader(type);
  GL.shaderSource(s, src);
  GL.compileShader(s);
  if (!GL.getShaderParameter(s, GL.COMPILE_STATUS)) {
    console.error("[webgl] shader error:", GL.getShaderInfoLog(s));
    GL.deleteShader(s);
    return null;
  }
  return s;
}

function _glLink(vsSrc, fsSrc) {
  const vs = _glCompile(GL.VERTEX_SHADER, vsSrc);
  const fs = _glCompile(GL.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;

  const p = GL.createProgram();
  GL.attachShader(p, vs);
  GL.attachShader(p, fs);
  GL.linkProgram(p);

  GL.deleteShader(vs);
  GL.deleteShader(fs);

  if (!GL.getProgramParameter(p, GL.LINK_STATUS)) {
    console.error("[webgl] link error:", GL.getProgramInfoLog(p));
    GL.deleteProgram(p);
    return null;
  }
  return p;
}

function initWebGL() {
  if (!canvas) return false;

  GL = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false
  }) || canvas.getContext('experimental-webgl', {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false
  });

  if (!GL) {
    console.warn("[webgl] WebGL unavailable (falling back to 2D fuzz only)");
    _glReady = false;
    return false;
  }

  const vsSrc = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // u_mode: 0 = fuzz, 1 = show texture
  // "clean RF": frame-stepped noise, not continuous sparkling
  const fsSrc = `
    precision mediump float;
    varying vec2 v_uv;

    uniform sampler2D u_tex;
    uniform float u_mode;
    uniform float u_time;
    uniform vec2 u_srcSize;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      if (u_mode < 0.5) {
        // stable per-frame noise
        float frame = floor(u_time * 60.0); // 60Hz-ish
        vec2 p = v_uv * u_srcSize;
        float n = hash(p + vec2(frame, frame * 0.37));
        // slight contrast curve to look more "RF"
        n = n * n * (3.0 - 2.0 * n);
        gl_FragColor = vec4(n, n, n, 1.0);
      } else {
        gl_FragColor = texture2D(u_tex, v_uv);
      }
    }
  `;

  _prog = _glLink(vsSrc, fsSrc);
  if (!_prog) {
    _glReady = false;
    return false;
  }

  const quad = new Float32Array([
    // x, y,   u, v
    -1, -1,   0, 1,
     1, -1,   1, 1,
    -1,  1,   0, 0,

    -1,  1,   0, 0,
     1, -1,   1, 1,
     1,  1,   1, 0,
  ]);

  _vb = GL.createBuffer();
  GL.bindBuffer(GL.ARRAY_BUFFER, _vb);
  GL.bufferData(GL.ARRAY_BUFFER, quad, GL.STATIC_DRAW);

  GL.useProgram(_prog);

  _aPos = GL.getAttribLocation(_prog, "a_pos");
  _aUV  = GL.getAttribLocation(_prog, "a_uv");
  _uTex = GL.getUniformLocation(_prog, "u_tex");
  _uMode = GL.getUniformLocation(_prog, "u_mode");
  _uTime = GL.getUniformLocation(_prog, "u_time");
  _uSrcSize = GL.getUniformLocation(_prog, "u_srcSize");

  _texFrame = GL.createTexture();
  GL.activeTexture(GL.TEXTURE0);
  GL.bindTexture(GL.TEXTURE_2D, _texFrame);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 0);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);

  // allocate initial texture to avoid "lazy init" stalls
  const zero = new Uint8Array(BASE_W * BASE_H * 4);
  GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, BASE_W, BASE_H, 0, GL.RGBA, GL.UNSIGNED_BYTE, zero);

  GL.disable(GL.DEPTH_TEST);
  GL.disable(GL.CULL_FACE);
  GL.disable(GL.BLEND);

  GL.clearColor(0, 0, 0, 1);

  _srcW = BASE_W;
  _srcH = BASE_H;

  _glReady = true;
  console.debug("[webgl] ready");
  return true;
}

function _glDraw(mode /*0 fuzz, 1 frame*/, timeSec) {
  if (!_glReady) return;

  GL.useProgram(_prog);
  GL.bindBuffer(GL.ARRAY_BUFFER, _vb);

  GL.enableVertexAttribArray(_aPos);
  GL.enableVertexAttribArray(_aUV);
  GL.vertexAttribPointer(_aPos, 2, GL.FLOAT, false, 16, 0);
  GL.vertexAttribPointer(_aUV,  2, GL.FLOAT, false, 16, 8);

  GL.activeTexture(GL.TEXTURE0);
  GL.bindTexture(GL.TEXTURE_2D, _texFrame);

  GL.uniform1i(_uTex, 0);
  GL.uniform1f(_uMode, mode ? 1.0 : 0.0);
  GL.uniform1f(_uTime, timeSec || 0.0);
  GL.uniform2f(_uSrcSize, _srcW, _srcH);

  GL.viewport(0, 0, canvas.width, canvas.height);

  // important: clear so we never show stale garbage / uninitialized buffer
  GL.clear(GL.COLOR_BUFFER_BIT);

  GL.drawArrays(GL.TRIANGLES, 0, 6);
}

// --- Scaling / sizing --------------------------------------------------------
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

  if (grille_ctx)          grille_ctx.imageSmoothingEnabled = false;
  if (scanlineCanvas_ctx)  scanlineCanvas_ctx.imageSmoothingEnabled = false;

  if (typeof _resyncScanlineOverlayAfterScale === 'function') _resyncScanlineOverlayAfterScale();
  if (typeof _resyncGrilleAfterScale === 'function') _resyncGrilleAfterScale();

  if (TEST_IMAGE_STATE.enabled) drawTestImageFitted();

  localStorage.setItem('scaleFactor', String(scaleFactor));
}

// Init GL first, then scale (prevents any "before init" references)
initWebGL();
applyScale();

// --- default, screen on, click screen to close/ hide -------------------------
const screenButton = document.getElementById('clickedScreen');
if (screenButton) {
  let screenVisible = true;

  if (systemScreen)   systemScreen.style.display = 'block';
  if (grilleScreen)   grilleScreen.style.display = 'block';
  if (blackScreen)    blackScreen.style.display = 'block';
  if (scanlineScreen) scanlineScreen.style.display = 'block';
  NoSignalAudio.setEnabled(true);

  screenButton.addEventListener('click', () => {
    screenVisible = !screenVisible;

    if (systemScreen)   systemScreen.style.display = screenVisible ? 'block' : 'none';
    if (grilleScreen)   grilleScreen.style.display = screenVisible ? 'block' : 'none';
    if (blackScreen)    blackScreen.style.display = screenVisible ? 'block' : 'none';
    if (scanlineScreen) scanlineScreen.style.display = screenVisible ? 'block' : 'none';
    NoSignalAudio.setEnabled(screenVisible);
  });
}

// --- Palette-aware blit (0..63 indices → RGBA via currentPalette) -----------

let _firstRealFrameSeen = false;

// IMPORTANT: if currentPalette isn't ready yet, DON'T build an all-black LUT.
// We'll keep a non-black fallback so frames are never black unless data really is.
const _LITTLE_ENDIAN = (() => {
  const b = new ArrayBuffer(4);
  new DataView(b).setUint32(0, 0x0a0b0c0d, true);
  return new Uint8Array(b)[0] === 0x0d;
})();

let _PAL_BYTES = new Uint8ClampedArray(64 * 4);
let _PAL_U32   = new Uint32Array(64);
let _palEverNonFallback = false;

function _hexToRgb(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(hex.slice(1, 3), 16) | 0,
    g: parseInt(hex.slice(3, 5), 16) | 0,
    b: parseInt(hex.slice(5, 7), 16) | 0
  };
}

function _buildFallbackPalette() {
  // simple grayscale ramp (NOT black) so you always see picture data
  for (let i = 0; i < 64; i++) {
    const v = ((i / 63) * 255) | 0;
    const p = i * 4;
    _PAL_BYTES[p    ] = v;
    _PAL_BYTES[p + 1] = v;
    _PAL_BYTES[p + 2] = v;
    _PAL_BYTES[p + 3] = 255;

    const r = v, g = v, b = v;
    _PAL_U32[i] = _LITTLE_ENDIAN
      ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
  }
}

function _rebuildPaletteLUT() {
  const pal = (typeof window !== 'undefined' && window.currentPalette) ? window.currentPalette : null;

  if (!pal) {
    // If we never got a real palette yet, keep fallback (visible).
    if (!_palEverNonFallback) _buildFallbackPalette();
    return;
  }

  for (let i = 0; i < 64; i++) {
    const hex = pal[i] ? pal[i] : '#000000';
    const rgb = _hexToRgb(hex);
    const r = rgb.r | 0, g = rgb.g | 0, b = rgb.b | 0;

    const p = i * 4;
    _PAL_BYTES[p    ] = r;
    _PAL_BYTES[p + 1] = g;
    _PAL_BYTES[p + 2] = b;
    _PAL_BYTES[p + 3] = 255;

    _PAL_U32[i] = _LITTLE_ENDIAN
      ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
  }

  _palEverNonFallback = true;
}

// build once now (fallback if palette not ready yet)
_rebuildPaletteLUT();
window._rebuildPaletteLUT = _rebuildPaletteLUT;

// FPS mark (no Atomics here)
let _fpsLastFrame = -1;
function _fpsMarkIfNewFrame() {
  if (typeof SHARED === 'undefined' || !SHARED || !SHARED.SYNC) return;
  const f = (SHARED.SYNC[4] | 0);
  if (f !== _fpsLastFrame) {
    _fpsLastFrame = f;
    registerFrameUpdate();
  }
}
window._fpsMarkIfNewFrame = _fpsMarkIfNewFrame;

// ---------------------------------------------------------------------------
// RF fuzz while nothing is rendered
// ---------------------------------------------------------------------------
let requestId = 0;

function animateFuzz(t) {
  if (_glReady && !_firstRealFrameSeen) {
    _glDraw(0, (t || 0) * 0.001);
  }
  requestId = requestAnimationFrame(animateFuzz);
}

function stopAnimation() {
  if (requestId) cancelAnimationFrame(requestId);
  requestId = 0;
}

// Start with fuzz; first real frame turns it off.
requestId = requestAnimationFrame(animateFuzz);

// ---------------------------------------------------------------------------
// Blitters
// ---------------------------------------------------------------------------

function blitNESFrameRGBA(srcRGBA, w = BASE_W, h = BASE_H) {
  // optional future path
}

function blitNESFramePaletteIndex(indexUint8Array, width = BASE_W, height = BASE_H) {
  if (!indexUint8Array || indexUint8Array.length !== width * height) return;

  _fpsMarkIfNewFrame();

  if (!_firstRealFrameSeen) { stopAnimation(); _firstRealFrameSeen = true; }

  if (!_glReady) return;

  // if palette becomes available later, use it (prevents "all-black LUT built too early")
  if (!_palEverNonFallback && typeof window !== 'undefined' && window.currentPalette) {
    _rebuildPaletteLUT();
  }

  const nPix = (width * height) | 0;

  if (!_stageBytes || _stagePixels !== nPix) {
    _stagePixels = nPix;
    _stageBytes = new Uint8Array(nPix * 4);
    _stageU32   = new Uint32Array(_stageBytes.buffer);
  }

  const out32 = _stageU32;
  const pal32 = _PAL_U32;

  for (let i = 0; i < nPix; i++) {
    out32[i] = pal32[indexUint8Array[i] & 0x3F];
  }

  GL.activeTexture(GL.TEXTURE0);
  GL.bindTexture(GL.TEXTURE_2D, _texFrame);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 0);

  if (_srcW !== (width|0) || _srcH !== (height|0)) {
    _srcW = width|0;
    _srcH = height|0;
    GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, _srcW, _srcH, 0, GL.RGBA, GL.UNSIGNED_BYTE, _stageBytes);
  } else {
    GL.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, _srcW, _srcH, GL.RGBA, GL.UNSIGNED_BYTE, _stageBytes);
  }

  _glDraw(1, performance.now() * 0.001);

  window._lastIndexFrame = indexUint8Array;
  window._lastIndexSize  = { w: width, h: height };

  if (typeof registerFrameUpdate === 'function') registerFrameUpdate();
}

window.blitNESFrameRGBA = blitNESFrameRGBA;
window.blitNESFramePaletteIndex = blitNESFramePaletteIndex;

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
  if (typeof window._rebuildPaletteLUT === 'function') window._rebuildPaletteLUT();
  const s = window._lastIndexSize;
  blitNESFramePaletteIndex(window._lastIndexFrame, s.w, s.h);
}
window.redrawWithCurrentPalette = redrawWithCurrentPalette;

// --- Palette Modal -----------------------------------------------------------
const paletteOption = systemScreen && systemScreen.querySelector('.optionsBar li:nth-child(3)');
if (paletteOption) {
  paletteOption.style.cursor = 'pointer';
  paletteOption.addEventListener('click', openPaletteModal);
}

function openPaletteModal() {
  const existing = document.getElementById('palette-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'palette-modal';
  modal.className = 'palette-modal';
  modal.innerHTML =
    `<div class="palette-modal-backdrop"></div>
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
     </div>`;

  document.body.appendChild(modal);

  const backdrop = modal.querySelector('.palette-modal-backdrop');
  const closeBtn = modal.querySelector('.palette-close');
  const cancelBtn = modal.querySelector('.palette-cancel');
  const applyBtn = modal.querySelector('.palette-apply');

  function close() { modal.remove(); }

  applyBtn.addEventListener('click', () => {
    const sel = modal.querySelector('input[name="palette"]:checked');
    if (sel && typeof window.setCurrentPalette === 'function') window.setCurrentPalette(sel.value);
    if (typeof window._rebuildPaletteLUT === 'function') window._rebuildPaletteLUT();
    close();
  });

  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  }, { once: true });
}

// --- Pixel Aspect Modal ------------------------------------------------------
const pixelOption = systemScreen && systemScreen.querySelector('.optionsBar li:nth-child(4)');
if (pixelOption) {
  pixelOption.style.cursor = 'pointer';
  pixelOption.addEventListener('click', openPixelModal);
}

function openPixelModal() {
  const existing = document.getElementById('pixel-modal');
  if (existing) existing.remove();

  const checked = (k) => (pixelAspectMode === k ? 'checked' : '');

  const modal = document.createElement('div');
  modal.id = 'pixel-modal';
  modal.className = 'pixel-modal';
  modal.innerHTML =
    `<div class="pixel-modal-backdrop"></div>
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
     </div>`;

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

// exit
const exitOption = systemScreen && systemScreen.querySelector('.optionsBar li:nth-child(6)');
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

// --- F2: quick cycle scales --------------------------------------------------
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

// run / pause shortcut key on r
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'r' && ev.key !== 'R') return;
  if (!cpuRunning) run();
  else pause();
});

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
fpsOverlay.style.display = "none";
fpsOverlay.textContent = "FPS: 0";
if (systemScreen) systemScreen.appendChild(fpsOverlay);

let frameCount = 0;
let fps = 0;

setInterval(() => {
  fps = frameCount;
  frameCount = 0;
  if (fpsOverlay.style.display !== "none") fpsOverlay.textContent = `FPS: ${fps}`;
}, 1000);

function registerFrameUpdate() { frameCount++; }
window.registerFrameUpdate = registerFrameUpdate;

const fpsOption = systemScreen && systemScreen.querySelector(".optionsBar li:nth-child(5)");
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

// --- Test image drawing (optional, kept compatible) --------------------------
function drawTestImageFitted() { /* left intentionally minimal */ }

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
  if (!_firstRealFrameSeen) requestId = requestAnimationFrame(animateFuzz);
}
