// Get a reference to the canvas parent
let systemScreen = document.getElementById('system-screen-modal')

// Get a reference to the canvas element
let canvas = document.getElementById("screen-canvas");

// Get the 2D rendering context for the canvas
let ctx = canvas.getContext("2d");

// Set the canvas size to 256 x 240 pixels
canvas.width = 256;
canvas.height = 240;

// Set the default scale factor
let scaleFactor = 2;

// event listener on F2 key, adjust scale factor on press
document.addEventListener("keydown", function(event) {
  if (event.key === "F2") {
    switch (scaleFactor) {
      case 2:
        scaleFactor = 4;
        break;
      case 4:
        scaleFactor = 6;
        break;
      case 6:
        scaleFactor = 1;
        break;
      case 1:
        scaleFactor = 2;
        break;
    }
    
    // Update the canvas size and scale
    canvas.width = 256 * scaleFactor;
    canvas.height = 240 * scaleFactor;
    ctx.scale(scaleFactor, scaleFactor);
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    systemScreen.style.width = `${canvas.width}px`;
    systemScreen.style.height = `${canvas.height}px`;
  }
});

// Scale the canvas context
ctx.scale(scaleFactor, scaleFactor);

// Set the CSS width and height of the canvas to be larger than the resolution
canvas.style.width = `${canvas.width*scaleFactor}px`;
canvas.style.height = `${canvas.height*scaleFactor}px`;

// Set the CSS width and height of the canvas parent to be the same as the scaled canvas
systemScreen.style.width = `${canvas.width*scaleFactor}px`;
systemScreen.style.height = `${canvas.height*scaleFactor}px`;

// Click event and function on button to toggle the system screen modal
const screenButton = document.getElementById("clickedScreen");
screenButton.addEventListener("click", function() {
  if (systemScreen.style.display === "block") {
    systemScreen.style.display = "none";
  } else {
    systemScreen.style.display = "block";
  }
});

// Add event listener to close the modal when clicking outside of it
systemScreen.addEventListener('click', function(event) {
  if (event.target !== systemScreen) {
    systemScreen.style.display = 'none';
  }
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
