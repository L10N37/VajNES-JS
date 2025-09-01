// ======== Interrupts ======== 
// https://www.nesdev.org/wiki/CPU_interrupts
function serviceNMI() {
  if (debugLogging) console.debug("%cNMI fired", "color:white;background:red;font-weight:bold;padding:2px 6px;border-radius:3px");

  const pc = CPUregisters.PC & 0xFFFF;

  // Push PCH
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), (pc >> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addExtraCycles(1);

  // Push PCL
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addExtraCycles(1);

  // Build status byte: U=1, B=0 → 0b00100000
  let p = 0b00100000;
  p |= (CPUregisters.P.N & 1) << 7;
  p |= (CPUregisters.P.V & 1) << 6;
  p |= (CPUregisters.P.D & 1) << 3;
  p |= (CPUregisters.P.I & 1) << 2;
  p |= (CPUregisters.P.Z & 1) << 1;
  p |= (CPUregisters.P.C & 1);

  // Push P
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), p & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addExtraCycles(1);

  // Set I
  CPUregisters.P.I = 1;
  addExtraCycles(1);

  // Vector fetch
  const lo = checkReadOffset(0xFFFA);
  addExtraCycles(1);
  const hi = checkReadOffset(0xFFFB);
  addExtraCycles(1);

  // Set PC
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;
  addExtraCycles(1);
}

function serviceIRQ() {
  const pc = CPUregisters.PC & 0xFFFF;

  // Push PCH
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), (pc >> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addExtraCycles(1);

  // Push PCL
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addExtraCycles(1);

  // U=1, B=0
  let p = 0b00100000;
  p |= (CPUregisters.P.N & 1) << 7;
  p |= (CPUregisters.P.V & 1) << 6;
  p |= (CPUregisters.P.D & 1) << 3;
  p |= (CPUregisters.P.I & 1) << 2;
  p |= (CPUregisters.P.Z & 1) << 1;
  p |= (CPUregisters.P.C & 1);

  // Push P
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), p & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addExtraCycles(1);

  // Set I
  CPUregisters.P.I = 1;
  addExtraCycles(1);

  // Vector fetch
  const lo = checkReadOffset(0xFFFE);
  addExtraCycles(1);
  const hi = checkReadOffset(0xFFFF);
  addExtraCycles(1);

  // Set PC
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;
  addExtraCycles(1);
}

// not an interrupt, get it TF out of the way for now #relocate
// ===== OAM DMA ($4014) =====
// Copies 256 bytes from CPU RAM page (value << 8) into PPU OAM.
// Adds 513 cycles if CPU is on even cycle, 514 if odd.
function dmaTransfer(value) {

  // add our cycles, topping up the PPU budget by 513/514 * 3, BEFORE the DMA transfer
  const curCycles = Atomics.load(SHARED.CLOCKS, 0);
  if (curCycles % 2 === 0) addExtraCycles(513);
  else addExtraCycles(514);

  cpuStall();

  const start = (value & 0xFF) << 8;
  const end   = start + 0x100;

  for (let src = start, i = 0; src < end; src++, i++) {
    OAM[i] = cpuRead(src);
  }
}