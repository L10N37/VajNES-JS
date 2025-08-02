// offsetsHandler, redirect all reads/writes to the appropriate hardware/ handlers, keeping the code clean and structured :D

function checkWriteOffset(address, value) {
  // PPU registers and mirrors: $2000–$3FFF
  if (address >= 0x2000 && address <= 0x3FFF) {
    // Mirror every 8 bytes
   // let base = 0x2000 + ((address - 0x2000) % 8);
    return ppuWrite(address, value);
  }

  // APU/IO Registers: $4000–$4017
  if (address >= 0x4000 && address <= 0x4017) {
    switch (address) {

    //Writing to $4014 initiates a [Sprite] DMA transfer: 256 bytes from CPU page $XX00–$XXFF to PPU OAM ($2004).”
      case 0x4014: { // OAMDMA (Sprite DMA)
        // Start DMA: copy 256 bytes from page to PPU OAM
        let page = value & 0xFF;
        let src = page << 8;
        for (let i = 0; i < 256; i++) {
          PPU_OAM[i] = systemMemory[src + i];
        }
        // DMA timing: 513 cycles (514 if on odd cycle, rarely matters for emu)
        cpuCycles += 513;
        // If emulating CPU/PPU clock in detail, add +1 if (cpuCycles % 2 === 1)
        return;
      }
    // ---------------------------------------------------------------------------------------------------------

      case 0x4016:
        return joypadWrite(address, value);
      case 0x4017:
        return apuWrite(address, value);
      default:
        return apuWrite(address, value);
    }
  }

  // Expansion/Mapper I/O: $4018–$401F (not handled yet)
  if (address >= 0x4018 && address <= 0x401F) {
    // Could be stub/ignored for now
    return; // Or: mapperWrite(address, value);
  }

  // Everything else (RAM, ROM, etc)
  return cpuWrite(address, value);
}

function checkReadOffset(address) {
  // PPU registers and mirrors: $2000–$3FFF
  if (address >= 0x2000 && address <= 0x3FFF) {
    // Mirror every 8 bytes
    let base = 0x2000 + ((address - 0x2000) % 8);
    return ppuRead(base);
  }

  // APU/IO Registers: $4000–$4017
  if (address >= 0x4000 && address <= 0x4017) {
    switch (address) {
      case 0x4016: // Controller 1 read
        return joypadRead(address, 1);
      case 0x4017: // Controller 2 read
        return joypadRead(address, 2);
      case 0x4015: // APU status
        return apuRead(address);
      default: // $4000–$4013
        return apuRead(address);
    }
  }

  // Expansion/Mapper I/O: $4018–$401F (stubbed)
  if (address >= 0x4018 && address <= 0x401F) {
    return 0x00; // Open bus/stub value
  }

  // Everything else (RAM, ROM, etc)
  return cpuRead(address);
}
