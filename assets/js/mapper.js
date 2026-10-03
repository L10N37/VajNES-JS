chrIsRAM = false;

const SUPPORTED_MAPPERS = new Set([0,1,2,3,4,5,7,9,10,11,19,21,22,23,24,25,26,34,64,66,68,69,71,73,78,79,85,118,119,155,158,206,210]);
function isMapperSupported(id) { return SUPPORTED_MAPPERS.has(id|0); }

// --- General mapper handling at ROM load, mappers folder contains stand-alone mapper implementations ---
function mapper(nesHeader) {
  const prgBanks = nesHeader[4]; // PRG-ROM banks (16KB each)
  const chrBanks = nesHeader[5]; // CHR-ROM banks (8KB each)
  const prgSize  = prgBanks * 0x4000;
  const chrSize  = chrBanks * 0x2000;

  if (!prgRom || prgRom.length < prgSize)
    throw new Error("ROM file too small for header PRG count");

  switch (mapperNumber) {
    // ==========================================================
    // Mapper 0: NROM
    // ==========================================================
    case 0: {
      let flatPrg = new Uint8Array(0x8000); // always 32KB view

      if (prgBanks === 1) {
        // 16KB PRG: mirror into both halves
        flatPrg.set(prgRom.slice(0, 0x4000), 0x0000); // $8000
        flatPrg.set(prgRom.slice(0, 0x4000), 0x4000); // $C000
        globalThis.NES_DEBUG_LOGGING && console.debug("[Mapper0] Mirrored 16KB PRG into 32KB region ($8000-$FFFF)");
      } else if (prgBanks === 2) {
        // 32KB PRG: straight copy
        flatPrg.set(prgRom.slice(0, 0x8000), 0x0000);
        globalThis.NES_DEBUG_LOGGING && console.debug("[Mapper0] Loaded 32KB PRG as is ($8000-$FFFF)");
      } else {
        throw new Error(`[Mapper0] Unexpected PRG-ROM bank count: ${prgBanks}`);
      }

      prgRom = flatPrg; // normalize to 32KB flat

      // CHR-ROM untouched (CHR_ROM already loaded globally)
      powerOnCPU(); // ensures consistent start state
      break;
    }

    // ==========================================================
    // Mapper 1: MMC1 (SxROM family)
    // ==========================================================
    case 7: {
      axromInit(nesHeader);
      powerOnCPU();
      break;
    }

    case 2: {
      uxromInit(nesHeader);
      powerOnCPU();
      break;
    }

    case 1: {
      globalThis.NES_DEBUG_LOGGING && console.debug("[Mapper1] Initializing MMC1");

      // CHR type: if no CHR banks, it's CHR RAM
      chrIsRAM = (chrSize === 0);

      // Hand off to mmc1.js init
      mmc1Init(prgRom, CHR_ROM);

      powerOnCPU();
      break;
    }


    // ==========================================================
    // Mapper 5: MMC5 (ExROM)
    // ==========================================================
    case 5: {
      globalThis.NES_DEBUG_LOGGING && console.debug("[Mapper5] Initializing MMC5");
      chrIsRAM = (chrSize === 0);
      mmc5Init();
      powerOnCPU();
      break;
    }

    // ==========================================================
    // Mapper 4: MMC3 (TxROM family)
    // ==========================================================
    case 4:
    case 118:
    case 119: {
      globalThis.NES_DEBUG_LOGGING && console.debug(`[Mapper${mapperNumber}] Initializing MMC3 family`);
      mmc3FamilyInit(nesHeader);
      powerOnCPU();
      break;
    }

    case 3: {
      cnromInit(nesHeader);
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    case 9:
    case 10: {
      mmc24Init();
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    case 11: {
      colorDreamsInit();
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    case 34: {
      mapper34Init(nesHeader);
      powerOnCPU();
      break;
    }

    case 66: {
      gxromInit();
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    case 71: {
      mapper71Init(nesHeader);
      chrIsRAM = true;
      powerOnCPU();
      break;
    }

    case 73: {
      vrc3Init();
      powerOnCPU();
      break;
    }

    case 78: {
      mapper78Init(nesHeader);
      powerOnCPU();
      break;
    }

    case 79: {
      nina79Init();
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    case 19:
    case 210: {
      namcoInit(nesHeader);
      chrIsRAM=false;
      powerOnCPU();
      break;
    }

    case 21:
    case 22:
    case 23:
    case 25: {
      vrc24Init();
      powerOnCPU();
      break;
    }

    case 24:
    case 26: {
      vrc6Init();
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    case 68: {
      mapper68Init();
      powerOnCPU();
      break;
    }

    case 85: {
      vrc7Init();
      powerOnCPU();
      break;
    }

    case 69: {
      fme7Init();
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    case 64:
    case 158: {
      rambo1Init();
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    case 206: {
      mapper206Init(nesHeader);
      chrIsRAM = false;
      powerOnCPU();
      break;
    }

    // ==========================================================
    // Unsupported mappers
    // ==========================================================
    default:
      throw new Error(`Mapper ${mapperNumber} not yet implemented`);
  }
}
