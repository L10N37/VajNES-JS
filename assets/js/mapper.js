function mapper(nesHeader) {

  const prgCount     = nesHeader[4];
  const mapperNumber = ((nesHeader[6] >> 4) | (nesHeader[7] & 0xF0));
  const mirroring    = (nesHeader[6] & 0x01) ? 'Vertical' : 'Horizontal';

  console.log(`Mapper #: ${mapperNumber}, Mirroring: ${mirroring}`);
  if (mapperNumber !== 0) throw new Error(`Unsupported mapper: ${mapperNumber}`);
  if (!loadedROM) throw new Error("No ROM loaded");

  const hexHeader = Array.from(nesHeader, byte => byte.toString(16).padStart(2, '0')).join(' ');
  console.log(`[Mapper] NES Header: ${hexHeader}`);
  isRomLoaded = true;

  const PRG_BANK_SIZE = memoryMap.prgRomLower.size;

  if (prgCount === 1) {
    for (let i = 0; i < PRG_BANK_SIZE; i++) {
      const b = loadedROM[i];
      systemMemory[memoryMap.prgRomLower.addr + i] = b;
      systemMemory[memoryMap.prgRomUpper.addr + i] = b;
    }
  } else if (prgCount === 2) {
    for (let i = 0; i < PRG_BANK_SIZE; i++) {
      systemMemory[memoryMap.prgRomLower.addr + i] = loadedROM[i];
      systemMemory[memoryMap.prgRomUpper.addr + i] = loadedROM[PRG_BANK_SIZE + i];
    }
  } else {
    throw new Error(`Unexpected PRG-ROM bank count: ${prgCount}`);
  }

  // === Reset Vector
  let lo, hi;
  if (prgCount === 1) {
    lo = loadedROM[0x3FFC];
    hi = loadedROM[0x3FFD];
  } else {
    lo = loadedROM[0x7FFC];
    hi = loadedROM[0x7FFD];
  }
  systemMemory[0xFFFC] = lo;
  systemMemory[0xFFFD] = hi;
  CPUregisters.PC = (hi << 8) | lo;
  console.log(`Reset Vector: $${CPUregisters.PC.toString(16).toUpperCase().padStart(4, '0')}`);
}
