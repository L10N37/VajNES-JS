/*
<!-- solid black underlay to block main page -->
<div id="black-screen-modal" class="blackScreenModal">
 <canvas id="blackCanvas"></canvas>
</div>
*/

// Get a reference to all canvas elements
let systemScreen = document.getElementById('system-screen-modal')
let grilleScreen = document.getElementById('grille-screen-modal')
let blackScreen = document.getElementById('black-screen-modal')

// Get a reference to the canvas element
let canvas = document.getElementById("screen-canvas");
let grilleCanvas = document.getElementById("grille-canvas");
let blackCanvas = document.getElementById("grille-canvas");

// Get the 2D rendering context for the canvas
let ctx = canvas.getContext("2d");
let grille_ctx = grilleCanvas.getContext("2d");

// Set the canvas size to 256 x 240 pixels
canvas.width = 256;
canvas.height = 240;
grilleCanvas.width = 256;
grilleCanvas.height = 240;

// Set the default scale factor
let scaleFactor = 2;

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

    ctx.scale(scaleFactor, scaleFactor);
    grille_ctx.scale(scaleFactor, scaleFactor);

    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    grilleCanvas.style.width = `${canvas.width}px`;
    grilleCanvas.style.height = `${canvas.height}px`;

    systemScreen.style.width = `${canvas.width}px`;
    systemScreen.style.height = `${canvas.height}px`;
    grilleScreen.style.width = `${canvas.width}px`;
    grilleScreen.style.height = `${canvas.height}px`;
  }
});

// Scale the canvas context
ctx.scale(scaleFactor, scaleFactor);
grille_ctx.scale(scaleFactor, scaleFactor);

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

// Click event and function on button to toggle the system screen modal
const screenButton = document.getElementById("clickedScreen");
screenButton.addEventListener("click", function() {
    systemScreen.style.display = "block";
    grilleScreen.style.display = "block";
    blackScreen.style.display = "block";
});

const exitOption = systemScreen.querySelector(".optionsBar li:nth-child(3)");
exitOption.addEventListener("click", function() {
  systemScreen.style.display = "none";
  grilleScreen.style.display = "none";
  blackScreen.style.display = 'none';
});

function handleEscapeKey(event) {
  if (event.key === "Escape") {
    systemScreen.style.display = "none";
    grilleScreen.style.display = "none";
    blackScreen.style.display = 'none';
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
