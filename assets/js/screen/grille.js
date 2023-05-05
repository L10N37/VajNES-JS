// Get the scanlines modal
let scanlinesModal = document.querySelector('.scanlinesModal');

// Get the 'Scanlines' LI element
let scanlinesLink = document.querySelector('li:nth-child(2)');

// When the 'Scanlines' link is clicked, show the scanlines modal
scanlinesLink.addEventListener('click', function() {
  scanlinesModal.style.display = 'block';
});

// When the 'OK' button is clicked, hide the scanlines modal
let grilleOkButton = document.querySelector('#ok-button');
grilleOkButton.addEventListener('click', function() {
  scanlinesModal.style.display = 'none';
});

const testImageCheckbox = document.getElementById('test-image-checkbox');

testImageCheckbox.addEventListener('click', function() {
  // load test image
  if (testImageCheckbox.checked) {
    stopAnimation();
    const img = new Image();
    img.src = 'assets/images/test/tmnt.png'; // set the source of the image
    img.onload = function() {
      // set canvas size to match image size
      canvas.width = img.width;
      canvas.height = img.height;
      // draw the image on the canvas which is now automatically scaled to fit.
      ctx.drawImage(img, 0, 0);
    };
  }
  // else play RF fuzz again
  else {
    animate();
  }
});
