// Get a reference to all canvas elements
const systemScreen = document.getElementById('system-screen-modal')
const grilleScreen = document.getElementById('grille-screen-modal')
const scanlineScreen = document.getElementById('scanline-simulation-modal')
const blackScreen = document.getElementById('black-screen-modal')

// Get a reference to the canvas element
const canvas = document.getElementById("screen-canvas");
const grilleCanvas = document.getElementById("grille-canvas");
const scanlineCanvas = document.getElementById("scanline-canvas");

// Get the 2D rendering context for the canvas
const ctx = canvas.getContext("2d");
const grille_ctx = grilleCanvas.getContext("2d");
const scanlineCanvas_ctx = scanlineCanvas.getContext("2d");

// Set the default scale factor
let scaleFactor = 2;

// Set the canvas sizes to 256 x 240 pixels
const canvases = [canvas, grilleCanvas, scanlineCanvas];

for (let i = 0; i < canvases.length; i++) {
  canvases[i].width = 256;
  canvases[i].height = 240;
}

// event listener on F2 key, adjust scale factor on press, this is a shorcut
// it's also available to change with radio buttons in the menu on top of the screen
document.addEventListener("keydown", function(event) {
  if (event.key === "F2") {
    switch (scaleFactor) {
      case 2:
        scaleFactor = 3;
        break;
      case 3:
        scaleFactor = 4;
        break;
      case 4:
        scaleFactor = 5;
        break;
      case 5:
          scaleFactor = 5.4;
          break;
      case 5.4:
          scaleFactor = 2;      
      break;
    }
    
    // Update the canvas size and scale
    canvas.width = 256 * scaleFactor;
    canvas.height = 240 * scaleFactor;
    grilleCanvas.width = 256 * scaleFactor;
    grilleCanvas.height = 240 * scaleFactor;
    scanlineCanvas.width = 256 * scaleFactor;
    scanlineCanvas.height = 240 * scaleFactor;

    ctx.scale(scaleFactor, scaleFactor);
    grille_ctx.scale(scaleFactor, scaleFactor);
    scanlineCanvas_ctx.scale(scaleFactor, scaleFactor)

    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    grilleCanvas.style.width = `${canvas.width}px`;
    grilleCanvas.style.height = `${canvas.height}px`;
    scanlineCanvas.style.width = `${canvas.width}px`;
    scanlineCanvas.style.height = `${canvas.height}px`;

    systemScreen.style.width = `${canvas.width}px`;
    systemScreen.style.height = `${canvas.height}px`;
    grilleScreen.style.width = `${canvas.width}px`;
    grilleScreen.style.height = `${canvas.height}px`;
    scanlineScreen.style.width = `${canvas.width}px`;
    scanlineScreen.style.height = `${canvas.height}px`;
  }
});

// Scale the canvas context
ctx.scale(scaleFactor, scaleFactor);
grille_ctx.scale(scaleFactor, scaleFactor);
scanlineCanvas_ctx.scale(scaleFactor, scaleFactor);

// Set the CSS width and height of the canvas to be larger than the resolution
canvas.style.width = `${canvas.width*scaleFactor}px`;
canvas.style.height = `${canvas.height*scaleFactor}px`;
grilleCanvas.style.width = `${canvas.width*scaleFactor}px`;
grilleCanvas.style.height = `${canvas.height*scaleFactor}px`;


// Set the CSS width and height of the canvas parent to be the same as the scaled canvas
systemScreen.style.width = `${canvas.width*scaleFactor}px`;
systemScreen.style.height = `${canvas.height*scaleFactor}px`;
grilleScreen.style.width = `${canvas.width*scaleFactor}px`;
grilleScreen.style.height = `${canvas.height*scaleFactor}px`;
scanlineScreen.style.width = `${scanlineCanvas.width*scaleFactor}px`;
scanlineScreen.style.height = `${scanlineCanvas.height*scaleFactor}px`;


// Click event and function on button to toggle the system screen modal
const screenButton = document.getElementById("clickedScreen");
screenButton.addEventListener("click", function() {
    systemScreen.style.display = "block";
    grilleScreen.style.display = "block";
    blackScreen.style.display = "block";
    scanlineScreen.style.display = "block";
});

const exitOption = systemScreen.querySelector(".optionsBar li:nth-child(3)");
exitOption.addEventListener("click", function() {
  systemScreen.style.display = "none";
  grilleScreen.style.display = "none";
  blackScreen.style.display = "none";
  scanlineScreen.style.display = "none";
});

function handleEscapeKey(event) {
  if (event.key === "Escape") {
    systemScreen.style.display = "none";
    grilleScreen.style.display = "none";
    blackScreen.style.display = 'none';
    scanlineScreen.style.display = "none";
  }
}

document.addEventListener('keydown', handleEscapeKey);

// Generate a random noise pattern
function generateNoise() {
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.floor(Math.random() * 255);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return imageData;
}

// RF noise animation
let requestId; // store the request ID for canceling the animation

function animate() {
  // Generate a new noise pattern
  const imageData = generateNoise();
  // Draw the new noise pattern over the previous frame
  ctx.globalCompositeOperation = 'difference';
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.putImageData(imageData, 0, 0);
  // Schedule the next animation frame
  requestId = requestAnimationFrame(animate);
}

// Stop the animation and clear the canvas
function stopAnimation() {
  cancelAnimationFrame(requestId); // cancel the next animation frame
  ctx.clearRect(0, 0, canvas.width, canvas.height); // clear the canvas
}

// Start the animation
animate();

// composite blur effect
const slider = document.getElementById('composite-blur-slider');

slider.addEventListener('input', (event) => {
  const value = event.target.value;
  setBlur(value);
});

function setBlur(value) {
  const blur = Math.min(Math.max(value, 0), 5).toFixed(1);
  document.getElementById("screen-canvas").style.filter = `blur(${blur}px)`;
}
