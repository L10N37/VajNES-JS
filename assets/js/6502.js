/* 
first WIP version used a flat contiguous 64KB array for EVERYTHING, for mirroring we actually wrote to memory at
all offsets, if writing to a mirror we ran code that then wrote to the base and all mirrors

for reads, we could read any mirror and it always contained the same data as the base
even with the UI needlessly being refreshed between every step, chewing through quite a few opcodes a second.

after more research, apparently using separate arrays for VRAM, WRAM, PRG-ROM etc was a better approach, and just using 
address folding so any reads/ writes to mirrors would just fold back down to the base address was just 'a better way'

After a complete refactor it averaged 2/3 seconds per opcode and sometimes up to 4/5 for the illegal opcodes, and when 
running continuously would cause a browser crash. It seems I 'deoptimised' the app by trying to be more 'true' to hardware 
and simplifying things made some aspects somewhat more complicated.

the information here from the opcodes object now gets used to create flattened metadata arrays to speed things up and
optimise it to the point that this can become a functional, full speed browser based emulator.

anyway, it would have had to be optimised into look up tables either way, but it would have being WAYYYYYYYYYY faster doing
things the original way. Even with all the UI and debug stuff shaved off, the old code chewed through far more opcodes per
second.

honestly, if you want to make an emulator, and actually make progress, use a flat memory model. DO NOT GO THIS ROUTE.
headaches, hours and hours of wasted time trying to make align reads and writes that naturally line up with a flat memory model!
*/

//to do: remove all prgRom references, along with -0x8000, use checkReadOffset - done

let CPUregisters = {
  A: 0x00,
  X: 0x00,
  Y: 0x00,
  // initialized to 0xFF on power-up or reset?
  // https://www.nesdev.org/wiki/Stack
  S: 0xFD, // this is confusing, changed to init as $FD
  PC: 0x8000, // got sick of loading a dummy rom/ setting in console/ setting in the GUI, lets just start with this
  P: {
      C: 0,    // Carry
      Z: 0,    // Zero
      I: 0,    // Interrupt Disable
      D: 0,    // Decimal Mode
      V: 0,    // Overflow
      N: 0     // Negative
  }
};
// These are used to access P register by INDEX! used for debug table
let P_VARIABLES = ['C', 'Z', 'I', 'D', 'V', 'N'];

