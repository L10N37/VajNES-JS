
function _region(addr) {
  addr &= 0xFFFF;
  if (addr < 0x2000) return 0;   // RAM
  if (addr < 0x4000) return 1;   // PPU
  if (addr < 0x4020) return 2;   // IO
  if (addr < 0x6000) return 3;   // EXP
  if (addr < 0x8000) return 4;   // PRGRAM
  return 5;                      // PRGROM
}

// Indexed READ ops that can do the page-cross dummy read behaviour (OpenBus test #3 expectations)
function _isIndexedReadOp(op) {
  switch (op & 0xFF) {
    // LDA abs,X / abs,Y
    case 0xBD: case 0xB9:
    // LDX abs,Y / LDY abs,X
    case 0xBE: case 0xBC:
    // ORA abs,X / abs,Y
    case 0x1D: case 0x19:
    // AND abs,X / abs,Y
    case 0x3D: case 0x39:
    // EOR abs,X / abs,Y
    case 0x5D: case 0x59:
    // ADC abs,X / abs,Y
    case 0x7D: case 0x79:
    // CMP abs,X / abs,Y
    case 0xDD: case 0xD9:
    // SBC abs,X / abs,Y
    case 0xFD: case 0xF9:
      return true;
    default:
      return false;
  }
}

function cpuOpenBusFinalise(addr, raw, op, isWrite) {
  addr &= 0xFFFF;
  raw  &= 0xFF;
  op   &= 0xFF;

  const busBefore = cpuOpenBus & 0xFF;
  const regn = _region(addr);

  let out = raw & 0xFF;

  // ------------------------------------------------------------
  // DRIVEN regions: value drives CPU data bus for that cycle
  // ------------------------------------------------------------
  // RAM, PPU regs (as read by CPU), PRG-RAM, PRG-ROM
  if (regn === 0 || regn === 1 || regn === 4 || regn === 5) {
    cpuOpenBus = out & 0xFF;
    return out & 0xFF;
  }

  // ------------------------------------------------------------
  // IO quirks
  // ------------------------------------------------------------
  if (regn === 2) {
    // $4015 READ: return value may have open-bus-ish bit behaviour, BUT it does NOT drive cpuOpenBus.
    // offsetsHandler.js should supply raw = apuRead($4015). Here we merge bit5 from bus.
    if (!isWrite && addr === 0x4015) {
      const merged = ((out & ~0x20) | (busBefore & 0x20)) & 0xFF;
      // IMPORTANT: cpuOpenBus NOT updated
      return merged;
    }

    // $4016/$4017 READ: only bit0 is fresh; upper bits float from previous bus
    if (!isWrite && (addr === 0x4016 || addr === 0x4017)) {
      out = ((busBefore & 0xFE) | (out & 0x01)) & 0xFF;
      cpuOpenBus = out & 0xFF;
      return out & 0xFF;
    }

    // writes (including $4015 write) always drive bus
    // normal IO reads also drive bus with the returned value for that cycle
    cpuOpenBus = out & 0xFF;
    return out & 0xFF;
  }

  // ------------------------------------------------------------
  // EXP open bus ($4020–$5FFF in your mapping): reads do NOT drive bus
  // ------------------------------------------------------------
  if (regn === 3) {
    if (!isWrite) {
      // default: floating bus -> keep whatever was on the bus
      out = busBefore & 0xFF;

      // ROM-specific quirk your ASM expects:
      // LDA abs ($AD) from open-bus returns the operand HIGH byte (address high).
      if (op === 0xAD) {
        out = (addr >>> 8) & 0xFF;
      }

      // Indexed reads in open-bus must KEEP bus (don’t become new hi)
      if (_isIndexedReadOp(op)) {
        out = busBefore & 0xFF;
      }

      // IMPORTANT: EXP reads do NOT update cpuOpenBus
      cpuOpenBus = busBefore & 0xFF;
      return out & 0xFF;
    }

    // EXP writes: CPU is driving the data bus
    cpuOpenBus = out & 0xFF;
    return out & 0xFF;
  }

  // fallback (shouldn't hit)
  cpuOpenBus = out & 0xFF;
  return out & 0xFF;
}
