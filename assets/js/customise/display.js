/*
// Set opacity to Mario image in display menu
const imageContainer = document.querySelector('.mario-container');
imageContainer.style.opacity = '0.5';
*/

// event listener on display button to display the 'display' modal window on click
const displayDropdown = document.querySelector('.display-dropdown');
const modal = document.querySelector('.modal');
// event listener on OK button in modal window, hides modal window
const okButton = document.getElementById("modal-ok-btn");
okButton.addEventListener("click", function() {
  modal.style.display = "none";
});


displayDropdown.addEventListener('click', () => {
  modal.style.display = 'block';
});

  const backgroundRadios = document.getElementsByName('background');
  const imageRadios = document.getElementsByName('image');
  const htmlElement = document.documentElement;

  // Add click event listener to background radios
  backgroundRadios.forEach(radio => {
    radio.addEventListener('click', () => {
      htmlElement.style.backgroundImage = 'none';
      htmlElement.style.backgroundColor = radio.value;
    });
  });

  // Add click event listener to image radios
  imageRadios.forEach(radio => {
    radio.addEventListener('click', () => {
      htmlElement.style.backgroundColor = '';
      htmlElement.style.backgroundImage = `url(${radio.value})`;
    });
  });

