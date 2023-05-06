/* coded scanlines weren't working out, went with actual image underlays
 credit: https://forums.libretro.com/t/some-scanline-overlays-w-fade-effect/18457 for the images
*/

const scanlineCtx = scanlineCanvas.getContext('2d');

function setScanlinesImage() {
    const selectedScanlines = document.querySelector('input[name="scanlines"]:checked');
    if (!selectedScanlines) {
      return; // exit the function if no radio button is selected
    }
  switch (selectedScanlines.value) {
    case 'scanlines1':
      imageSrc = 'assets/images/scanlines/scanlines1.png';
      break;
    case 'scanlines2':
      imageSrc = 'assets/images/scanlines/scanlines2.png';
      break;
    case 'scanlines3':
      imageSrc = 'assets/images/scanlines/scanlines3.png';
      break;
  }

  if (imageSrc) {
    const image = new Image();
    image.onload = function() {
      scanlineCanvas.width = image.width;
      scanlineCanvas.height = image.height;
      scanlineCtx.drawImage(image, 0, 0, image.width, image.height);
    }
    image.src = imageSrc;
  } else {
    scanlineCtx.clearRect(0, 0, scanlineCanvas.width, scanlineCanvas.height);
  }
}

// Add event listener to radio buttons
const scanlineRadioButtons = document.querySelectorAll('input[name="scanlines"]');
scanlineRadioButtons.forEach((button) => {
  button.addEventListener('change', setScanlinesImage);
});

// Call setScanlinesImage to set initial image
setScanlinesImage();