function resetCPU() {
  SHARED.VRAM.fill(0x00);
  systemMemory.fill(0x00); // may not happen on a real system
  CPUregisters.A = 0x00;
  CPUregisters.X = 0x00;
  CPUregisters.Y = 0x00;
  CPUregisters.S = 0xFD; // unsure, should be $FC at reset
  CPUregisters.P = {
      C: 0,    // Carry
      Z: 0,    // Zero
      I: 0,    // Interrupt Disable
      D: 0,    // Decimal Mode
      V: 0,    // Overflow
      N: 0     // Negative
  };
  // pull PC from reset vector
  const lo = checkReadOffset(0xFFFC);
  const hi = checkReadOffset(0xFFFD);
  CPUregisters.PC = lo | (hi << 8);;

  cpuCycles = 0;  // reset cycles on reset
  cpuCycles += 7; // burn 7 cycles straight away

  console.debug(`[Mapper] Reset Vector: $${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
  console.debug("PC @ 0x" + CPUregisters.PC.toString(16).padStart(4, "0").toUpperCase());
}

////////////////////////// CPU Functions //////////////////////////
// http://www.6502.org/tutorials/6502opcodes.html#ADC
// https://en.wikipedia.org/wiki/MOS_Technology_6502#Registers
// https://www.masswerk.at/6502/6502_instruction_set.html
// https://www.pagetable.com/c64ref/6502/?tab=2#LDA 
// https://www.nesdev.org/obelisk-6502-guide/addressessing.html

function opCodeTest(){
  showTestModal();
    console.debug(
    "%c🟢 TEST MODAL TRIGGERED by OPCODE 0x02 🟢",
    "background: yellow; color: black; font-weight: bold; font-size: 20px; padding: 6px 12px; border: 2px solid black;"
  );
}

function addExtraCycles(x) {
  Atomics.add(SHARED.CLOCKS, 0, x);        // CPU
  Atomics.add(SHARED.CLOCKS, 1, 3 * x);    // PPU
}

/*
  NES Mappers That Use IRQs (Interrupt Requests):

  Mapper # | Name / Alias      | IRQ Use Case
  ---------|-------------------|-------------------------------
  4        | MMC3              | Scanline IRQ for mid-frame effects
  5        | MMC5              | Scanline IRQ, advanced features
  6        | VNROM             | Uses IRQs
  7        | AxROM             | IRQs used
  9        | MMC2              | Scanline IRQ
  10       | MMC4              | Scanline IRQ
  11       | Color Dreams      | IRQ support
  15       | Pirate MMC5       | IRQs
  18       | Taito TC0190      | IRQ support
  21       | Konami VRC4       | IRQ for scanline counting
  22       | VRC6              | IRQs used
  23       | VRC7              | IRQs used
  24       | Namco 163         | IRQ support
  25       | Sunsoft 5B        | IRQ support
  26       | VRC2              | IRQ support
  32       | Irem G-101        | IRQ support
  33       | Jaleco JF-13      | IRQ support
  34       | Namco 106         | IRQ support
  66       | GNROM             | IRQ support
  68       | Sunsoft FME-7     | IRQ support
  71       | Camerica BC        | IRQ support

  Notes:
  - IRQs mainly used for scanline counting and mid-frame graphical effects.
  - Simpler mappers like NROM (0) and UxROM (2) do NOT use IRQs.
  - Some mappers have partial or undocumented IRQ features.

  Prioritise implementing IRQ support for popular mappers like MMC3 (4), MMC5 (5), and VRC6 (22).
*/
function BRK_IMP() {
  const ret = (CPUregisters.PC + 2) & 0xFFFF;
  pushStack((ret >> 8) & 0xFF);
  pushStack(ret & 0xFF);
  pushStatus(true);   // Break=1 only here

  CPUregisters.P.I = 1;

  const lo = checkReadOffset(0xFFFE);
  const hi = checkReadOffset(0xFFFF);
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;

  addExtraCycles(5); // plus 2 base = 7 total
}

function LDA_IMM() {
  CPUregisters.A = checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function LDA_ZP() {
  const address = checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.A = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function LDA_ZPX() {
  const address = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  CPUregisters.A = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function LDA_ABS() {
  const address = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.A = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function STA_ABSX() {
  const address = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  checkWriteOffset(address, CPUregisters.A);
}

function ADC_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1);
  let carryIn = CPUregisters.P.C ? 1 : 0;
  let result;

  if (CPUregisters.P.D) {
    // Decimal mode BCD addition
    let lowNibble = (CPUregisters.A & 0x0F) + (value & 0x0F) + carryIn;
    let carry = 0;

    if (lowNibble > 9) {
      lowNibble += 6;
    }
    carry = lowNibble > 0x0F ? 1 : 0;
    lowNibble &= 0x0F;

    let highNibble = (CPUregisters.A >> 4) + (value >> 4) + carry;
    if (highNibble > 9) {
      highNibble += 6;
    }
    result = ((highNibble << 4) | lowNibble) & 0xFF;

    CPUregisters.P.C = highNibble > 0x0F ? 1 : 0;

    // Overflow flag in decimal mode is implementation-defined; NES clears it.
    CPUregisters.P.V = 0; 
  } else {
    // Binary mode addition
    const sum = CPUregisters.A + value + carryIn;
    CPUregisters.P.C = (sum > 255) ? 1 : 0;
    // **Correct overflow detection:**
    CPUregisters.P.V = ((~(CPUregisters.A ^ value) & (CPUregisters.A ^ sum) & 0x80) !== 0) ? 1 : 0;
    result = sum & 0xFF;
  }

  CPUregisters.A = result;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

/*
The AND instruction does a bitwise AND between the accumulator (A) and the given immediate value, then stores the result in A.

It also sets flags:

Z (zero) if the result is 0

N (negative) if the result has bit 7 set
*/
function AND_IMM() {
  // opcode logic
  let oldVal = CPUregisters.A;
  let immVal = checkReadOffset(CPUregisters.PC +1);
  let newVal = oldVal & immVal;
  CPUregisters.A = newVal;
  // flags
  if (CPUregisters.A === 0) CPUregisters.P.Z = 1;
  if (CPUregisters.A & 0x80) CPUregisters.P.N = 1;
}

function LDA_ABSX() {
  // Fetch base address from instruction
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const base = (hi << 8) | lo;
  const address = (base + CPUregisters.X) & 0xFFFF;

  CPUregisters.A = checkReadOffset(address); // Fetch the data
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;

  // Detect page boundary crossing ONLY for this data fetch:
  if ((base & 0xFF00) !== (address & 0xFF00)) {
      //cpuCycles = (cpuCycles + 1) & 0xFFFF;
      addExtraCycles(1);
  }

}

function LDA_ABSY() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const base = (hi << 8) | lo;
  const address = (base + CPUregisters.Y) & 0xFFFF;

  CPUregisters.A = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;

  // Detect page boundary crossing
  if ((base & 0xFF00) !== (address & 0xFF00)) {
    //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    addExtraCycles(1);
  }
}

function LDA_INDX() {
  const zpaddress = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = ((checkReadOffset((zpaddress + 1) & 0xFF) << 8) | checkReadOffset(zpaddress)) & 0xFFFF;
  CPUregisters.A = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function LDA_INDY() {
  const zp = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const lo = checkReadOffset(zp);
  const hi = checkReadOffset((zp + 1) & 0xFF);
  const base = (hi << 8) | lo;
  const address = (base + CPUregisters.Y) & 0xFFFF;

  CPUregisters.A = checkReadOffset(address, true);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
    // Add a cycle if page boundary is crossed when adding Y
  if ((base & 0xFF00) !== (address & 0xFF00)) addExtraCycles(1);//cpuCycles = (cpuCycles + 1) & 0xFFFF;
}

function STA_ZP() {
  const address = checkReadOffset(CPUregisters.PC + 1);
  checkWriteOffset(address, CPUregisters.A);
}

function STA_ZPX() {
  const address = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  checkWriteOffset(address, CPUregisters.A);
}

function STA_ABS() {
  const address = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  checkWriteOffset(address, CPUregisters.A);
}

function STA_ABSY() {
  const base = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  const address = (base + CPUregisters.Y) & 0xFFFF;
  checkWriteOffset(address, CPUregisters.A);
}

function STA_INDX() {
  const zpaddress = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (checkReadOffset((zpaddress + 1) & 0xFF) << 8) | checkReadOffset(zpaddress);
  checkWriteOffset(address, CPUregisters.A);
}

function STA_INDY() {
  const zpaddress = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset((zpaddress + 1) & 0xFF) << 8) | checkReadOffset(zpaddress);
  const address = (base + CPUregisters.Y) & 0xFFFF;
  checkWriteOffset(address, CPUregisters.A);
}

// Flag manipulation instructions
function CLC_IMP() { CPUregisters.P.C = 0; }  // Clear Carry
function SEC_IMP() { CPUregisters.P.C = 1; }  // Set Carry

function CLI_IMP() { CPUregisters.P.I = 0; }  // Clear Interrupt Disable
function SEI_IMP() { CPUregisters.P.I = 1; }  // Set Interrupt Disable

function CLD_IMP() { CPUregisters.P.D = 0; }  // Clear Decimal
function SED_IMP() { CPUregisters.P.D = 1; }  // Set Decimal

function CLV_IMP() { CPUregisters.P.V = 0; }  // Clear Overflow

function INC_ZP() {
  const addressess = checkReadOffset(CPUregisters.PC + 1);
  const value = (checkReadOffset(addressess) + 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function INC_ZPX() {
  const addressess = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const value = (checkReadOffset(addressess) + 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function INC_ABS() {
  const addressess = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  const value = (checkReadOffset(addressess) + 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function INC_ABSX() {
  
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  const value = (checkReadOffset(addressess) + 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
  //cpuCycles = (cpuCycles + 3) & 0xFFFF; // quirk, add 3 to base cycles
  addExtraCycles(3);
}

function JMP_ABS() {
  const pc0 = CPUregisters.PC & 0xFFFF;                         // snapshot

  const lo  = checkReadOffset((pc0 + 1) & 0xFFFF) & 0xFF;       // operand low
  const hi  = checkReadOffset((pc0 + 2) & 0xFFFF) & 0xFF;       // operand high
  const tgt = ((hi << 8) | lo) & 0xFFFF;

  CPUregisters.PC = tgt;                                        // set PC directly
}

function JMP_IND() {
  const pc0 = CPUregisters.PC & 0xFFFF;
  const opc = checkReadOffset(pc0) & 0xFF;        // expect 0x6C

  const ptrLo = checkReadOffset((pc0 + 1) & 0xFFFF) & 0xFF;
  const ptrHi = checkReadOffset((pc0 + 2) & 0xFFFF) & 0xFF;
  const ptr   = (ptrHi << 8) | ptrLo;

  // NMOS 6502 page-wrap bug: high byte fetch wraps within the same page
  const bugAddr = (ptr & 0xFF00) | ((ptr + 1) & 0x00FF);

  const lo = checkReadOffset(ptr)     & 0xFF;
  const hi = checkReadOffset(bugAddr) & 0xFF;
  const tgt = ((hi << 8) | lo) & 0xFFFF;

  // Set PC directly; dispatcher must NOT add +3 after this
  CPUregisters.PC = tgt;  
}

function ROL_ACC() {
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (CPUregisters.A & 0x80) !== 0;
  CPUregisters.A = ((CPUregisters.A << 1) | carryIn) & 0xFF;
  CPUregisters.P.C = (carryOut) ? 1 : 0;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ROL_ZP() {
  const addressess = checkReadOffset(CPUregisters.PC + 1);
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (value & 0x80) !== 0;
  const result = ((value << 1) | carryIn) & 0xFF;
  checkWriteOffset(addressess, result);
  CPUregisters.P.C = (carryOut) ? 1 : 0;

  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function ROL_ZPX() {
  const addressess = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (value & 0x80) !== 0;
  const result = ((value << 1) | carryIn) & 0xFF;
  checkWriteOffset(addressess, result);
  CPUregisters.P.C = (carryOut) ? 1 : 0;

  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function ROL_ABS() {
  const addressess = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (value & 0x80) !== 0;
  const result = ((value << 1) | carryIn) & 0xFF;
  checkWriteOffset(addressess, result);
  CPUregisters.P.C = (carryOut) ? 1 : 0;

  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function ROL_ABSX() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (value & 0x80) !== 0;
  const result = ((value << 1) | carryIn) & 0xFF;
  checkWriteOffset(addressess, result);
  CPUregisters.P.C = (carryOut) ? 1 : 0;

  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function TXS_IMP() {
  CPUregisters.S = CPUregisters.X;
  // No status flags affected
}

function TSX_IMP() {
  CPUregisters.X = CPUregisters.S;
  CPUregisters.P.Z = +(CPUregisters.X === 0);
  CPUregisters.P.N = (CPUregisters.X >> 7) & 1;
}

function LDX_IMM() {
  // Load immediate value into X register (immediate operand is next byte)
  CPUregisters.X = checkReadOffset(CPUregisters.PC +1);
  
  // Set zero and negative flags
  CPUregisters.P.Z = ((CPUregisters.X === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0) ? 1 : 0;
}

function LDX_ZP() {
  // Fetch operand (zero page address) from instruction stream
  const zpAddr = checkReadOffset(CPUregisters.PC + 1);
  // Read from zero page
  CPUregisters.X = checkReadOffset(zpAddr & 0xFF);
  // Update flags
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) ? 1 : 0;
}

function LDX_ZPY() {
  // Load value from zero page addressess + Y into X
  const baseaddress = checkReadOffset(CPUregisters.PC +1);
  const addressess = (baseaddress + CPUregisters.Y) & 0xFF; // zero page wrap
  CPUregisters.X = checkReadOffset(addressess);
  
  // Set zero and negative flags
  CPUregisters.P.Z = ((CPUregisters.X === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0) ? 1 : 0;
}

function LDX_ABS() {
  // Load value from absolute addressess into X
  const low = checkReadOffset(CPUregisters.PC +1);
  const high = checkReadOffset(CPUregisters.PC +2);
  const addressess = (high << 8) | low;
  CPUregisters.X = checkReadOffset(addressess);
  
  // Set zero and negative flags
  CPUregisters.P.Z = ((CPUregisters.X === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0) ? 1 : 0;
}

function LDX_ABSY() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const base = (hi << 8) | lo;
  const address = (base + CPUregisters.Y) & 0xFFFF;

  CPUregisters.X = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0) ? 1 : 0;
    // Add cycle if page crossed (standard quirk)
  if ((base & 0xFF00) !== (address & 0xFF00)) addExtraCycles(1); //cpuCycles = (cpuCycles + 1) & 0xFFFF;
}

function ADC_ZP() {
  const addressess = checkReadOffset(CPUregisters.PC + 1);
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = (result > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((result & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.V = ((~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_ZPX() {
  const baseaddress = checkReadOffset(CPUregisters.PC + 1);
  const addressess = (baseaddress + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = (result > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((result & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.V = ((~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_ABS() {
  const low = checkReadOffset(CPUregisters.PC + 1);
  const high = checkReadOffset(CPUregisters.PC + 2);
  const addressess = (high << 8) | low;
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = (result > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((result & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.V = ((~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = result & 0xFF;
}

// Shared core: do 8-bit add with carry in either binary or BCD.
// Mirrors classic 6502 behavior: V computed from binary add even in BCD.
function adc_core(a, val, carryIn, decimal) {
  const ai = a & 0xFF, bi = val & 0xFF, ci = carryIn & 1;

  if (!decimal) {
    const sum = ai + bi + ci;
    const res = sum & 0xFF;
    CPUregisters.P.V = ((~(ai ^ bi) & (ai ^ res) & 0x80) !== 0) ? 1 : 0;
    CPUregisters.P.C = (sum > 0xFF) ? 1 : 0;
    CPUregisters.P.Z = (res === 0) ? 1 : 0;
    CPUregisters.P.N = (res & 0x80) ? 1 : 0;
    return res;
  }

  // BCD (NMOS 6502 style)
  let lo = (ai & 0x0F) + (bi & 0x0F) + ci;
  let hi = (ai & 0xF0) + (bi & 0xF0);
  if (lo > 9) { lo += 6; hi += 0x10; }
  let sum = (lo & 0x0F) | (hi & 0xF0);
  let carry = (hi > 0x90) ? 1 : 0;
  if ((hi & 0xF0) > 0x90) sum += 0x60;

  const res = sum & 0xFF;

  // Flags: V still from binary add, C from BCD carry-out
  const binSum = ai + bi + ci;
  CPUregisters.P.V = ((~(ai ^ bi) & (ai ^ (binSum & 0xFF)) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.C = carry;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res & 0x80) ? 1 : 0;
  return res;
}

function ADC_ABSX() {
  const lo   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi   = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;

  const val  = checkReadOffset(addr) & 0xFF;
  const dec  = (CPUregisters.P.D === 1);      // if you emulate decimal
  const cin  = CPUregisters.P.C & 1;

  const res = adc_core(CPUregisters.A, val, cin, dec);
  CPUregisters.A = res;

  // timing (+1 on page cross
  if ((addr & 0xFF00) !== (base & 0xFF00)) addExtraCycles(1);//cpuCycles = (cpuCycles + 1) & 0xFFFF;
}

function ADC_ABSY() {
  const lo   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi   = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  const val  = checkReadOffset(addr) & 0xFF;             // <-- bus-aware read
  const cin  = CPUregisters.P.C & 1;
  const dec  = !!CPUregisters.P.D && !!CPU_FEATURE_DECIMAL; // gate for NES

  const res = adc_core(CPUregisters.A, val, cin, dec);
  CPUregisters.A = res;

  // timing (+1 cycle if page crossed)
  if ((addr & 0xFF00) !== (base & 0xFF00)) addExtraCycles(1);// cpuCycles = (cpuCycles + 1) & 0xFFFF;
}

function ADC_INDX() {
  const operand = checkReadOffset(CPUregisters.PC +1);;
  const ptr = (operand + CPUregisters.X) & 0xFF;
  const low = checkReadOffset(ptr);
  const high = checkReadOffset((ptr + 1) & 0xFF);
  const addressess = (high << 8) | low;
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = (result > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((result & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.V = ((~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_INDY() {
  const operand = checkReadOffset(CPUregisters.PC +1);
  const low = checkReadOffset(operand & 0xFF);
  const high = checkReadOffset((operand + 1) & 0xFF);
  const baseaddressess = (high << 8) | low;
  const addressess = (baseaddressess + CPUregisters.Y) & 0xFFFF;
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = (result > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((result & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.V = ((~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = result & 0xFF;
}

/*
Execution steps
Fetch operand address from the next byte after the opcode.

Example: if the instruction is AND $10, CPU fetches $10.

Read value from memory location $0010 (zero page).

Bitwise AND the accumulator with this value:

Update flags:

Z (zero flag) = 1 if the result is 0

N (negative flag) = bit 7 of result

V and others are unaffected.
*/

function AND_ZP() {
let operand = checkReadOffset(CPUregisters.PC +1);
let val = checkReadOffset(operand) & 0xFF;
let result =CPUregisters.A & val & 0xFF;
CPUregisters.A = result
if (CPUregisters.A === 0x00) CPUregisters.P.Z = 1;
if (CPUregisters & 0x80) CPUregisters.P.N = 1;
}

function AND_ZPX() {
  const addr = checkReadOffset(CPUregisters.PC +1);
  const effAddr = (addr + CPUregisters.X) & 0xFF;
  const val = checkReadOffset(effAddr);
  CPUregisters.A = CPUregisters.A & val;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
}

function AND_ABS() {
  const low = checkReadOffset(CPUregisters.PC +1);
  const high = checkReadOffset(CPUregisters.PC +2);
  const addressess = (high << 8) | low;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_ABSX() {
  const low = checkReadOffset(CPUregisters.PC +1);
  const high = checkReadOffset(CPUregisters.PC +2);
  const baseaddressess = (high << 8) | low;
  const addressess = (baseaddressess + CPUregisters.X) & 0xFFFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_ABSY() {
  const low = checkReadOffset(CPUregisters.PC +1);
  const high = checkReadOffset(CPUregisters.PC +2);
  const baseaddressess = (high << 8) | low;
  const addressess = (baseaddressess + CPUregisters.Y) & 0xFFFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

// AND ($nn,X) — 0x21 — 6 cycles, no page-cross penalty
function AND_INDX() {
  const zp   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const ptr  = (zp + (CPUregisters.X & 0xFF)) & 0xFF;     // ZP index (wrap)
  const lo   = checkReadOffset(ptr) & 0xFF;
  const hi   = checkReadOffset((ptr + 1) & 0xFF) & 0xFF;  // ZP wrap for hi
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const val  = checkReadOffset(addr) & 0xFF;

  const res = (CPUregisters.A & val) & 0xFF;
  CPUregisters.A   = res;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res & 0x80) ? 1 : 0;

  //cpuCycles = (cpuCycles + 6) & 0xFFFF; // +add 6 to 1 base cycles, total 7 for this opcode
  addExtraCycles(6);
}

// AND ($nn),Y — opcode 0x31
function AND_INDY() {
  const nn   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF; // operand byte in PRG
  const lo   = checkReadOffset(nn) & 0xFF;                     // ZP pointer lo
  const hi   = checkReadOffset((nn + 1) & 0xFF) & 0xFF;        // ZP wrap for hi
  const base = ((hi << 8) | lo) & 0xFFFF;

  const y    = CPUregisters.Y & 0xFF;
  const addr = (base + y) & 0xFFFF;

  const val  = checkReadOffset(addr) & 0xFF;
  const res  = (CPUregisters.A & val) & 0xFF;

  CPUregisters.A   = res;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res & 0x80) ? 1 : 0;

  //cpuCycles = (cpuCycles + 5) & 0xFFFF;
  addExtraCycles(5);

  if ((addr & 0xFF00) !== (base & 0xFF00))addExtraCycles(1); //cpuCycles = (cpuCycles + 1) & 0xFFFF;
}

// ---------- ASL (Accumulator) total = 2 cycles → extra = 0 ----------
function ASL_ACC() {
  const old    = CPUregisters.A & 0xFF;
  const result = (old << 1) & 0xFF;

  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.A   = result;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;
}

// ---------- ASL $nn  (ZP) total = 5 cycles → extra = +2 ----------
function ASL_ZP() {
  const op  = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const ea  = op; // zero-page address

  const old = checkReadOffset(ea) & 0xFF;
  checkWriteOffset(ea, old);                // dummy write (RMW bus pattern)

  const res = (old << 1) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  checkWriteOffset(ea, res);                // final write

  //cpuCycles = (cpuCycles + 2) & 0xFFFF; // base(3) + 2 = 5
  addExtraCycles(2);

}

// ---------- ASL $nn,X (ZP,X) total = 6 cycles → extra = +2 ----------
function ASL_ZPX() {
  const op   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const ea   = (op + (CPUregisters.X & 0xFF)) & 0xFF;  // ZP wrap

  const old  = checkReadOffset(ea) & 0xFF;
  checkWriteOffset(ea, old);                // dummy

  const res  = (old << 1) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  checkWriteOffset(ea, res);                // final

 //cpuCycles = (cpuCycles + 2) & 0xFFFF; // base(4) + 2 = 6
 addExtraCycles(2);

}

// ---------- ASL $nnnn (ABS) total = 6 cycles → extra = +2 ----------
function ASL_ABS() {
  const lo  = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi  = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const ea  = ((hi << 8) | lo) & 0xFFFF;

  const old = checkReadOffset(ea) & 0xFF;
  checkWriteOffset(ea, old);                // dummy

  const res = (old << 1) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  checkWriteOffset(ea, res);                // final

 //cpuCycles = (cpuCycles + 2) & 0xFFFF; // base(4) + 2 = 6
 addExtraCycles(2);

}

// ---------- ASL $nnnn,X (ABS,X) total = 7 cycles → extra = +3 ----------
function ASL_ABSX() {
  const lo   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi   = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const ea   = (((hi << 8) | lo) + (CPUregisters.X & 0xFF)) & 0xFFFF;

  const old  = checkReadOffset(ea) & 0xFF;
  checkWriteOffset(ea, old);                // dummy

  const res  = (old << 1) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  checkWriteOffset(ea, res);                // final

  //cpuCycles = (cpuCycles + 3) & 0xFFFF; // base(4) + 3 = 7 (fixed; no page-cross add for RMW)
  addExtraCycles(3);
}

function BIT_ZP() {
  // Zero‑page addressessing
  const operand = checkReadOffset(CPUregisters.PC +1) & 0xFF;
  const m      = checkReadOffset(operand) & 0xFF;
  const res    = CPUregisters.A & m;

  // Z = (A & M) == 0
  CPUregisters.P.Z = ((res === 0 ? 1 : 0)) ? 1 : 0;
  // V = M bit 6
  CPUregisters.P.V = ((m & 0x40) >>> 6) ? 1 : 0;
  // N = M bit 7
  CPUregisters.P.N = ((m & 0x80) >>> 7) ? 1 : 0;
}

function BIT_ABS() {
  // Absolute addressessing
  const lo   = checkReadOffset(CPUregisters.PC +1);
  const hi   = checkReadOffset(CPUregisters.PC +2);
  const address = ((hi << 8) | lo) & 0xFFFF;
  const m    = checkReadOffset(address) & 0xFF;
  const res  = CPUregisters.A & m;

  CPUregisters.P.Z = ((res === 0 ? 1 : 0)) ? 1 : 0;
  CPUregisters.P.V = ((m & 0x40) >>> 6) ? 1 : 0;
  CPUregisters.P.N = ((m & 0x80) >>> 7) ? 1 : 0;
}

// Logical Shift Right — Accumulator
function LSR_ACC() {
  const oldA  = CPUregisters.A & 0xFF;
  const result = (oldA >>> 1) & 0xFF;
  // C = old bit 0
  CPUregisters.P.C = (oldA & 0x01) ? 1 : 0;
  // store result
  CPUregisters.A   = result;
  // Z = result == 0
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  // N = always 0 after LSR
  CPUregisters.P.N = (0) ? 1 : 0;
}

// LSR $nn  (0x46) — Zero Page
function LSR_ZP() {
  const zp   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const old  = checkReadOffset(zp) & 0xFF;
  const res  = (old >>> 1) & 0xFF;

  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  checkWriteOffset(zp, res);
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = 0;

  //cpuCycles = (cpuCycles + 5) & 0xFFFF; // ZP: 5 cycles
  addExtraCycles(5);

}

// LSR $nn,X  (0x56) — Zero Page,X (wrap)
function LSR_ZPX() {
  const zp   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;
  const old  = checkReadOffset(addr) & 0xFF;
  const res  = (old >>> 1) & 0xFF;

  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  checkWriteOffset(addr, res);
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = 0;

  //cpuCycles = (cpuCycles + 6) & 0xFFFF;// ZP,X: 6 cycles
  addExtraCycles(6);
}

// LSR $nnnn  (0x4E) — Absolute
function LSR_ABS() {
  const lo   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi   = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const old  = checkReadOffset(addr) & 0xFF;
  const res  = (old >>> 1) & 0xFF;

  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  checkWriteOffset(addr, res);
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = 0;

  //cpuCycles = (cpuCycles + 6) & 0xFFFF; // ABS: 6 cycles
  addExtraCycles(6);
}

// LSR $nnnn,X  (0x5E) — Absolute,X
function LSR_ABSX() {
  const lo    = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi    = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const base  = ((hi << 8) | lo) & 0xFFFF;
  const addr  = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const old   = checkReadOffset(addr) & 0xFF;
  const res   = (old >>> 1) & 0xFF;

  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  checkWriteOffset(addr, res);
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = 0;

  //cpuCycles = (cpuCycles + 7) & 0xFFFF; // ABS,X: 7 cycles (RMW)
  addExtraCycles(1); // +1 on base, 7 is a mistake
}

function ORA_IMM() {
  // Fetch immediate operand
  const value  = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  // Compute result
  const result = (CPUregisters.A | value) & 0xFF;
  // Store back into A
  CPUregisters.A = result;
  // Z = result == 0?
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  // N = bit 7 of result
  CPUregisters.P.N = ((result & 0x80) >>> 7) ? 1 : 0;
}

function ORA_ZP() {
  const addressess = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_ZPX() {
  const addressess = (checkReadOffset(CPUregisters.PC +1) + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_ABS() {
  const low = checkReadOffset(CPUregisters.PC +1);
  const high = checkReadOffset(CPUregisters.PC +2);
  const addressess = (high << 8) | low;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_ABSX() {
  const low = checkReadOffset(CPUregisters.PC +1);
  const high = checkReadOffset(CPUregisters.PC +2);
  const addressess = ((high << 8) | low) + CPUregisters.X;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_ABSY() {
  const low = checkReadOffset(CPUregisters.PC +1);
  const high = checkReadOffset(CPUregisters.PC +2);
  const addressess = ((high << 8) | low) + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_INDX() {
  const operand = checkReadOffset(CPUregisters.PC +1);
  const ptr = (operand + CPUregisters.X) & 0xFF;
  const low = checkReadOffset(ptr);
  const high = checkReadOffset((ptr + 1) & 0xFF);
  const addressess = (high << 8) | low;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_INDY() {
  const operand = checkReadOffset(CPUregisters.PC +1);
  const low = checkReadOffset(operand);
  const high = checkReadOffset((operand + 1) & 0xFF);
  const addressess = ((high << 8) | low) + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

// CMP #imm — 0xC9
function CMP_IMM() {
  const m    = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const a    = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

// CMP $nn — 0xC5
function CMP_ZP() {
  const zp   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const m    = checkReadOffset(zp) & 0xFF;
  const a    = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

// CMP $nn,X — 0xD5
function CMP_ZPX() {
  const zp   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;
  const m    = checkReadOffset(addr) & 0xFF;
  const a    = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

// CMP $nnnn — 0xCD
function CMP_ABS() {
  const lo   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi   = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const m    = checkReadOffset(addr) & 0xFF;
  const a    = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

// CMP $nnnn,X — 0xDD
function CMP_ABSX() {
  const lo    = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi    = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const base  = ((hi << 8) | lo) & 0xFFFF;
  const addr  = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const m     = checkReadOffset(addr) & 0xFF;
  const a     = CPUregisters.A & 0xFF;
  const diff  = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

// CMP $nnnn,Y — 0xD9
function CMP_ABSY() {
  const lo    = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi    = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const base  = ((hi << 8) | lo) & 0xFFFF;
  const addr  = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  const m     = checkReadOffset(addr) & 0xFF;
  const a     = CPUregisters.A & 0xFF;
  const diff  = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

// CMP ($nn,X) — 0xC1
function CMP_INDX() {
  const nn   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const ptr  = (nn + (CPUregisters.X & 0xFF)) & 0xFF;      // ZP wrap
  const lo   = checkReadOffset(ptr) & 0xFF;
  const hi   = checkReadOffset((ptr + 1) & 0xFF) & 0xFF;   // ZP wrap for hi
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const m    = checkReadOffset(addr) & 0xFF;
  const a    = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

// CMP ($nn),Y — 0xD1
function CMP_INDY() {
  const nn   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const lo   = checkReadOffset(nn) & 0xFF;
  const hi   = checkReadOffset((nn + 1) & 0xFF) & 0xFF;    // ZP wrap for hi
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  const m    = checkReadOffset(addr) & 0xFF;
  const a    = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

// ---------- CPY ----------
function CPY_IMM() { // C0
  const operand = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const diff = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = ((CPUregisters.Y & 0xFF) >= operand) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

function CPY_ZP() { // C4
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const operand = checkReadOffset(zp) & 0xFF;
  const diff = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = ((CPUregisters.Y & 0xFF) >= operand) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

function CPY_ABS() { // CC
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const operand = checkReadOffset(addr) & 0xFF;
  const diff = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = ((CPUregisters.Y & 0xFF) >= operand) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
}

function DEC_ZP() {
  // 1. Fetch address from instruction
  const addr = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  // 2. Read value at address
  let val = checkReadOffset(addr);
  // 3. Decrement, wrap 8-bit
  val = (val - 1) & 0xFF;
  // 4. Write back
  checkWriteOffset(addr, val);
  // 5. Set flags
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
}

// DEC $nn,X  (opcode 0xD6)
function DEC_ZPX() {
  const zp   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;        // zero-page wrap
  const val  = (checkReadOffset(addr) - 1) & 0xFF;
  checkWriteOffset(addr, val);
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  //cpuCycles = (cpuCycles + 2) & 0xFFFF;  // add two to base of 4 for Absolute addressing, 6 total for this opcode
  addExtraCycles(2);
 // so the worker thread can action its 3 ticks per CPU cycle instantly
}

// DEC $nnnn  (opcode 0xCE)
function DEC_ABS() {
  const lo   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi   = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const val  = (checkReadOffset(addr) - 1) & 0xFF;
  checkWriteOffset(addr, val);
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  //cpuCycles = (cpuCycles + 2) & 0xFFFF; // add two to base of 4 for Absolute addressing, 6 total for this opcode
  addExtraCycles(2);

}

function DEC_ABSX() {
  // Fetch operand bytes via bus
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;

  // Effective address (absolute,X); page-cross doesn't change timing for RMW
  const ea = (((hi << 8) | lo) + (CPUregisters.X & 0xFF)) & 0xFFFF;

  // RMW bus pattern: read -> dummy write (old) -> compute -> final write (new)
  const old = checkReadOffset(ea) & 0xFF;
  checkWriteOffset(ea, old);                 // dummy write of original value

  const val = (old - 1) & 0xFF;              // modify
  checkWriteOffset(ea, val);                 // final write

  // Flags
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val >>> 7) & 1;

  // Timing: base(absX)=4 added by dispatcher; add +3 here -> total 7
  //cpuCycles = (cpuCycles + 3) & 0xFFFF;
  addExtraCycles(3);
}

function EOR_IMM() {
  const value = checkReadOffset(CPUregisters.PC +1);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ZP() {
  const addressess = checkReadOffset(CPUregisters.PC +1);
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ZPX() {
  const addressess = (checkReadOffset(CPUregisters.PC +1) + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ABS() {
  const addressess = (checkReadOffset(CPUregisters.PC +2) << 8) | checkReadOffset(CPUregisters.PC +1);
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ABX() {
  const addressess = (((checkReadOffset(CPUregisters.PC +2) << 8) | checkReadOffset(CPUregisters.PC +1)) + CPUregisters.X) & 0xFFFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ABY() {
  const addressess = (((checkReadOffset(CPUregisters.PC +2) << 8) | checkReadOffset(CPUregisters.PC +1)) + CPUregisters.Y) & 0xFFFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_INY() {
  const operand = checkReadOffset(CPUregisters.PC +1);
  const lowByteaddress = operand & 0xFF;
  const highByteaddress = (operand + 1) & 0xFF;
  const addressess = (((checkReadOffset(highByteaddress) << 8) | checkReadOffset(lowByteaddress)) + CPUregisters.Y) & 0xFFFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ABSX() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ABSY() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_INDX() {

  const nn   = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF; // operand from PRG
  const ptr  = (nn + (CPUregisters.X & 0xFF)) & 0xFF;         // ZP index (wrap)
  const lo   = checkReadOffset(ptr) & 0xFF;
  const hi   = checkReadOffset((ptr + 1) & 0xFF) & 0xFF;      // ZP wrap for hi
  const addr = ((hi << 8) | lo) & 0xFFFF;

  const val  = checkReadOffset(addr) & 0xFF;
  const res  = (CPUregisters.A ^ val) & 0xFF;

  CPUregisters.A   = res;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res & 0x80) ? 1 : 0;

  //cpuCycles = (cpuCycles + 6) & 0xFFFF;// fixed for INDX
  addExtraCycles(6);
}

function EOR_INDY() {
  const zpaddress = checkReadOffset(CPUregisters.PC + 1);
  const addressess = ((checkReadOffset(zpaddress + 1) << 8) | checkReadOffset(zpaddress)) + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function JSR_ABS() {
  // Fetch target address from next two bytes (little endian)
  const low  = checkReadOffset(CPUregisters.PC + 1);
  const high = checkReadOffset(CPUregisters.PC + 2);
  const target = (high << 8) | low;

  // Compute return address = PC + 2 (last byte of JSR instruction)
  const returnAddr = (CPUregisters.PC + 2) & 0xFFFF;

  // Push return address - 1 onto stack (high byte first, then low)
  checkWriteOffset(0x0100 + CPUregisters.S, (returnAddr >> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  checkWriteOffset(0x0100 + CPUregisters.S, returnAddr & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Set PC to target address (jump)
  CPUregisters.PC = target;
  addExtraCycles(2) // 2 over base of 4, 6 for this handler
}

function STY_ZP() {
  const address = checkReadOffset(CPUregisters.PC + 1);
  checkWriteOffset(address, CPUregisters.Y);
}

function STY_ZPX() {
  const address = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  checkWriteOffset(address, CPUregisters.Y);
}

function STY_ABS() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = (hi << 8) | lo;
  checkWriteOffset(address, CPUregisters.Y);
}

function LDY_IMM() {
  const val        = checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.Y   = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
}

function LDY_ZP() {
  // Fetch operand (zero page address) from instruction stream
  const zpAddr = checkReadOffset(CPUregisters.PC + 1);
  // Read value from zero page
  const value = checkReadOffset(zpAddr & 0xFF);
  // Store into Y
  CPUregisters.Y = value;
  // Update flags
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value & 0x80) ? 1 : 0;
}

function LDY_ZPX() {
  const zp         = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const val        = checkReadOffset(zp);
  CPUregisters.Y   = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
}

function LDY_ABS() {
  // Fetch operand (little endian) from instruction stream
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = (hi << 8) | lo;
  // Read from effective absolute address
  const value = checkReadOffset(address);
  // Store into Y
  CPUregisters.Y = value;
  // Update flags
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value & 0x80) ? 1 : 0;
}

function LDY_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const base = (hi << 8) | lo;
  const address = (base + CPUregisters.X) & 0xFFFF;

  CPUregisters.Y = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.Y === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.Y & 0x80) !== 0) ? 1 : 0;

  // Add cycle if page crossed — always do cycle logic *after* memory ops!
  if ((base & 0xFF00) !== (address & 0xFF00)) addExtraCycles(1);//cpuCycles = (cpuCycles + 1) & 0xFFFF;
  
}

function SBC_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1);
  const carry = CPUregisters.P.C ? 1 : 0;
  const A = CPUregisters.A;

  const raw = A - value - (1 - carry);

  if (CPUregisters.P.D) {
    // BCD mode subtraction
    let al = (A & 0x0F) - (value & 0x0F) - (1 - carry);
    let ah = (A >> 4) - (value >> 4);

    if (al < 0) {
      al += 10;
      ah -= 1;
    }
    if (ah < 0) {
      ah += 10;
      CPUregisters.P.C = 0; // borrow occurred, clear carry
    } else {
      CPUregisters.P.C = 1; // no borrow, set carry
    }

    const result = ((ah << 4) | (al & 0x0F)) & 0xFF;
    CPUregisters.A = result;

    // Set zero and negative flags
    CPUregisters.P.Z = (result === 0) ? 1 : 0;
    CPUregisters.P.N = (result & 0x80) ? 1 : 0;

    // Overflow flag undefined in BCD, clear it
    CPUregisters.P.V = 0;
  } else {
    // Binary mode subtraction
    CPUregisters.P.C = raw >= 0 ? 1 : 0;
    CPUregisters.A = raw & 0xFF;

    // Set zero and negative flags
    CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
    CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;

    // Overflow flag
    CPUregisters.P.V = (((A ^ raw) & (A ^ value) & 0x80) !== 0) ? 1 : 0;
  }
}



function SBC_ZP() {
  const address = checkReadOffset(CPUregisters.PC + 1);
  const value = checkReadOffset(address) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = (sum > 0xFF ? 1 : 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function SBC_ZPX() {
  const address = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(address) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = (sum > 0xFF ? 1 : 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function SBC_ABS() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = (hi << 8) | lo;
  const value = checkReadOffset(address) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = (sum > 0xFF ? 1 : 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function SBC_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = ((hi << 8) | lo) + CPUregisters.X;
  const value = checkReadOffset(address & 0xFFFF) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = (sum > 0xFF ? 1 : 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function SBC_ABSY() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = ((hi << 8) | lo) + CPUregisters.Y;
  const value = checkReadOffset(address & 0xFFFF) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = (sum > 0xFF ? 1 : 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function SBC_INDX() {
  const zpaddress = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const lo = checkReadOffset(zpaddress);
  const hi = checkReadOffset((zpaddress + 1) & 0xFF);
  const address = (hi << 8) | lo;
  const value = checkReadOffset(address) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = (sum > 0xFF ? 1 : 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function SBC_INDY() {
  const zpaddress = checkReadOffset(CPUregisters.PC + 1);
  const lo = checkReadOffset(zpaddress);
  const hi = checkReadOffset((zpaddress + 1) & 0xFF);
  const address = ((hi << 8) | lo) + CPUregisters.Y;
  const value = checkReadOffset(address & 0xFFFF) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = (sum > 0xFF ? 1 : 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

// TYA - Transfer Y to A (implied)
function TYA_IMP() {
  CPUregisters.A = CPUregisters.Y;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
}

// TXA - Transfer X to A (implied)
function TXA_IMP() {
  CPUregisters.A = CPUregisters.X;
  CPUregisters.P.Z = +(CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A >> 7) & 1;
}

// PHP - Push Processor Status
function PHP_IMP() {
  pushStatus(true);   // always pushes with B=1
  addExtraCycles(1);  // 3 total
}

// PLP - Pull Processor Status
function PLP_IMP() {
  pullStatus();       // unpacks flags, ignores B, forces U
  addExtraCycles(2);  // 4 total
}

// PHA - Push Accumulator (implied)
function PHA_IMP() {
  const spAddr = 0x0100 | (CPUregisters.S & 0xFF);
  checkWriteOffset(spAddr, CPUregisters.A & 0xFF);  // push A
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;     // post-decrement
  addExtraCycles(1); // one over base of 2, 3 for this handler
}

// PLA - Pull Accumulator (implied)
function PLA_IMP() {
    CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
    CPUregisters.A = checkReadOffset(0x0100 | CPUregisters.S);
    CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
    CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
    addExtraCycles(2); // + 2 over base, for 4
}

// RTI - Return from Interrupt
function RTI_IMP() {
  // Pull status (B/U bits ignored, U forced to 1 internally)
  pullStatus();

  // Pull PC low then high
  const pcl = pullStack();
  const pch = pullStack();

  CPUregisters.PC = ((pch << 8) | pcl) & 0xFFFF;

  addExtraCycles(4); // 6 total with base
}

// RTS - Return from Subroutine (implied)
function RTS_IMP() {
  // Pull low byte
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  const pcl = checkReadOffset(0x100 | CPUregisters.S);
  // Pull high byte
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  const pch = checkReadOffset(0x100 | CPUregisters.S);
  // Reconstruct PC, then add 1 for proper return
  CPUregisters.PC = (((pch << 8) | pcl) + 1) & 0xFFFF;
  addExtraCycles(4); // base 2 + 4 for 6 cycles for this opcode
}

function NOP_ZPY() {
  // dummy read from (ZP + Y) but do nothing else
  const zp = checkReadOffset(CPUregisters.PC + 1);
  checkReadOffset((zp + CPUregisters.Y) & 0xFF);
  //cpuCycles = (cpuCycles + 1) & 0xFFFF; // +1 for this opcode
  addExtraCycles(1);
  
}

function NOP(){}

// Zero Page NOP (0x04, 0x44, 0x64)
// Reads zp operand, does nothing else
function NOP_ZP() {
  const zp = checkReadOffset(CPUregisters.PC + 1);
  checkReadOffset(zp & 0xFF);
}

// Zero Page,X NOP (0x14, 0x34, 0x54, 0x74, 0xD4, 0xF4)
// Reads zp+X operand, does nothing else
function NOP_ZPX() {
  const zp = checkReadOffset(CPUregisters.PC + 1);
  checkReadOffset((zp + CPUregisters.X) & 0xFF);
}

// Absolute NOP (0x0C)
// Reads absolute operand, does nothing else
function NOP_ABS() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const addr = lo | (hi << 8);
  checkReadOffset(addr);
}

function NOP_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const base = lo | (hi << 8);
  const eff = (base + CPUregisters.X) & 0xFFFF;
  checkReadOffset(eff);
  if ((base & 0xFF00) !== (eff & 0xFF00)) addExtraCycles(1); //cpuCycles = (cpuCycles + 1) & 0xFFFF; // Add cycle if page crossed
}

function SKB_IMM() {
  // dummy‐read the immediate operand (2‑byte instruction)
  checkReadOffset(CPUregisters.PC + 1);
}

function CPX_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1);
  const result = (CPUregisters.X - value) & 0xFF;

  CPUregisters.P.C = (CPUregisters.X >= value ? 1 : 0) ? 1 : 0;
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function CPX_ZP() {
  const address = checkReadOffset(CPUregisters.PC + 1);
  const value = checkReadOffset(address);
  const result = (CPUregisters.X - value) & 0xFF;

  CPUregisters.P.C = (CPUregisters.X >= value ? 1 : 0) ? 1 : 0;
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function CPX_ABS() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = (hi << 8) | lo;
  const value = checkReadOffset(address);
  const result = (CPUregisters.X - value) & 0xFF;

  CPUregisters.P.C = (CPUregisters.X >= value ? 1 : 0) ? 1 : 0;
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function DEX_IMP() {
  CPUregisters.X = (CPUregisters.X - 1) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.X === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function DEY_IMP() {
  CPUregisters.Y = (CPUregisters.Y - 1) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.Y === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.Y & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function INX_IMP() {
  CPUregisters.X = (CPUregisters.X + 1) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.X === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function INY_IMP() {
  CPUregisters.Y = (CPUregisters.Y + 1) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.Y === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.Y & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function ROR_ACC() {
  const carryIn = CPUregisters.P.C;
  CPUregisters.P.C = (CPUregisters.A & 0x01) ? 1 : 0;
  CPUregisters.A = (CPUregisters.A >> 1) | (carryIn << 7);
  CPUregisters.A &= 0xFF;

  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function ROR_ZP() {
  const address = checkReadOffset(CPUregisters.PC + 1);
  const value = checkReadOffset(address);
  const carryIn = CPUregisters.P.C;
  const carryOut = value & 0x01;

  const result = ((value >> 1) | (carryIn << 7)) & 0xFF;
  checkWriteOffset(address, result);

  CPUregisters.P.C = (carryOut) ? 1 : 0;
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function ROR_ZPX() {
  const base = checkReadOffset(CPUregisters.PC + 1);
  const address = (base + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(address);
  const carryIn = CPUregisters.P.C;
  const carryOut = value & 0x01;

  const result = ((value >> 1) | (carryIn << 7)) & 0xFF;
  checkWriteOffset(address, result);

  CPUregisters.P.C = (carryOut) ? 1 : 0;
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function ROR_ABS() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = (hi << 8) | lo;
  const value = checkReadOffset(address);
  const carryIn = CPUregisters.P.C;
  const carryOut = value & 0x01;

  const result = ((value >> 1) | (carryIn << 7)) & 0xFF;
  checkWriteOffset(address, result);

  CPUregisters.P.C = (carryOut) ? 1 : 0;
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function ROR_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const baseaddress = (hi << 8) | lo;
  const address = (baseaddress + CPUregisters.X) & 0xFFFF;
  const value = checkReadOffset(address);
  const carryIn = CPUregisters.P.C;
  const carryOut = value & 0x01;

  const result = ((value >> 1) | (carryIn << 7)) & 0xFF;
  checkWriteOffset(address, result);

  CPUregisters.P.C = (carryOut) ? 1 : 0;
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}
function TAX_IMP() {
  CPUregisters.X = CPUregisters.A;
  CPUregisters.P.Z = (CPUregisters.X === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function TAY_IMP() {
  CPUregisters.Y = CPUregisters.A;
  CPUregisters.P.Z = (CPUregisters.Y === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.Y & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
}

function STX_ZP() {
  const address = checkReadOffset(CPUregisters.PC + 1);
  checkWriteOffset(address, CPUregisters.X);
}

function STX_ZPY() {
  const base = checkReadOffset(CPUregisters.PC + 1);
  const address = (base + CPUregisters.Y) & 0xFF; // zero page wrap
  checkWriteOffset(address, CPUregisters.X);
}

function STX_ABS() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = (hi << 8) | lo;
  checkWriteOffset(address, CPUregisters.X);
}

  //          ................. illegalOpcode functions ................. 

  function LAX_IMM() {
    const val = checkReadOffset(CPUregisters.PC + 1);
    CPUregisters.A = CPUregisters.X = val;
    CPUregisters.P.Z = +(val === 0);
    CPUregisters.P.N = (val >> 7) & 1;
  }
  
  function RRA_INDX() {
    const zp = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
    const addr = checkReadOffset(zp) | (checkReadOffset((zp + 1) & 0xFF) << 8);
    let val = checkReadOffset(addr);

    // --- ROR memory (inline) ---
    const oldCarry = CPUregisters.P.C;
    CPUregisters.P.C = val & 0x01;               // new carry from bit 0
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);

    // --- ADC (A + val + carry) ---
    let acc = CPUregisters.A;
    let carry = CPUregisters.P.C ? 1 : 0;
    let result = acc + val + carry;

    // Flags
    CPUregisters.P.N = (result >> 7) & 1;
    CPUregisters.P.Z = +((result & 0xFF) === 0);
    CPUregisters.P.V = +(((~(acc ^ val) & (acc ^ result)) & 0x80) !== 0);
    CPUregisters.P.C = +(result > 0xFF);

    CPUregisters.A = result & 0xFF;
  }

function RRA_INDY() {
  const zp = checkReadOffset(CPUregisters.PC + 1);
  const base = checkReadOffset(zp) | (checkReadOffset((zp + 1) & 0xFF) << 8);
  const addr = (base + CPUregisters.Y) & 0xFFFF;
  let val = checkReadOffset(addr);

  // --- ROR (rotate right through carry) ---
  const oldCarry = CPUregisters.P.C;
  CPUregisters.P.C = val & 0x01;                // new carry from bit 0
  val = (val >> 1) | (oldCarry << 7);
  checkWriteOffset(addr, val);

  // --- ADC (A + val + carry) ---
  let acc = CPUregisters.A;
  let carry = CPUregisters.P.C ? 1 : 0;
  let result = acc + val + carry;

  // Flags
  CPUregisters.P.N = (result >> 7) & 1;                                // Negative
  CPUregisters.P.Z = +((result & 0xFF) === 0);                         // Zero
  CPUregisters.P.V = +(((~(acc ^ val) & (acc ^ result)) & 0x80) !== 0); // Overflow
  CPUregisters.P.C = +(result > 0xFF);                                 // Carry

  CPUregisters.A = result & 0xFF;
}

function RRA_ZP() {
  const addr = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  let val = checkReadOffset(addr);

  // --- ROR: rotate right through carry ---
  const oldCarry = CPUregisters.P.C;
  CPUregisters.P.C = val & 0x01;
  val = (val >> 1) | (oldCarry ? 0x80 : 0x00);
  checkWriteOffset(addr, val);

  // --- ADC: add val + carry ---
  const acc = CPUregisters.A;
  const carryIn = CPUregisters.P.C;
  const sum = acc + val + carryIn;

  // Flags for ADC
  CPUregisters.P.C = (sum > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((sum & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = (sum & 0x80) ? 1 : 0;
  CPUregisters.P.V = (~(acc ^ val) & (acc ^ sum) & 0x80) ? 1 : 0;

  CPUregisters.A = sum & 0xFF;
}

 function RRA_ZPX() {
  const zpAddr = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let val = checkReadOffset(zpAddr);

  // ----- ROR -----
  const oldCarry = CPUregisters.P.C;
  CPUregisters.P.C = val & 0x01;
  val = (val >> 1) | (oldCarry ? 0x80 : 0x00);
  checkWriteOffset(zpAddr, val);

  // ----- ADC -----
  const acc = CPUregisters.A;
  const carryIn = CPUregisters.P.C;
  const sum = acc + val + carryIn;

  CPUregisters.P.C = (sum > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((sum & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = (sum & 0x80) ? 1 : 0;
  CPUregisters.P.V = (~(acc ^ val) & (acc ^ sum) & 0x80) ? 1 : 0;

  CPUregisters.A = sum & 0xFF;
}

  function RRA_ABS() {
    const addr = checkReadOffset(CPUregisters.PC + 1) | (checkReadOffset(CPUregisters.PC + 2) << 8);
    let val = checkReadOffset(addr);

    // --- ROR (rotate right through carry) ---
    const oldCarry = CPUregisters.P.C;
    CPUregisters.P.C = val & 0x01;                // new carry from bit 0
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);

    // --- ADC (A + val + carry) ---
    let acc = CPUregisters.A;
    let carry = CPUregisters.P.C ? 1 : 0;
    let result = acc + val + carry;

    // Flags
    CPUregisters.P.N = (result >> 7) & 1;                                // Negative
    CPUregisters.P.Z = +((result & 0xFF) === 0);                         // Zero
    CPUregisters.P.V = +(((~(acc ^ val) & (acc ^ result)) & 0x80) !== 0); // Overflow
    CPUregisters.P.C = +(result > 0xFF);                                 // Carry

    CPUregisters.A = result & 0xFF;
  }

  
function RRA_ABSX() {
  const base = checkReadOffset(CPUregisters.PC + 1) | (checkReadOffset(CPUregisters.PC + 2) << 8);
  const addr = (base + CPUregisters.X) & 0xFFFF;
  let val = checkReadOffset(addr);

  // --- ROR (rotate right through carry) ---
  const oldCarry = CPUregisters.P.C;
  CPUregisters.P.C = val & 0x01;                // new carry from bit 0
  val = (val >> 1) | (oldCarry << 7);
  checkWriteOffset(addr, val);

  // --- ADC (A + val + carry) ---
  let acc = CPUregisters.A;
  let carry = CPUregisters.P.C ? 1 : 0;
  let result = acc + val + carry;

  // Flags
  CPUregisters.P.N = (result >> 7) & 1;                                // Negative
  CPUregisters.P.Z = +((result & 0xFF) === 0);                         // Zero
  CPUregisters.P.V = +(((~(acc ^ val) & (acc ^ result)) & 0x80) !== 0); // Overflow
  CPUregisters.P.C = +(result > 0xFF);                                 // Carry

  CPUregisters.A = result & 0xFF;
}

function RRA_ABSY() {
  const base = checkReadOffset(CPUregisters.PC + 1) | (checkReadOffset(CPUregisters.PC + 2) << 8);
  const addr = (base + CPUregisters.Y) & 0xFFFF;
  let val = checkReadOffset(addr);

  // --- ROR (rotate right through carry) ---
  const oldCarry = CPUregisters.P.C;
  CPUregisters.P.C = val & 0x01;                // new carry from bit 0
  val = (val >> 1) | (oldCarry << 7);
  checkWriteOffset(addr, val);

  // --- ADC (A + val + carry) ---
  let acc = CPUregisters.A;
  let carry = CPUregisters.P.C ? 1 : 0;
  let result = acc + val + carry;

  // Flags
  CPUregisters.P.N = (result >> 7) & 1;                                // Negative
  CPUregisters.P.Z = +((result & 0xFF) === 0);                         // Zero
  CPUregisters.P.V = +(((~(acc ^ val) & (acc ^ result)) & 0x80) !== 0); // Overflow
  CPUregisters.P.C = +(result > 0xFF);                                 // Carry

  CPUregisters.A = result & 0xFF;
}

  function LAX_ZP() {
  const address = checkReadOffset(CPUregisters.PC +1);// always zero page (no handler)
  const value = checkReadOffset(address);
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = (((value & 0x80) !== 0)) ? 1 : 0;
}

function LAX_ABS() {
  // Fetch operand (little endian) from instruction stream
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = (hi << 8) | lo;
  // Read effective address
  const value = checkReadOffset(address);
  // Load into both A and X
  CPUregisters.A = value;
  CPUregisters.X = value;
  // Update flags
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value & 0x80) ? 1 : 0;
}

function LAX_ZPY() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.Y) & 0xFF;
  const value = checkReadOffset(pointer);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function LAX_ABSY() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const base = (hi << 8) | lo;
  const address = (base + CPUregisters.Y) & 0xFFFF;
  const value = checkReadOffset(address);
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
  // Add extra cycle if page boundary is crossed, post data manipulation
  if ((base & 0xFF00) !== (address & 0xFF00)) addExtraCycles(1);//cpuCycles = (cpuCycles + 1) & 0xFFFF;
}

function LAX_INDX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  const value = checkReadOffset(addressess);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function LAX_INDY() {
  const zp = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const addr_lo = checkReadOffset(zp);
  const addr_hi = checkReadOffset((zp + 1) & 0xFF);
  const base = (addr_hi << 8) | addr_lo;
  const effective = (base + CPUregisters.Y) & 0xFFFF;
  const value = checkReadOffset(effective);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function SAX_ZP() {
  const address = checkReadOffset(CPUregisters.PC +1); // always zp (no handler)
  checkWriteOffset(address, CPUregisters.A & CPUregisters.X);
}

function SAX_ABS() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const address = (hi << 8) | lo;
  checkWriteOffset(address, CPUregisters.A & CPUregisters.X);
}

function SAX_INDX() {
  // Fetch the operand (zero-page base address)
  const zpBase = checkReadOffset(CPUregisters.PC + 1);

  // Add X, wrap to zero page
  const zpAddr = (zpBase + CPUregisters.X) & 0xFF;

  // Fetch the pointer (16-bit, zero-page wrap)
  const low = checkReadOffset(zpAddr);
  const high = checkReadOffset((zpAddr + 1) & 0xFF);
  const addr = (high << 8) | low;

  // Store (A & X)
  const value = CPUregisters.A & CPUregisters.X;
  checkWriteOffset(addr, value);
}

function SAX_ZPY() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.Y) & 0xFF;
  const value = CPUregisters.A & CPUregisters.X;
  checkWriteOffset(pointer, value);
}

function DCP_ZP() {
  const address = checkReadOffset(CPUregisters.PC +1);
  let value = (checkReadOffset(address) - 1) & 0xFF;
  checkWriteOffset(address, value);

  const result = CPUregisters.A - value;
  CPUregisters.P.C = ((CPUregisters.A >= value)) ? 1 : 0;
  CPUregisters.P.Z = (((result & 0xFF) === 0)) ? 1 : 0;
  CPUregisters.P.N = (((result & 0x80) !== 0)) ? 1 : 0;
}

function DCP_ABS() {
  const lo = checkReadOffset(CPUregisters.PC +1);
  const hi = checkReadOffset(CPUregisters.PC +2);
  const address = (hi << 8) | lo;

  let value = (checkReadOffset(address) - 1) & 0xFF;
  checkWriteOffset(address, value);

  const result = CPUregisters.A - value;
  CPUregisters.P.C = ((CPUregisters.A >= value)) ? 1 : 0;
  CPUregisters.P.Z = (((result & 0xFF) === 0)) ? 1 : 0;
  CPUregisters.P.N = (((result & 0x80) !== 0)) ? 1 : 0;
}

function DCP_ZPX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = pointer;
  let value = (checkReadOffset(addressess) - 1) & 0xFF;
  checkWriteOffset(addressess, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function DCP_ABSX() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = (checkReadOffset(addressess) - 1) & 0xFF;
  checkWriteOffset(addressess, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function DCP_ABSY() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = (checkReadOffset(addressess) - 1) & 0xFF;
  checkWriteOffset(addressess, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function DCP_INDX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  let value = (checkReadOffset(addressess) - 1) & 0xFF;
  checkWriteOffset(addressess, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function DCP_INDY() {
  const pointer = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  const addressess = base + CPUregisters.Y;
  let value = (checkReadOffset(addressess) - 1) & 0xFF;
  checkWriteOffset(addressess, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}


function ISC_ZPX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let value = (checkReadOffset(pointer) + 1) & 0xFF;
  checkWriteOffset(pointer, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = (CPUregisters.A < 0x100) ? 1 : 0;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ISC_ABSX() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = (checkReadOffset(addressess) + 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = (CPUregisters.A < 0x100) ? 1 : 0;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ISC_ABSY() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = (checkReadOffset(addressess) + 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = (CPUregisters.A < 0x100) ? 1 : 0;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ISC_INDX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  let value = (checkReadOffset(addressess) + 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = (CPUregisters.A < 0x100) ? 1 : 0;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ISC_INDY() {
  const pointer = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  const addressess = base + CPUregisters.Y;
  let value = (checkReadOffset(addressess) + 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = (CPUregisters.A < 0x100) ? 1 : 0;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SLO_ZP() {
  const address = checkReadOffset(CPUregisters.PC +1);
  let value = checkReadOffset(address);
  CPUregisters.P.C = (((value & 0x80) !== 0)) ? 1 : 0;
  value = (value << 1) & 0xFF;
  checkWriteOffset(address, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
}

function SLO_ABS() {
  const lo = checkReadOffset(CPUregisters.PC +1);
  const hi = checkReadOffset(CPUregisters.PC +2);
  const address = (hi << 8) | lo;
  let value = checkReadOffset(address);
  CPUregisters.P.C = (((value & 0x80) !== 0)) ? 1 : 0;
  value = (value << 1) & 0xFF;
  checkWriteOffset(address, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;

}

function SLO_ABSX() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = checkReadOffset(addressess);
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = (value << 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
  //cpuCycles = (cpuCycles + 3) & 0xFFFF; // add 3 to the base, this opcode always chews 7 cycles
  addExtraCycles(3);
}

function SLO_ABSY() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = checkReadOffset(addressess);
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = (value << 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SLO_INDX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  let value = checkReadOffset(addressess);
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = (value << 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SLO_INDY() {
  const pointer = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  const addressess = base + CPUregisters.Y;
  let value = checkReadOffset(addressess);
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = (value << 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SLO_ZPX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let value = checkReadOffset(pointer);
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = (value << 1) & 0xFF;
  checkWriteOffset(pointer, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ISC_ZP() {
  const address = checkReadOffset(CPUregisters.PC +1);
  // increment memory at ZP address
  const newVal = (checkReadOffset(address) + 1) & 0xFF;
  checkWriteOffset(address, newVal);

  // subtract with borrow = 1 – C
  const borrow = 1 - CPUregisters.P.C;
  const result = CPUregisters.A - newVal - borrow;
  CPUregisters.P.C = result >= 0 ? 1 : 0;
  CPUregisters.A   = result & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;
}

function ISC_ABS() {
  const lo = checkReadOffset(CPUregisters.PC +1);
  const hi = checkReadOffset(CPUregisters.PC +2);
  const address = (hi << 8) | lo;
  // increment memory at ABS address
  const newVal = (checkReadOffset(address) + 1) & 0xFF;
  checkWriteOffset(address, newVal);

  // subtract with borrow = 1 – C
  const borrow = 1 - CPUregisters.P.C;
  const result = CPUregisters.A - newVal - borrow;
  CPUregisters.P.C = result >= 0 ? 1 : 0;
  CPUregisters.A   = result & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;
}

function RLA_ZP() {
  const address = checkReadOffset(CPUregisters.PC +1);
  let value = checkReadOffset(address);
  // rotate left through C
  const carryIn = CPUregisters.P.C;
  CPUregisters.P.C = (value & 0x80) !== 0 ? 1 : 0;
  value = ((value << 1) | carryIn) & 0xFF;
  checkWriteOffset(address, value);

  // then AND with A
  CPUregisters.A &= value;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;
}

function RLA_ABS() {
  const lo = checkReadOffset(CPUregisters.PC +1);
  const hi = checkReadOffset(CPUregisters.PC +2);
  const address = (hi << 8) | lo;
  let value = checkReadOffset(address);
  // rotate left through C
  const carryIn = CPUregisters.P.C;
  CPUregisters.P.C = (value & 0x80) !== 0 ? 1 : 0;
  value = ((value << 1) | carryIn) & 0xFF;
  checkWriteOffset(address, value);

  // then AND with A
  CPUregisters.A &= value;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;
}

function RLA_ABSX() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = checkReadOffset(addressess);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  checkWriteOffset(addressess, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function RLA_ABSY() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = checkReadOffset(addressess);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  checkWriteOffset(addressess, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function RLA_INDX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  let value = checkReadOffset(addressess);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  checkWriteOffset(addressess, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function RLA_INDY() {
  const pointer = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  const addressess = base + CPUregisters.Y;
  let value = checkReadOffset(addressess);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  checkWriteOffset(addressess, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function RLA_ZPX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let value = checkReadOffset(pointer);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = ((value & 0x80) !== 0) ? 1 : 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  checkWriteOffset(pointer, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SRE_ZP() {
  const address = checkReadOffset(CPUregisters.PC +1);
  let value = checkReadOffset(address);
  CPUregisters.P.C = (((value & 0x01) !== 0)) ? 1 : 0;
  value = (value >> 1) & 0xFF;
  checkWriteOffset(address, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
}

function SRE_ABS() {
  const lo = checkReadOffset(CPUregisters.PC +1);;
  const hi = checkReadOffset(CPUregisters.PC +2);
  const address = (hi << 8) | lo;
  let value = checkReadOffset(address);
  CPUregisters.P.C = (((value & 0x01) !== 0)) ? 1 : 0;
  value = (value >> 1) & 0xFF;
  checkWriteOffset(address, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
}

function SRE_ABSX() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = checkReadOffset(addressess);
  CPUregisters.P.C = (value & 0x01) ? 1 : 0;
  value >>= 1;
  checkWriteOffset(addressess, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SRE_ABSY() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = checkReadOffset(addressess);
  CPUregisters.P.C = (value & 0x01) ? 1 : 0;
  value >>= 1;
  checkWriteOffset(addressess, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SRE_INDX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  let value = checkReadOffset(addressess);
  CPUregisters.P.C = (value & 0x01) ? 1 : 0;
  value >>= 1;
  checkWriteOffset(addressess, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SRE_INDY() {
  const pointer = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  const addressess = base + CPUregisters.Y;
  let value = checkReadOffset(addressess);
  CPUregisters.P.C = (value & 0x01) ? 1 : 0;
  value >>= 1;
  checkWriteOffset(addressess, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function SRE_ZPX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let value = checkReadOffset(pointer);
  CPUregisters.P.C = (value & 0x01) ? 1 : 0;
  value >>= 1;
  checkWriteOffset(pointer, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ANC_IMM() {
  const value = checkReadOffset(CPUregisters.PC +1);
  CPUregisters.A &= value;
  CPUregisters.P.C = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
  CPUregisters.PC += 2;
}

function ALR_IMM() {
  const val = checkReadOffset(CPUregisters.PC + 1);
  const tmp = CPUregisters.A & val;
  CPUregisters.P.C = tmp & 0x01;
  CPUregisters.A = tmp >> 1;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC += 2;
}

function ARR_IMM() {
  const val = checkReadOffset(CPUregisters.PC + 1);
  let tmp = CPUregisters.A & val;
  const oldCarry = CPUregisters.P.C;
  // Perform ROR
  const newA = (tmp >> 1) | (oldCarry ? 0x80 : 0x00);
  // C is set to bit 0 of tmp
  CPUregisters.P.C = (tmp & 0x01) ? 1 : 0;
  CPUregisters.A = newA & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
}

function XAA_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.A = CPUregisters.X & value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;

  CPUregisters.PC += 2;
}

function AXA_ABSY() {
  const base = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  const addressess = (base + CPUregisters.Y) & 0xFFFF;
  const value = CPUregisters.A & CPUregisters.X & (((addressess >> 8) + 1) & 0xFF);
  checkWriteOffset(addressess, value);
}

function AXA_INDY() {
  const pointer = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset(pointer + 1) << 8) | checkReadOffset(pointer);
  const addressess = base + CPUregisters.Y;
  const value = CPUregisters.A & CPUregisters.X;
  checkWriteOffset(addressess, value & (addressess >> 8) + 1);
}

function LAS_ABSY() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const base = (hi << 8) | lo;
  const address = (base + CPUregisters.Y) & 0xFFFF;

  // DO NOT add extra cycle on page cross (quirk: always 4 cycles)
  const value = checkReadOffset(address) & CPUregisters.S;
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.S = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

// --- BRA (0x80): Unofficial "Branch Always" ---
function BRA_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  const oldPC = CPUregisters.PC;
  const newPC = (CPUregisters.PC + 2 + signed) & 0xFFFF;
  // Page boundary cross penalty (+1 cycle)
  if (((oldPC + 2) & 0xFF00) !== (newPC & 0xFF00)) addExtraCycles(1);//cpuCycles = (cpuCycles + 1) & 0xFFFF;
  CPUregisters.PC = newPC;
}


// 0x9C — SHY (SAY) — Store (Y & (high byte of addr + 1)) to (abs + X)
function SHY_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const baseAddr = (hi << 8) | lo;
  const addr = (baseAddr + CPUregisters.X) & 0xFFFF;
  const value = CPUregisters.Y & (((addr >> 8) + 1) & 0xFF);
  checkWriteOffset(addr, value);
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
  // No extra cycles (base is 5)
}

// 0x9E — SHX (SXA) — Store (X & (high byte of addr + 1)) to (abs + Y)
function SHX_ABSY() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const baseAddr = (hi << 8) | lo;
  const addr = (baseAddr + CPUregisters.Y) & 0xFFFF;
  const value = CPUregisters.X & (((addr >> 8) + 1) & 0xFF);
  checkWriteOffset(addr, value);
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
  // No extra cycles (base is 5)
}

// 0x9B — TAS (SHS) — (A & X) to SP, also store (A & X & (high byte of addr + 1)) to (abs + Y)
function TAS_ABSY() {
  const lo = checkReadOffset(CPUregisters.PC + 1);
  const hi = checkReadOffset(CPUregisters.PC + 2);
  const baseAddr = (hi << 8) | lo;
  const addr = (baseAddr + CPUregisters.Y) & 0xFFFF;
  const tmp = CPUregisters.A & CPUregisters.X;
  CPUregisters.S = tmp & 0xFF;
  const value = tmp & (((addr >> 8) + 1) & 0xFF);
  checkWriteOffset(addr, value);
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
  // No extra cycles (base is 5)
}

function SBX_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1);
  let result = (CPUregisters.A & CPUregisters.X) - value;
  if (result < 0) result += 0x100; // wrap like 8-bit
  CPUregisters.X = result & 0xFF;
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) ? 1 : 0;
}

// --------- Branches (REL) with PC increment inside handler ---------
// NOTE: Dispatcher must NOT auto-advance PC for these opcodes.

// BCC — Branch if Carry Clear (0x90)
function BCC_REL() {
  // fetch relative offset
  const off = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const rel = (off < 0x80) ? off : off - 0x100;  // sign-extend
  const nextPC = (CPUregisters.PC + 2) & 0xFFFF;

  if (!CPUregisters.P.C) {
    const dest = (nextPC + rel) & 0xFFFF;
    addExtraCycles(1); // branch taken
    if ((nextPC & 0xFF00) !== (dest & 0xFF00)) {
      addExtraCycles(1); // add only if page crossed
    }
    CPUregisters.PC = dest;
  } else {
    CPUregisters.PC = nextPC;
  }
}

// BCS — Branch if Carry Set (0xB0)
function BCS_REL() {
  const pc = CPUregisters.PC & 0xFFFF;

  const off = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;

  const rel = (off ^ 0x80) - 0x80;
  const nextPC = (pc + 2) & 0xFFFF;

  if (CPUregisters.P.C) {
    const dest = (nextPC + rel) & 0xFFFF;
     addExtraCycles(1); // branch taken  //cpuCycles = (cpuCycles + 1) & 0xFFFF; // +1 if branch taken
    if ((nextPC & 0xFF00) !== (dest & 0xFF00)) addExtraCycles(1); // branch taken //cpuCycles = (cpuCycles + 1) & 0xFFFF; // +1 if page cross
    CPUregisters.PC = dest;
  } else {
    CPUregisters.PC = nextPC;
   }
}

// BEQ — Branch if Zero Set (0xF0)
function BEQ_REL() {
  const off    = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const rel    = (off < 0x80) ? off : off - 0x100;
  const nextPC = (CPUregisters.PC + 2) & 0xFFFF;

  if (CPUregisters.P.Z) {
    const dest = (nextPC + rel) & 0xFFFF;
    //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    addExtraCycles(1);
    if ((nextPC & 0xFF00) !== (dest & 0xFF00)) cpuCycles = (cpuCycles + 1) & 0xFFFF;
    CPUregisters.PC = dest;
  } else {
    CPUregisters.PC = nextPC;
  }
}

// BNE — Branch if Zero Clear (0xD0)
function BNE_REL() {
  const off    = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const rel    = (off < 0x80) ? off : off - 0x100;
  const nextPC = (CPUregisters.PC + 2) & 0xFFFF;

  if (!CPUregisters.P.Z) {
    const dest = (nextPC + rel) & 0xFFFF;
    //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    addExtraCycles(1);
    if ((nextPC & 0xFF00) !== (dest & 0xFF00)) addExtraCycles(1); //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    CPUregisters.PC = dest;
  } else {
    CPUregisters.PC = nextPC;
  }
}

// BMI — Branch if Negative Set (0x30)
function BMI_REL() {
  const off    = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const rel    = (off < 0x80) ? off : off - 0x100;
  const nextPC = (CPUregisters.PC + 2) & 0xFFFF;

  if (CPUregisters.P.N) {
    const dest = (nextPC + rel) & 0xFFFF;
    //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    addExtraCycles(1);
    if ((nextPC & 0xFF00) !== (dest & 0xFF00)) addExtraCycles(1); //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    CPUregisters.PC = dest;
  } else {
    CPUregisters.PC = nextPC;
  }
}

// BPL — Branch if Negative Clear (0x10)
function BPL_REL() {
  const off    = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const rel    = (off < 0x80) ? off : off - 0x100;
  const nextPC = (CPUregisters.PC + 2) & 0xFFFF;

  if (!CPUregisters.P.N) {
    const dest = (nextPC + rel) & 0xFFFF;
    //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    addExtraCycles(1);
    if ((nextPC & 0xFF00) !== (dest & 0xFF00)) addExtraCycles(1);//cpuCycles = (cpuCycles + 1) & 0xFFFF;
    CPUregisters.PC = dest;
  } else {
    CPUregisters.PC = nextPC;
  }
}

// BVC — Branch if Overflow Clear (0x50)
function BVC_REL() {
  const off    = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const rel    = (off < 0x80) ? off : off - 0x100;
  const nextPC = (CPUregisters.PC + 2) & 0xFFFF;

  if (!CPUregisters.P.V) {
    const dest = (nextPC + rel) & 0xFFFF;
    //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    addExtraCycles(1);
    if ((nextPC & 0xFF00) !== (dest & 0xFF00)) addExtraCycles(1);//cpuCycles = (cpuCycles + 1) & 0xFFFF;
    CPUregisters.PC = dest;
  } else {
    CPUregisters.PC = nextPC;
  }
}

// BVS — Branch if Overflow Set (0x70)
function BVS_REL() {
  const off    = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const rel    = (off < 0x80) ? off : off - 0x100;
  const nextPC = (CPUregisters.PC + 2) & 0xFFFF;

  if (CPUregisters.P.V) {
    const dest = (nextPC + rel) & 0xFFFF;
    //cpuCycles = (cpuCycles + 1) & 0xFFFF;
    addExtraCycles(1);
    if ((nextPC & 0xFF00) !== (dest & 0xFF00)) addExtraCycles(1);//cpuCycles = (cpuCycles + 1) & 0xFFFF;
    CPUregisters.PC = dest;
  } else {
    CPUregisters.PC = nextPC;
  }
}


/*
//////////////////////// 6502 CPU opcode object ////////////////////////
// legacy, handy for opcode hex reference
const opcodes = {

  // ==================== BRANCH/CONTROL FLOW (pcIncrement: 0) ==================== //
  BCC: { relative: { code: 0x90, length: 2, pcIncrement: 0, func: BCC_REL } },
  BCS: { relative: { code: 0xB0, length: 2, pcIncrement: 0, func: BCS_REL } },
  BEQ: { relative: { code: 0xF0, length: 2, pcIncrement: 0, func: BEQ_REL } },
  BMI: { relative: { code: 0x30, length: 2, pcIncrement: 0, func: BMI_REL } },
  BNE: { relative: { code: 0xD0, length: 2, pcIncrement: 0, func: BNE_REL } },
  BPL: { relative: { code: 0x10, length: 2, pcIncrement: 0, func: BPL_REL } },
  BVC: { relative: { code: 0x50, length: 2, pcIncrement: 0, func: BVC_REL } },
  BVS: { relative: { code: 0x70, length: 2, pcIncrement: 0, func: BVS_REL } },
  // Unofficial: BRA - Branch Always (0x80)
  BRA: { relative: { code: 0x80, length: 2, pcIncrement: 0, func: BRA_REL } },

  JMP: {
    absolute:   { code: 0x4C, length: 0, pcIncrement: 0, func: JMP_ABS }, // 3 or set directly
    indirect:   { code: 0x6C, length: 0, pcIncrement: 0, func: JMP_IND }  // 3 or set directly
  },
  JSR: { absolute: { code: 0x20, length: 3, pcIncrement: 0, func: JSR_ABS } }, // PC handled by opc. handler
  RTS: { implied: { code: 0x60, length: 1, pcIncrement: 0, func: RTS_IMP } }, // PC from stack
  RTI: { implied: { code: 0x40, length: 1, pcIncrement: 0, func: RTI_IMP } }, // PC from stack
  BRK: { implied: { code: 0x00, length: 1, pcIncrement: 2, func: BRK_IMP } }, // quirk, single byte opcode / increment PC +2

  // ======================= LOAD/STORE ======================= //
  LDA: {
    immediate:  { code: 0xA9, length: 2, pcIncrement: 2, func: LDA_IMM },
    zeroPage:   { code: 0xA5, length: 2, pcIncrement: 2, func: LDA_ZP },
    zeroPageX:  { code: 0xB5, length: 2, pcIncrement: 2, func: LDA_ZPX },
    absolute:   { code: 0xAD, length: 3, pcIncrement: 3, func: LDA_ABS },
    absoluteX:  { code: 0xBD, length: 3, pcIncrement: 3, func: LDA_ABSX },
    absoluteY:  { code: 0xB9, length: 3, pcIncrement: 3, func: LDA_ABSY },
    indirectX:  { code: 0xA1, length: 2, pcIncrement: 2, func: LDA_INDX },
    indirectY:  { code: 0xB1, length: 2, pcIncrement: 2, func: LDA_INDY }
  },
  LDX: {
    immediate:  { code: 0xA2, length: 2, pcIncrement: 2, func: LDX_IMM },
    zeroPage:   { code: 0xA6, length: 2, pcIncrement: 2, func: LDX_ZP },
    zeroPageY:  { code: 0xB6, length: 2, pcIncrement: 2, func: LDX_ZPY },
    absolute:   { code: 0xAE, length: 3, pcIncrement: 3, func: LDX_ABS },
    absoluteY:  { code: 0xBE, length: 3, pcIncrement: 3, func: LDX_ABSY }
  },
  LDY: {
    immediate:  { code: 0xA0, length: 2, pcIncrement: 2, func: LDY_IMM },
    zeroPage:   { code: 0xA4, length: 2, pcIncrement: 2, func: LDY_ZP },
    zeroPageX:  { code: 0xB4, length: 2, pcIncrement: 2, func: LDY_ZPX },
    absolute:   { code: 0xAC, length: 3, pcIncrement: 3, func: LDY_ABS },
    absoluteX:  { code: 0xBC, length: 3, pcIncrement: 3, func: LDY_ABSX }
  },
  STA: {
    zeroPage:   { code: 0x85, length: 2, pcIncrement: 2, func: STA_ZP },
    zeroPageX:  { code: 0x95, length: 2, pcIncrement: 2, func: STA_ZPX },
    absolute:   { code: 0x8D, length: 3, pcIncrement: 3, func: STA_ABS },
    absoluteX:  { code: 0x9D, length: 3, pcIncrement: 3, func: STA_ABSX },
    absoluteY:  { code: 0x99, length: 3, pcIncrement: 3, func: STA_ABSY },
    indirectX:  { code: 0x81, length: 2, pcIncrement: 2, func: STA_INDX },
    indirectY:  { code: 0x91, length: 2, pcIncrement: 2, func: STA_INDY }
  },
  STX: {
    zeroPage:   { code: 0x86, length: 2, pcIncrement: 2, func: STX_ZP },
    zeroPageY:  { code: 0x96, length: 2, pcIncrement: 2, func: STX_ZPY },
    absolute:   { code: 0x8E, length: 3, pcIncrement: 3, func: STX_ABS }
  },
  STY: {
    zeroPage:   { code: 0x84, length: 2, pcIncrement: 2, func: STY_ZP },
    zeroPageX:  { code: 0x94, length: 2, pcIncrement: 2, func: STY_ZPX },
    absolute:   { code: 0x8C, length: 3, pcIncrement: 3, func: STY_ABS }
  },

  // ======================= ALU / LOGIC ======================= //
  ADC: {
    immediate:  { code: 0x69, length: 2, pcIncrement: 2, func: ADC_IMM },
    zeroPage:   { code: 0x65, length: 2, pcIncrement: 2, func: ADC_ZP },
    zeroPageX:  { code: 0x75, length: 2, pcIncrement: 2, func: ADC_ZPX },
    absolute:   { code: 0x6D, length: 3, pcIncrement: 3, func: ADC_ABS },
    absoluteX:  { code: 0x7D, length: 3, pcIncrement: 3, func: ADC_ABSX },
    absoluteY:  { code: 0x79, length: 3, pcIncrement: 3, func: ADC_ABSY },
    indirectX:  { code: 0x61, length: 2, pcIncrement: 2, func: ADC_INDX },
    indirectY:  { code: 0x71, length: 2, pcIncrement: 2, func: ADC_INDY }
  },
  SBC: {
    immediate:  { code: 0xE9, length: 2, pcIncrement: 2, func: SBC_IMM },
    zeroPage:   { code: 0xE5, length: 2, pcIncrement: 2, func: SBC_ZP },
    zeroPageX:  { code: 0xF5, length: 2, pcIncrement: 2, func: SBC_ZPX },
    absolute:   { code: 0xED, length: 3, pcIncrement: 3, func: SBC_ABS },
    absoluteX:  { code: 0xFD, length: 3, pcIncrement: 3, func: SBC_ABSX },
    absoluteY:  { code: 0xF9, length: 3, pcIncrement: 3, func: SBC_ABSY },
    indirectX:  { code: 0xE1, length: 2, pcIncrement: 2, func: SBC_INDX },
    indirectY:  { code: 0xF1, length: 2, pcIncrement: 2, func: SBC_INDY }
  },
  AND: {
    immediate:  { code: 0x29, length: 2, pcIncrement: 2, func: AND_IMM },
    zeroPage:   { code: 0x25, length: 2, pcIncrement: 2, func: AND_ZP },
    zeroPageX:  { code: 0x35, length: 2, pcIncrement: 2, func: AND_ZPX },
    absolute:   { code: 0x2D, length: 3, pcIncrement: 3, func: AND_ABS },
    absoluteX:  { code: 0x3D, length: 3, pcIncrement: 3, func: AND_ABSX },
    absoluteY:  { code: 0x39, length: 3, pcIncrement: 3, func: AND_ABSY },
    indirectX:  { code: 0x21, length: 2, pcIncrement: 2, func: AND_INDX },
    indirectY:  { code: 0x31, length: 2, pcIncrement: 2, func: AND_INDY }
  },
  ORA: {
    immediate:  { code: 0x09, length: 2, pcIncrement: 2, func: ORA_IMM },
    zeroPage:   { code: 0x05, length: 2, pcIncrement: 2, func: ORA_ZP },
    zeroPageX:  { code: 0x15, length: 2, pcIncrement: 2, func: ORA_ZPX },
    absolute:   { code: 0x0D, length: 3, pcIncrement: 3, func: ORA_ABS },
    absoluteX:  { code: 0x1D, length: 3, pcIncrement: 3, func: ORA_ABSX },
    absoluteY:  { code: 0x19, length: 3, pcIncrement: 3, func: ORA_ABSY },
    indirectX:  { code: 0x01, length: 2, pcIncrement: 2, func: ORA_INDX },
    indirectY:  { code: 0x11, length: 2, pcIncrement: 2, func: ORA_INDY }
  },
  EOR: {
    immediate:  { code: 0x49, length: 2, pcIncrement: 2, func: EOR_IMM },
    zeroPage:   { code: 0x45, length: 2, pcIncrement: 2, func: EOR_ZP },
    zeroPageX:  { code: 0x55, length: 2, pcIncrement: 2, func: EOR_ZPX },
    absolute:   { code: 0x4D, length: 3, pcIncrement: 3, func: EOR_ABS },
    absoluteX:  { code: 0x5D, length: 3, pcIncrement: 3, func: EOR_ABX },
    absoluteY:  { code: 0x59, length: 3, pcIncrement: 3, func: EOR_ABY },
    indirectX:  { code: 0x41, length: 2, pcIncrement: 2, func: EOR_INDX },
    indirectY:  { code: 0x51, length: 2, pcIncrement: 2, func: EOR_INDY }
  },

  // ======================= SHIFT/ROTATE ======================= //
  ASL: {
    accumulator: { code: 0x0A, length: 1, pcIncrement: 1, func: ASL_ACC },
    zeroPage:    { code: 0x06, length: 2, pcIncrement: 2, func: ASL_ZP },
    zeroPageX:   { code: 0x16, length: 2, pcIncrement: 2, func: ASL_ZPX },
    absolute:    { code: 0x0E, length: 3, pcIncrement: 3, func: ASL_ABS },
    absoluteX:   { code: 0x1E, length: 3, pcIncrement: 3, func: ASL_ABSX }
  },
  LSR: {
    accumulator: { code: 0x4A, length: 1, pcIncrement: 1, func: LSR_ACC },
    zeroPage:    { code: 0x46, length: 2, pcIncrement: 2, func: LSR_ZP },
    zeroPageX:   { code: 0x56, length: 2, pcIncrement: 2, func: LSR_ZPX },
    absolute:    { code: 0x4E, length: 3, pcIncrement: 3, func: LSR_ABS },
    absoluteX:   { code: 0x5E, length: 3, pcIncrement: 3, func: LSR_ABSX }
  },
  ROL: {
    accumulator: { code: 0x2A, length: 1, pcIncrement: 1, func: ROL_ACC },
    zeroPage:    { code: 0x26, length: 2, pcIncrement: 2, func: ROL_ZP },
    zeroPageX:   { code: 0x36, length: 2, pcIncrement: 2, func: ROL_ZPX },
    absolute:    { code: 0x2E, length: 3, pcIncrement: 3, func: ROL_ABS },
    absoluteX:   { code: 0x3E, length: 3, pcIncrement: 3, func: ROL_ABSX }
  },
  ROR: {
    accumulator: { code: 0x6A, length: 1, pcIncrement: 1, func: ROR_ACC },
    zeroPage:    { code: 0x66, length: 2, pcIncrement: 2, func: ROR_ZP },
    zeroPageX:   { code: 0x76, length: 2, pcIncrement: 2, func: ROR_ZPX },
    absolute:    { code: 0x6E, length: 3, pcIncrement: 3, func: ROR_ABS },
    absoluteX:   { code: 0x7E, length: 3, pcIncrement: 3, func: ROR_ABSX }
  },

  // ======================= REGISTER TRANSFERS ======================= //
  TAX: { implied: { code: 0xAA, length: 1, pcIncrement: 1, func: TAX_IMP } },
  TXA: { implied: { code: 0x8A, length: 1, pcIncrement: 1, func: TXA_IMP } },
  DEX: { implied: { code: 0xCA, length: 1, pcIncrement: 1, func: DEX_IMP } },
  INX: { implied: { code: 0xE8, length: 1, pcIncrement: 1, func: INX_IMP } },
  TAY: { implied: { code: 0xA8, length: 1, pcIncrement: 1, func: TAY_IMP } },
  TYA: { implied: { code: 0x98, length: 1, pcIncrement: 1, func: TYA_IMP } },
  DEY: { implied: { code: 0x88, length: 1, pcIncrement: 1, func: DEY_IMP } },
  INY: { implied: { code: 0xC8, length: 1, pcIncrement: 1, func: INY_IMP } },
  TSX: { implied: { code: 0xBA, length: 1, pcIncrement: 1, func: TSX_IMP } },
  TXS: { implied: { code: 0x9A, length: 1, pcIncrement: 1, func: TXS_IMP } },

  // ======================= STACK OPS ======================= //
  PHA: { implied: { code: 0x48, length: 1, pcIncrement: 1, func: PHA_IMP } },
  PLA: { implied: { code: 0x68, length: 1, pcIncrement: 1, func: PLA_IMP } },
  PHP: { implied: { code: 0x08, length: 1, pcIncrement: 1, func: PHP_IMP } },
  PLP: { implied: { code: 0x28, length: 1, pcIncrement: 1, func: PLP_IMP } },

    // ======================= FLAG OPS ======================= //
  CLC: { implied: { code: 0x18, length: 1, pcIncrement: 1, func: CLC_IMP } },
  CLD: { implied: { code: 0xD8, length: 1, pcIncrement: 1, func: CLD_IMP } },
  CLI: { implied: { code: 0x58, length: 1, pcIncrement: 1, func: CLI_IMP } },
  CLV: { implied: { code: 0xB8, length: 1, pcIncrement: 1, func: CLV_IMP } },
  SEC: { implied: { code: 0x38, length: 1, pcIncrement: 1, func: SEC_IMP } },
  SED: { implied: { code: 0xF8, length: 1, pcIncrement: 1, func: SED_IMP } },
  SEI: { implied: { code: 0x78, length: 1, pcIncrement: 1, func: SEI_IMP } },

  // ======================= COMPARE ======================= //
  CMP: {
    immediate:  { code: 0xC9, length: 2, pcIncrement: 2, func: CMP_IMM },
    zeroPage:   { code: 0xC5, length: 2, pcIncrement: 2, func: CMP_ZP },
    zeroPageX:  { code: 0xD5, length: 2, pcIncrement: 2, func: CMP_ZPX },
    absolute:   { code: 0xCD, length: 3, pcIncrement: 3, func: CMP_ABS },
    absoluteX:  { code: 0xDD, length: 3, pcIncrement: 3, func: CMP_ABSX },
    absoluteY:  { code: 0xD9, length: 3, pcIncrement: 3, func: CMP_ABSY },
    indirectX:  { code: 0xC1, length: 2, pcIncrement: 2, func: CMP_INDX },
    indirectY:  { code: 0xD1, length: 2, pcIncrement: 2, func: CMP_INDY }
  },
  CPX: {
    immediate:  { code: 0xE0, length: 2, pcIncrement: 2, func: CPX_IMM },
    zeroPage:   { code: 0xE4, length: 2, pcIncrement: 2, func: CPX_ZP },
    absolute:   { code: 0xEC, length: 3, pcIncrement: 3, func: CPX_ABS }
  },
  CPY: {
    immediate:  { code: 0xC0, length: 2, pcIncrement: 2, func: CPY_IMM },
    zeroPage:   { code: 0xC4, length: 2, pcIncrement: 2, func: CPY_ZP },
    absolute:   { code: 0xCC, length: 3, pcIncrement: 3, func: CPY_ABS }
  },

  // ======================= INCREMENT / DECREMENT ======================= //
  INC: {
    zeroPage:   { code: 0xE6, length: 2, pcIncrement: 2, func: INC_ZP },
    zeroPageX:  { code: 0xF6, length: 2, pcIncrement: 2, func: INC_ZPX },
    absolute:   { code: 0xEE, length: 3, pcIncrement: 3, func: INC_ABS },
    absoluteX:  { code: 0xFE, length: 3, pcIncrement: 3, func: INC_ABSX }
  },
  DEC: {
    zeroPage:   { code: 0xC6, length: 2, pcIncrement: 2, func: DEC_ZP },
    zeroPageX:  { code: 0xD6, length: 2, pcIncrement: 2, func: DEC_ZPX },
    absolute:   { code: 0xCE, length: 3, pcIncrement: 3, func: DEC_ABS },
    absoluteX:  { code: 0xDE, length: 3, pcIncrement: 3, func: DEC_ABSX }
  },

  // ======================= BIT TEST ======================= //
  BIT: {
    zeroPage:  { code: 0x24, length: 2, pcIncrement: 2, func: BIT_ZP },
    absolute:  { code: 0x2C, length: 3, pcIncrement: 3, func: BIT_ABS }
  },

  // ======================= NOPs (OFFICIAL AND UNOFFICIAL) ======================= //
  NOP: {
    // Official and implied (1-byte, just do nothing, let pcIncrement advance)
    implied:   { code: 0xEA, length: 1, pcIncrement: 1, func: NOP },
    implied1:  { code: 0x1A, length: 1, pcIncrement: 1, func: NOP },
    implied2:  { code: 0x3A, length: 1, pcIncrement: 1, func: NOP },
    implied3:  { code: 0x5A, length: 1, pcIncrement: 1, func: NOP },
    implied4:  { code: 0x7A, length: 1, pcIncrement: 1, func: NOP },
    implied5:  { code: 0xDA, length: 1, pcIncrement: 1, func: NOP },
    implied6:  { code: 0xFA, length: 1, pcIncrement: 1, func: NOP },

    // "SKB"/"DOP" NOPs - 2-byte, just skip operand (NO memory access), so plain NOP and pcIncrement=2 is fine
    // imm1:      { code: 0x80, length: 2, pcIncrement: 0, func: BRA_REL }, // (alias for BRA, quirk, in branches group)
    immediate:      { code: 0x82, length: 2, pcIncrement: 2, func: NOP },    // plain NOP
    immediate1:      { code: 0x89, length: 2, pcIncrement: 2, func: NOP },    // plain NOP
    immmediate2:      { code: 0xC2, length: 2, pcIncrement: 2, func: NOP },    // plain NOP
    immediate3:      { code: 0xE2, length: 2, pcIncrement: 2, func: NOP },    // plain NOP

    // Zero page NOPs: read from ZP (quirk!)
    zeroPage:       { code: 0x04, length: 2, pcIncrement: 2, func: NOP_ZP },    // quirk: does memory read
    zeroPage1:       { code: 0x44, length: 2, pcIncrement: 2, func: NOP_ZP },    // "
    zeroPage2:       { code: 0x64, length: 2, pcIncrement: 2, func: NOP_ZP },    // "

    // Zero page,X NOPs: read from ZP+X (quirk!)
    zeroPageX:      { code: 0x14, length: 2, pcIncrement: 2, func: NOP_ZPX },   // quirk: does memory read
    zeroPageX1:      { code: 0x34, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "
    zeroPageX2:      { code: 0x54, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "
    zeroPageX3:      { code: 0x74, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "
    zeroPageX4:      { code: 0xD4, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "
    zeroPageX5:      { code: 0xF4, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "

    // Absolute NOP: read from $nnnn (quirk!)
    absolute:      { code: 0x0C, length: 3, pcIncrement: 3, func: NOP_ABS },   // quirk: does memory read

    // Absolute,X NOPs: read from $nnnn+X
    absoluteX:     { code: 0x1C, length: 3, pcIncrement: 3, func: NOP_ABSX }, // quirk: memory read + possible extra cycle
    absoluteX1:     { code: 0x3C, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "
    absoluteX2:     { code: 0x5C, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "
    absoluteX3:     { code: 0x7C, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "
    absoluteX4:     { code: 0xDC, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "
    absoluteX5:     { code: 0xFC, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "

    // Zero page,Y NOP: rare (quirk)
    zeroPageY:       { code: 0x92, length: 2, pcIncrement: 2, func: NOP_ZPY },  // quirk: does memory read
  },

  // ======================== UNOFFICIAL/ILLEGAL OPCODES ======================== //
  LAX: {
    immediate:  { code: 0xAB, length: 2, pcIncrement: 2, func: LAX_IMM },
    zeroPage:   { code: 0xA7, length: 2, pcIncrement: 2, func: LAX_ZP },
    zeroPageY:  { code: 0xB7, length: 2, pcIncrement: 2, func: LAX_ZPY },
    absolute:   { code: 0xAF, length: 3, pcIncrement: 3, func: LAX_ABS },
    absoluteY:  { code: 0xBF, length: 3, pcIncrement: 3, func: LAX_ABSY },
    indirectX:  { code: 0xA3, length: 2, pcIncrement: 2, func: LAX_INDX },
    indirectY:  { code: 0xB3, length: 2, pcIncrement: 2, func: LAX_INDY }
  },
  SAX: {
    zeroPage:   { code: 0x87, length: 2, pcIncrement: 2, func: SAX_ZP },
    zeroPageY:  { code: 0x97, length: 2, pcIncrement: 2, func: SAX_ZPY },
    absolute:   { code: 0x8F, length: 3, pcIncrement: 3, func: SAX_ABS },
    indirectX:  { code: 0x83, length: 2, pcIncrement: 2, func: SAX_INDX }
  },
  DCP: {
    zeroPage:   { code: 0xC7, length: 2, pcIncrement: 2, func: DCP_ZP },
    zeroPageX:  { code: 0xD7, length: 2, pcIncrement: 2, func: DCP_ZPX },
    absolute:   { code: 0xCF, length: 3, pcIncrement: 3, func: DCP_ABS },
    absoluteX:  { code: 0xDF, length: 3, pcIncrement: 3, func: DCP_ABSX },
    absoluteY:  { code: 0xDB, length: 3, pcIncrement: 3, func: DCP_ABSY },
    indirectX:  { code: 0xC3, length: 2, pcIncrement: 2, func: DCP_INDX },
    indirectY:  { code: 0xD3, length: 2, pcIncrement: 2, func: DCP_INDY }
  },
  ISC: {
    zeroPage:   { code: 0xE7, length: 2, pcIncrement: 2, func: ISC_ZP },
    zeroPageX:  { code: 0xF7, length: 2, pcIncrement: 2, func: ISC_ZPX },
    absolute:   { code: 0xEF, length: 3, pcIncrement: 3, func: ISC_ABS },
    absoluteX:  { code: 0xFF, length: 3, pcIncrement: 3, func: ISC_ABSX },
    absoluteY:  { code: 0xFB, length: 3, pcIncrement: 3, func: ISC_ABSY },
    indirectX:  { code: 0xE3, length: 2, pcIncrement: 2, func: ISC_INDX },
    indirectY:  { code: 0xF3, length: 2, pcIncrement: 2, func: ISC_INDY }
  },
  SLO: {
    zeroPage:   { code: 0x07, length: 2, pcIncrement: 2, func: SLO_ZP },
    zeroPageX:  { code: 0x17, length: 2, pcIncrement: 2, func: SLO_ZPX },
    absolute:   { code: 0x0F, length: 3, pcIncrement: 3, func: SLO_ABS },
    absoluteX:  { code: 0x1F, length: 3, pcIncrement: 3, func: SLO_ABSX },
    absoluteY:  { code: 0x1B, length: 3, pcIncrement: 3, func: SLO_ABSY },
    indirectX:  { code: 0x03, length: 2, pcIncrement: 2, func: SLO_INDX },
    indirectY:  { code: 0x13, length: 2, pcIncrement: 2, func: SLO_INDY }
  },
  RLA: {
    zeroPage:   { code: 0x27, length: 2, pcIncrement: 2, func: RLA_ZP },
    zeroPageX:  { code: 0x37, length: 2, pcIncrement: 2, func: RLA_ZPX },
    absolute:   { code: 0x2F, length: 3, pcIncrement: 3, func: RLA_ABS },
    absoluteX:  { code: 0x3F, length: 3, pcIncrement: 3, func: RLA_ABSX },
    absoluteY:  { code: 0x3B, length: 3, pcIncrement: 3, func: RLA_ABSY },
    indirectX:  { code: 0x23, length: 2, pcIncrement: 2, func: RLA_INDX },
    indirectY:  { code: 0x33, length: 2, pcIncrement: 2, func: RLA_INDY }
  },
  SRE: {
    zeroPage:   { code: 0x47, length: 2, pcIncrement: 2, func: SRE_ZP },
    zeroPageX:  { code: 0x57, length: 2, pcIncrement: 2, func: SRE_ZPX },
    absolute:   { code: 0x4F, length: 3, pcIncrement: 3, func: SRE_ABS },
    absoluteX:  { code: 0x5F, length: 3, pcIncrement: 3, func: SRE_ABSX },
    absoluteY:  { code: 0x5B, length: 3, pcIncrement: 3, func: SRE_ABSY },
    indirectX:  { code: 0x43, length: 2, pcIncrement: 2, func: SRE_INDX },
    indirectY:  { code: 0x53, length: 2, pcIncrement: 2, func: SRE_INDY }
  },
  RRA: {
    zeroPage:   { code: 0x67, length: 2, pcIncrement: 2, func: RRA_ZP },
    zeroPageX:  { code: 0x77, length: 2, pcIncrement: 2, func: RRA_ZPX },
    absolute:   { code: 0x6F, length: 3, pcIncrement: 3, func: RRA_ABS },
    absoluteX:  { code: 0x7F, length: 3, pcIncrement: 3, func: RRA_ABSX },
    absoluteY:  { code: 0x7B, length: 3, pcIncrement: 3, func: RRA_ABSY },
    indirectX:  { code: 0x63, length: 2, pcIncrement: 2, func: RRA_INDX },
    indirectY:  { code: 0x73, length: 2, pcIncrement: 2, func: RRA_INDY }
  },
  ANC: {
    immediate:  { code: 0x0B, length: 2, pcIncrement: 2, func: ANC_IMM },
    immediate2: { code: 0x2B, length: 2, pcIncrement: 2, func: ANC_IMM }
  },
  ALR: { immediate: { code: 0x4B, length: 2, pcIncrement: 2, func: ALR_IMM } },
  ARR: { immediate: { code: 0x6B, length: 2, pcIncrement: 2, func: ARR_IMM } },
  AXA: {
    absoluteY:  { code: 0x9F, length: 3, pcIncrement: 3, func: AXA_ABSY },  // 0x9F, 0x93 -- (SHA/AHX/AXA)
    indirectY:  { code: 0x93, length: 2, pcIncrement: 2, func: AXA_INDY }
  },
  XAA: { immediate: { code: 0x8B, length: 2, pcIncrement: 2, func: XAA_IMM } },
  LAS: { absoluteY: { code: 0xBB, length: 3, pcIncrement: 3, func: LAS_ABSY } },

  // ---- Additional unoffficials for full NESDev test compatibility ----
  SHY: { absoluteX: { code: 0x9C, length: 3, pcIncrement: 3, func: SHY_ABSX } },  // aka SAY
  SHX: { absoluteY: { code: 0x9E, length: 3, pcIncrement: 3, func: SHX_ABSY } },  // aka SXA
  TAS: { absoluteY: { code: 0x9B, length: 3, pcIncrement: 3, func: TAS_ABSY } },  // aka SHS
  SBX: { immediate: { code: 0xCB, length: 2, pcIncrement: 2, func: SBX_IMM } },  // aka AXS

  // ======================= TEST HOOK OPCODE ======================= //
  Test_Trigger: { implied: { code: 0x02, length: 1, pcIncrement: 0, func: opCodeTest } }
};

// Base timings per addressing mode
const baseCycles = {
  immediate:   2,
  zeroPage:    3,
  zeroPageX:   4,
  zeroPageY:   4,
  absolute:    4,
  absoluteX:   4,  // +1 if page crossed
  absoluteY:   4,  // +1 if page crossed
  indirectX:   6,
  indirectY:   5,  // +1 if page crossed
  accumulator: 2,
  implied:     2,
  relative:    2,
  indirect:    5   // JMP ($hhhh)
};

// patch in cycle counts for modes
for (const opname in opcodes) for (const variant in opcodes[opname]) {
  let mode = variant.replace(/[0-9]+$/, '');
  opcodes[opname][variant].cycles = baseCycles[mode] || 2;
}

// 6502/NES Addressing Mode Cycle Table + Known Quirks
//
// * "RMW" = Read-Modify-Write (ASL, LSR, ROL, ROR, INC, DEC, SLO, RLA, etc.)
// * "Branch" = Bxx (BNE, BEQ, BPL, BMI, BVC, BVS, BCC, BCS)
// * "Unofficial" = see nesdev.org for oddities
//
// +1 = Add one cycle for page boundary cross (see quirk notes)
//
// ┌──────────────────┬────────┬─────────────┬───────────────────────────────────────────────────────────────┐
// │ Addressing Mode  │ Cycles │ Page Cross? │           Quirk Notes (for accurate emulation)                │
// ├──────────────────┼────────┼─────────────┼───────────────────────────────────────────────────────────────┤
// │ immediate        │   2    │    No       │                                                               │
// │ zeroPage         │   3    │    No       │                                                               │
// │ zeroPage,X       │   4    │    No       │                                                               │
// │ zeroPage,Y       │   4    │    No       │                                                               │
// │ absolute         │   4    │    No       │                                                               │
// │ absolute,X       │   4    │  Yes (+1)   │ *For RMW: always +1, regardless of page cross                 │
// │ absolute,Y       │   4    │  Yes (+1)   │                                                               │
// │ indirect,X       │   6    │    No       │                                                               │
// │ indirect,Y       │   5    │  Yes (+1)   │                                                               │
// │ accumulator      │   2    │    No       │                                                               │
// │ implied          │   2    │    No       │                                                               │
// │ relative (branch)│   2    │ +1 if branch│ +1 if branch taken, +2 if branch taken AND page crossed       │
// │ indirect (JMP)   │   5    │    No       │                                                               │
// └──────────────────┴────────┴─────────────┴───────────────────────────────────────────────────────────────┘
//
// === QUIRKS EXPLAINED ===
//  - RMW (Read-Modify-Write) opcodes with absolute,X addressing (ASL $nnnn,X etc):
//      * ALWAYS add 1 cycle, regardless of whether a page boundary is crossed!
//      * i.e., 7 cycles, not 6 or 7
//
//  - Branch (Bxx) instructions:
//      * If branch not taken: 2 cycles
//      * If branch taken:     3 cycles
//      * If branch taken AND page crossed: 4 cycles (add 2)
//
//  - Unofficial opcodes:
//      * Some have cycle counts and page-cross behaviors that differ from above!
//      * See: https://www.nesdev.org/wiki/CPU_unofficial_opcodes
//
//  - STA/STX/STY/SHY/SHX/SAX do NOT add cycles for page cross (quirk vs. LDA etc)
//
//  - JMP (indirect) is always 5 cycles, never adds a cycle for page wrap bug
*/