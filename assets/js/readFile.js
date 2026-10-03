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

// ROM compatibility database -------------------------------------------------
// Exact CRC32 of PRG+CHR payload (header/trainer excluded).  Nothing here
// modifies the ROM file: entries only correct the cartridge interpretation in
// memory.  reportedMappers prevents an override from touching an already-valid
// or intentionally different header that happens to share the same payload.
const ROM_COMPAT_OVERRIDES = new Map([
  // Adventures in the Magic Kingdom: bad/alternate iNES headers report 65.
  [0x5DBD6099, { mapper: 1, reportedMappers: [65], title: 'Adventures in the Magic Kingdom (USA)' }],
  [0x26C7D763, { mapper: 1, reportedMappers: [65], title: 'Adventures in the Magic Kingdom (USA) [a1]' }],
  [0x6B761858, { mapper: 1, reportedMappers: [65], title: 'Adventures in the Magic Kingdom (PAL)' }],

  // Splatterhouse: Wanpaku Graffiti: legacy dumps commonly identify the
  // Namco 340 board as mapper 19 rather than mapper 210.
  [0x46FD7843, { mapper: 210, reportedMappers: [19], title: 'Splatterhouse: Wanpaku Graffiti' }],

  // Audit-derived duplicate-payload header repairs.  The same payload exists
  // elsewhere in the set with the correct licensed cartridge mapper.
  [0x8B957B50, { mapper: 3, reportedMappers: [0], title: 'Kung-Fu Heroes' }],
  [0x7A36CAD2, { mapper: 4, reportedMappers: [0], title: 'Last Armageddon' }],

  // Alien Syndrome (USA): legacy iNES dumps commonly report mapper 4 even
  // though the cartridge uses Tengen 800037, represented by mapper 158.
  [0xCBF4366F, { mapper: 158, reportedMappers: [4], title: 'Alien Syndrome (USA)' }],
]);

