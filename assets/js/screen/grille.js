
(function initAnimTrap() {
  if (window.__animTrapInit) return;
  window.__animTrapInit = true;

  const _origRAF = window.requestAnimationFrame;
  const _origCAF = window.cancelAnimationFrame;
  const _origSI  = window.setInterval;
  const _origCI  = window.clearInterval;

  const rafIds = new Set();
  const intIds = new Set();

  window.requestAnimationFrame = function wrappedRAF(cb) {
    const id = _origRAF.call(window, function (ts) { cb(ts); });
    rafIds.add(id);
    return id;
  };
  window.cancelAnimationFrame = function wrappedCAF(id) {
    rafIds.delete(id);
    return _origCAF.call(window, id);
  };
  window.setInterval = function wrappedSI(cb, ms, ...args) {
    const id = _origSI.call(window, cb, ms, ...args);
    intIds.add(id);
    return id;
  };
  window.clearInterval = function wrappedCI(id) {
    intIds.delete(id);
    return _origCI.call(window, id);
  };
  window.__cancelAllAnimations = function cancelAllAnimations() {
    for (const id of Array.from(rafIds))  { try { _origCAF.call(window, id); } catch {} }
    rafIds.clear();
    for (const id of Array.from(intIds))  { try { _origCI.call(window, id); } catch {} }
    intIds.clear();
  };
})();

