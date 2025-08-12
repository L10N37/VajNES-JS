let scaleModal = document.getElementById('scale-modal');

// Open the modal (first item in your options bar)
const scaleButton = systemScreen.querySelector('.optionsBar li:nth-child(1)');
scaleButton.addEventListener('click', () => {
  scaleModal.style.display = 'block';
});

// Close button inside the modal
const closeModal = scaleModal.querySelector('.closeModal');
closeModal.addEventListener('click', () => {
  scaleModal.style.display = 'none';
});

// Radio group -> update global scaleFactor then call applyScale()
const scaleRadioButtons = scaleModal.querySelectorAll('input[type=radio]');
for (let i = 0; i < scaleRadioButtons.length; i++) {
  scaleRadioButtons[i].addEventListener('click', () => {
    const next = parseFloat(scaleRadioButtons[i].value);
    if (!isFinite(next) || next <= 0) return;
    scaleFactor = next;
    applyScale();
    scaleModal.style.display = 'none';
  });
}
