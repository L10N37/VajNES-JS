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
    const nesHeader = romBytes.subarray(0, 16);

    // ---- Confirm valid NES header ----
    if (
      romBytes[0] !== 0x4E || romBytes[1] !== 0x45 ||
      romBytes[2] !== 0x53 || romBytes[3] !== 0x1A
    ) {
      console.warn('ROM file does not contain a valid NES header.');
      return;
    }

    // ========= Header button =========
    const headerButton = document.getElementById('header-button');
    headerButton.replaceWith(headerButton.cloneNode(true));
    const freshButton = document.getElementById('header-button');
    freshButton.addEventListener('click', function () {
      const prgBanks = nesHeader[4];
      const chrBanks = nesHeader[5];
      const mapperNumber = (nesHeader[6] >> 4) | (nesHeader[7] & 0xF0);
      const mirroring = (nesHeader[6] & 0x01) ? 'Vertical' : 'Horizontal';

      const info =
        `System: NES\n` +
        `PRG ROM Size: ${prgBanks * 16} KB\n` +
        `CHR ROM Size: ${chrBanks * 8} KB - ${(chrBanks === 0 ? 'Uses CHR RAM' : 'Uses CHR ROM')}\n` +
        `Mapper Number: ${mapperNumber}\n` +
        `Mirroring: ${mirroring}\n` +
        `Battery-Backed: ${((nesHeader[6] & 0x02) ? 'Yes' : 'No')}\n` +
        `Trainer: ${((nesHeader[6] & 0x04) ? 'Yes' : 'No')}\n` +
        `Four Screen VRAM: ${((nesHeader[6] & 0x08) ? 'Yes' : 'No')}\n`;
      window.alert(info);
    });

    // ---- Extract PRG/CHR sizes ----
    const prgBanks = romBytes[4]; // 16KB banks
    const chrBanks = romBytes[5]; // 8KB banks
    const prgSize  = prgBanks * 0x4000;
    const chrSize  = chrBanks * 0x2000;

    console.debug(`[HEADER] PRG banks: ${prgBanks} (${prgSize} bytes), CHR banks: ${chrBanks} (${chrSize} bytes)`);
    console.debug(`[HEADER] Mapper: ${((romBytes[6] >> 4) | (romBytes[7] & 0xF0))}, Mirroring: ${romBytes[6] & 0x01 ? 'Vertical' : 'Horizontal'}`);

    // ---- Determine mirroring mode from header ----
    const fourScreen   = (nesHeader[6] & 0x08) !== 0;
    const verticalFlag = (nesHeader[6] & 0x01) !== 0;
    MIRRORING = fourScreen ? 'four' : (verticalFlag ? 'vertical' : 'horizontal');

    // ---- Slice out PRG-ROM ----
    prgRom = romBytes.slice(16, 16 + prgSize);

    // ---- Load CHR data directly into shared CHR_ROM ----
    const chrStart = 16 + prgSize;
    if (chrSize > 0) {
      CHR_ROM.set(romBytes.subarray(chrStart, chrStart + chrSize));
      chrIsRAM = false;
    } else {
      CHR_ROM.fill(0x00);
      chrIsRAM = true;
    }

    console.debug(`[Loader] Loaded PRG-ROM: ${prgRom.length} bytes`);
    console.debug(`[Loader] CHR is ${chrIsRAM ? 'RAM' : 'ROM'}; size=${CHR_ROM.byteLength} bytes`);

    // --- Mapper setup ---
    mapper(nesHeader);

    // Update debug tables
    updateDebugTables();

    // Notify PPU worker ROM is ready
    ppuWorker.postMessage({ type: 'romReady' });
  };

  reader.onerror = function () {
    console.debug(reader.error);
  };
}
