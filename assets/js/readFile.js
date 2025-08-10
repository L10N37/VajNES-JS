
let isRomLoaded = false;

function readFile(input) {
  const file = input.files[0];
  if (!file || file.name.split('.').pop().toLowerCase() !== 'nes') {
    console.error('Invalid file type. Please select a NES ROM file.');
    return;
  }

  const reader = new FileReader();
  reader.readAsArrayBuffer(file);

  reader.onload = function () {
  const romBytes = new Uint8Array(reader.result);

    // ---- Confirm valid NES header (magic number) ----
    if (
      romBytes[0] !== 0x4E || romBytes[1] !== 0x45 ||
      romBytes[2] !== 0x53 || romBytes[3] !== 0x1A
    ) {
      console.warn('ROM file does not contain a valid NES header.');
      return;
    }

    // ============================================================================
    const headerButton = document.getElementById('header-button');
    // Remove old event if exists to avoid multiple alerts
    headerButton.replaceWith(headerButton.cloneNode(true));
    const freshButton = document.getElementById('header-button');

    freshButton.addEventListener('click', function() {
      let prgBanks = nesHeader[4];
      let chrBanks = nesHeader[5];
      let mapperNumber = (nesHeader[6] >> 4) | (nesHeader[7] & 0xf0);
      let mirroring = (nesHeader[6] & 0x01) ? 'Vertical' : 'Horizontal';

      let info =
        'System: NES\n' +
        'PRG ROM Size: ' + prgBanks * 16 + ' KB\n' +
        'CHR ROM Size: ' + chrBanks * 8 + ' KB - ' +
        (chrBanks === 0 ? 'Uses CHR RAM' : 'Uses CHR ROM') + '\n' +
        'Mapper Number: ' + mapperNumber + '\n' +
        'Mirroring: ' + mirroring + '\n' +
        'Battery-Backed: ' + ((nesHeader[6] & 0x02) ? 'Yes' : 'No') + '\n' +
        'Trainer: ' + ((nesHeader[6] & 0x04) ? 'Yes' : 'No') + '\n' +
        'Four Screen VRAM: ' + ((nesHeader[6] & 0x08) ? 'Yes' : 'No') + '\n';
      window.alert(info);
    });
  // ================================================================================


    // ---- Extract PRG/CHR sizes from header ----
    const prgBanks = romBytes[4]; // Number of 16KB PRG-ROM banks
    const chrBanks = romBytes[5]; // Number of 8KB CHR-ROM banks
    const prgSize = prgBanks * 0x4000; // 16KB per bank
    const chrSize = chrBanks * 0x2000; // 8KB per bank

    // ---- For debugging/validation, log what we see ----
    console.log(`[HEADER] PRG banks: ${prgBanks} (${prgSize} bytes), CHR banks: ${chrBanks} (${chrSize} bytes)`);
    console.log(`[HEADER] Mapper: ${((romBytes[6] >> 4) | (romBytes[7] & 0xF0))}, Mirroring: ${romBytes[6] & 0x01 ? 'Vertical' : 'Horizontal'}`);

    // ---- Slice out PRG-ROM ----
    prgRom = romBytes.slice(16, 16 + prgSize);

    // ---- Slice out CHR-ROM, if present ----
    if (chrSize > 0) {
      chrRom = romBytes.slice(16 + prgSize, 16 + prgSize + chrSize);
    } else {
      chrRom = null; // Game uses CHR-RAM, not ROM (rare for early games)
    }

    // --- More debugging, sizes
    console.log(`[Loader] Loaded PRG-ROM: ${prgRom.length} bytes`);
    console.log(`[Loader] Loaded CHR-ROM: ${chrRom ? chrRom.length : 0} bytes`);

    // --- Kick off the mapper to finish PRG-ROM setup (mirroring)
    mapper(romBytes.slice(0, 16)); // Just pass the header

    updateDebugTables();
    isRomLoaded = true; // only used atm for fuzzy audio to be cut off
  };

  reader.onerror = function () {
    console.log(reader.error);
  };
}
