// ======== Interrupts ======== 
// https://www.nesdev.org/wiki/CPU_interrupts
function serviceNMI() {
  if (debugLogging) console.debug("%cNMI fired", "color:white;background:red;font-weight:bold;padding:2px 6px;border-radius:3px");

  const pc = (CPUregisters.PC) & 0xFFFF;

  // push PC hi/lo
  pushStack((pc >> 8) & 0xFF);
  pushStack(pc & 0xFF);

  // push status (Break=0)
  pushStatus(false);

  // set flags
  CPUregisters.P.I = 1;
  CPUregisters.P.B = 0;

  // vector
  const lo = checkReadOffset(0xFFFA);
  const hi = checkReadOffset(0xFFFB);
  //console.debug(`NMI vector lo=$${lo.toString(16)} hi=$${hi.toString(16)}`); //fucknshitcuntfuckyoufuckn

  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;

  addExtraCycles(7);
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
    OAM[i] = systemMemory[src & 0x7FF];
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
    (CPUregisters.P.D << 3) |   // Decimal
    (CPUregisters.P.I << 2) |   // Interrupt Disable
    (CPUregisters.P.Z << 1) |   // Zero
    CPUregisters.P.C            // Carry
  ) & 0xFF;
}

// Unpack one status byte into CPU flags
function unpackStatus(packed) {
  CPUregisters.P.C =  packed       & 1;
  CPUregisters.P.Z = (packed >> 1) & 1;
  CPUregisters.P.I = (packed >> 2) & 1;
  CPUregisters.P.D = (packed >> 3) & 1;
  CPUregisters.P.V = (packed >> 6) & 1;
  CPUregisters.P.N = (packed >> 7) & 1;
}

function pushStatus(setBreakBit) {
  pushStack(packStatus(setBreakBit));
}

function pullStatus() {
  const packed = pullStack();
  unpackStatus(packed);
}


