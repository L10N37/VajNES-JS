
// adjust transparency of main screen cavnas, this allows simulated scanline effect to show through
const transparencySlider = document.getElementById('transparency-slider');

transparencySlider.addEventListener('input', function() {
  const opacity = transparencySlider.value / 100;
  systemScreen.style.opacity = opacity;
});

// adjust the grille canvas to change the intensity of the scanline effect from the grille
const intensitySlider = document.getElementById('intensity-slider');

function handleIntensityChange() {
  const intensity = intensitySlider.value / 100;
  grilleCanvas.style.opacity = intensity;
}

intensitySlider.addEventListener('input', handleIntensityChange);

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

function clearGrilleCanvas() {
  grille_ctx.clearRect(0, 0, grilleCanvas.width, grilleCanvas.height);
  return 'none';
}

function drawShadowMask() {
  // Clear the grille canvas
  grille_ctx.clearRect(0, 0, grilleCanvas.width, grilleCanvas.height);

  // Draw the shadow mask
  grille_ctx.fillStyle = 'black';
  grille_ctx.fillRect(0, 0, grilleCanvas.width, grilleCanvas.height);
  grille_ctx.fillStyle = 'white';
  for (let i = 0; i < grilleCanvas.width; i += 8) {
    for (let j = 0; j < grilleCanvas.height; j += 8) {
      grille_ctx.fillRect(i, j, 4, 4);
    }
  }

  // Return the type of the grille
  return 'shadow-mask';
}

function drawApertureGrille() {
  // Clear the grille canvas
  grille_ctx.clearRect(0, 0, grilleCanvas.width, grilleCanvas.height);

  // Draw the aperture grille
  grille_ctx.fillStyle = 'black';
  grille_ctx.fillRect(0, 0, grilleCanvas.width, grilleCanvas.height);
  grille_ctx.fillStyle = 'white';
  for (let i = 0; i < grilleCanvas.width; i += 4) {
    grille_ctx.fillRect(i, 0, 2, grilleCanvas.height);
  }
}

  const grilleTypeRadios = document.getElementsByName('grille-type');
  
  // Add event listeners to grille type radios
  grilleTypeRadios.forEach(function(radio) {
    radio.addEventListener('click', function() {
      // Check which radio is selected and set current grille type accordingly
      if (radio.value === 'aperture-grille') {
        drawApertureGrille();
      } else if (radio.value === 'shadow-mask') {
        currentGrilleType = drawShadowMask();
      } else if (radio.value === 'none') {
        currentGrilleType = clearGrilleCanvas();;
      }

    });
  });

  function drawScanlines(canvas, intensity) {
    const ctx = canvas.getContext('2d');
    const lineHeight = 2;
    const gap = 2;
    const alpha = intensity / 100;
  
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  
    for (let y = 0; y < canvas.height; y += lineHeight + gap) {
      ctx.fillRect(0, y, canvas.width, lineHeight);
    }
  }
  
const scanlineIntensitySlider = document.getElementById('scanlines-intensity-slider');

scanlineIntensitySlider.addEventListener('input', () => {
  const intensity = parseInt(scanlineIntensitySlider.value);
  drawScanlines(scanlineCanvas, intensity);
});
