let MIRRORING = null;
let prgRamBattery = false;
let headerVersion = 1;

function readFile(input, auto = false) {
  if (!auto) {
    const file = input.files[0];
    if (!file || file.name.split('.').pop().toLowerCase() !== 'nes') {
      console.error('Invalid file type. Please select a NES ROM file.');
      return;
    }
    
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = function () {
      const romBytes = new Uint8Array(reader.result);
      localStorage.setItem('lastRomData', btoa(String.fromCharCode(...romBytes)));
      loadRom(romBytes);
    };

    reader.onerror = function () {
      console.debug(reader.error);
    };
  } else {
    const saved = localStorage.getItem('lastRomData');
    if (!saved) {
      console.debug('[AutoLoad] No ROM cached, skipping autoload.');
      return;
    }
    const romBytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
    loadRom(romBytes);
  }
}

function loadRom(romBytes) {
  const nesHeader = romBytes.subarray(0, 16);

  if (
    romBytes[0] !== 0x4E || romBytes[1] !== 0x45 ||
    romBytes[2] !== 0x53 || romBytes[3] !== 0x1A
  ) {
    console.warn('ROM file does not contain a valid NES header.');
    return;
  }

  const prgBanks = nesHeader[4];
  const chrBanks = nesHeader[5];
  const prgSize  = prgBanks * 0x4000;
  const chrSize  = chrBanks * 0x2000;

  headerVersion = ((nesHeader[7] >> 2) & 0x03) === 0x02 ? 2 : 1;

  const mapperLow  = nesHeader[6] >> 4;
  const mapperHigh = nesHeader[7] & 0xF0;
  let mapperExt    = 0;
  if (headerVersion === 2) {
    mapperExt = (nesHeader[8] & 0x0F) << 8;
  }
  mapperNumber = mapperLow | mapperHigh | mapperExt;
  if (mapperNumber === 155) mapperNumber = 1;

  prgRamBattery = (nesHeader[6] & 0x02) !== 0;
  const fourScreen   = (nesHeader[6] & 0x08) !== 0;
  const verticalFlag = (nesHeader[6] & 0x01) !== 0;
  MIRRORING = fourScreen ? 'four' : (verticalFlag ? 'vertical' : 'horizontal');

  // SAB COPY
  if (MIRRORING === 'vertical') MIRRORING_MODE = 0;
  if (MIRRORING === 'horizontal') MIRRORING_MODE = 1;
  if (MIRRORING === 'four') MIRRORING_MODE= 4;

  console.debug(`[HEADER] Detected iNES v${headerVersion}`);
  console.debug(`[HEADER] PRG banks: ${prgBanks} (${prgSize} bytes), CHR banks: ${chrBanks} (${chrSize} bytes)`);
  console.debug(`[HEADER] Mapper: ${mapperNumber}, Mirroring: ${MIRRORING}`);
  console.debug(`[HEADER] Battery-Backed PRG-RAM: ${prgRamBattery}`);

  prgRom = romBytes.slice(16, 16 + prgSize);

  // CHR_ROM already aliased to SharedArrayBuffer-backed Uint8Array
  const chrStart = 16 + prgSize;

  if (chrSize > 0) {
    const src = romBytes.subarray(chrStart, chrStart + chrSize);
    for (let i = 0; i < chrSize; i++) {
      CHR_ROM[i] = src[i];
    }
    chrIsRAM = false;
  } else {
    for (let i = 0; i < 0x2000; i++) {
      CHR_ROM[i] = 0x00;
    }
    chrIsRAM = true;
    if (chrIsRAM) PPU_FRAME_FLAGS |= 0x80;
    else           PPU_FRAME_FLAGS &= 0x7F;
  }

  console.debug(`[Loader] CHR is ${chrIsRAM ? 'RAM' : 'ROM'}; size=${CHR_ROM.length} bytes`);
  console.debug(
    `[Loader] First 16 CHR bytes: ${
      Array.from(CHR_ROM.subarray(0, 16))
        .map(v => v.toString(16).padStart(2, '0'))
        .join(' ')
    }`
  );

  console.debug(`[Loader] Loaded PRG-ROM: ${prgRom.length} bytes`);
  console.debug(`[Loader] CHR is ${chrIsRAM ? 'RAM' : 'ROM'}; size=${CHR_ROM.byteLength} bytes`);
  console.debug(`[Loader] PRG-RAM is ${prgRamBattery ? 'battery-backed' : 'volatile'}`);

  mapper(nesHeader);
  updateDebugTables();

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
}
