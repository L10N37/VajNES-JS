// Get the scanlines modal
let scanlinesModal = document.querySelector('.scanlinesModal');

// Get the 'Scanlines' LI element
let scanlinesLink = document.querySelector('li:nth-child(2)');

// When the 'Scanlines' link is clicked, show the scanlines modal
scanlinesLink.addEventListener('click', function() {
  scanlinesModal.style.display = 'block';
});

// When the 'OK' button is clicked, hide the scanlines modal
var okButton = document.querySelector('#ok-button');
okButton.addEventListener('click', function() {
  scanlinesModal.style.display = 'none';
});
