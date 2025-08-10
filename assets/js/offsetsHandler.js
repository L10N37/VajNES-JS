// Routes all CPU reads/writes to their proper handler after folding for mirrors.
// Always update cpuOpenBus on every read/write.

function checkReadOffset(address) {
  const addr = foldMirrors(address) & 0xFFFF;
  let value;

  if (addr < 0x2000) { // CPU RAM
    value = cpuRead(addr);

    if (debugLogging && (addr < 0x0800)) {
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      console.log(`[RAM R] ${h16(addr)} -> ${h8(value)}`);
    }
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
  else if (addr < 0x6000) { // Expansion, mapper-dependent, treat as open bus by default
    value = openBusRead(addr);

    if (debugLogging) {
      // const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      // const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      // console.log(`[EXP R] ${h16(addr)} -> ${h8(value)} (open bus)`);
    }
  }
  else if (addr >= 0x8000 && addr <= 0xFFFF) { // ======== CARTRIDGE READING ========
    // strip off the $8000 base and pull straight from PRG-ROM buffer
    value = prgRom[addr - 0x8000];

    if (debugLogging) {
      // const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      // const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      // console.log(`[PRG R] ${h16(addr)} -> ${h8(value)}`);
    }
  }
  else {
    value = openBusRead(addr);

    if (debugLogging) {
      // const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      // const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      // console.log(`[OPENBUS R] ${h16(addr)} -> ${h8(value)}`);
    }
  }

  // Always update open bus on every read
  cpuOpenBus = value & 0xFF;
  return value & 0xFF;
}

function checkWriteOffset(address, value) {
  const addr = (foldMirrors(address) & 0xFFFF);
  value = value & 0xFF; // enforce 8-bit

  if (addr < 0x2000) { // CPU RAM
    cpuWrite(addr, value);

    if (debugLogging && (addr < 0x0800)) {
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      console.log(`[RAM W] ${h16(addr)} <= ${h8(value)}`);
    }
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
  else if (addr === 0x4014) { // OAM DMA
    if (debugLogging) {
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      console.log(`[OAMDMA $4014 W] page=${h8(value)} src=${h16(value<<8)}..${h16((value<<8)|0xFF)}`);
    }
    dmaTransfer(value); // <--- DMA handler here
  }
  else if (addr < 0x4020) { // APU & I/O
    if (debugLogging) {
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      if (addr === 0x4015) {
        console.log(`[APU $4015 W] ${h8(value)}`);
      } else if (addr === 0x4016 || addr === 0x4017) {
        console.log(`[CTRL ${h16(addr)} W] ${h8(value)}`);
      } else {
        // console.log(`[APU/IO W] ${h16(addr)} <= ${h8(value)}`);
      }
    }
    apuWrite(addr, value);
  }
  else if (addr < 0x6000) { // Expansion, mapper-dependent
    openBusWrite(addr, value);

    if (debugLogging) {
      // const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      // const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      // console.log(`[EXP W] ${h16(addr)} <= ${h8(value)} (ignored/open bus)`);
    }
  }
  else if (addr < 0x8000) {          // PRG-RAM (GAME SAVES)
    prgRam[addr - 0x6000] = value;

    if (debugLogging) {
      // const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      // const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      // console.log(`[PRG-RAM W] ${h16(addr)} <= ${h8(value)}`);
    }
  }
  else if (addr <= 0xFFFF) {         // PRG-ROM (for tests), probably not required
    prgRom[addr - 0x8000] = value;

    if (debugLogging) {
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      console.warn(`[PRG-ROM W] ${h16(addr)} <= ${h8(value)} (TEST PATH)`);
    }
  }
  // else do nothing

  // Always update open bus
  cpuOpenBus = value & 0xFF;
}

// Fallback open bus read/write handlers
function openBusRead(addr) { return cpuOpenBus; }
function openBusWrite(addr, value) { /* no-op */ }
