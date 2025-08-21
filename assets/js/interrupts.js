// ======== Interrupts ======== 
// https://www.nesdev.org/wiki/CPU_interrupts
function serviceNMI() {
  
if (debugLogging) console.debug("%cNMI fired", "color: white; background-color: red; font-weight: bold; padding: 2px 6px; border-radius: 3px");

  const pc = CPUregisters.PC & 0xFFFF;

  // push PC hi/lo
  checkWriteOffset(0x0100 | CPUregisters.S, (pc >>> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  checkWriteOffset(0x0100 | CPUregisters.S, pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // push status with Break=0
  const p = packStatus(false);
  checkWriteOffset(0x0100 | CPUregisters.S, p);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // set flags after NMI
  CPUregisters.P.I = 1;
  CPUregisters.P.B = 0;

  // fetch NMI vector
  const lo = checkReadOffset(0xFFFA) & 0xFF;
  const hi = checkReadOffset(0xFFFB) & 0xFF;
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;

  addExtraCycles(7);
}

function serviceIRQ() {
  // Push PC high, then low
  checkWriteOffset(0x0100 + CPUregisters.S, (CPUregisters.PC >> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  checkWriteOffset(0x0100 + CPUregisters.S, CPUregisters.PC & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Push status with B=0
  const status = packStatus(false);
  checkWriteOffset(0x0100 + CPUregisters.S, status);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Fetch IRQ vector at $FFFE/$FFFF
  const lo = checkReadOffset(0xFFFE);
  const hi = checkReadOffset(0xFFFF);
  CPUregisters.PC = (hi << 8) | lo;

  // Set interrupt disable flag
  CPUregisters.P.I = 1;

  // Takes 7 cycles total
  addExtraCycles(7);
}

// not an interrupt, get it TF out of the way for now #relocate
// ===== OAM DMA ($4014) =====
// Copies 256 bytes from CPU RAM page (value << 8) into PPU OAM.
// Adds 513 cycles if CPU is on even cycle, 514 if odd.
function dmaTransfer(value) {
  const start = (value & 0xFF) << 8;
  const end   = start + 0x100;

  for (let src = start, i = 0; src < end; src++, i++) {
    OAM[i] = systemMemory[src & 0x7FF];
  }
  //set our stall flag
  dmaTransferOcurred = true;
  // add our cycles, topping up the PPU budget by 513/514 * 3
  const curCycles = Atomics.load(SHARED.CLOCKS, 0);
  if (curCycles % 2 === 0) addExtraCycles(513);
  else addExtraCycles(514);
}