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
    const nesHeader = romBytes.subarray(0, 16);

    // ---- Confirm valid NES header (magic number) ----
    if (
      romBytes[0] !== 0x4E || romBytes[1] !== 0x45 ||
      romBytes[2] !== 0x53 || romBytes[3] !== 0x1A
    ) {
      console.warn('ROM file does not contain a valid NES header.');
      return;
    }

    // ========= Header button (live view) =========
    const headerButton = document.getElementById('header-button');
    headerButton.replaceWith(headerButton.cloneNode(true));
    const freshButton = document.getElementById('header-button');
    freshButton.addEventListener('click', function () {
      const prgBanks = nesHeader[4];
      const chrBanks = nesHeader[5];
      const mapperNumber = (nesHeader[6] >> 4) | (nesHeader[7] & 0xF0);
      const mirroring = (nesHeader[6] & 0x01) ? 'Vertical' : 'Horizontal';

      const info =
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

    // ---- Extract PRG/CHR sizes from header ----
    const prgBanks = romBytes[4]; // 16KB banks
    const chrBanks = romBytes[5]; // 8KB banks
    const prgSize  = prgBanks * 0x4000;
    const chrSize  = chrBanks * 0x2000;

    console.log(`[HEADER] PRG banks: ${prgBanks} (${prgSize} bytes), CHR banks: ${chrBanks} (${chrSize} bytes)`);
    console.log(`[HEADER] Mapper: ${((romBytes[6] >> 4) | (romBytes[7] & 0xF0))}, Mirroring: ${romBytes[6] & 0x01 ? 'Vertical' : 'Horizontal'}`);

    // ---- Slice out PRG-ROM ----
    prgRom = romBytes.slice(16, 16 + prgSize);

    // ---- Load CHR (ROM or RAM) into SHARED SAB ----
    if (chrSize > 0) {
      // Ensure SAB matches cart size
      if (!SHARED.SAB_CHR || SHARED.CHR_ROM.byteLength !== chrSize) {
        SHARED.SAB_CHR = new SharedArrayBuffer(chrSize);
        SHARED.CHR_ROM = new Uint8Array(SHARED.SAB_CHR);
        // Inform worker of new CHR buffer
        ppuWorker.postMessage({ type: 'assetsUpdate', SAB_ASSETS: { CHR_ROM: SHARED.SAB_CHR } });
      }
      const chrStart = 16 + prgSize;
      SHARED.CHR_ROM.set(romBytes.subarray(chrStart, chrStart + chrSize));
      window.chrIsRAM = false;
    } else {
      // CHR-RAM cart (writes to $0000-$1FFF allowed)
      if (!SHARED.SAB_CHR || SHARED.CHR_ROM.byteLength !== 0x2000) {
        SHARED.SAB_CHR = new SharedArrayBuffer(0x2000);
        SHARED.CHR_ROM = new Uint8Array(SHARED.SAB_CHR);
        ppuWorker.postMessage({ type: 'assetsUpdate', SAB_ASSETS: { CHR_ROM: SHARED.SAB_CHR } });
      }
      SHARED.CHR_ROM.fill(0x00);
      window.chrIsRAM = true;
    }

    console.log(`[Loader] Loaded PRG-ROM: ${prgRom.length} bytes`);
    console.log(`[Loader] CHR is ${window.chrIsRAM ? 'RAM' : 'ROM'}; size=${SHARED.CHR_ROM.byteLength} bytes`);

    // --- Kick off mapper to finish PRG-ROM setup (mirroring, reset vector)
    mapper(romBytes.slice(0, 16)); // pass header only

    updateDebugTables();
    isRomLoaded = true;
    ppuWorker.postMessage({ type: 'romReady' });
  };

  reader.onerror = function () {
    console.log(reader.error);
  };
}
