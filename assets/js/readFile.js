let MIRRORING = null;
let prgRamBattery = false;
let headerVersion = 1;

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

    // ---- Extract PRG/CHR sizes ----
    const prgBanks = nesHeader[4];
    const chrBanks = nesHeader[5];
    const prgSize  = prgBanks * 0x4000;
    const chrSize  = chrBanks * 0x2000;

    // ---- Detect header version ----
    headerVersion = ((nesHeader[7] >> 2) & 0x03) === 0x02 ? 2 : 1;

    // ---- Mapper decoding ----
    const mapperLow  = nesHeader[6] >> 4;
    const mapperHigh = nesHeader[7] & 0xF0;
    let mapperExt    = 0;
    if (headerVersion === 2) {
      mapperExt = (nesHeader[8] & 0x0F) << 8; // NES 2.0 upper bits
    }
    mapperNumber = mapperLow | mapperHigh | mapperExt;
    // some mmc1 roms are reading as mapper 155, patch to = 1
    if (mapperNumber === 155) mapperNumber = 1;

    // ---- Flags ----
    prgRamBattery = (nesHeader[6] & 0x02) !== 0;
    const fourScreen   = (nesHeader[6] & 0x08) !== 0;
    const verticalFlag = (nesHeader[6] & 0x01) !== 0;
    MIRRORING = fourScreen ? 'four' : (verticalFlag ? 'vertical' : 'horizontal');

    // ---- Debug header info ----
    console.debug(`[HEADER] Detected iNES v${headerVersion}`);
    console.debug(`[HEADER] PRG banks: ${prgBanks} (${prgSize} bytes), CHR banks: ${chrBanks} (${chrSize} bytes)`);
    console.debug(`[HEADER] Mapper: ${mapperNumber}, Mirroring: ${MIRRORING}`);
    console.debug(`[HEADER] Battery-Backed PRG-RAM: ${prgRamBattery}`);

    // ---- Slice out PRG-ROM ----
    prgRom = romBytes.slice(16, 16 + prgSize);

    // ---- Load CHR data ----
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
    console.debug(`[Loader] PRG-RAM is ${prgRamBattery ? 'battery-backed' : 'volatile'}`);

    // --- Mapper setup ---
    mapper(nesHeader);

    // Update debug tables
    updateDebugTables();

    // ========= Header button =========
    const headerButton = document.getElementById('header-button');
    headerButton.replaceWith(headerButton.cloneNode(true));
    const freshButton = document.getElementById('header-button');
    freshButton.addEventListener('click', function () {
      const info =
        `System: NES\n` +
        `Header Version: iNES v${headerVersion}\n` +
        `PRG ROM Size: ${prgBanks * 16} KB\n` +
        `CHR ROM Size: ${chrBanks * 8} KB - ${(chrBanks === 0 ? 'Uses CHR RAM' : 'Uses CHR ROM')}\n` +
        `Mapper Number: ${mapperNumber}\n` +
        `Mirroring: ${MIRRORING}\n` +
        `Battery-Backed: ${prgRamBattery ? 'Yes' : 'No'}\n` +
        `Trainer: ${((nesHeader[6] & 0x04) ? 'Yes' : 'No')}\n` +
        `Four Screen VRAM: ${((nesHeader[6] & 0x08) ? 'Yes' : 'No')}\n`;
      window.alert(info);
    });
  };

  reader.onerror = function () {
    console.debug(reader.error);
  };
}
