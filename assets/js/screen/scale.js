
// Get a reference to the scale modal element
let scaleModal = document.getElementById("scale-modal")

// Click event and function on "Scale" button to show the scale modal
const scaleButton = systemScreen.querySelector(".optionsBar li:nth-child(1)");
scaleButton.addEventListener("click", function() {
  scaleModal.style.display = "block";
});

// Click event and function on close button of scale modal
const closeModal = scaleModal.querySelector(".closeModal");
closeModal.addEventListener("click", function() {
  scaleModal.style.display = "none";
});


const scaleRadioButtons = scaleModal.querySelectorAll("input[type=radio]");
for (let i = 0; i < scaleRadioButtons.length; i++) {
  scaleRadioButtons[i].addEventListener("click", function() {
    scaleFactor = parseFloat(scaleRadioButtons[i].value);
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

    scaleModal.style.display = "none";
  });
}

/*
// Get a reference to the canvas parent
let systemScreen = document.getElementById('system-screen-modal')
let grilleScreen = document.getElementById('grille-screen-modal')

// Get a reference to the canvas element
let canvas = document.getElementById("screen-canvas");
let grilleCanvas = document.getElementById("grille-canvas");
*/