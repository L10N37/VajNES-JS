// --- Grille + transparency + test-image toggle ------------------------------
// Keeps your existing UI logic but avoids resizing the main canvas.
// The goal is simply: draw effects that follow whatever size applyScale() set.

const transparencySlider = document.getElementById('transparency-slider');
transparencySlider.addEventListener('input', () => {
  const opacity = transparencySlider.value / 100;
  systemScreen.style.opacity = opacity;
});

// Grille intensity is just CSS opacity on the grille canvas
const intensitySlider = document.getElementById('intensity-slider');
function handleIntensityChange() {
  const intensity = intensitySlider.value / 100;
  grilleCanvas.style.opacity = intensity;
}
intensitySlider.addEventListener('input', handleIntensityChange);

// Open/close the scanlines settings modal
let scanlinesModal = document.querySelector('.scanlinesModal');
let scanlinesLink  = document.querySelector('li:nth-child(2)');
scanlinesLink.addEventListener('click', () => { scanlinesModal.style.display = 'block'; });

let grilleOkButton = document.querySelector('#ok-button');
grilleOkButton.addEventListener('click', () => { scanlinesModal.style.display = 'none'; });

// ---- Test image: KEEP feature, but don’t resize the canvas. ----------------
const testImageCheckbox = document.getElementById('test-image-checkbox');
testImageCheckbox.addEventListener('click', () => {
  if (testImageCheckbox.checked) {
    // turn on test image without touching canvas dims
    enableTestImage('assets/images/test/tmnt.png');
  } else {
    // back to RF fuzz
    disableTestImage();
  }
});

// ---- Optional grille patterns ----------------------------------------------
function clearGrilleCanvas() {
  grille_ctx.clearRect(0, 0, grilleCanvas.width, grilleCanvas.height);
}

function drawShadowMask() {
  grille_ctx.clearRect(0, 0, grilleCanvas.width, grilleCanvas.height);
  grille_ctx.fillStyle = 'black';
  grille_ctx.fillRect(0, 0, grilleCanvas.width, grilleCanvas.height);

  grille_ctx.fillStyle = 'rgb(30,30,30)';
  for (let i = 0; i < grilleCanvas.width; i += 8) {
    for (let j = 0; j < grilleCanvas.height; j += 8) {
      grille_ctx.fillRect(i, j, 4, 4);
    }
  }
  grille_ctx.fillStyle = 'rgb(60,60,60)';
  for (let i = 4; i < grilleCanvas.width; i += 8) {
    for (let j = 4; j < grilleCanvas.height; j += 8) {
      grille_ctx.fillRect(i, j, 4, 4);
    }
  }
}

function drawApertureGrille() {
  grille_ctx.clearRect(0, 0, grilleCanvas.width, grilleCanvas.height);
  grille_ctx.fillStyle = 'black';
  grille_ctx.fillRect(0, 0, grilleCanvas.width, grilleCanvas.height);
  grille_ctx.fillStyle = 'white';
  for (let i = 0; i < grilleCanvas.width; i += 4) {
    grille_ctx.fillRect(i, 0, 2, grilleCanvas.height);
  }
}

const grilleTypeRadios = document.getElementsByName('grille-type');
grilleTypeRadios.forEach((radio) => {
  radio.addEventListener('click', () => {
    if (radio.value === 'aperture-grille') {
      drawApertureGrille();
    } else if (radio.value === 'shadow-mask') {
      drawShadowMask();
    } else {
      clearGrilleCanvas();
    }
  });
});

/*
// ---- Simple drawn scanlines (separate from PNG overlays) --------------------
// using the PNG overlay from scanlines.js you can ignore this.
// Left in because you were experimenting with both approaches.
function drawScanlines(canvasRef, intensity) {
  const g = canvasRef.getContext('2d');
  const alpha = intensity / 100;

  g.clearRect(0, 0, canvasRef.width, canvasRef.height);
  g.fillStyle = `rgba(0, 0, 0, ${alpha})`;

  // 2px on, 2px off — tune to taste.
  const lineHeight = 2, gap = 2;
  for (let y = 0; y < canvasRef.height; y += lineHeight + gap) {
    g.fillRect(0, y, canvasRef.width, lineHeight);
  }
}
*/

const scanlineIntensitySlider = document.getElementById('scanlines-intensity-slider');
scanlineIntensitySlider.addEventListener('input', () => {
  drawScanlines(scanlineCanvas, parseInt(scanlineIntensitySlider.value, 10) || 0);
});

// ---- Scale hooks so overlays/grilles re-draw after size changes ------------
function _resyncGrilleAfterScale() {
  // If a grille pattern is active, redraw it at the new size.
  const checked = Array.from(grilleTypeRadios).find(r => r.checked)?.value;
  if (checked === 'aperture-grille') drawApertureGrille();
  else if (checked === 'shadow-mask') drawShadowMask();
  // Redraw drawn scanlines using current intensity slider
  const current = parseInt(scanlineIntensitySlider.value, 10) || 0;
  drawScanlines(scanlineCanvas, current);
}
