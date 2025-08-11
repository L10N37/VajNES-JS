
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
      const w = canvas.width, h = canvas.height;
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
  t?.addEventListener('input', () => {
    try { systemScreen.style.opacity = (t.value / 100); } catch {}
  });
  const i = document.getElementById('intensity-slider');
  i?.addEventListener('input', () => {
    try { grilleCanvas.style.opacity = (i.value / 100); } catch {}
  });
})();

// ===========================================================================
// 3) Scanlines modal open/close
// ===========================================================================
(function wireModal() {
  const modal = document.querySelector('.scanlinesModal');
  const okBtn = document.querySelector('#ok-button');
  const openLink = document.querySelector('li:nth-child(2)'); // if you have a menu link
  openLink?.addEventListener('click', () => { if (modal) modal.style.display = 'block'; });
  okBtn   ?.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
})();

// ===========================================================================
// 4) Test sources — mutually exclusive: Test Image, RGBA anim, Index anim
// ===========================================================================
(function wireTests() {
  const img   = document.getElementById('test-image-checkbox');
  const rgba  = document.getElementById('test-rgba-checkbox');
  const index = document.getElementById('test-index-checkbox');

  function select(kind) {
    const H = window._grilleHelpers;
    H.hardStopAll();          // nuke ANY running loops (tests + emulator)
    H.clearMainCanvas();      // clean slate

    if (kind === 'image') { H.setExclusive(img);   H.drawTestImage();  return; }
    if (kind === 'rgba')  { H.setExclusive(rgba);  try { testRGBAAnim?.(); } catch(e){ console.error(e);} return; }
    if (kind === 'index') { H.setExclusive(index); try { testIndexAnim?.(); } catch(e){ console.error(e);} return; }

    H.setExclusive(null);
    H.resumeIfNoneSelected();
  }

  img  ?.addEventListener('change', () => select(img.checked   ? 'image' : null));
  rgba ?.addEventListener('change', () => select(rgba.checked  ? 'rgba'  : null));
  index?.addEventListener('change', () => select(index.checked ? 'index' : null));
})();

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
    g.clearRect(0,0,grilleCanvas.width,grilleCanvas.height);
    g.fillStyle = 'black'; g.fillRect(0,0,grilleCanvas.width,grilleCanvas.height);
    g.fillStyle = 'rgb(30,30,30)';
    for (let i=0;i<grilleCanvas.width;i+=8)
      for (let j=0;j<grilleCanvas.height;j+=8)
        g.fillRect(i,j,4,4);
    g.fillStyle = 'rgb(60,60,60)';
    for (let i=4;i<grilleCanvas.width;i+=8)
      for (let j=4;j<grilleCanvas.height;j+=8)
        g.fillRect(i,j,4,4);
  }

  function drawApertureGrille() {
    const g = getG(); if (!g) return;
    g.clearRect(0,0,grilleCanvas.width,grilleCanvas.height);
    g.fillStyle = 'black'; g.fillRect(0,0,grilleCanvas.width,grilleCanvas.height);
    g.fillStyle = 'white';
    for (let i=0;i<grilleCanvas.width;i+=4) g.fillRect(i,0,2,grilleCanvas.height);
  }

  const radios = document.getElementsByName('grille-type');
  radios.forEach(r => {
    r.addEventListener('click', () => {
      if (r.value === 'aperture-grille')      drawApertureGrille();
      else if (r.value === 'shadow-mask')     drawShadowMask();
      else                                    clearGrilleCanvas();
    });
  });

  window._grilleDraw = { clearGrilleCanvas, drawShadowMask, drawApertureGrille };
})();

// ===========================================================================
// 6) Code-drawn scanlines (drawn on scanlineCanvas)
// ===========================================================================
(function wireScanlines() {
  function drawScanlines(canvasEl, intensity, opts = {}) {
    const g = canvasEl.getContext('2d');
    const lineHeight = +opts.lineHeight || 2;
    const gap        = +opts.gap || 2;
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

  inten?.addEventListener('input',  redraw);
  lH  ?.addEventListener('input',   redraw);
  gap ?.addEventListener('input',   redraw);
  off ?.addEventListener('change',  redraw);

  window._scanlineRedraw = redraw;
  redraw();
})();

// ===========================================================================
// 7) Resync after scale (redraw overlays + test image if active)
// ===========================================================================
(function wireResync() {
  function resync() {
    // If your scaling code resized the main canvas, match overlays
    try { window._syncOverlaySizes?.(); } catch {}

    // Redraw grille overlays
    try {
      const val = Array.from(document.getElementsByName('grille-type'))
                       .find(r => r.checked)?.value;
      if (val === 'aperture-grille')      window._grilleDraw?.drawApertureGrille();
      else if (val === 'shadow-mask')     window._grilleDraw?.drawShadowMask();
      else                                window._grilleDraw?.clearGrilleCanvas();
    } catch {}

    // Redraw code-drawn scanlines
    try { window._scanlineRedraw?.(); } catch {}

    // If Test Image is active, redraw it (canvas resize cleared pixels)
    try {
      const imgChecked = document.getElementById('test-image-checkbox')?.checked;
      if (imgChecked) window._grilleHelpers?.drawTestImage?.();
    } catch {}
  }

  // Observe all relevant canvases for size changes
  try {
    const ro = new ResizeObserver(resync);
    ro.observe(grilleCanvas);
    ro.observe(scanlineCanvas);
    ro.observe(canvas);
  } catch {
    // Fallback
    window.addEventListener('resize', resync);
  }
})();
