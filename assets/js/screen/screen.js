// Get a reference to the canvas parent
let systemScreen = document.getElementById('system-screen-modal')

// Get a reference to the canvas element
let canvas = document.getElementById("screen-canvas");

// Get the 2D rendering context for the canvas
let ctx = canvas.getContext("2d");

// Set the canvas size to 256 x 240 pixels
canvas.width = 256;
canvas.height = 240;

// Set the scale factor
let scaleFactor = 4;

// Scale the canvas context
ctx.scale(scaleFactor, scaleFactor);

// Set the CSS width and height of the canvas to be larger than the resolution
canvas.style.width = `${canvas.width*scaleFactor}px`;
canvas.style.height = `${canvas.height*scaleFactor}px`;

// Set the CSS width and height of the canvas parent to be the same as the scaled canvas
systemScreen.style.width = `${canvas.width*scaleFactor}px`;
systemScreen.style.height = `${canvas.height*scaleFactor}px`;

// Click event and function on button to open the system screen modal
const screenButton = document.getElementById("clickedScreen");
screenButton.addEventListener("click", function() {
  systemScreen.style.display = "block";
});

// Click event and function on button to close the system screen modal
const closeScreenButton = document.querySelector('.closeScreenCanvas');
closeScreenButton.addEventListener("click", function() {
  systemScreen.style.display = "none";
});

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

// Draw the initial noise pattern
ctx.putImageData(generateNoise(), 0, 0);

// Animate the noise pattern over time
function animate() {
  // Generate a new noise pattern
  const imageData = generateNoise();
  // Draw the new noise pattern over the previous frame
  ctx.globalCompositeOperation = 'difference';
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.putImageData(imageData, 0, 0);
  // Schedule the next animation frame
  requestAnimationFrame(animate);
}

// Start the animation
animate();
