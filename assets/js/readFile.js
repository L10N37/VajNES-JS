// Cartridge flag: PRG-RAM is battery backed (used for save games)
let prgRamBattery = false;

// iNES header version detected (1 = iNES, 2 = NES 2.0)
let headerVersion = 1;

function readFile(input, auto = false) {

  // Manual ROM selection
  if (!auto) {

    // Get first selected file
    const file = input.files[0];

    // Validate extension
    if (!file || !file.name.toLowerCase().endsWith('.nes')) {
      console.error('Invalid file type. Please select a NES ROM file.');
      return;
    }

    // FileReader loads ROM as binary buffer
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = function () {

      // Convert ArrayBuffer → Uint8Array
      const romBytes = new Uint8Array(reader.result);

    // Cache ROM for automatic reload on refresh
    function bytesToBase64(bytes)
    {
        let binary = "";
        const chunk = 0x8000;

        for (let i = 0; i < bytes.length; i += chunk)
        {
            const sub = bytes.subarray(i, i + chunk);
            binary += String.fromCharCode.apply(null, sub);
        }

        return btoa(binary);
    }

    localStorage.setItem('lastRomData', bytesToBase64(romBytes));

      // Pass ROM to loader
      loadRom(romBytes);
    };

    reader.onerror = function () {
      console.debug(reader.error);
    };

  } else {

    // Auto-load ROM from localStorage
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

  // First 16 bytes of ROM contain the iNES header
  const nesHeader = romBytes.subarray(0, 16);

  // Validate "NES<EOF>" signature
  if (
    romBytes[0] !== 0x4E || romBytes[1] !== 0x45 ||
    romBytes[2] !== 0x53 || romBytes[3] !== 0x1A
  ) {
    console.warn('ROM file does not contain a valid NES header.');
    return;
  }

  // Header fields
  const prgBanks = nesHeader[4];  // PRG banks (16KB units)
  const chrBanks = nesHeader[5];  // CHR banks (8KB units)

  // Convert bank counts → byte sizes
  const prgSize = prgBanks * 0x4000;
  const chrSize = chrBanks * 0x2000;

  // Detect header version (NES 2.0 vs classic iNES)
  headerVersion = ((nesHeader[7] >> 2) & 0x03) === 0x02 ? 2 : 1;

  // Mapper number is split across flags 6 and 7
  const mapperLow  = nesHeader[6] >> 4;
  const mapperHigh = nesHeader[7] & 0xF0;

  let mapperExt = 0;

  // NES 2.0 extended mapper bits
  if (headerVersion === 2) {
    mapperExt = (nesHeader[8] & 0x0F) << 8;
  }

  // Final mapper number
  mapperNumber = mapperLow | mapperHigh | mapperExt;

  // Special MMC1 variant
  if (mapperNumber === 155) mapperNumber = 1;

  // ------------------------------------------------------------
  // Trainer detection (512 bytes located after header if present)
  // ------------------------------------------------------------

  const hasTrainer = (nesHeader[6] & 0x04) !== 0;
  const trainerSize = hasTrainer ? 512 : 0;

  // Compute actual PRG start offset
  const prgStart = 16 + trainerSize;

  // Compute CHR start offset
  const chrStart = prgStart + prgSize;

  // ------------------------------------------------------------
  // Store full ROM for large mappers (MMC3 / Mapper 4)
  // Header and trainer are skipped
  // ------------------------------------------------------------

  if (mapperNumber === 4) {

    // Entire PRG ROM (header removed)
    FULL_PRG_ROM = romBytes.slice(prgStart, prgStart + prgSize);

    // Entire CHR ROM
    FULL_CHR_ROM = romBytes.slice(chrStart, chrStart + chrSize);

    // Store metadata
    FULL_PRG_ROM_SIZE = prgSize;
    FULL_CHR_ROM_SIZE = chrSize;

    FULL_PRG_BANKS_16K = prgBanks;
    FULL_CHR_BANKS_8K  = chrBanks;

    console.debug(`[Mapper4] Full PRG ROM stored (${FULL_PRG_ROM_SIZE} bytes)`);
    console.debug(`[Mapper4] Full CHR ROM stored (${FULL_CHR_ROM_SIZE} bytes)`);
  }

  // ------------------------------------------------------------
  // Cartridge configuration flags
  // ------------------------------------------------------------

  prgRamBattery = (nesHeader[6] & 0x02) !== 0;

  const fourScreen   = (nesHeader[6] & 0x08) !== 0;
  const verticalFlag = (nesHeader[6] & 0x01) !== 0;

  // Determine nametable mirroring mode
  MIRRORING = fourScreen ? 'four' : (verticalFlag ? 'vertical' : 'horizontal');

  // Header debug output
  console.debug(`[HEADER] Detected iNES v${headerVersion}`);
  console.debug(`[HEADER] PRG banks: ${prgBanks} (${prgSize} bytes), CHR banks: ${chrBanks} (${chrSize} bytes)`);
  console.debug(`[HEADER] Mapper: ${mapperNumber}, Mirroring: ${MIRRORING}`);
  console.debug(`[HEADER] Battery-Backed PRG-RAM: ${prgRamBattery}`);

  // ------------------------------------------------------------
  // CPU-visible PRG window ($8000-$FFFF)
  // Your emulator currently maps entire PRG here
  // ------------------------------------------------------------

  prgRom = romBytes.slice(prgStart, prgStart + prgSize);

  // ------------------------------------------------------------
  // PPU CHR memory load
  // ------------------------------------------------------------

  if (chrSize > 0) {

    // Copy CHR ROM into emulator CHR memory
    const src = romBytes.subarray(chrStart, chrStart + chrSize);

    for (let i = 0; i < chrSize; i++) {
      CHR_ROM[i] = src[i];
    }

    chrIsRAM = false;

  } else {

    // Cartridge uses CHR RAM
    for (let i = 0; i < 0x2000; i++) {
      CHR_ROM[i] = 0x00;
    }

    chrIsRAM = true;

    // Update PPU frame flag
    if (chrIsRAM) PPU_FRAME_FLAGS |= 0x80;
    else           PPU_FRAME_FLAGS &= 0x7F;
  }

  // ------------------------------------------------------------
  // Debug output
  // ------------------------------------------------------------

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

  // Initialize mapper logic
  mapper(nesHeader);

  // Refresh debug tables
  updateDebugTables();

  // ------------------------------------------------------------
  // UI: Header info popup
  // ------------------------------------------------------------

  const headerButton = document.getElementById('header-button');

  // Replace button to remove existing listeners
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
      `Trainer: ${(hasTrainer ? 'Yes' : 'No')}\n` +
      `Four Screen VRAM: ${((nesHeader[6] & 0x08) ? 'Yes' : 'No')}\n`;

    window.alert(info);
  });
}