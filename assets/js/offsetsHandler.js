function checkReadOffset(address) {
  const addr = foldMirrors(address) & 0xFFFF;
  let value;

  if (addr < 0x2000) { // CPU RAM
    value = cpuRead(addr);
    // no logging
  }
  else if (addr < 0x4000) { // PPU registers (mirrored every 8)
    value = ppuRead(addr);

    if (debugLogging) {
      const base = 0x2000 + (addr & 0x0007);
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      const pcH = h16(CPUregisters.PC);
      switch (base) {
        case 0x2002: console.log(`[$2002 PPUSTATUS R] PC=${pcH} -> ${h8(value)} (vblank=${(value>>>7)&1})`); break;
        case 0x2007: console.log(`[$2007 PPUDATA   R] PC=${pcH} -> ${h8(value)}`); break;
        default:     console.log(`[PPU R] ${h16(base)} -> ${h8(value)}`); break;
      }
    }
  }
  else if (addr < 0x4020) { // APU & I/O
    value = apuRead(addr);

    if (debugLogging) {
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      if (addr === 0x4015) {
        console.log(`[APU $4015 R] -> ${h8(value)}`);
      } else if (addr === 0x4016 || addr === 0x4017) {
        console.log(`[CTRL ${h16(addr)} R] -> ${h8(value)}`);
      } else {
        console.log(`[APU/IO R] ${h16(addr)} -> ${h8(value)}`);
      }
    }
  }
  else if (addr < 0x6000) { // Expansion
    return cpuOpenBus & 0xFF;
    
  }
  else if (addr >= 0x8000 && addr <= 0xFFFF) { // PRG-ROM
    value = prgRom[addr - 0x8000];
    
  }
  else {
    return cpuOpenBus & 0xFF;
    
  }

  cpuOpenBus = value & 0xFF;
  return value & 0xFF;
}

function checkWriteOffset(address, value) {
  const addr = (foldMirrors(address) & 0xFFFF);
  value = value & 0xFF; // enforce 8-bit

  if (addr < 0x2000) { // CPU RAM
    cpuWrite(addr, value);
    // no logging
  }
  else if (addr < 0x4000) { // PPU registers
    if (debugLogging) {
      const base = 0x2000 + (addr & 0x0007);
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      switch (base) {
        case 0x2000: console.log(`[$2000 PPUCTRL   W] ${h8(value)}`); break;
        case 0x2001: console.log(`[$2001 PPUMASK   W] ${h8(value)}`); break;
        case 0x2003: console.log(`[$2003 OAMADDR   W] ${h8(value)}`); break;
        case 0x2004: console.log(`[$2004 OAMDATA   W] ${h8(value)}`); break;
        case 0x2005: console.log(`[$2005 PPUSCROLL W] ${h8(value)} (toggle)`); break;
        case 0x2006: console.log(`[$2006 PPUADDR   W] ${h8(value)} (toggle)`); break;
        case 0x2007: console.log(`[$2007 PPUDATA   W] ${h8(value)}`); break;
        default:     console.log(`[PPU W] ${h16(base)} <= ${h8(value)}`); break;
      }
    }
    ppuWrite(addr, value);
  }
  else if (addr === 0x4014) { // OAM DMA (PPU-related, keep logging)
    if (debugLogging) {
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      console.log(`[OAMDMA $4014 W] page=${h8(value)} src=${h16(value<<8)}..${h16((value<<8)|0xFF)}`);
    }
    dmaTransfer(value);
  }
  else if (addr < 0x4020) { // APU & I/O
    // writes are NOT logged per request
    apuWrite(addr, value);
  }
  else if (addr < 0x6000) { // Expansion
    cpuOpenBus = value & 0xFF; // not handled, still write value to openBus
    
  }
  else if (addr < 0x8000) { // PRG-RAM
    prgRam[addr - 0x6000] = value;
    
  }
  else if (addr <= 0xFFFF) { // PRG-ROM (test harness may poke here)
    prgRom[addr - 0x8000] = value;
    
  }

  cpuOpenBus = value & 0xFF;
}
