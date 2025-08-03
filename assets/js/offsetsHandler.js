// offsetsHandler, redirect all reads/writes to the appropriate hardware/ handlers, keeping the code clean and structured :D

function checkWriteOffset(address, value) {
  // Zero Page only (NO MIRROR), write value to RAM offset here directly, no passing to other handler
  if (address >= 0x0000 && address <= 0x00FF) {
    systemMemory[address] = value;
    cpuOpenBus = value;
    return;
  }
    // CPU RAM mirrors: $0100–$1FFF
  if (address >= 0x0100 && address <= 0x1FFF) {
    cpuWrite(address, value);
    mirrorCPURAMWrite(); // mirror handler
    return;
  }

  // 2. PPU registers and mirrors: $2000–$3FFF
    if (address >= 0x2000 && address <= 0x3FFF) {
    // Special case: PPU palette RAM $3F00–$3FFF
    if (address >= 0x3F00 && address <= 0x3FFF) {
      systemMemory[address] = value;         // write value to RAM offset here directly, no passing to other handler
      mirrorPPUPaletteWrite(address, value); // palette mirroring handler
      cpuOpenBus = value & 0xFF;             // open bus, 
      return;
    }
    // Otherwise, normal PPU register/mirror handling
    ppuWrite(address, value);
    systemMemory[address & 0x3FFF] = value; //
    mirrorPPURegisterWrite(address, value); // register mirror handler
    return;
  }

  // 3. APU/IO Registers: $4000–$4017
  if (address >= 0x4000 && address <= 0x4017) {
    switch (address) {
      case 0x4014: { // OAMDMA (Sprite DMA)
        cpuOpenBus = value & 0xFF;
        let page = value & 0xFF;
        let src = page << 8;
        for (let i = 0; i < 256; i++) {
          PPU_OAM[i] = systemMemory[src + i];
        }
        cpuCycles += 513;
        return;
      }
      case 0x4016:
        cpuOpenBus = value & 0xFF;
        return joypadWrite(address, value);
      case 0x4017:
        cpuOpenBus = value & 0xFF;
        return apuWrite(address, value);
      default:
        cpuOpenBus = value & 0xFF;
        return apuWrite(address, value);
    }
  }

  // 4. Expansion/Mapper I/O: $4018–$401F (stub/ignored for now)
  if (address >= 0x4018 && address <= 0x401F) {
    // mapperWrite(address, value); // (unimplemented)
    return;
  }

  // 5. PRG-ROM or other (should almost never be written, but allow for completeness)
  systemMemory[address] = value;
  cpuOpenBus = value & 0xFF;
}

function checkReadOffset(address) {
  // 1. CPU RAM: $0000–$1FFF (including mirrors)
  if (address >= 0x0000 && address <= 0x1FFF) {
    return cpuRead(address);
  }

  // 2. PPU registers and mirrors: $2000–$3FFF
  if (address >= 0x2000 && address <= 0x3FFF) {
    // Mirror every 8 bytes
    let base = 0x2000 + ((address - 0x2000) % 8);
    return ppuRead(base);
  }

  // 3. APU/IO Registers: $4000–$4017
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

  // 4. Expansion/Mapper I/O: $4018–$401F (stubbed)
  if (address >= 0x4018 && address <= 0x401F) {
    return 0x00; // Open bus/stub value
  }

  // 5. PRG-ROM or unmapped (read-only in normal NES, but allow for completeness)
  return cpuRead(address);
}
