/* Scanline overlay handling
   These are image-based overlays. Key rule: never resize the canvas here.
   We always draw the selected PNG stretched to the current scanlineCanvas size.
*/

const scanlineCtx = scanlineCanvas.getContext('2d');
scanlineCtx.imageSmoothingEnabled = false;

let _scanlineImage = null;
let _scanlineFullscreenPresentation = {
  active: false,
  normalDisplayHeight: 0
};

const SCANLINE_IMAGE_REF_KEY = 'vajnesScanlineImageReferenceHeight';
let _scanlineImageReferenceHeight =
  Number(localStorage.getItem(SCANLINE_IMAGE_REF_KEY) || 0);

function captureScanlineImageReferenceHeight() {
  const h = Math.max(
    1,
    Math.round(scanlineCanvas.clientHeight || scanlineCanvas.height || 1)
  );
  _scanlineImageReferenceHeight = h;
  localStorage.setItem(SCANLINE_IMAGE_REF_KEY, String(h));
}

function setScanlinesImage() {
  const selected = document.querySelector('input[name="scanlines"]:checked');
  if (!selected) return;

  let src = '';
  if (selected.value === 'scanlines1') src = 'assets/images/scanlines/scanlines1.png';
  if (selected.value === 'scanlines2') src = 'assets/images/scanlines/scanlines2.png';
  if (selected.value === 'scanlines3') src = 'assets/images/scanlines/scanlines3.png';

  if (!src) {
    scanlineCtx.clearRect(0, 0, scanlineCanvas.width, scanlineCanvas.height);
    _scanlineImage = null;
    return;
  }

  const img = new Image();
  img.onload = () => {
    _scanlineImage = img;
    drawScanlineImage();
  };
  img.src = src;
}

// Draw current scanline PNG. In fullscreen we preserve the exact vertical
// pitch it had in the tuned windowed presentation instead of stretching that
// texture to the monitor height (which changes line thickness and spacing).
function drawScanlineImage() {
  scanlineCtx.imageSmoothingEnabled = false;
  scanlineCtx.clearRect(0, 0, scanlineCanvas.width, scanlineCanvas.height);
  if (!_scanlineImage) return;

  // Preserve the physical scanline pitch at the scale where the user chose
  // this image. Scaling the whole 1080-line PNG to every emulator size creates
  // beat/alias patterns (2x/4x/5x looked visibly different from 3x/5.4x).
  if (!(_scanlineImageReferenceHeight > 0)) {
    captureScanlineImageReferenceHeight();
  }

  const tileH = Math.max(1, Math.round(_scanlineImageReferenceHeight));
  for (let y = 0; y < scanlineCanvas.height; y += tileH) {
    scanlineCtx.drawImage(
      _scanlineImage,
      0, 0, _scanlineImage.width, _scanlineImage.height,
      0, y, scanlineCanvas.width, tileH
    );
  }
}

// If scale changes, we want the overlay to re-stretch as well.
// screen.js calls applyScale(); quick hook to re-draw without window.*.
function _resyncScanlineOverlayAfterScale() {
  if (window._scanlineEffectMode === 'computed') return;
  drawScanlineImage();
}

function _setScanlineFullscreenPresentation(active, normalDisplayHeight) {
  _scanlineFullscreenPresentation.active = !!active;
  _scanlineFullscreenPresentation.normalDisplayHeight =
    Number(normalDisplayHeight) > 0 ? Number(normalDisplayHeight) : 0;

  if (window._scanlineEffectMode !== 'computed') drawScanlineImage();
}
window._setScanlineFullscreenPresentation = _setScanlineFullscreenPresentation;
window._drawSelectedScanlineImage = drawScanlineImage;

// Radio buttons for choosing the overlay
const savedScanlineImage = localStorage.getItem('vajnesScanlineImage');
if (savedScanlineImage) {
  const radio = document.querySelector(`input[name="scanlines"][value="${savedScanlineImage}"]`);
  if (radio) radio.checked = true;
}

document.querySelectorAll('input[name="scanlines"]').forEach((b) => {
  b.addEventListener('change', () => {
    localStorage.setItem('vajnesScanlineImage', b.value);
    window._scanlineEffectMode = 'image';
    localStorage.setItem('vajnesScanlineEffectMode','image');
    captureScanlineImageReferenceHeight();
    setScanlinesImage();
  });
});

// Initial pass. Remember whether the PNG overlay or the computed scanline
// tuning was the user's most recently selected effect.
const savedEffectMode = localStorage.getItem('vajnesScanlineEffectMode');
window._scanlineEffectMode = savedEffectMode === 'computed'
  ? 'computed'
  : (savedScanlineImage ? 'image' : 'computed');
if (window._scanlineEffectMode === 'image') {
  if (!(_scanlineImageReferenceHeight > 0)) captureScanlineImageReferenceHeight();
  setScanlinesImage();
}
