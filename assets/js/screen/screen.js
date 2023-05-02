
// Get a reference to the canvas parent (hide and show modal
let systemScreen = document.getElementById('system-screen-modal')

// Get a reference to the canvas element
let canvas = document.getElementById("screen-canvas");

// Get the 2D rendering context for the canvas
let ctx = canvas.getContext("2d");

// Set the canvas size to 256 x 240 pixels
canvas.width = 256;
canvas.height = 240;
      
    //click event and FUNCTION on button to open the system screen modal
    const screenButton = document.getElementById("clickedScreen");
screenButton.addEventListener("click", function() {

  systemScreen.style.display = "block";
  
});

    //click event and FUNCION on button to open the system screen modal
    const closeScreenButton = document.querySelector('.closeScreenCanvas');
closeScreenButton.addEventListener("click", function() {

  systemScreen.style.display = "none";

});

//----------  RENDER ON THE STUFF ONTO THE SCREEN ---------- //

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