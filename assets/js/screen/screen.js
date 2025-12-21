// ============================================================================
// SCREEN BOOT + LAYERS (WEBGL presenter) + RF FUZZ (CPU-GENERATED LIKE 2D DEMO)
// ============================================================================
//
// PERFORMANCE NOTE (IMPORTANT):
// - The old blitter expanded 256*240 palette indices into RGBA on the CPU every frame.
//   That loop is expensive and often caps FPS ~30–40.
// - This version uploads the palette index frame as a 1-byte texture and does
//   index->RGB palette lookup in the fragment shader (fast).
//
// RF fuzz stays CPU-generated RGBA (your "real snow" look) and uploads while
// waiting for the first real frame.
//
// ----------------------------------------------------------------------------
// RF TUNING KNOBS (EDIT THESE FIRST)
// ----------------------------------------------------------------------------
const RF = {
  everyOtherFrame: true,
  fpsHz: 60,

  brightness: 0.05,
  contrast: 1.15,
  gamma: 1.25,
  blackFloor: 0.02,

  noiseAmount: 1.0,
  mono: true,
  seedSalt: 0,

  bandStrength: 0.12,
  bandFreq: 2.0,
};
window.RF = RF;

// --- Screen boot + layers ---------------------------------------------------
const systemScreen   = document.getElementById('system-screen-modal');
const grilleScreen   = document.getElementById('grille-screen-modal');
const scanlineScreen = document.getElementById('scanline-simulation-modal');
const blackScreen    = document.getElementById('black-screen-modal');

const canvas         = document.getElementById('screen-canvas');     // main picture (WEBGL)
const grilleCanvas   = document.getElementById('grille-canvas');     // grille / masks
const scanlineCanvas = document.getElementById('scanline-canvas');   // scanline overlay

const grille_ctx         = grilleCanvas ? grilleCanvas.getContext('2d', { desynchronized: true }) : null;
const scanlineCanvas_ctx = scanlineCanvas ? scanlineCanvas.getContext('2d', { desynchronized: true }) : null;

const TEST_IMAGE_STATE = { enabled: false, img: null };

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
// WebGL presenter (FAST PATH):
// - Real NES frames: upload 8-bit indices + palette texture, GPU does lookup
// - RF fuzz: upload RGBA to separate texture, show it while no real frame
// ---------------------------------------------------------------------------

let GL = null;
let _glReady = false;

let _progNES = null;     // palette-index -> RGB shader
let _progRGBA = null;    // straight RGBA presenter (for fuzz)

let _vb = null;

let _aPosNES = -1, _aUVNES = -1;
let _uIdxTex = null, _uPalTex = null;

let _aPosRGBA = -1, _aUVRGBA = -1;
let _uRgbTex = null;

// textures
let _texIndex = null;    // LUMINANCE 256x240
let _texPal   = null;    // RGB 64x1
let _texRFFuzz = null;   // RGBA 256x240

// palette upload state
let _palRGB = new Uint8Array(64 * 3);
let _palDirty = true;           // upload palette when true
let _palEverNonFallback = false;

// RF buffers
let _rfBytes = null;
let _rfU32   = null;
let _rfPixels = 0;

