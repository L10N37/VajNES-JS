
function _region(addr) {
  addr &= 0xFFFF;
  if (addr < 0x2000) return 0;   // RAM
  if (addr < 0x4000) return 1;   // PPU
  if (addr < 0x4020) return 2;   // IO
  if (addr < 0x6000) return 3;   // EXP
  if (addr < 0x8000) return 4;   // PRGRAM
  return 5;                      // PRGROM
}

function cpuOpenBusFinalise(addr, raw, op, isWrite) {
  addr &= 0xFFFF;
  raw  &= 0xFF;
  op   &= 0xFF;

  const busBefore = openBus.CPU & 0xFF;
  const regn = _region(addr);

  let out = raw & 0xFF;

  // ------------------------------------------------------------
  // DRIVEN regions: value drives CPU data bus for that cycle
  // ------------------------------------------------------------
  // RAM, PPU regs (as read by CPU), PRG-RAM, PRG-ROM
  if (regn === 0 || regn === 1 || regn === 4 || regn === 5) {
    openBus.CPU = out & 0xFF;
    return out & 0xFF;
  }

  // ------------------------------------------------------------
  // IO quirks
  // ------------------------------------------------------------
  if (regn === 2) {
    // $4015 READ: return value may have open-bus-ish bit behaviour, BUT it does NOT drive openBus.CPU.
    // Bit 5 comes from the CPU internal latch, which DMA cannot overwrite.
    if (!isWrite && addr === 0x4015) {
      const merged = ((out & ~0x20) | (openBus.internal & 0x20)) & 0xFF;
      // IMPORTANT: openBus.CPU NOT updated
      return merged;
    }

    // $4016/$4017 READ: only bit0 is fresh; upper bits float from previous bus
    if (!isWrite && (addr === 0x4016 || addr === 0x4017)) {
      out = ((busBefore & 0xFE) | (out & 0x01)) & 0xFF;
      openBus.CPU = out & 0xFF;
      return out & 0xFF;
    }

    // writes (including $4015 write) always drive bus
    // normal IO reads also drive bus with the returned value for that cycle
    openBus.CPU = out & 0xFF;
    return out & 0xFF;
  }

  // ------------------------------------------------------------
  // EXP open bus ($4020–$5FFF in your mapping): reads do NOT drive bus
  // ------------------------------------------------------------
  if (regn === 3) {
    if (!isWrite) {
      // default: floating bus -> keep whatever was on the bus
      out = busBefore & 0xFF;

      // IMPORTANT: EXP reads do NOT update openBus.CPU
      openBus.CPU = busBefore & 0xFF;
      return out & 0xFF;
    }

    // EXP writes: CPU is driving the data bus
    openBus.CPU = out & 0xFF;
    return out & 0xFF;
  }

  // fallback (shouldn't hit)
  openBus.CPU = out & 0xFF;
  return out & 0xFF;
}
