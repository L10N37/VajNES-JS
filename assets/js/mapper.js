/*
 https://www.nesdev.org/neshdr20.txt
*/

function mapper(nesHeader) {
    let mapperNumber = ((nesHeader[6] >> 4) | (nesHeader[7] & 0xF0));
    let mirroring = ((nesHeader[6] & 0x01) ? 'Vertical' : 'Horizontal');

    function mirrorCartSpace() {
      for (let i = 0; i < memoryMap.prgRomUpper.size; i++) {
        systemMemory[memoryMap.prgRomUpper.addr + i] = systemMemory[memoryMap.prgRomLower.addr + i]
      }
    }

    console.log(`Mapper #: ${mapperNumber}`);
  
    if (mapperNumber == 0 && mirroring == 'Horizontal') {
      // Move necessary ROM data to cart space area, mirror if necessary
      for (let i = 0; i < memoryMap.prgRomLower.size; i++) {
        systemMemory[memoryMap.prgRomLower.addr + i] = loadedROM[i];
      }
      mirrorCartSpace();
      updateDebugTables(allWramCells, allCartSpaceBytes);
    }
  
  }
  