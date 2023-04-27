// Get modal elements
var modal = document.getElementById("modal");
var modalOkBtn = document.getElementById("modal-ok-btn");
var modalCancelBtn = document.getElementById("modal-cancel-btn");

// Get display button element
var displayBtn = document.querySelector(".display-dropdown button");

// Add click event to display button
displayBtn.addEventListener("click", function() {
  // Show modal window
  modal.style.display = "block";
});

// Add click event to modal OK button
modalOkBtn.addEventListener("click", function() {
  // Get selected background colors
  var selectedColors = [];
  var checkboxes = document.querySelectorAll("input[name='color']");
  for (var i = 0; i < checkboxes.length; i++) {
    if (checkboxes[i].checked) {
      selectedColors.push(checkboxes[i].value);
    }
  }
  
  // Set selected color variable
  if (selectedColors.length > 0) {
    var selectedColor = selectedColors[0];
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