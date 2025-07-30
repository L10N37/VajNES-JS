// Commonly-used NES palettes from emulation sources:
// - nesClassic (hardware‑approximation / neutral)
// - fceuxDefault (FCEUX default palette)
// - smc2005 (mildly saturated "Nintendo Power" style)

window.PALETTES = {
    nesClassic: {
        0x00: "#7C7C7C", 0x01: "#0000FC", 0x02: "#0000BC", 0x03: "#4428BC",
        0x04: "#940084", 0x05: "#A80020", 0x06: "#A81000", 0x07: "#881400",
        0x08: "#503000", 0x09: "#007800", 0x0A: "#006800", 0x0B: "#005800",
        0x0C: "#004058", 0x0D: "#000000", 0x0E: "#000000", 0x0F: "#000000",
        0x10: "#BCBCBC", 0x11: "#0078F8", 0x12: "#0058F8", 0x13: "#6844FC",
        0x14: "#D800CC", 0x15: "#E40058", 0x16: "#F83800", 0x17: "#E45C10",
        0x18: "#AC7C00", 0x19: "#00B800", 0x1A: "#00A800", 0x1B: "#00A844",
        0x1C: "#008888", 0x1D: "#000000", 0x1E: "#000000", 0x1F: "#000000",
        0x20: "#F8F8F8", 0x21: "#3CBCFC", 0x22: "#6888FC", 0x23: "#9878F8",
        0x24: "#F878F8", 0x25: "#F85898", 0x26: "#F87858", 0x27: "#FCA044",
        0x28: "#F8B800", 0x29: "#B8F818", 0x2A: "#58D854", 0x2B: "#58F898",
        0x2C: "#00E8D8", 0x2D: "#787878", 0x2E: "#000000", 0x2F: "#000000",
        0x30: "#FCFCFC", 0x31: "#A4E4FC", 0x32: "#B8B8F8", 0x33: "#D8B8F8",
        0x34: "#F8B8F8", 0x35: "#F8A4C0", 0x36: "#F0D0B0", 0x37: "#FCE0A8",
        0x38: "#F8D878", 0x39: "#D8F878", 0x3A: "#B8F8B8", 0x3B: "#B8F8D8",
        0x3C: "#00FCFC", 0x3D: "#F8D8F8", 0x3E: "#000000", 0x3F: "#000000"
      },
  
    fceuxDefault: {
      0x00: "#7F7F7F", 0x01: "#0000FF", 0x02: "#1B00FF", 0x03: "#4E00B2",
      0x04: "#850085", 0x05: "#A50028", 0x06: "#A20A00", 0x07: "#7B1400",
      0x08: "#4D2000", 0x09: "#137600", 0x0A: "#006A00", 0x0B: "#005900",
      0x0C: "#004C82", 0x0D: "#000000", 0x0E: "#000000", 0x0F: "#000000",
      0x10: "#B8B8B8", 0x11: "#0078F8", 0x12: "#0058F8", 0x13: "#6844FC",
      0x14: "#D800CC", 0x15: "#E40058", 0x16: "#F83800", 0x17: "#E45C10",
      0x18: "#AC7C00", 0x19: "#00B800", 0x1A: "#00A800", 0x1B: "#00A844",
      0x1C: "#008888", 0x1D: "#000000", 0x1E: "#000000", 0x1F: "#000000",
      0x20: "#F8F8F8", 0x21: "#3CBCFC", 0x22: "#6888FC", 0x23: "#9878F8",
      0x24: "#F878F8", 0x25: "#F85898", 0x26: "#F87858", 0x27: "#FCA044",
      0x28: "#F8B800", 0x29: "#B8F818", 0x2A: "#58D854", 0x2B: "#58F898",
      0x2C: "#00E8D8", 0x2D: "#787878", 0x2E: "#000000", 0x2F: "#000000",
      0x30: "#FCFCFC", 0x31: "#A4E4FC", 0x32: "#B8B8F8", 0x33: "#D8B8F8",
      0x34: "#F8B8F8", 0x35: "#F8A4C0", 0x36: "#F0D0B0", 0x37: "#FCE0A8",
      0x38: "#F8D878", 0x39: "#D8F878", 0x3A: "#B8F8B8", 0x3B: "#B8F8D8",
      0x3C: "#00FCFC", 0x3D: "#F8D8F8", 0x3E: "#000000", 0x3F: "#000000"
    },
  
    smc2005: {
      0x00: "#8B8B7F", 0x01: "#1414CE", 0x02: "#3C00C0", 0x03: "#6000A8",
      0x04: "#900098", 0x05: "#A40030", 0x06: "#A40008", 0x07: "#8C1800",
      0x08: "#681C00", 0x09: "#008000", 0x0A: "#007800", 0x0B: "#007A14",
      0x0C: "#006C60", 0x0D: "#000000", 0x0E: "#000000", 0x0F: "#000000",
      0x10: "#B8B8B8", 0x11: "#0044FF", 0x12: "#3858FF", 0x13: "#7058FF",
      0x14: "#D800D8", 0x15: "#F80050", 0x16: "#FC5800", 0x17: "#F46814",
      0x18: "#B6A800", 0x19: "#009000", 0x1A: "#00A000", 0x1B: "#00A850",
      0x1C: "#00A8A8", 0x1D: "#000000", 0x1E: "#000000", 0x1F: "#000000",
      0x20: "#F8F8F8", 0x21: "#58B8FF", 0x22: "#7898FC", 0x23: "#B8B8F8",
      0x24: "#E8B8F8", 0x25: "#F8A4C0", 0x26: "#F8C090", 0x27: "#FCC870",
      0x28: "#FCF890", 0x29: "#C8FC90", 0x2A: "#90FCA8", 0x2B: "#90FCFC",
      0x2C: "#68F8F8", 0x2D: "#A8A8A8", 0x2E: "#000000", 0x2F: "#000000",
      0x30: "#FCFCFC", 0x31: "#C8E8FC", 0x32: "#D8D8FC", 0x33: "#E8D8FC",
      0x34: "#F8D8FC", 0x35: "#F8D8E0", 0x36: "#F0E0D0", 0x37: "#F8F0D8",
      0x38: "#F8F8B8", 0x39: "#E0F8B8", 0x3A: "#D0F8D8", 0x3B: "#D0F8F8",
      0x3C: "#A8F8F8", 0x3D: "#E8D8F8", 0x3E: "#000000", 0x3F: "#000000"
    }
  };
  
  window.currentPaletteName = "nesClassic";
  window.currentPalette = window.PALETTES[window.currentPaletteName];
  
  function setCurrentPalette(name) {
    if (window.PALETTES[name]) {
      window.currentPaletteName = name;
      window.currentPalette = window.PALETTES[name];
      console.log(`[Palette] using '${name}'`);
    } else {
      console.warn(`[Palette] Unknown palette name '${name}'`);
    }
  }
  window.setCurrentPalette = setCurrentPalette;
  
  function getColorForNESByte(nesByte) {
    const idx = nesByte & 0x3F;
    return window.currentPalette?.[idx] || "#000000";
  }
  window.getColorForNESByte = getColorForNESByte;
  
  // palette selection
  document.querySelectorAll('input[name="palette"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const selectedPalette = e.target.value;
      setCurrentPalette(selectedPalette);
      console.log(`[TileViewer] Selected palette: ${selectedPalette}`);
  
      if (window.lastCHRData) {
        drawTilesToCanvas(window.lastCHRData, "bgCanvas");
        drawTilesToCanvas(window.lastCHRData, "fgCanvas");
      }
    });
  });
  