// ===========================================================================
// 1) Helpers
// ===========================================================================
(function defineHelpers() {
  // Normalize overlays to the main canvas size
  function syncOverlaySizes() {
    try {
      if (!grilleCanvas || !scanlineCanvas || !canvas) return;
      // Effects live in display space, not the NES/WebGL backing resolution.
      // clientWidth/clientHeight already include the selected pixel aspect.
      const w = Math.max(1, Math.round(canvas.clientWidth || canvas.width));
      const h = Math.max(1, Math.round(canvas.clientHeight || canvas.height));
      if (grilleCanvas.width !== w || grilleCanvas.height !== h) {
        grilleCanvas.width = w; grilleCanvas.height = h;
      }
      if (scanlineCanvas.width !== w || scanlineCanvas.height !== h) {
        scanlineCanvas.width = w; scanlineCanvas.height = h;
      }
    } catch {}
  }
  window._syncOverlaySizes = syncOverlaySizes;

  function hardStopAll() {
    try { window.__cancelAllAnimations?.(); } catch {}
    try { stopAnimation?.(); } catch {}
  }

  function clearMainCanvas() {
    try {
      ctx.setTransform?.(1,0,0,1,0,0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
    } catch {}
  }

  function resumeIfNoneSelected() {
    const a = document.getElementById('test-rgba-checkbox')?.checked;
    const b = document.getElementById('test-index-checkbox')?.checked;
    const c = document.getElementById('test-image-checkbox')?.checked;
    if (!a && !b && !c) { try { animate?.(); } catch {} }
  }

  function setExclusive(target) {
    const img   = document.getElementById('test-image-checkbox');
    const rgba  = document.getElementById('test-rgba-checkbox');
    const index = document.getElementById('test-index-checkbox');
    if (img)   img.checked   = (target === img);
    if (rgba)  rgba.checked  = (target === rgba);
    if (index) index.checked = (target === index);
  }

  // Cache test image so we can redraw it after scaling without toggling
  let __testImage = null;
  let __testImageLoaded = false;
  const __testImageSrc = 'assets/images/test/tmnt.png';

  function drawTestImage() {
    clearMainCanvas();
    if (!__testImage) {
      __testImage = new Image();
      __testImage.src = __testImageSrc;
      __testImage.onload = () => {
        __testImageLoaded = true;
        try { ctx.drawImage(__testImage, 0, 0, canvas.width, canvas.height); } catch {}
      };
      return; // onload will draw
    }
    if (__testImageLoaded) {
      try { ctx.drawImage(__testImage, 0, 0, canvas.width, canvas.height); } catch {}
    }
  }

  window._grilleHelpers = {
    hardStopAll,
    clearMainCanvas,
    resumeIfNoneSelected,
    setExclusive,
    drawTestImage
  };
})();

// ===========================================================================
// 2) Opacity controls
// ===========================================================================
(function wireOpacity() {
  const t = document.getElementById('transparency-slider');
  const i = document.getElementById('intensity-slider');

  // Restore the saved CRT tuning before the first draw. Transparency belongs
  // only to the emulated picture; the hover toolbar stays fully opaque.
  const savedTransparency = localStorage.getItem('vajnesTransparency');
  if (t && savedTransparency !== null) t.value = savedTransparency;
  const savedGrilleIntensity = localStorage.getItem('vajnesGrilleIntensity');
  if (i && savedGrilleIntensity !== null) i.value = savedGrilleIntensity;

  try { systemScreen.style.opacity = '1'; } catch {}

  if (t) {
    try { canvas.style.opacity = (t.value / 100); } catch {}
    t.addEventListener('input', () => {
      try {
        systemScreen.style.opacity = '1';
        canvas.style.opacity = (t.value / 100);
      } catch {}
      localStorage.setItem('vajnesTransparency', String(t.value));
    });
  }

  if (i) {
    try { grilleCanvas.style.opacity = (i.value / 100); } catch {}
    i.addEventListener('input', () => {
      try { grilleCanvas.style.opacity = (i.value / 100); } catch {}
      localStorage.setItem('vajnesGrilleIntensity', String(i.value));
    });
  }
})();

// ===========================================================================
// 3) Scanlines modal open/close
// ===========================================================================
(function wireModal() {
  const modal = document.querySelector('.scanlinesModal');
  const okBtn = document.querySelector('#ok-button');
  const openLink = document.getElementById('screen-option-scanlines');
  openLink?.addEventListener('click', () => { if (modal) modal.style.display = 'block'; });
  okBtn   ?.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
})();

// Windowed CRT tuning is defined at the known-good 3x presentation. Scaling
// the emulator scales the CRT geometry proportionally. Fullscreen deliberately
// keeps the physical pitch established by the windowed presentation.
const CRT_TUNING_REFERENCE_SCALE = 3;
window._crtFullscreenActive = false;
window._crtGeometryScale = function() {
  if (window._crtFullscreenActive) return 1;
  const current = Number(scaleFactor);
  return (isFinite(current) && current > 0)
    ? current / CRT_TUNING_REFERENCE_SCALE
    : 1;
};

// ===========================================================================
// 5) Grille patterns (drawn on grilleCanvas) — ctx on window to avoid redeclare
// ===========================================================================
(function wireGrillePatterns() {
  try { window.grille_ctx = window.grille_ctx || grilleCanvas.getContext('2d'); } catch {}
  const getG = () => window.grille_ctx;

  function clearGrilleCanvas() {
    try { getG()?.clearRect(0, 0, grilleCanvas.width, grilleCanvas.height); } catch {}
  }

  function drawShadowMask() {
    const g = getG(); if (!g) return;
    const k = window._crtGeometryScale?.() || 1;
    const cell = Math.max(2, Math.round(8 * k));
    const half = Math.max(1, Math.round(4 * k));
    g.clearRect(0,0,grilleCanvas.width,grilleCanvas.height);
    g.fillStyle = 'black'; g.fillRect(0,0,grilleCanvas.width,grilleCanvas.height);
    g.fillStyle = 'rgb(30,30,30)';
    for (let i=0;i<grilleCanvas.width;i+=cell)
      for (let j=0;j<grilleCanvas.height;j+=cell)
        g.fillRect(i,j,half,half);
    g.fillStyle = 'rgb(60,60,60)';
    for (let i=half;i<grilleCanvas.width;i+=cell)
      for (let j=half;j<grilleCanvas.height;j+=cell)
        g.fillRect(i,j,half,half);
  }

  function drawApertureGrille() {
    const g = getG(); if (!g) return;
    const k = window._crtGeometryScale?.() || 1;
    const period = Math.max(2, Math.round(4 * k));
    const stripe = Math.max(1, Math.round(2 * k));
    g.clearRect(0,0,grilleCanvas.width,grilleCanvas.height);
    g.fillStyle = 'black'; g.fillRect(0,0,grilleCanvas.width,grilleCanvas.height);
    g.fillStyle = 'white';
    for (let i=0;i<grilleCanvas.width;i+=period) g.fillRect(i,0,stripe,grilleCanvas.height);
  }

  const radios = document.getElementsByName('grille-type');
  const savedGrilleType = localStorage.getItem('vajnesGrilleType');

  radios.forEach(r => {
    if (savedGrilleType && r.value === savedGrilleType) r.checked = true;
    r.addEventListener('click', () => {
      localStorage.setItem('vajnesGrilleType', r.value);
      if (r.value === 'aperture-grille')      drawApertureGrille();
      else if (r.value === 'shadow-mask')     drawShadowMask();
      else                                    clearGrilleCanvas();
    });
  });

  const active = Array.from(radios).find(r => r.checked)?.value;
  if (active === 'aperture-grille') drawApertureGrille();
  else if (active === 'shadow-mask') drawShadowMask();
  else clearGrilleCanvas();

  window._grilleDraw = { clearGrilleCanvas, drawShadowMask, drawApertureGrille };
})();

// ===========================================================================
// 6) Code-drawn scanlines (drawn on scanlineCanvas)
// ===========================================================================
(function wireScanlines() {
  function drawScanlines(canvasEl, intensity, opts = {}) {
    const g = canvasEl.getContext('2d');
    const k = window._crtGeometryScale?.() || 1;
    const baseLineHeight = +opts.lineHeight || 2;
    const baseGap        = Number.isFinite(+opts.gap) ? +opts.gap : 2;
    const lineHeight = Math.max(1, Math.round(baseLineHeight * k));
    const gap        = baseGap <= 0 ? 0 : Math.max(1, Math.round(baseGap * k));
    const color      = opts.color || '#000';
    const offset     = !!opts.offset;
    const alpha = Math.max(0, Math.min(100, intensity)) / 100;

    const w = canvasEl.width, h = canvasEl.height;
    g.clearRect(0,0,w,h);
    const prevA = g.globalAlpha;
    g.globalAlpha = alpha;
    g.fillStyle = color;

    const step = lineHeight + gap;
    for (let y=0,i=0; y<h; y+=step, i++) {
      const xOff = offset && (i % 2 === 1) ? Math.floor(gap/2) : 0;
      g.fillRect(xOff, y, w - xOff, lineHeight);
    }
    g.globalAlpha = prevA;
  }

  const inten = document.getElementById('scanlines-intensity-slider');
  const lH   = document.getElementById('scanline-lineheight');
  const gap  = document.getElementById('scanline-gap');
  const off  = document.getElementById('scanline-offset');

  const restore = (el,key) => {
    const value = localStorage.getItem(key);
    if (el && value !== null) el.value = value;
  };
  restore(inten,'vajnesScanlineIntensity');
  restore(lH,'vajnesScanlineLineHeight');
  restore(gap,'vajnesScanlineGap');
  if (off) off.checked = localStorage.getItem('vajnesScanlineOffset') === '1';

  function redraw() {
    drawScanlines(
      scanlineCanvas,
      parseInt(inten?.value ?? '0', 10),
      {
        lineHeight: parseInt(lH?.value ?? '2', 10),
        gap:        parseInt(gap?.value ?? '2', 10),
        offset:     !!off?.checked,
        color: '#000'
      }
    );
  }

  inten?.addEventListener('input', () => {
    localStorage.setItem('vajnesScanlineIntensity', String(inten.value));
    localStorage.setItem('vajnesScanlineEffectMode','computed');
    window._scanlineEffectMode = 'computed';
    redraw();
  });
  lH?.addEventListener('input', () => {
    localStorage.setItem('vajnesScanlineLineHeight', String(lH.value));
    localStorage.setItem('vajnesScanlineEffectMode','computed');
    window._scanlineEffectMode = 'computed';
    redraw();
  });
  gap?.addEventListener('input', () => {
    localStorage.setItem('vajnesScanlineGap', String(gap.value));
    localStorage.setItem('vajnesScanlineEffectMode','computed');
    window._scanlineEffectMode = 'computed';
    redraw();
  });
  off?.addEventListener('change', () => {
    localStorage.setItem('vajnesScanlineOffset', off.checked ? '1' : '0');
    localStorage.setItem('vajnesScanlineEffectMode','computed');
    window._scanlineEffectMode = 'computed';
    redraw();
  });

  window._scanlineRedraw = redraw;
  if (localStorage.getItem('vajnesScanlineEffectMode') !== 'image') redraw();
})();

// ===========================================================================
// 7) Resync after scale (redraw overlays + test image if active)
// ===========================================================================
(function wireResync() {
  function redrawActiveCrtEffects() {
    try {
      const val = Array.from(document.getElementsByName('grille-type'))
                       .find(r => r.checked)?.value;
      if (val === 'aperture-grille')      window._grilleDraw?.drawApertureGrille();
      else if (val === 'shadow-mask')     window._grilleDraw?.drawShadowMask();
      else                                window._grilleDraw?.clearGrilleCanvas();
    } catch {}

    try {
      if (window._scanlineEffectMode === 'image')
        window._drawSelectedScanlineImage?.();
      else
        window._scanlineRedraw?.();
    } catch {}
  }

  // Fullscreen must NOT scale the already-rendered CRT overlay. Resize only
  // the overlay backing canvases to the actual displayed picture size, then
  // render the user's same scanline/grille settings in physical screen pixels.
  window._setCrtFullscreenPresentation = function(active, displayW, displayH, normalDisplayH) {
    try {
      window._crtFullscreenActive = !!active;
      if (!grilleCanvas || !scanlineCanvas || !canvas) return;

      if (active) {
        const w = Math.max(1, Math.round(Number(displayW) || 1));
        const h = Math.max(1, Math.round(Number(displayH) || 1));
        if (grilleCanvas.width !== w) grilleCanvas.width = w;
        if (grilleCanvas.height !== h) grilleCanvas.height = h;
        if (scanlineCanvas.width !== w) scanlineCanvas.width = w;
        if (scanlineCanvas.height !== h) scanlineCanvas.height = h;
        window._setScanlineFullscreenPresentation?.(true, normalDisplayH);
      } else {
        const w = Math.max(1, Math.round(canvas.clientWidth || canvas.width));
        const h = Math.max(1, Math.round(canvas.clientHeight || canvas.height));
        if (grilleCanvas.width !== w) grilleCanvas.width = w;
        if (grilleCanvas.height !== h) grilleCanvas.height = h;
        if (scanlineCanvas.width !== w) scanlineCanvas.width = w;
        if (scanlineCanvas.height !== h) scanlineCanvas.height = h;
        window._setScanlineFullscreenPresentation?.(false, 0);
      }

      try { grilleCanvas.getContext('2d').imageSmoothingEnabled = false; } catch {}
      try { scanlineCanvas.getContext('2d').imageSmoothingEnabled = false; } catch {}
      redrawActiveCrtEffects();
    } catch {}
  };

  // Normal scale changes still resize the backing canvases through applyScale().
  // Redraw at those new dimensions, but CSS-only ResizeObserver events are
  // irrelevant to CRT pitch and therefore intentionally ignored.
  let lastW = canvas?.width || 0;
  let lastH = canvas?.height || 0;
  function resync() {
    const w = canvas?.width || 0, h = canvas?.height || 0;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    try { window._syncOverlaySizes?.(); } catch {}
    redrawActiveCrtEffects();
  }

  try {
    const ro = new ResizeObserver(resync);
    ro.observe(canvas);
  } catch {
    window.addEventListener('resize', resync);
  }
})();
