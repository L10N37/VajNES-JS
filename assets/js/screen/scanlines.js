/* Scanline overlay handling
   These are image-based overlays. Key rule: never resize the canvas here.
   We always draw the selected PNG stretched to the current scanlineCanvas size.
*/

const scanlineCtx = scanlineCanvas.getContext('2d');
scanlineCtx.imageSmoothingEnabled = false;

let _scanlineImage = null;

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

// Draw current scanline PNG stretched to match the current canvas size
function drawScanlineImage() {
  scanlineCtx.imageSmoothingEnabled = false;
  scanlineCtx.clearRect(0, 0, scanlineCanvas.width, scanlineCanvas.height);
  if (!_scanlineImage) return;
  scanlineCtx.drawImage(
    _scanlineImage,
    0, 0, _scanlineImage.width, _scanlineImage.height,
    0, 0, scanlineCanvas.width, scanlineCanvas.height
  );
}

// If scale changes, we want the overlay to re-stretch as well.
// screen.js calls applyScale(); quick hook to re-draw without window.*.
function _resyncScanlineOverlayAfterScale() {
  drawScanlineImage();
}

// Radio buttons for choosing the overlay
document.querySelectorAll('input[name="scanlines"]').forEach((b) => {
  b.addEventListener('change', setScanlinesImage);
});

// Initial pass
setScanlinesImage();