// For draw viewport (canvas is scaled via CSS, but we draw to its backing size)
let _srcW = BASE_W;
let _srcH = BASE_H;

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
    console.warn("[webgl] WebGL unavailable");
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

  // NES palette lookup shader:
  // idxTex: LUMINANCE, value 0..255 in .r
  // palTex: 64x1 RGB, lookup using idx&63
  const fsNES = `
    precision mediump float;
    varying vec2 v_uv;

    uniform sampler2D u_idxTex;
    uniform sampler2D u_palTex;

    void main() {
      float idx = texture2D(u_idxTex, v_uv).r * 255.0;
      float pi = floor(mod(idx, 64.0));          // 0..63

      float u = (pi + 0.5) / 64.0;               // center of texel
      vec3 rgb = texture2D(u_palTex, vec2(u, 0.5)).rgb;

      gl_FragColor = vec4(rgb, 1.0);
    }
  `;

  // Straight RGBA presenter (for RF fuzz texture)
  const fsRGBA = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_rgbTex;
    void main() {
      gl_FragColor = texture2D(u_rgbTex, v_uv);
    }
  `;

  _progNES = _glLink(vsSrc, fsNES);
  _progRGBA = _glLink(vsSrc, fsRGBA);
  if (!_progNES || !_progRGBA) {
    _glReady = false;
    return false;
  }

  // Fullscreen quad
  const quad = new Float32Array([
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

  // lookups
  GL.useProgram(_progNES);
  _aPosNES  = GL.getAttribLocation(_progNES, "a_pos");
  _aUVNES   = GL.getAttribLocation(_progNES, "a_uv");
  _uIdxTex  = GL.getUniformLocation(_progNES, "u_idxTex");
  _uPalTex  = GL.getUniformLocation(_progNES, "u_palTex");

  GL.useProgram(_progRGBA);
  _aPosRGBA = GL.getAttribLocation(_progRGBA, "a_pos");
  _aUVRGBA  = GL.getAttribLocation(_progRGBA, "a_uv");
  _uRgbTex  = GL.getUniformLocation(_progRGBA, "u_rgbTex");

  // --- create textures ------------------------------------------------------

  // 0: index texture (LUMINANCE 256x240)
  _texIndex = GL.createTexture();
  GL.activeTexture(GL.TEXTURE0);
  GL.bindTexture(GL.TEXTURE_2D, _texIndex);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);

  // allocate once
  const zeroIdx = new Uint8Array(BASE_W * BASE_H);
  GL.texImage2D(GL.TEXTURE_2D, 0, GL.LUMINANCE, BASE_W, BASE_H, 0, GL.LUMINANCE, GL.UNSIGNED_BYTE, zeroIdx);

  // 1: palette texture (RGB 64x1)
  _texPal = GL.createTexture();
  GL.activeTexture(GL.TEXTURE1);
  GL.bindTexture(GL.TEXTURE_2D, _texPal);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);

  // allocate palette (filled by _uploadPaletteTex())
  const zeroPal = new Uint8Array(64 * 3);
  GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGB, 64, 1, 0, GL.RGB, GL.UNSIGNED_BYTE, zeroPal);

  // 2: RF fuzz texture (RGBA 256x240)
  _texRFFuzz = GL.createTexture();
  GL.activeTexture(GL.TEXTURE2);
  GL.bindTexture(GL.TEXTURE_2D, _texRFFuzz);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
  GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);

  const zeroRGBA = new Uint8Array(BASE_W * BASE_H * 4);
  GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, BASE_W, BASE_H, 0, GL.RGBA, GL.UNSIGNED_BYTE, zeroRGBA);

  // global GL state
  GL.disable(GL.DEPTH_TEST);
  GL.disable(GL.CULL_FACE);
  GL.disable(GL.BLEND);
  GL.clearColor(0, 0, 0, 1);

  _srcW = BASE_W;
  _srcH = BASE_H;

  _glReady = true;
  console.debug("[webgl] ready (GPU palette lookup enabled)");
  return true;
}

function _glBindQuadAttribs(aPos, aUV) {
  GL.bindBuffer(GL.ARRAY_BUFFER, _vb);
  GL.enableVertexAttribArray(aPos);
  GL.enableVertexAttribArray(aUV);
  GL.vertexAttribPointer(aPos, 2, GL.FLOAT, false, 16, 0);
  GL.vertexAttribPointer(aUV,  2, GL.FLOAT, false, 16, 8);
}

function _glPresentNES() {
  if (!_glReady) return;

  GL.useProgram(_progNES);
  _glBindQuadAttribs(_aPosNES, _aUVNES);

  // idx on unit 0, pal on unit 1
  GL.activeTexture(GL.TEXTURE0);
  GL.bindTexture(GL.TEXTURE_2D, _texIndex);
  GL.uniform1i(_uIdxTex, 0);

  GL.activeTexture(GL.TEXTURE1);
  GL.bindTexture(GL.TEXTURE_2D, _texPal);
  GL.uniform1i(_uPalTex, 1);

  GL.viewport(0, 0, canvas.width, canvas.height);
  GL.clear(GL.COLOR_BUFFER_BIT);
  GL.drawArrays(GL.TRIANGLES, 0, 6);
}

function _glPresentRFFuzz() {
  if (!_glReady) return;

  GL.useProgram(_progRGBA);
  _glBindQuadAttribs(_aPosRGBA, _aUVRGBA);

  // fuzz texture on unit 2 (we bind it but tell sampler 0 to avoid extra uniforms? no — just use unit 0 here)
  // Keep it simple: bind fuzz on unit 0 for this program.
  GL.activeTexture(GL.TEXTURE0);
  GL.bindTexture(GL.TEXTURE_2D, _texRFFuzz);
  GL.uniform1i(_uRgbTex, 0);

  GL.viewport(0, 0, canvas.width, canvas.height);
  GL.clear(GL.COLOR_BUFFER_BIT);
  GL.drawArrays(GL.TRIANGLES, 0, 6);
}

function _uploadIndexFrame(indexUint8Array, w, h) {
  if (!_glReady) return;

  if ((w|0) !== BASE_W || (h|0) !== BASE_H) {
    // if you ever support non-256x240, handle resize here
    // for now, keep strict for speed / simplicity
    w = BASE_W; h = BASE_H;
  }

  GL.activeTexture(GL.TEXTURE0);
  GL.bindTexture(GL.TEXTURE_2D, _texIndex);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, w, h, GL.LUMINANCE, GL.UNSIGNED_BYTE, indexUint8Array);
}

function _uploadRFFuzzRGBA(bytesRGBA, w, h) {
  if (!_glReady) return;

  if ((w|0) !== BASE_W || (h|0) !== BASE_H) {
    w = BASE_W; h = BASE_H;
  }

  GL.activeTexture(GL.TEXTURE0);
  GL.bindTexture(GL.TEXTURE_2D, _texRFFuzz);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, w, h, GL.RGBA, GL.UNSIGNED_BYTE, bytesRGBA);
}

// --- palette building & upload (RGB 64x1) -----------------------------------

function _hexToRgb(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(hex.slice(1, 3), 16) | 0,
    g: parseInt(hex.slice(3, 5), 16) | 0,
    b: parseInt(hex.slice(5, 7), 16) | 0
  };
}

function _buildFallbackPaletteRGB() {
  for (let i = 0; i < 64; i++) {
    const v = ((i / 63) * 255) | 0;
    _palRGB[i*3+0] = v;
    _palRGB[i*3+1] = v;
    _palRGB[i*3+2] = v;
  }
}

function _rebuildPaletteRGB() {
  const pal = (typeof window !== 'undefined' && window.currentPalette) ? window.currentPalette : null;
  if (!pal) {
    if (!_palEverNonFallback) _buildFallbackPaletteRGB();
    _palDirty = true;
    return;
  }

  for (let i = 0; i < 64; i++) {
    const hex = pal[i] ? pal[i] : '#000000';
    const { r, g, b } = _hexToRgb(hex);
    _palRGB[i*3+0] = r;
    _palRGB[i*3+1] = g;
    _palRGB[i*3+2] = b;
  }

  _palEverNonFallback = true;
  _palDirty = true;
}

function _uploadPaletteTexIfDirty() {
  if (!_glReady) return;
  if (!_palDirty) return;

  GL.activeTexture(GL.TEXTURE1);
  GL.bindTexture(GL.TEXTURE_2D, _texPal);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 64, 1, GL.RGB, GL.UNSIGNED_BYTE, _palRGB);

  _palDirty = false;
}

// expose old name (other files call it)
function _rebuildPaletteLUT() {
  _rebuildPaletteRGB();
}
_rebuildPaletteLUT();
window._rebuildPaletteLUT = _rebuildPaletteLUT;

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

// Init GL first, then scale
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

// --- FPS mark (no Atomics here) ---------------------------------------------
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
// RF fuzz while nothing is rendered (CPU-generated noise like your 2D example)
// ---------------------------------------------------------------------------
let requestId = 0;
let _firstRealFrameSeen = false;

let _rfToggle = true;
let _rfLastStep = -1;

function _ensureRfBuffer(w, h) {
  const nPix = (w * h) | 0;
  if (!_rfBytes || _rfPixels !== nPix) {
    _rfPixels = nPix;
    _rfBytes = new Uint8Array(nPix * 4);
    _rfU32   = new Uint32Array(_rfBytes.buffer);
  }
}

function _clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

function _makeRng(seed) {
  let s = (seed | 0) || 1;
  return function next() {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17; s |= 0;
    s ^= s << 5;  s |= 0;
    return (s >>> 0);
  };
}

function _generateRfNoiseU32(w, h, timeSec) {
  _ensureRfBuffer(w, h);

  const step = (timeSec * RF.fpsHz) | 0;
  if (step === _rfLastStep) return;
  _rfLastStep = step;

  if (RF.everyOtherFrame) {
    _rfToggle = !_rfToggle;
    if (_rfToggle) return;
  }

  const out = _rfU32;

  const baseSeed = (step * 1664525 + 1013904223 + (RF.seedSalt|0)) | 0;
  const rng = _makeRng(baseSeed);

  const strength = _clamp01(RF.noiseAmount);
  const bri = _clamp01(RF.brightness);
  const floorL = _clamp01(RF.blackFloor);
  const con = RF.contrast;
  const gam = Math.max(0.01, RF.gamma);

  const bandStr = _clamp01(RF.bandStrength);
  const bandFreq = Math.max(0.01, RF.bandFreq);

  const band = new Float32Array(h);
  if (bandStr > 0) {
    for (let y = 0; y < h; y++) {
      const t = (y / h) * Math.PI * 2 * bandFreq;
      band[y] = 1.0 - bandStr * 0.5 + bandStr * (0.5 + 0.5 * Math.sin(t));
    }
  } else {
    for (let y = 0; y < h; y++) band[y] = 1.0;
  }

  let i = 0;
  for (let y = 0; y < h; y++) {
    const bmul = band[y];
    for (let x = 0; x < w; x++, i++) {
      const r = rng() & 255;
      let l = r / 255;

      l = (l - 0.5) * con + 0.5;
      l *= bmul;
      l = _clamp01(l);
      l = Math.pow(l, gam);

      l = Math.max(l, floorL);
      l = bri + (l - bri) * strength;
      l = _clamp01(l);

      const v = (l * 255) | 0;

      if (RF.mono) {
        out[i] = ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
      } else {
        const g = (rng() & 255);
        const b = (rng() & 255);
        out[i] = ((255 << 24) | (b << 16) | (g << 8) | v) >>> 0;
      }
    }
  }
}

function animateFuzz(t) {
  if (_glReady && !_firstRealFrameSeen) {
    const timeSec = (t || 0) * 0.001;
    _generateRfNoiseU32(BASE_W, BASE_H, timeSec);
    if (_rfBytes) _uploadRFFuzzRGBA(_rfBytes, BASE_W, BASE_H);
    _glPresentRFFuzz();
  }
  requestId = requestAnimationFrame(animateFuzz);
}

function stopAnimation() {
  if (requestId) cancelAnimationFrame(requestId);
  requestId = 0;
}

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

  // Upload palette (only when dirty / changed)
  // If palette becomes available later, rebuild once.
  if (!_palEverNonFallback && typeof window !== 'undefined' && window.currentPalette) {
    _rebuildPaletteRGB();
  }
  _uploadPaletteTexIfDirty();

  // FAST PATH: upload 8-bit indices only; GPU maps to RGB
  _uploadIndexFrame(indexUint8Array, width|0, height|0);
  _glPresentNES();

  window._lastIndexFrame = indexUint8Array;
  window._lastIndexSize  = { w: width, h: height };

  registerFrameUpdate();
}

window.blitNESFrameRGBA = blitNESFrameRGBA;
window.blitNESFramePaletteIndex = blitNESFramePaletteIndex;

function redrawWithCurrentPalette() {
  if (!window._lastIndexFrame || !window._lastIndexSize) return;
  if (typeof window._rebuildPaletteLUT === 'function') window._rebuildPaletteLUT();
  const s = window._lastIndexSize;
  blitNESFramePaletteIndex(window._lastIndexFrame, s.w, s.h);
}
window.redrawWithCurrentPalette = redrawWithCurrentPalette;

// Blur slider remains
const slider = document.getElementById('composite-blur-slider');
if (slider) {
  slider.addEventListener('input', (event) => {
    const v = Math.min(Math.max(+event.target.value || 0, 0), 5);
    document.getElementById('screen-canvas').style.filter = `blur(${v.toFixed(1)}px)`;
  });
}

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
