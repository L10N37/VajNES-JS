// Get modal elements
let modal = document.getElementById("modal");
let modalOkBtn = document.getElementById("modal-ok-btn");
let modalCancelBtn = document.getElementById("modal-cancel-btn");

// Get display button element
let displayBtn = document.querySelector(".display-dropdown button");

// Add click event to display button
displayBtn.addEventListener("click", function() {
  // Show modal window
  modal.style.display = "block";
});

// Add click event to modal OK button
modalOkBtn.addEventListener("click", function() {
  // Get selected background colors
  let selectedColors = [];
  let checkboxes = document.querySelectorAll("input[name='color']");
  for (let i = 0; i < checkboxes.length; i++) {
    if (checkboxes[i].checked) {
      selectedColors.push(checkboxes[i].value);
    }
    //console.log(selectedColors);
  }
  
  // Set selected color letiable
  if (selectedColors.length > 0) {
    let selectedColor = selectedColors[0];
    document.documentElement.style.setProperty('--selected-color', selectedColor);
  }
  
  // Hide modal window
  modal.style.display = "none";
});

// Add click event to modal cancel button
modalCancelBtn.addEventListener("click", function() {
  // Hide modal window
  modal.style.display = "none";
});

// Get the HTML element
const html = document.querySelector('html');

// Set the background color of the HTML element
function setBgColor(color) {
  html.style.backgroundColor = color;
}