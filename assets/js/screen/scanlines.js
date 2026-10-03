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

  if (_scanlineFullscreenPresentation.active &&
      _scanlineFullscreenPresentation.normalDisplayHeight > 0) {
    const tileH = Math.max(1, Math.round(_scanlineFullscreenPresentation.normalDisplayHeight));
    for (let y = 0; y < scanlineCanvas.height; y += tileH) {
      scanlineCtx.drawImage(
        _scanlineImage,
        0, 0, _scanlineImage.width, _scanlineImage.height,
        0, y, scanlineCanvas.width, tileH
      );
    }
    return;
  }

  scanlineCtx.drawImage(
    _scanlineImage,
    0, 0, _scanlineImage.width, _scanlineImage.height,
    0, 0, scanlineCanvas.width, scanlineCanvas.height
  );
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
    setScanlinesImage();
  });
});

// Initial pass. Remember whether the PNG overlay or the computed scanline
// tuning was the user's most recently selected effect.
const savedEffectMode = localStorage.getItem('vajnesScanlineEffectMode');
window._scanlineEffectMode = savedEffectMode === 'computed'
  ? 'computed'
  : (savedScanlineImage ? 'image' : 'computed');
if (window._scanlineEffectMode === 'image') setScanlinesImage();
