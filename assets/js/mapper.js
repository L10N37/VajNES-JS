chrIsRAM = false;

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
      resetCPU(); // ensures consistent start state
      break;
    }

    // ==========================================================
    // Mapper 1: MMC1 (SxROM family)
    // ==========================================================
    case 7: {
      axromInit(nesHeader);
      resetCPU();
      break;
    }

    case 2: {
      uxromInit(nesHeader);
      resetCPU();
      break;
    }

    case 1: {
      globalThis.NES_DEBUG_LOGGING && console.debug("[Mapper1] Initializing MMC1");

      // CHR type: if no CHR banks, it's CHR RAM
      chrIsRAM = (chrSize === 0);

      // Hand off to mmc1.js init
      mmc1Init(prgRom, CHR_ROM);

      resetCPU();
      break;
    }

    // ==========================================================
    // Mapper 4: MMC3 (TxROM family)
    // ==========================================================
    case 4: {
      globalThis.NES_DEBUG_LOGGING && console.debug("[Mapper4] Initializing MMC3");

      // CHR type: if no CHR banks, it's CHR RAM
      chrIsRAM = (chrSize === 0);

      // Load ups of MMC3 games are handled directly in readFile

      resetCPU();
      break;
    }

    case 3: {
      cnromInit(nesHeader);
      chrIsRAM = false;
      resetCPU();
      break;
    }

    case 9:
    case 10: {
      mmc24Init();
      chrIsRAM = false;
      resetCPU();
      break;
    }

    case 11: {
      colorDreamsInit();
      chrIsRAM = false;
      resetCPU();
      break;
    }

    case 66: {
      gxromInit();
      chrIsRAM = false;
      resetCPU();
      break;
    }

    case 79: {
      nina79Init();
      chrIsRAM = false;
      resetCPU();
      break;
    }

    // ==========================================================
    // Unsupported mappers
    // ==========================================================
    default:
      throw new Error(`Mapper ${mapperNumber} not yet implemented`);
  }
}
