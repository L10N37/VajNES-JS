let DMA = {
  active: false,
  page:   0x00,
  addr:   0x0000,
  index:  0,     // 0..255
  tmp:    0x00,
  phase:  0,     // 0 = read, 1 = write
  pad:    0      // 1 or 2 cycles
};

// ===== OAM DMA ($4014) =====
// Copies 256 bytes from CPU RAM page (value << 8) into PPU OAM.
// Adds 513 cycles if CPU starts on odd cycle, 514 if even.
// Microstepped: 1 CPU cycle per call (PPU +3 each).
function dmaTransfer(value) {
  const cur = cpuCycles ?? 0;

  DMA.active = true;
  DMA.page   = value & 0xFF;
  DMA.addr   = DMA.page << 8;
  DMA.index  = 0;
  DMA.tmp    = 0;
  DMA.phase  = "get";

const startCycle = (cpuCycles + 1) & 1;   // first cycle after the write
DMA.pad = startCycle ? 2 : 1;             // odd start => 2, even start => 1
}

function oamDmaRead(addr) {
  addr &= 0xFFFF;
  const cpuBus = CPUregisters.PC & 0xFFFF;
  const apuActive = (cpuBus & 0xFFE0) === 0x4000;

  // Read the external DMA source without accidentally decoding the CPU's
  // $4000-$401F register window from the OAM address itself.
  let source;
  if (addr >= 0x4000 && addr < 0x4020) source = openBus.CPU & 0xFF;
  else source = checkReadOffset(addr) & 0xFF;

  if (!apuActive) return source;

  // When the halted 6502 address activates the APU decoder, the OAM DMA
  // address contributes only its low five bits. Thus $50x5/$50x6/$50x7,
  // etc. can access $4015/$4016/$4017 while the external source still
  // contributes the otherwise-floating bus bits.
  const reg = 0x4000 | (addr & 0x1F);
  if (reg === 0x4015) {
    const status = apuStatusRead() & 0xFF;
    const value = ((status & ~0x20) | (source & 0x20)) & 0xFF;
    // $4015's status lines do not leave their low status bits on the external
    // pins after the read; the high/open-bus portion remains for following IO.
    openBus.CPU = value & 0xE0;
    return value;
  }
  if (reg === 0x4016 || reg === 0x4017) {
    const bit = joypadRead(reg) & 1; // /OE may still clock the controller.
    const externallyDriven = addr < 0x2000 ||
      (addr >= 0x6000 && addr < 0x8000) || addr >= 0x8000;
    if (externallyDriven) return source;
    const value = ((openBus.CPU & 0xFE) | bit) & 0xFF;
    openBus.CPU = value;
    return value;
  }

  return source;
}


function dmaMicroStep() {

  // ---- alignment pad (1 or 2 cycles) ----
  if (DMA.pad > 0) {
    let cycles = DMA.pad;

    for (let i = 0; i < cycles; i++) {
      consumeCycle();
    }

    DMA.pad = 0;
    return cycles; // returns 1 or 2
  }

  // ---- finished ----
  if (DMA.index === 256) {
    DMA.active = false;
    return 0;
  }

  // ---- transfer ----
  if (DMA.phase === "get") {
    // READ cycle. Preserve the original DMA read path unless the 6502/APU
    // address-decoder interaction specifically applies.
    const cpuBus = CPUregisters.PC & 0xFFFF;
    const apuActive = (cpuBus & 0xFFE0) === 0x4000;
    if (apuActive) {
      DMA.tmp = oamDmaRead(DMA.addr) & 0xFF;
    } else if (DMA.addr >= 0x4000 && DMA.addr < 0x4020) {
      const raw = openBus.CPU & 0xFF;
      DMA.tmp = cpuOpenBusFinalise(DMA.addr, raw, 0x00, false);
    } else {
      const raw = checkReadOffset(DMA.addr) & 0xFF;
      DMA.tmp = cpuOpenBusFinalise(DMA.addr, raw, 0x00, false);
    }
    DMA.phase = "put";
    consumeCycle();
    return 1;
  }
  
  if (DMA.phase === "put" ) {
    // WRITE cycle. OAM DMA's internal $2004 write does not replace the
    // value lingering on the external CPU data bus while APU decode is active.
    const preserveExternalBus = ((CPUregisters.PC & 0xFFE0) === 0x4000);
    const externalBus = openBus.CPU & 0xFF;
    checkWriteOffset(0x2004, DMA.tmp);
    if (preserveExternalBus) openBus.CPU = externalBus;
    DMA.addr = (DMA.addr + 1) & 0xFFFF;
    DMA.index = (DMA.index + 1) & 0xFFFF;
    DMA.phase = "get";
    consumeCycle();
    //globalThis.NES_DEBUG_LOGGING && console.log( "  cpuCycles:", cpuCycles);
    return 1;
  }
}