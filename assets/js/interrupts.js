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
// ----- DMA state -----
const DMA = {
  active: false,
  addr:   0,   // source address (page << 8)
  index:  0,   // 0..255
  pad:    0,   // 1 or 2 CPU-cycle alignment pad (odd->1, even->2)
};

function dmaTransfer(value) {
  const curCycles = Atomics.load(SHARED.CLOCKS, 0);

  DMA.active = true;
  DMA.addr   = (value & 0xFF) << 8;
  DMA.index  = 0;
  // Parity rule: even start => 514 total (pad=2), odd start => 513 total (pad=1)
  DMA.pad    = (curCycles & 1) ? 1 : 2;

  // We will repeatedly stall per micro-step to keep CPU/PPU in lockstep.
  cpuStall();
}

// Advance DMA by one micro-step; return CPU cycles consumed (1 or 2)
// Call this at the TOP of `step()` when DMA is active.
function dmaMicroStep() {
  // 1) Burn the initial 1/2-cycle pad first
  if (DMA.pad > 0) {
    DMA.pad -= 1;
    addExtraCycles(1);  // adds 1 CPU cycle (PPU +3 handled inside)
    // Keep CPU/PPU step-locked: stall until PPU burns the tick
    cpuStall();
    return 1;
  }

  // 2) Transfer next byte (2 CPU cycles per byte)
  if (DMA.index < 256) {
    const data = cpuRead(DMA.addr);
    // Write to OAM; if your pipeline expects $2004 writes, use cpuWrite(0x2004, data)
    OAM[DMA.index] = data;

    DMA.addr  = (DMA.addr + 1) & 0xFFFF;
    DMA.index += 1;

    addExtraCycles(2);  // adds 2 CPU cycles (PPU +6 inside)
    cpuStall();         // let PPU burn those 2*3 ticks before continuing
    return 2;
  }

  // 3) Done: unstall and clear DMA
  DMA.active = false;
  if (typeof cpuUnstall === 'function') cpuUnstall();
  return 0;
}