// Cartridge flag: PRG-RAM is battery backed (used for save games)
let prgRamBattery = false;

// iNES header version detected (1 = iNES, 2 = NES 2.0)
let headerVersion = 1;


function crc32Bytes(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Known licensed games with old/bad iNES headers whose mapper-high nibble is
// polluted. Keyed by CRC32 of PRG+CHR payload (header/trainer excluded), so
// genuine cartridges that really use the reported high mapper are untouched.
// Adventures in the Magic Kingdom:
//   USA PRG+CHR  CRC32 5DBD6099
//   PAL PRG+CHR  CRC32 6B761858
const KNOWN_BAD_HEADER_MAPPERS = new Map([
  [0x5DBD6099, 1],
  [0x6B761858, 1],
]);

function knownBadHeaderMapper(romBytes, header) {
  const trainerSize = (header[6] & 0x04) ? 512 : 0;
  const payloadStart = 16 + trainerSize;
  const payloadSize = header[4] * 0x4000 + header[5] * 0x2000;
  if (!payloadSize || romBytes.length < payloadStart + payloadSize) return null;
  const crc = crc32Bytes(romBytes.subarray(payloadStart, payloadStart + payloadSize));
  return KNOWN_BAD_HEADER_MAPPERS.has(crc) ? KNOWN_BAD_HEADER_MAPPERS.get(crc) : null;
}

function readFile(input, auto = false) {

  // Manual ROM selection
  if (!auto) {

    // Get first selected file
    const file = input.files[0];

    // Validate extension
    if (!file || !file.name.toLowerCase().endsWith('.nes')) {
      globalThis.NES_DEBUG_LOGGING && console.error('Invalid file type. Please select a NES ROM file.');
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
      globalThis.NES_DEBUG_LOGGING && console.debug(reader.error);
    };

  } else {

    // Auto-load ROM from localStorage
    const saved = localStorage.getItem('lastRomData');

    if (!saved) {
      globalThis.NES_DEBUG_LOGGING && console.debug('[AutoLoad] No ROM cached, skipping autoload.');
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
    globalThis.NES_DEBUG_LOGGING && console.warn('ROM file does not contain a valid NES header.');
    return;
  }

  // Reject unsupported/truncated images before mutating the running cartridge.
  if (romBytes.length < 16) throw new Error('Truncated iNES header');
  const isNES2 = (nesHeader[7] & 0x0C) === 0x08;
  if (isNES2 && nesHeader[9] !== 0)
    throw new Error('NES 2.0 extended ROM sizes are not supported yet');

  // Archaic iNES images made by old tools such as NES Image can contain
  // signatures like "DiskDude!" in bytes 7-15. In that case byte 7's high
  // nibble is not mapper metadata (it famously adds 64 to the real mapper).
  // NESdev's compatibility rule is to ignore those upper mapper bits when a
  // non-NES-2.0 header has non-zero padding in bytes 12-15.
  const archaicINes = !isNES2 &&
    ((nesHeader[12] | nesHeader[13] | nesHeader[14] | nesHeader[15]) !== 0);
  const mapperHighNibble = archaicINes ? 0 : (nesHeader[7] & 0xF0);

  let incomingMapper = (nesHeader[6] >> 4) | mapperHighNibble |
    (isNES2 ? (nesHeader[8] & 15) << 8 : 0);

  if(typeof configureExpansionAudioForRom==='function')
    configureExpansionAudioForRom(romBytes,nesHeader,incomingMapper,isNES2);

  // Some otherwise-valid old dumps have only the mapper-high nibble polluted,
  // with clean zero padding, so the generic archaic-header test above cannot
  // identify them. Repair only ROM payloads we know exactly.
  if (!isNES2) {
    const repairedMapper = knownBadHeaderMapper(romBytes, nesHeader);
    if (repairedMapper !== null) incomingMapper = repairedMapper;
  }

  if(typeof configureExpansionAudioForRom==='function')
    configureExpansionAudioForRom(romBytes,nesHeader,incomingMapper,isNES2);

  if (![0,1,2,3,4,7,9,10,11,66,79,155].includes(incomingMapper))
    throw new Error(`Mapper ${incomingMapper} not yet implemented`);
  const required = 16 + ((nesHeader[6] & 4) ? 512 : 0) + nesHeader[4]*0x4000 + nesHeader[5]*0x2000;
  if (!nesHeader[4] || romBytes.length < required) throw new Error('Truncated cartridge ROM');
  if (incomingMapper===0 && ![1,2].includes(nesHeader[4])) throw new Error('Invalid NROM PRG size');
  if (incomingMapper===2 && (nesHeader[5]!==0 || ![2,4,8,16].includes(nesHeader[4]) ||
      (isNES2 && (nesHeader[8]>>4)>2)))
    throw new Error('Unsupported UxROM board: expected 32–256 KiB PRG and 8 KiB CHR RAM');

  if (incomingMapper===7 && (nesHeader[5]!==0 || ![2,4,8,16].includes(nesHeader[4]) ||
      (isNES2 && (nesHeader[8]>>4)>2)))
    throw new Error('Unsupported AxROM board: expected 32–256 KiB PRG, 8 KiB CHR RAM and submapper 0–2');

  if (incomingMapper===3 && (nesHeader[5]===0 || ![1,2].includes(nesHeader[4]) ||
      (isNES2 && (nesHeader[8]>>4)>2)))
    throw new Error('Unsupported CNROM board: expected 16/32 KiB PRG, CHR ROM and submapper 0–2');
  if ([9,10,11,66].includes(incomingMapper) && nesHeader[5]===0)
    throw new Error(`Unsupported mapper ${incomingMapper} board: CHR ROM required`);

  if (incomingMapper===79 && (nesHeader[5]===0 || ![2,4].includes(nesHeader[4])))
    throw new Error('Unsupported NINA-03/06 board: expected 32/64 KiB PRG and CHR ROM');

  // Header fields
  const prgBanks = nesHeader[4];  // PRG banks (16KB units)
  const chrBanks = nesHeader[5];  // CHR banks (8KB units)

  // Convert bank counts → byte sizes
  const prgSize = prgBanks * 0x4000;
  const chrSize = chrBanks * 0x2000;

  // Detect header version (NES 2.0 vs classic iNES)
  headerVersion = ((nesHeader[7] >> 2) & 0x03) === 0x02 ? 2 : 1;

  // Mapper number is split across flags 6 and 7. For an archaic
  // polluted iNES header, mapperHighNibble was deliberately masked above.
  const mapperLow  = nesHeader[6] >> 4;
  const mapperHigh = mapperHighNibble;

  let mapperExt = 0;

  // NES 2.0 extended mapper bits
  if (headerVersion === 2) {
    mapperExt = (nesHeader[8] & 0x0F) << 8;
  }

  // Final mapper number. Use the validated/repaired mapper selected above.
  mapperNumber = incomingMapper;

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
    FULL_CHR_ROM = chrSize ? romBytes.slice(chrStart, chrStart + chrSize) : new Uint8Array(0x2000);

    // Store metadata
    FULL_PRG_ROM_SIZE = prgSize;
    FULL_CHR_ROM_SIZE = FULL_CHR_ROM.length;

    FULL_PRG_BANKS_16K = prgBanks;
    FULL_CHR_BANKS_8K  = chrBanks;

    globalThis.NES_DEBUG_LOGGING && console.debug(`[Mapper4] Full PRG ROM stored (${FULL_PRG_ROM_SIZE} bytes)`);
    globalThis.NES_DEBUG_LOGGING && console.debug(`[Mapper4] Full CHR ROM stored (${FULL_CHR_ROM_SIZE} bytes)`);
  }

  // ------------------------------------------------------------
  // Cartridge configuration flags
  // ------------------------------------------------------------

  prgRamBattery = (nesHeader[6] & 0x02) !== 0;

  const fourScreen   = (nesHeader[6] & 0x08) !== 0;
  const verticalFlag = (nesHeader[6] & 0x01) !== 0;

  // Determine nametable mirroring mode
  MIRRORING = fourScreen ? 'four' : (verticalFlag ? 'vertical' : 'horizontal');
  VRAM = new Uint8Array(fourScreen ? 0x1000 : 0x800);
  prgRam.fill(0);
  if (hasTrainer) prgRam.set(romBytes.subarray(16,528),0x1000);

  // Header debug output
  globalThis.NES_DEBUG_LOGGING && console.debug(`[HEADER] Detected iNES v${headerVersion}`);
  globalThis.NES_DEBUG_LOGGING && console.debug(`[HEADER] PRG banks: ${prgBanks} (${prgSize} bytes), CHR banks: ${chrBanks} (${chrSize} bytes)`);
  globalThis.NES_DEBUG_LOGGING && console.debug(`[HEADER] Mapper: ${mapperNumber}, Mirroring: ${MIRRORING}`);
  globalThis.NES_DEBUG_LOGGING && console.debug(`[HEADER] Battery-Backed PRG-RAM: ${prgRamBattery}`);

  // ------------------------------------------------------------
  // CPU-visible PRG window ($8000-$FFFF)
  // Your emulator currently maps entire PRG here
  // ------------------------------------------------------------

  prgRom = romBytes.slice(prgStart, prgStart + prgSize);

  // ------------------------------------------------------------
  // PPU CHR memory load
  // ------------------------------------------------------------

  // Allocate the entire CHR image; writing beyond the old 8 KiB typed array
  // silently dropped every later MMC1 bank.
  CHR_ROM = chrSize ? romBytes.slice(chrStart,chrStart+chrSize) : new Uint8Array(0x2000);
  chrIsRAM = chrSize === 0;

  // ------------------------------------------------------------
  // Debug output
  // ------------------------------------------------------------

  globalThis.NES_DEBUG_LOGGING && console.debug(`[Loader] CHR is ${chrIsRAM ? 'RAM' : 'ROM'}; size=${CHR_ROM.length} bytes`);

  globalThis.NES_DEBUG_LOGGING && console.debug(
    `[Loader] First 16 CHR bytes: ${
      Array.from(CHR_ROM.subarray(0, 16))
        .map(v => v.toString(16).padStart(2, '0'))
        .join(' ')
    }`
  );

  globalThis.NES_DEBUG_LOGGING && console.debug(`[Loader] Loaded PRG-ROM: ${prgRom.length} bytes`);
  globalThis.NES_DEBUG_LOGGING && console.debug(`[Loader] CHR is ${chrIsRAM ? 'RAM' : 'ROM'}; size=${CHR_ROM.byteLength} bytes`);
  globalThis.NES_DEBUG_LOGGING && console.debug(`[Loader] PRG-RAM is ${prgRamBattery ? 'battery-backed' : 'volatile'}`);

  // Initialize mapper logic
  mapper(nesHeader);
  if(typeof NESAudio!=="undefined")NESAudio.unlock();

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