// mapper.js

/**
 * Map PRG-ROM into CPU address space, then set the reset vector.
 * Supports only Mapper 0 (NROM).
 *
 * Called as mapper(nesHeader), with `loadedROM` already
 * strip-header (i.e. PRG data starting at index 0).
 */
function mapper(nesHeader) {
  // pull mapper info from header
  const prgCount     = nesHeader[4];                                 // # of 16 KB PRG banks
  const mapperNumber = ((nesHeader[6] >> 4) | (nesHeader[7] & 0xF0));
  const mirroring    = (nesHeader[6] & 0x01) ? 'Vertical' : 'Horizontal';
  console.log(`Mapper #: ${mapperNumber}, Mirroring: ${mirroring}`);


  if (mapperNumber !== 0) {
    throw new Error(`Unsupported mapper: ${mapperNumber}`);
  }

  // size of one PRG bank in bytes (should be 0x4000 == 16 KB)
  const PRG_BANK_SIZE = memoryMap.prgRomLower.size;

  // load PRG-ROM into $8000–$BFFF and $C000–$FFFF
  if (prgCount === 1) {
    // 16 KB cart: mirror the single bank into both slots
    for (let i = 0; i < PRG_BANK_SIZE; i++) {
      const b = loadedROM[i];
      systemMemory[memoryMap.prgRomLower.addr + i] = b;
      systemMemory[memoryMap.prgRomUpper.addr + i] = b;
    }
  } else if (prgCount === 2) {
    // 32 KB cart: first bank at $8000, second at $C000
    for (let i = 0; i < PRG_BANK_SIZE; i++) {
      systemMemory[memoryMap.prgRomLower.addr + i] = loadedROM[i];
      systemMemory[memoryMap.prgRomUpper.addr + i] = loadedROM[PRG_BANK_SIZE + i];
    }
  } else {
    throw new Error(`Unexpected PRG-ROM bank count: ${prgCount}`);
  }

  // fetch reset vector from $FFFC/$FFFD
  const lo          = systemMemory[0xFFFC];
  const hi          = systemMemory[0xFFFD];
  const resetVector = (hi << 8) | lo;
  console.log(
    `systemMemory[0xFFFC]=${lo.toString(16)}, [0xFFFD]=${hi.toString(16)}`
  );
  console.log(`Reset Vector Address: 0x${resetVector.toString(16).toUpperCase()}`);

  // start CPU there
  CPUregisters.PC = resetVector;
  return resetVector;
}