function romCompatibilityOverride(romBytes, header, reportedMapper) {
  const trainerSize = (header[6] & 0x04) ? 512 : 0;
  const payloadStart = 16 + trainerSize;
  const payloadSize = header[4] * 0x4000 + header[5] * 0x2000;
  if (!payloadSize || romBytes.length < payloadStart + payloadSize) return null;

  const crc = crc32Bytes(romBytes.subarray(payloadStart, payloadStart + payloadSize));
  const entry = ROM_COMPAT_OVERRIDES.get(crc);
  if (!entry) return null;
  if (entry.reportedMappers && !entry.reportedMappers.includes(reportedMapper)) return null;
  return { ...entry, crc };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

function readFile(input, auto = false) {

  // Manual ROM selection
  if (!auto) {

    // Get first selected file
    const file = input.files[0];

    // Validate extension
    const lowerName=file?.name?.toLowerCase()||'';
    if (!file || (!lowerName.endsWith('.nes') && !lowerName.endsWith('.zip'))) {
      globalThis.NES_DEBUG_LOGGING && console.error('Invalid file type. Please select a NES ROM or ZIP archive.');
      return;
    }

    // A new manual selection supersedes the old one immediately. If this ROM
    // proves unsupported, do not silently resurrect or auto-load the old ROM.
    if (typeof window.pause === 'function') window.pause();
    if (typeof NESAudio !== 'undefined' && NESAudio.setExpansion)
      NESAudio.setExpansion(null,false);
    localStorage.removeItem('lastRomData');
    localStorage.removeItem('lastRomName');

    // FileReader loads ROM as binary buffer
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = async function () {
      try {
        let romBytes = new Uint8Array(reader.result);
        let romName = file.name;

        if (lowerName.endsWith('.zip')) {
          if (typeof extractNesFromZip!=='function')
            throw new Error('ZIP support is unavailable');
          const extracted=await extractNesFromZip(romBytes);
          if(!extracted)return;
          romBytes=extracted.bytes;
          romName=extracted.name;
        }

        // Cache only the successfully extracted/loaded NES ROM, never the ZIP container.
        if (loadRom(romBytes, romName) === true) {
          localStorage.setItem('lastRomData', bytesToBase64(romBytes));
          localStorage.setItem('lastRomName', romName || '');
        }
      } catch (error) {
        console.error(error);
        if(typeof window.alert==='function')window.alert(error.message||String(error));
      }
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
    loadRom(romBytes, localStorage.getItem('lastRomName') || '');
  }
}

function loadRom(romBytes, fileName = '') {

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

  // Some otherwise-valid old dumps have only the mapper-high nibble polluted,
  // with clean zero padding, so the generic archaic-header test above cannot
  // identify them. Repair only ROM payloads we know exactly.
  if (!isNES2) {
    const compat = romCompatibilityOverride(romBytes, nesHeader, incomingMapper);
    if (compat) {
      globalThis.NES_DEBUG_LOGGING && console.debug(
        `[ROM compat] ${compat.title}: mapper ${incomingMapper} -> ${compat.mapper} (CRC ${compat.crc.toString(16).toUpperCase().padStart(8,'0')})`
      );
      incomingMapper = compat.mapper;
    }
  }

  if (![0,1,2,3,4,5,7,9,10,11,19,24,26,64,66,69,79,118,119,155,158,210].includes(incomingMapper))
    throw new Error(`Mapper ${incomingMapper} not yet implemented`);

  // Never show an expansion-audio prompt for a mapper this build cannot run.
  if(typeof configureExpansionAudioForRom==='function')
    configureExpansionAudioForRom(romBytes,nesHeader,incomingMapper,isNES2);
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
  if (incomingMapper===5 && nesHeader[5]===0)
    throw new Error('Unsupported MMC5 board: CHR ROM required');
  if ([9,10,11,66].includes(incomingMapper) && nesHeader[5]===0)
    throw new Error(`Unsupported mapper ${incomingMapper} board: CHR ROM required`);

  if (incomingMapper===79 && (nesHeader[5]===0 || ![2,4].includes(nesHeader[4])))
    throw new Error('Unsupported NINA-03/06 board: expected 32/64 KiB PRG and CHR ROM');

  if ((incomingMapper===19 || incomingMapper===210) && nesHeader[5]===0)
    throw new Error(`Unsupported Namco mapper ${incomingMapper}: CHR ROM required`);
  if ((incomingMapper===24 || incomingMapper===26) && nesHeader[5]===0)
    throw new Error('Unsupported VRC6 board: CHR ROM required');
  if (incomingMapper===69 && nesHeader[5]===0)
    throw new Error('Unsupported FME-7 board: CHR ROM required');
  if ((incomingMapper===64 || incomingMapper===158) && nesHeader[5]===0)
    throw new Error('Unsupported RAMBO-1 board: CHR ROM required');
  if (incomingMapper===118 && nesHeader[5]===0)
    throw new Error('Unsupported TxSROM board: CHR ROM required');
  if (incomingMapper===119 && nesHeader[5]===0)
    throw new Error('Unsupported TQROM board: CHR ROM required');

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

  // Game Genie identity: canonical whole-file CRC plus a header-independent
  // PRG+CHR payload CRC for known alternate-header dumps.
  const fullRomCrc = crc32Bytes(romBytes);
  const payloadCrc = crc32Bytes(romBytes.subarray(prgStart, chrStart + chrSize));

  // ------------------------------------------------------------
  // Store full ROM for large mappers (MMC3 / Mapper 4)
  // Header and trainer are skipped
  // ------------------------------------------------------------

  if (mapperNumber === 4 || mapperNumber === 118 || mapperNumber === 119) {

    // Entire PRG ROM (header removed)
    FULL_PRG_ROM = romBytes.slice(prgStart, prgStart + prgSize);

    // Entire CHR ROM
    FULL_CHR_ROM = chrSize ? romBytes.slice(chrStart, chrStart + chrSize) : new Uint8Array(0x2000);

    // Store metadata
    FULL_PRG_ROM_SIZE = prgSize;
    FULL_CHR_ROM_SIZE = FULL_CHR_ROM.length;

    FULL_PRG_BANKS_16K = prgBanks;
    FULL_CHR_BANKS_8K  = chrBanks;

    globalThis.NES_DEBUG_LOGGING && console.debug(`[Mapper${mapperNumber}] Full PRG ROM stored (${FULL_PRG_ROM_SIZE} bytes)`);
    globalThis.NES_DEBUG_LOGGING && console.debug(`[Mapper${mapperNumber}] Full CHR ROM stored (${FULL_CHR_ROM_SIZE} bytes)`);
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

  if (typeof VajNESGenie !== 'undefined' && VajNESGenie.onRomLoaded) {
    VajNESGenie.onRomLoaded({
      fullCrc: fullRomCrc,
      payloadCrc,
      fileName,
      mapper: mapperNumber
    });
  }

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

  return true;
}