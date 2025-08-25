// ======== Interrupts ======== 
// https://www.nesdev.org/wiki/CPU_interrupts
function serviceNMI() {
  if (debugLogging) console.debug("%cNMI fired", "color:white;background:red;font-weight:bold;padding:2px 6px;border-radius:3px");

  const pc = CPUregisters.PC & 0xFFFF;
  pushStack((pc >> 8) & 0xFF);                      // PCH
  pushStack(pc & 0xFF);                             // PCL
  pushStatus(false);                                // B=0 for IRQ/NMI pushes

  CPUregisters.P.I = 1;
  CPUregisters.P.B = 0;

  const lo = checkReadOffset(0xFFFA);
  const hi = checkReadOffset(0xFFFB);
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;

  addExtraCycles(7);

const pcPush = CPUregisters.PC & 0xFFFF;
}

function serviceIRQ() {
  const pc = CPUregisters.PC & 0xFFFF;
  pushStack((pc >> 8) & 0xFF);
  pushStack(pc & 0xFF);
  pushStatus(false);  // Break=0

  const lo = checkReadOffset(0xFFFE);
  const hi = checkReadOffset(0xFFFF);
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;

  CPUregisters.P.I = 1;
  addExtraCycles(7);
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

  const start = (value & 0xFF) << 8;
  const end   = start + 0x100;

  for (let src = start, i = 0; src < end; src++, i++) {
    OAM[i] = cpuRead(src);
  }
}

// --- - -- - - helpers for the interrupt handlers and BRK_IMP (in 6502.js) - - -- - ---

// Stack helpers (CPU stack is always page 1: $0100–$01FF)

function pushStack(value) {
  checkWriteOffset(0x0100 | CPUregisters.S, value & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
}

function pullStack() {
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  return checkReadOffset(0x0100 | CPUregisters.S) & 0xFF;
}

// Pack CPU flags into one status byte
function packStatus(setBreakBit) {
  return (
    (CPUregisters.P.N << 7) |   // Negative
    (CPUregisters.P.V << 6) |   // Overflow
    (1 << 5) |                  // U = always 1 when pushed
    ((setBreakBit ? 1 : 0) << 4)|// Break (only BRK/PHP)
    (CPUregisters.P.D << 3) |   // Decimal (ignored by NES ALU, but flag is preserved)
    (CPUregisters.P.I << 2) |   // Interrupt Disable
    (CPUregisters.P.Z << 1) |   // Zero
    CPUregisters.P.C            // Carry
  ) & 0xFF;
}

// Unpack one status byte into CPU flags
function unpackStatus(packed) {
  // Force U=1, ignore B (bit4) when restoring—matches 6502 behavior for RTI/PLP
  packed = (packed | 0x20) & ~0x10;

  CPUregisters.P.C =  packed       & 1;
  CPUregisters.P.Z = (packed >> 1) & 1;
  CPUregisters.P.I = (packed >> 2) & 1;
  CPUregisters.P.D = (packed >> 3) & 1;
  CPUregisters.P.V = (packed >> 6) & 1;
  CPUregisters.P.N = (packed >> 7) & 1;
}

// Always set bit5=1 in the packed status; set/clear B according to caller
function pushStatus(setBreakBit) {
  // packStatus should honor setBreakBit for B and set bit5=1.
  // force it here:
  const p = packStatus(setBreakBit) | 0x20;         // ensure bit5=1
  pushStack(p);
}

// On pull: ignore B (bit4) and force bit5=1 as real 6502 does; NES keeps D effectively 0
function pullStatus() {
  const packed = pullStack();
  const forced = (packed & ~0x10) | 0x20;           // clear B, set bit5=1
  unpackStatus(forced);
}


