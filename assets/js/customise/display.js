const backgroundRadios = document.getElementsByName('background');
const imageRadios = document.getElementsByName('image');
const htmlElement = document.documentElement;

// Get the stored background image
const storedImage = localStorage.getItem('selectedImage');

// Set the background image if there is a stored image
if (storedImage) {
  htmlElement.style.backgroundImage = `url(${storedImage})`;
}

// Get the stored background color
const storedColor = localStorage.getItem('selectedColor');

// Set the background color if there is a stored color
if (storedColor) {
  htmlElement.style.backgroundColor = storedColor;
}

// event listener on display button to display the 'display' modal window on click
const displayDropdown = document.getElementById('clickedDisplay');
const modal = document.querySelector('.modal');
// event listener on OK button in modal window, hides modal window
const okButton = document.getElementById("modal-ok-btn");
okButton.addEventListener("click", function() {
  modal.style.display = "none";
});


displayDropdown.addEventListener('click', () => {
  modal.style.display = 'block';
});

// Add click event listener to background radios
backgroundRadios.forEach(radio => {
  radio.addEventListener('click', () => {
    htmlElement.style.backgroundImage = 'none';
    htmlElement.style.backgroundColor = radio.value;
    localStorage.removeItem('selectedImage');
    localStorage.setItem('selectedColor', radio.value);
  });

  // If the radio button matches the stored color, select it and set the background color
  if (radio.value === storedColor) {
    radio.checked = true;
    htmlElement.style.backgroundColor = storedColor;
  }
});

  // Add click event listener to image radios
  imageRadios.forEach(radio => {
    radio.addEventListener('click', () => {
      htmlElement.style.backgroundColor = '';
      htmlElement.style.backgroundImage = `url(${radio.value})`;
      localStorage.removeItem('selectedColor');
      localStorage.setItem('selectedImage', radio.value);
    });
  });