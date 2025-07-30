let CPUregisters = {
  A: 0x00,
  X: 0x00,
  Y: 0x00,
  // initialized to 0xFF on power-up or reset?
  // https://www.nesdev.org/wiki/Stack
  S: 0xFF,
  PC: 0x0000,
  P: {
      C: 0,    // Carry
      Z: 0,    // Zero
      I: 0,    // Interrupt Disable
      D: 0,    // Decimal Mode
      B: 0,    // Break Command
      U: 'NA', // Unused ('U' Flag, technically always set to 1)
      V: 0,    // Overflow
      N: 0     // Negative
  }
};
// These are used to access P register by INDEX! used for debug table
let P_VARIABLES = ['C', 'Z', 'I', 'D', 'B', 'U', 'V', 'N'];

function resetCPU() {
  systemMemory.fill(0x00); // may not happeon on a real system
  CPUregisters.A = 0x00;
  CPUregisters.X = 0x00;
  CPUregisters.Y = 0x00;
  CPUregisters.S = 0xFF;
  CPUregisters.P = {
      C: 0,    // Carry
      Z: 0,    // Zero
      I: 0,    // Interrupt Disable
      D: 0,    // Decimal Mode
      B: 0,    // Break Command
      U: 'NA',     // Unused ('U' Flag, technically always set to 1)
      V: 0,    // Overflow
      N: 0     // Negative
  };
  CPUregisters.PC = 0x0000;
}

////////////////////////// CPU Functions //////////////////////////
// http://www.6502.org/tutorials/6502opcodes.html#ADC
// https://en.wikipedia.org/wiki/MOS_Technology_6502#Registers
// https://www.masswerk.at/6502/6502_instruction_set.html
// https://www.pagetable.com/c64ref/6502/?tab=2#LDA 
// https://www.nesdev.org/obelisk-6502-guide/addressessing.html

function SEI_IMP() {
  CPUregisters.P.I = (1) ? 1 : 0;
}

function CLD_IMP() {
  CPUregisters.P.D = (0) ? 1 : 0;
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
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);
  CPUregisters.P.C = (sum > 255) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_IMM() {
  CPUregisters.A &= checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}


function LDA_ABSX() {
  const base = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  const address = (base + CPUregisters.X) & 0xFFFF;
  CPUregisters.A = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function LDA_ABSY() {
  const base = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  const address = (base + CPUregisters.Y) & 0xFFFF;
  CPUregisters.A = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function LDA_INDX() {
  const zpaddress = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (checkReadOffset((zpaddress + 1) & 0xFF) << 8) | checkReadOffset(zpaddress);
  CPUregisters.A = checkReadOffset(address);
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function LDA_INDY() {
  const zp = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  const lo = checkReadOffset(zp);
  const hi = checkReadOffset((zp + 1) & 0xFF);
  const addr = ((hi<<8)|lo) + CPUregisters.Y & 0xFFFF;
  const val  = checkReadOffset(addr);
  CPUregisters.A   = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
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
  console.log("STA_ABS writing to", address.toString(16), "value", CPUregisters.A);
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

function ADC_ZP() {
  const address = checkReadOffset(CPUregisters.PC + 1);
  const value = checkReadOffset(address);
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);
  CPUregisters.P.C = (sum > 255) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_INX() {
  const operand = checkReadOffset(CPUregisters.PC + 1);
  const lowByteaddress = (operand + CPUregisters.X) & 0xFF;
  const highByteaddress = (operand + CPUregisters.X + 1) & 0xFF;
  const addressess = (checkReadOffset(highByteaddress) << 8) | checkReadOffset(lowByteaddress);
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_INY() {
  const operand = checkReadOffset(CPUregisters.PC + 1);
  const lowByteaddress = operand & 0xFF;
  const highByteaddress = (operand + 1) & 0xFF;
  const addressess = ((checkReadOffset(highByteaddress) << 8) | checkReadOffset(lowByteaddress)) + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function CLC_IMP() { CPUregisters.P.C = (0) ? 1 : 0; }
function SEC_IMP() { CPUregisters.P.C = (1) ? 1 : 0; }
function CLI_IMP() { CPUregisters.P.I = (0) ? 1 : 0; }
function CLV_IMP() { CPUregisters.P.V = (0) ? 1 : 0; }
function SED_IMP() { CPUregisters.P.D = (1) ? 1 : 0; }

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
}

function JMP_ABS() {
  CPUregisters.PC = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
}

function JMP_IND() {
  const pointer = (checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1);
  const lowByte = checkReadOffset(pointer);
  const highByte = (pointer & 0xFF) === 0xFF
    ? checkReadOffset(pointer & 0xFF00)
    : checkReadOffset(pointer + 1);
  CPUregisters.PC = (highByte << 8) | lowByte;
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
  CPUregisters.X = systemMemory[CPUregisters.PC + 1];
  
  // Set zero and negative flags
  CPUregisters.P.Z = ((CPUregisters.X === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0) ? 1 : 0;
}

function LDX_ZP() {
  // Load value from zero page into X
  const addressess = systemMemory[CPUregisters.PC + 1];
  CPUregisters.X = checkReadOffset(addressess);
  
  // Set zero and negative flags
  CPUregisters.P.Z = ((CPUregisters.X === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0) ? 1 : 0;
}

function LDX_ZPY() {
  // Load value from zero page addressess + Y into X
  const baseaddress = systemMemory[CPUregisters.PC + 1];
  const addressess = (baseaddress + CPUregisters.Y) & 0xFF; // zero page wrap
  CPUregisters.X = checkReadOffset(addressess);
  
  // Set zero and negative flags
  CPUregisters.P.Z = ((CPUregisters.X === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0) ? 1 : 0;
}

function LDX_ABS() {
  // Load value from absolute addressess into X
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const addressess = (high << 8) | low;
  CPUregisters.X = checkReadOffset(addressess);
  
  // Set zero and negative flags
  CPUregisters.P.Z = ((CPUregisters.X === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.X & 0x80) !== 0) ? 1 : 0;
}

function LDX_ABSY() {
  // Opcode BE: LDX absolute,Y
  const lo   = checkReadOffset(CPUregisters.PC + 1);
  const hi   = checkReadOffset(CPUregisters.PC + 2);
  const base = (hi << 8) | lo;
  const addr = (base + CPUregisters.Y) & 0xFFFF;

  // Choose proper read
  const val = (addr >= 0x2000 && addr <= 0x3FFF)
    ? checkReadOffset(addr)
    : checkReadOffset(addr);

  CPUregisters.X   = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
}

function ADC_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = (result > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((result & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.V = ((~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = result & 0xFF;
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

function ADC_ABSX() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseaddressess = (high << 8) | low;
  const addressess = (baseaddressess + CPUregisters.X) & 0xFFFF;
  const value = checkReadOffset(addressess);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = (result > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = ((result & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.V = ((~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_ABSY() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
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

function ADC_INDX() {
  const operand = systemMemory[CPUregisters.PC + 1];
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
  const operand = systemMemory[CPUregisters.PC + 1];
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

function AND_IMM() {
  const value = systemMemory[CPUregisters.PC + 1];
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_ZP() {
  const addressess = systemMemory[CPUregisters.PC + 1];
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_ZPX() {
  const baseaddress = systemMemory[CPUregisters.PC + 1];
  const addressess = (baseaddress + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_ABS() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const addressess = (high << 8) | low;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_ABSX() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseaddressess = (high << 8) | low;
  const addressess = (baseaddressess + CPUregisters.X) & 0xFFFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_ABSY() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseaddressess = (high << 8) | low;
  const addressess = (baseaddressess + CPUregisters.Y) & 0xFFFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_INDX() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const ptr = (operand + CPUregisters.X) & 0xFF;
  const low = checkReadOffset(ptr);
  const high = checkReadOffset((ptr + 1) & 0xFF);
  const addressess = (high << 8) | low;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function AND_INDY() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const low = checkReadOffset(operand & 0xFF);
  const high = checkReadOffset((operand + 1) & 0xFF);
  const baseaddressess = (high << 8) | low;
  const addressess = (baseaddressess + CPUregisters.Y) & 0xFFFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A &= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ASL_ACC() {
  // Capture original A and perform shift
  const oldA   = CPUregisters.A & 0xFF;
  const result = (oldA << 1) & 0xFF;

  // C = old bit 7
  CPUregisters.P.C = ((oldA & 0x80) >>> 7) ? 1 : 0;
  // Store shifted result
  CPUregisters.A   = result;
  // Z = result == 0
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  // N = result bit 7
  CPUregisters.P.N = ((result & 0x80) >>> 7) ? 1 : 0;
}

function ASL_ZP() {
  const addressess = systemMemory[CPUregisters.PC + 1];
  const value = checkReadOffset(addressess);
  const carryOut = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[addressess] = result;
  CPUregisters.P.C = (carryOut) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function ASL_ZPX() {
  const baseaddress = systemMemory[CPUregisters.PC + 1];
  const addressess = (baseaddress + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(addressess);
  const carryOut = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[addressess] = result;
  CPUregisters.P.C = (carryOut) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function ASL_ABS() {
  // Fetch the two‑byte addressess
  const lo   = systemMemory[CPUregisters.PC + 1];
  const hi   = systemMemory[CPUregisters.PC + 2];
  const address = (hi << 8) | lo;

  // Read, shift, and compute carry
  const oldVal = checkReadOffset(address) & 0xFF;
  const result = (oldVal << 1) & 0xFF;
  const carry  = (oldVal & 0x80) >>> 7;

  // Write back and update flags as 0/1
  checkWriteOffset(address, result);
  CPUregisters.P.C = (carry) ? 1 : 0;                    // 1 if bit 7 was set
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;      // 1 if result==0
  CPUregisters.P.N = ((result & 0x80) >>> 7) ? 1 : 0;     // bit 7 of the result
}

function ASL_ABSX() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseaddressess = (high << 8) | low;
  const addressess = (baseaddressess + CPUregisters.X) & 0xFFFF;
  const value = checkReadOffset(addressess);
  const carryOut = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[addressess] = result;
  CPUregisters.P.C = (carryOut) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function BIT_ZP() {
  // Zero‑page addressessing
  const zpaddress = systemMemory[CPUregisters.PC + 1] & 0xFF;
  const m      = checkReadOffset(zpaddress) & 0xFF;
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
  const lo   = systemMemory[CPUregisters.PC + 1];
  const hi   = systemMemory[CPUregisters.PC + 2];
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

// LSR on zero page
function LSR_ZP() {
  const zpaddress = systemMemory[CPUregisters.PC + 1] & 0xFF;
  const oldVal = checkReadOffset(zpaddress) & 0xFF;
  const result = (oldVal >>> 1) & 0xFF;
  CPUregisters.P.C = (oldVal & 0x01) ? 1 : 0;
  checkWriteOffset(zpaddress, result);
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = (0) ? 1 : 0;
}

// LSR on zero page, X‑indexed
function LSR_ZPX() {
  const base   = systemMemory[CPUregisters.PC + 1] & 0xFF;
  const address   = (base + CPUregisters.X) & 0xFF;
  const oldVal = checkReadOffset(address) & 0xFF;
  const result = (oldVal >>> 1) & 0xFF;
  CPUregisters.P.C = (oldVal & 0x01) ? 1 : 0;
  checkWriteOffset(address, result);
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = (0) ? 1 : 0;
}

// LSR on absolute addressess
function LSR_ABS() {
  const lo   = systemMemory[CPUregisters.PC + 1];
  const hi   = systemMemory[CPUregisters.PC + 2];
  const address = ((hi << 8) | lo) & 0xFFFF;
  const oldVal = checkReadOffset(address) & 0xFF;
  const result = (oldVal >>> 1) & 0xFF;
  CPUregisters.P.C = (oldVal & 0x01) ? 1 : 0;
  checkWriteOffset(address, result);
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = (0) ? 1 : 0;
}

// LSR on absolute addressess with X‑offset
function LSR_ABSX() {
  const lo   = systemMemory[CPUregisters.PC + 1];
  const hi   = systemMemory[CPUregisters.PC + 2];
  const base = ((hi << 8) | lo) & 0xFFFF;
  const address = (base + CPUregisters.X) & 0xFFFF;
  const oldVal = checkReadOffset(address) & 0xFF;
  const result = (oldVal >>> 1) & 0xFF;
  CPUregisters.P.C = (oldVal & 0x01) ? 1 : 0;
  checkWriteOffset(address, result);
  CPUregisters.P.Z = (result === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = (0) ? 1 : 0;
}

function ORA_IMM() {
  // Fetch immediate operand
  const value  = systemMemory[CPUregisters.PC + 1] & 0xFF;
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
  const addressess = systemMemory[CPUregisters.PC + 1];
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_ZPX() {
  const addressess = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_ABS() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const addressess = (high << 8) | low;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_ABSX() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const addressess = ((high << 8) | low) + CPUregisters.X;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_ABSY() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const addressess = ((high << 8) | low) + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function ORA_INDX() {
  const operand = systemMemory[CPUregisters.PC + 1];
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
  const operand = systemMemory[CPUregisters.PC + 1];
  const low = checkReadOffset(operand);
  const high = checkReadOffset((operand + 1) & 0xFF);
  const addressess = ((high << 8) | low) + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A |= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

// --------- Branches (REL) ---------------
//still branch to correct locations if conditional runs 1
function BPL_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  if (!CPUregisters.P.N) {
    CPUregisters.PC += signed;
  }
}

function BMI_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  if (CPUregisters.P.N) {
    CPUregisters.PC += signed;
  }
}

function BVC_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  if (!CPUregisters.P.V) {
    CPUregisters.PC += signed;
  }
}

function BCS_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  if (CPUregisters.P.C) {
    CPUregisters.PC += signed;
  }
}

function BCC_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  if (!CPUregisters.P.C) {
    CPUregisters.PC += signed;
  }
}

function BEQ_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  if (CPUregisters.P.Z) {
    CPUregisters.PC += signed;
  }
}

function BNE_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  if (!CPUregisters.P.Z) {
    CPUregisters.PC += signed;
  }
}

// --------- BRK (IMP) ---------------
// zero increment in object for this, done here in opcode function
function BRK_IMP() {
  // compute return address = PC + table.pcIncrement (2)
  const ret = (CPUregisters.PC + 2) & 0xFFFF;

  // push high then low
  systemMemory[0x100 + CPUregisters.S] = (ret >> 8) & 0xFF;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  systemMemory[0x100 + CPUregisters.S] = ret & 0xFF;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // build status with B=1
  let st = 0x20 | 0x10; // unused & B
  if (CPUregisters.P.N) st |= 0x80;
  if (CPUregisters.P.V) st |= 0x40;
  if (CPUregisters.P.D) st |= 0x08;
  if (CPUregisters.P.I) st |= 0x04;
  if (CPUregisters.P.Z) st |= 0x02;
  if (CPUregisters.P.C) st |= 0x01;

  systemMemory[0x100 + CPUregisters.S] = st;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // disable interrupts
  CPUregisters.P.I = (1) ? 1 : 0;

  // fetch vector & jump
  const lo = checkReadOffset(0xFFFE);
  const hi = checkReadOffset(0xFFFF);
  CPUregisters.PC = (hi << 8) | lo;
}

function CMP_IMM() {
  const operand = checkReadOffset(CPUregisters.PC + 1);
  const result  = (CPUregisters.A - operand) & 0xFF;

  CPUregisters.P.C = (CPUregisters.A >= operand) ? 1 : 0;       // Carry = no borrow
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;                  // Zero  = equal
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;            // Negative = bit7 of result
}

function CMP_ZP() {
  const addressess = systemMemory[CPUregisters.PC + 1];
  const operand = systemMemory[addressess];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CMP_ZPX() {
  const addressess = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const operand = systemMemory[addressess];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CMP_ABS() {
  const addressess = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const operand = systemMemory[addressess];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CMP_ABSX() {
  const baseaddressess = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const addressess = (baseaddressess + CPUregisters.X) & 0xFFFF;
  const operand = systemMemory[addressess];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CMP_ABSY() {
  const baseaddressess = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const addressess = (baseaddressess + CPUregisters.Y) & 0xFFFF;
  const operand = systemMemory[addressess];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CMP_INDX() {
  const zpaddress = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const lowByte = systemMemory[zpaddress];
  const highByte = systemMemory[(zpaddress + 1) & 0xFF];
  const addressess = (highByte << 8) | lowByte;
  const operand = systemMemory[addressess];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CMP_INDY() {
  const zpaddress = systemMemory[CPUregisters.PC + 1];
  const lowByte = systemMemory[zpaddress];
  const highByte = systemMemory[(zpaddress + 1) & 0xFF];
  const addressess = ((highByte << 8) | lowByte) + CPUregisters.Y;
  const operand = systemMemory[addressess & 0xFFFF];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CPY_IMM() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const result = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.Y >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CPY_ZP() {
  const addressess = systemMemory[CPUregisters.PC + 1];
  const operand = systemMemory[addressess];
  const result = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.Y >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function CPY_ABS() {
  const addressess = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const operand = systemMemory[addressess];
  const result = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = (CPUregisters.Y >= operand) ? 1 : 0;
  CPUregisters.P.Z = ((result === 0)) ? 1 : 0;
  CPUregisters.P.N = ((result & 0x80) !== 0) ? 1 : 0;
}

function DEC_ZP() {
  const addressess = systemMemory[CPUregisters.PC + 1];
  const value = (systemMemory[addressess] - 1) & 0xFF;
  systemMemory[addressess] = value;
  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function DEC_ZPX() {
  const addressess = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const value = (systemMemory[addressess] - 1) & 0xFF;
  systemMemory[addressess] = value;
  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function DEC_ABS() {
  const addressess = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const value = (systemMemory[addressess] - 1) & 0xFF;
  systemMemory[addressess] = value;
  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function DEC_ABX() {
  const addressess = ((systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1]) + CPUregisters.X;
  const value = (systemMemory[addressess] - 1) & 0xFF;
  systemMemory[addressess] = value;
  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function DEC_ABSX() {
  const addressess = (((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.X) & 0xFFFF;
  let value = (checkReadOffset(addressess) - 1) & 0xFF;
  checkWriteOffset(addressess, value);

  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function EOR_IMM() {
  const value = systemMemory[CPUregisters.PC + 1];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ZP() {
  const addressess = systemMemory[CPUregisters.PC + 1];
  const value = systemMemory[addressess];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ZPX() {
  const addressess = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const value = systemMemory[addressess];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ABS() {
  const addressess = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const value = systemMemory[addressess];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ABX() {
  const addressess = (((systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1]) + CPUregisters.X) & 0xFFFF;
  const value = systemMemory[addressess];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_ABY() {
  const addressess = (((systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1]) + CPUregisters.Y) & 0xFFFF;
  const value = systemMemory[addressess];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_INX() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const lowByteaddress = (operand + CPUregisters.X) & 0xFF;
  const highByteaddress = (operand + CPUregisters.X + 1) & 0xFF;
  const addressess = (systemMemory[highByteaddress] << 8) | systemMemory[lowByteaddress];
  const value = systemMemory[addressess];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
}

function EOR_INY() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const lowByteaddress = operand & 0xFF;
  const highByteaddress = (operand + 1) & 0xFF;
  const addressess = (((systemMemory[highByteaddress] << 8) | systemMemory[lowByteaddress]) + CPUregisters.Y) & 0xFFFF;
  const value = systemMemory[addressess];
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
  const zpaddress = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = checkReadOffset(zpaddress) | (checkReadOffset((zpaddress + 1) & 0xFF) << 8);
  const value = checkReadOffset(addressess);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
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
  // Fetch target addressess from next two bytes (little endian)
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const target = (high << 8) | low;

  // Compute return addressess = PC + 2 (last byte of JSR instruction)
  const returnaddressess = (CPUregisters.PC + 2) & 0xFFFF;

  // 6502 stack pointer (CPUregisters.S) starts at 0xFF and goes down
  // Push return addressess - 1 onto stack (high byte first)
  systemMemory[0x0100 + CPUregisters.S] = (returnaddressess >> 8) & 0xFF;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  systemMemory[0x0100 + CPUregisters.S] = returnaddressess & 0xFF;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Set PC to target addressess (jump)
  CPUregisters.PC = target;
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
  const address = systemMemory[CPUregisters.PC + 1];
  const value = systemMemory[address & 0xFF];
  CPUregisters.Y = value;

  CPUregisters.STATUS = (CPUregisters.STATUS & 0x7D) |
                        (value === 0 ? 0x02 : 0x00) |
                        (value & 0x80);
}

function LDY_ZPX() {
  const zp         = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const val        = checkReadOffset(zp);
  CPUregisters.Y   = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
}

function LDY_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const address = (hi << 8) | lo;
  const value = systemMemory[address];
  CPUregisters.Y = value;

  CPUregisters.STATUS = (CPUregisters.STATUS & 0x7D) |
                        (value === 0 ? 0x02 : 0x00) |
                        (value & 0x80);
}

function LDY_ABSX() {
  const lo   = checkReadOffset(CPUregisters.PC + 1);
  const hi   = checkReadOffset(CPUregisters.PC + 2);
  const base = (hi << 8) | lo;
  const addr = (base + CPUregisters.X) & 0xFFFF;

  const val = (addr >= 0x2000 && addr <= 0x3FFF)
    ? checkReadOffset(addr)
    : checkReadOffset(addr);

  CPUregisters.Y   = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
}

function SBC_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = (sum > 0xFF ? 1 : 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0 ? 1 : 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0 ? 1 : 0) ? 1 : 0;
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

// BVS - Branch on Overflow Set (relative)
// if conditional truthy
// PC += offset → step() then does its +2 → lands exactly at oldPC + 2 + offset, which is how the 6502 spec defines it.
function BVS_REL() {
  const raw = checkReadOffset(CPUregisters.PC + 1);
  const offset = raw < 0x80 ? raw : raw - 0x100;
  if (CPUregisters.P.V) {
    CPUregisters.PC += offset;
  }
}

// TYA - Transfer Y to A (implied)
function TYA_IMP() {
  CPUregisters.A = CPUregisters.Y;
  CPUregisters.SR = (CPUregisters.SR & 0x7D) | (CPUregisters.A === 0 ? 0x02 : 0) | (CPUregisters.A & 0x80 ? 0x80 : 0);
}

// TXA - Transfer X to A (implied)
function TXA_IMP() {
  CPUregisters.A = CPUregisters.X;
  CPUregisters.P.Z = +(CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A >> 7) & 1;
}

// PHP - Push Processor Status on stack (implied)
function PHP_IMP() {
  systemMemory[0x100 + CPUregisters.S] = CPUregisters.SR | 0x10; // set break flag in pushed status
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
}

// PLP - Pull Processor Status from stack (implied)
function PLP_IMP() {
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  CPUregisters.SR = systemMemory[0x100 + CPUregisters.S] & 0xEF; // clear break flag on pull
}

// PHA - Push Accumulator (implied)
function PHA_IMP() {
  systemMemory[0x100 + CPUregisters.S] = CPUregisters.A;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
}

// PLA - Pull Accumulator (implied)
function PLA_IMP() {
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  CPUregisters.A = systemMemory[0x100 + CPUregisters.S];
  CPUregisters.SR = (CPUregisters.SR & 0x7D) | (CPUregisters.A === 0 ? 0x02 : 0) | (CPUregisters.A & 0x80 ? 0x80 : 0);
}

// RTI - Return from Interrupt (implied) --- object set to zero for PC inc, done here
function RTI_IMP() {
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  CPUregisters.SR = systemMemory[0x100 + CPUregisters.S] & 0xEF; // clear break flag

  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  let pcl = systemMemory[0x100 + CPUregisters.S];

  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  let pch = systemMemory[0x100 + CPUregisters.S];

  CPUregisters.PC = (pch << 8) | pcl;
}

// RTS - Return from Subroutine (implied)
function RTS_IMP() {
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  let pcl = systemMemory[0x100 + CPUregisters.S];

  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  let pch = systemMemory[0x100 + CPUregisters.S];

  CPUregisters.PC = ((pch << 8) | pcl) + 1;
}

function NOP_ZPY() {
  // dummy read from (ZP + Y) but do nothing else
  const zp = checkReadOffset(CPUregisters.PC + 1);
  checkReadOffset((zp + CPUregisters.Y) & 0xFF);
}

function NOP() {}

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
  
  function RRA_ZP() {
    let addr = checkReadOffset(CPUregisters.PC + 1);
    let val = checkReadOffset(addr);
  
    // ROR (Rotate Right)
    let oldCarry = CPUregisters.P.C;
    CPUregisters.P.C = val & 0x01;
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);
  
    // ADC with result (as per standard 6502 ADC logic)
    let A = CPUregisters.A;
    let sum = A + val + oldCarry;
    let result = sum & 0xFF;
  
    // Set flags as per ADC
    CPUregisters.P.Z = +(result === 0);
    CPUregisters.P.N = (result >> 7) & 1;
    // Carry out
    CPUregisters.P.C = sum > 0xFF ? 1 : 0;
    // Overflow detection
    CPUregisters.P.V = (~(A ^ val) & (A ^ result) & 0x80) ? 1 : 0;
  
    CPUregisters.A = result;
  }  

  function RRA_INDX() {
    const zp = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
    const addr = checkReadOffset(zp) | (checkReadOffset((zp + 1) & 0xFF) << 8);
    let val = checkReadOffset(addr);
  
    // --- ROR memory (same as ROR_ABS but inline) ---
    const oldCarry = CPUregisters.P & 0x01;
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((val & 0x01) ? 1 : 0);
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);
  
    // --- ADC (A + val + carry, set N/Z/C/V flags) ---
    let acc = CPUregisters.A;
    let carry = (CPUregisters.P & 0x01) ? 1 : 0;
    let result = acc + val + carry;
    CPUregisters.P = (CPUregisters.P & ~0x80) | (result & 0x80); // N flag
    CPUregisters.P = (CPUregisters.P & ~0x02) | ((result === 0) ? 0x02 : 0); // Z flag
    CPUregisters.P = (CPUregisters.P & ~0x40) | (((~(acc ^ val) & (acc ^ result)) & 0x80) ? 0x40 : 0); // V flag
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((result > 0xFF) ? 0x01 : 0); // C flag
    CPUregisters.A = result & 0xFF;
  }

  function RRA_INDY() {
    const zp = checkReadOffset(CPUregisters.PC + 1);
    const base = checkReadOffset(zp) | (checkReadOffset((zp + 1) & 0xFF) << 8);
    const addr = (base + CPUregisters.Y) & 0xFFFF;
    let val = checkReadOffset(addr);
  
    // ROR
    const oldCarry = CPUregisters.P & 0x01;
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((val & 0x01) ? 1 : 0);
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);
  
    // ADC
    let acc = CPUregisters.A;
    let carry = (CPUregisters.P & 0x01) ? 1 : 0;
    let result = acc + val + carry;
    CPUregisters.P = (CPUregisters.P & ~0x80) | (result & 0x80);
    CPUregisters.P = (CPUregisters.P & ~0x02) | ((result === 0) ? 0x02 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x40) | (((~(acc ^ val) & (acc ^ result)) & 0x80) ? 0x40 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((result > 0xFF) ? 0x01 : 0);
    CPUregisters.A = result & 0xFF;
  }

  function RRA_ZP() {
    const addr = checkReadOffset(CPUregisters.PC + 1);
    let val = checkReadOffset(addr);
  
    // ROR
    const oldCarry = CPUregisters.P & 0x01;
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((val & 0x01) ? 1 : 0);
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);
  
    // ADC
    let acc = CPUregisters.A;
    let carry = (CPUregisters.P & 0x01) ? 1 : 0;
    let result = acc + val + carry;
    CPUregisters.P = (CPUregisters.P & ~0x80) | (result & 0x80);
    CPUregisters.P = (CPUregisters.P & ~0x02) | ((result === 0) ? 0x02 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x40) | (((~(acc ^ val) & (acc ^ result)) & 0x80) ? 0x40 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((result > 0xFF) ? 0x01 : 0);
    CPUregisters.A = result & 0xFF;
  }

  function RRA_ZPX() {
    const addr = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
    let val = checkReadOffset(addr);
  
    // ROR
    const oldCarry = CPUregisters.P & 0x01;
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((val & 0x01) ? 1 : 0);
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);
  
    // ADC
    let acc = CPUregisters.A;
    let carry = (CPUregisters.P & 0x01) ? 1 : 0;
    let result = acc + val + carry;
    CPUregisters.P = (CPUregisters.P & ~0x80) | (result & 0x80);
    CPUregisters.P = (CPUregisters.P & ~0x02) | ((result === 0) ? 0x02 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x40) | (((~(acc ^ val) & (acc ^ result)) & 0x80) ? 0x40 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((result > 0xFF) ? 0x01 : 0);
    CPUregisters.A = result & 0xFF;
  }

  function RRA_ABS() {
    const addr = checkReadOffset(CPUregisters.PC + 1) | (checkReadOffset(CPUregisters.PC + 2) << 8);
    let val = checkReadOffset(addr);
  
    // ROR
    const oldCarry = CPUregisters.P & 0x01;
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((val & 0x01) ? 1 : 0);
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);
  
    // ADC
    let acc = CPUregisters.A;
    let carry = (CPUregisters.P & 0x01) ? 1 : 0;
    let result = acc + val + carry;
    CPUregisters.P = (CPUregisters.P & ~0x80) | (result & 0x80);
    CPUregisters.P = (CPUregisters.P & ~0x02) | ((result === 0) ? 0x02 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x40) | (((~(acc ^ val) & (acc ^ result)) & 0x80) ? 0x40 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((result > 0xFF) ? 0x01 : 0);
    CPUregisters.A = result & 0xFF;
  }
  
  function RRA_ABSX() {
    const base = checkReadOffset(CPUregisters.PC + 1) | (checkReadOffset(CPUregisters.PC + 2) << 8);
    const addr = (base + CPUregisters.X) & 0xFFFF;
    let val = checkReadOffset(addr);
  
    // ROR
    const oldCarry = CPUregisters.P & 0x01;
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((val & 0x01) ? 1 : 0);
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);
  
    // ADC
    let acc = CPUregisters.A;
    let carry = (CPUregisters.P & 0x01) ? 1 : 0;
    let result = acc + val + carry;
    CPUregisters.P = (CPUregisters.P & ~0x80) | (result & 0x80);
    CPUregisters.P = (CPUregisters.P & ~0x02) | ((result === 0) ? 0x02 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x40) | (((~(acc ^ val) & (acc ^ result)) & 0x80) ? 0x40 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((result > 0xFF) ? 0x01 : 0);
    CPUregisters.A = result & 0xFF;
  }

  function RRA_ABSY() {
    const base = checkReadOffset(CPUregisters.PC + 1) | (checkReadOffset(CPUregisters.PC + 2) << 8);
    const addr = (base + CPUregisters.Y) & 0xFFFF;
    let val = checkReadOffset(addr);
  
    // ROR
    const oldCarry = CPUregisters.P & 0x01;
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((val & 0x01) ? 1 : 0);
    val = (val >> 1) | (oldCarry << 7);
    checkWriteOffset(addr, val);
  
    // ADC
    let acc = CPUregisters.A;
    let carry = (CPUregisters.P & 0x01) ? 1 : 0;
    let result = acc + val + carry;
    CPUregisters.P = (CPUregisters.P & ~0x80) | (result & 0x80);
    CPUregisters.P = (CPUregisters.P & ~0x02) | ((result === 0) ? 0x02 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x40) | (((~(acc ^ val) & (acc ^ result)) & 0x80) ? 0x40 : 0);
    CPUregisters.P = (CPUregisters.P & ~0x01) | ((result > 0xFF) ? 0x01 : 0);
    CPUregisters.A = result & 0xFF;
  }
  
  function LAX_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  const value = checkReadOffset(address);
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = (((value & 0x80) !== 0)) ? 1 : 0;
}

function LAX_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const address = (hi << 8) | lo;
  const value = checkReadOffset(address);
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = ((value === 0)) ? 1 : 0;
  CPUregisters.P.N = (((value & 0x80) !== 0)) ? 1 : 0;
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
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
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
  const pointer = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  const addressess = base + CPUregisters.Y;
  const value = checkReadOffset(addressess);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = ((value & 0x80) !== 0) ? 1 : 0;
}

function SAX_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  checkWriteOffset(address, CPUregisters.A & CPUregisters.X);
}

function SAX_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const address = (hi << 8) | lo;
  checkWriteOffset(address, CPUregisters.A & CPUregisters.X);
}

function SAX_INDX() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addressess = (checkReadOffset((pointer + 1) & 0xFF) << 8) | checkReadOffset(pointer);
  const value = CPUregisters.A & CPUregisters.X;
  checkWriteOffset(addressess, value);
}

function SAX_ZPY() {
  const pointer = (checkReadOffset(CPUregisters.PC + 1) + CPUregisters.Y) & 0xFF;
  const value = CPUregisters.A & CPUregisters.X;
  checkWriteOffset(pointer, value);
}

function DCP_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  let value = (checkReadOffset(address) - 1) & 0xFF;
  checkWriteOffset(address, value);

  const result = CPUregisters.A - value;
  CPUregisters.P.C = ((CPUregisters.A >= value)) ? 1 : 0;
  CPUregisters.P.Z = (((result & 0xFF) === 0)) ? 1 : 0;
  CPUregisters.P.N = (((result & 0x80) !== 0)) ? 1 : 0;
}

function DCP_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
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
  const address = systemMemory[CPUregisters.PC + 1];
  let value = checkReadOffset(address);
  CPUregisters.P.C = (((value & 0x80) !== 0)) ? 1 : 0;
  value = (value << 1) & 0xFF;
  checkWriteOffset(address, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
}

function SLO_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
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
  const address = systemMemory[CPUregisters.PC + 1];
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
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
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
  const address = systemMemory[CPUregisters.PC + 1];
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
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
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
  const address = systemMemory[CPUregisters.PC + 1];
  let value = checkReadOffset(address);
  CPUregisters.P.C = (((value & 0x01) !== 0)) ? 1 : 0;
  value = (value >> 1) & 0xFF;
  checkWriteOffset(address, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
}

function SRE_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
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
  const value = systemMemory[CPUregisters.PC + 1];
  CPUregisters.A &= value;
  CPUregisters.P.C = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = (((CPUregisters.A & 0x80) !== 0)) ? 1 : 0;
  CPUregisters.PC += 2;
}

function ALR_IMM() {
  const val = systemMemory[CPUregisters.PC + 1];
  CPUregisters.A &= val;
  // Carry = bit 0 of A before shift
  CPUregisters.STATUS = (CPUregisters.STATUS & ~0x01) | (CPUregisters.A & 0x01);
  CPUregisters.A >>= 1;
  // Set zero flag
  if (CPUregisters.A === 0) CPUregisters.STATUS |= 0x02;
  else CPUregisters.STATUS &= ~0x02;
  // Set negative flag from bit 7
  if (CPUregisters.A & 0x80) CPUregisters.STATUS |= 0x80;
  else CPUregisters.STATUS &= ~0x80;
  CPUregisters.PC += 2;
}

function ARR_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.A &= value;
  CPUregisters.A >>= 1;
  CPUregisters.P.C = ((CPUregisters.A & 0x40) !== 0) ? 1 : 0;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.V = (((CPUregisters.A >> 5) & 1) ^ ((CPUregisters.A >> 6) & 1)) ? 1 : 0;
}

function XAA_IMM() {
  const value = checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.A = CPUregisters.X & value;

  CPUregisters.P.Z = ((CPUregisters.A === 0)) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;

  CPUregisters.PC += 2;
}

function AXA_ABSY() {
  const addressess = ((checkReadOffset(CPUregisters.PC + 2) << 8) | checkReadOffset(CPUregisters.PC + 1)) + CPUregisters.Y;
  const value = CPUregisters.A & CPUregisters.X;
  checkWriteOffset(addressess, value & (addressess >> 8) + 1);
}

function AXA_INDY() {
  const pointer = checkReadOffset(CPUregisters.PC + 1);
  const base = (checkReadOffset(pointer + 1) << 8) | checkReadOffset(pointer);
  const addressess = base + CPUregisters.Y;
  const value = CPUregisters.A & CPUregisters.X;
  checkWriteOffset(addressess, value & (addressess >> 8) + 1);
}

//////////////////////// 6502 CPU opcode object ////////////////////////
// TO DO: Add cycles, work out boundary cross stuff
const opcodes = {
  // ======================= LEGAL OPCODES ======================= //
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
  ASL: {
    accumulator: { code: 0x0A, length: 1, pcIncrement: 1, func: ASL_ACC },
    zeroPage:    { code: 0x06, length: 2, pcIncrement: 2, func: ASL_ZP },
    zeroPageX:   { code: 0x16, length: 2, pcIncrement: 2, func: ASL_ZPX },
    absolute:    { code: 0x0E, length: 3, pcIncrement: 3, func: ASL_ABS },
    absoluteX:   { code: 0x1E, length: 3, pcIncrement: 3, func: ASL_ABSX }
  },
  BCC: { relative: { code: 0x90, length: 2, pcIncrement: 2, func: BCC_REL } },
  BCS: { relative: { code: 0xB0, length: 2, pcIncrement: 2, func: BCS_REL } },
  BEQ: { relative: { code: 0xF0, length: 2, pcIncrement: 2, func: BEQ_REL } },
  BIT: {
    zeroPage:  { code: 0x24, length: 2, pcIncrement: 2, func: BIT_ZP },
    absolute:  { code: 0x2C, length: 3, pcIncrement: 3, func: BIT_ABS }
  },
  BMI: { relative: { code: 0x30, length: 2, pcIncrement: 2, func: BMI_REL } },
  BNE: { relative: { code: 0xD0, length: 2, pcIncrement: 2, func: BNE_REL } },
  BPL: { relative: { code: 0x10, length: 2, pcIncrement: 2, func: BPL_REL } },
  BRK: { implied: { code: 0x00, length: 1, pcIncrement: 0, func: BRK_IMP } },
  BVC: { relative: { code: 0x50, length: 2, pcIncrement: 2, func: BVC_REL } },
  BVS: { relative: { code: 0x70, length: 2, pcIncrement: 2, func: BVS_REL } },
  CLC: { implied: { code: 0x18, length: 1, pcIncrement: 1, func: CLC_IMP } },
  CLD: { implied: { code: 0xD8, length: 1, pcIncrement: 1, func: CLD_IMP } },
  CLI: { implied: { code: 0x58, length: 1, pcIncrement: 1, func: CLI_IMP } },
  CLV: { implied: { code: 0xB8, length: 1, pcIncrement: 1, func: CLV_IMP } },
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
  DEC: {
    zeroPage:   { code: 0xC6, length: 2, pcIncrement: 2, func: DEC_ZP },
    zeroPageX:  { code: 0xD6, length: 2, pcIncrement: 2, func: DEC_ZPX },
    absolute:   { code: 0xCE, length: 3, pcIncrement: 3, func: DEC_ABS },
    absoluteX:  { code: 0xDE, length: 3, pcIncrement: 3, func: DEC_ABSX }
  },
  DEX: { implied: { code: 0xCA, length: 1, pcIncrement: 1, func: DEX_IMP } },
  DEY: { implied: { code: 0x88, length: 1, pcIncrement: 1, func: DEY_IMP } },
  EOR: {
    immediate:  { code: 0x49, length: 2, pcIncrement: 2, func: EOR_IMM },
    zeroPage:   { code: 0x45, length: 2, pcIncrement: 2, func: EOR_ZP },
    zeroPageX:  { code: 0x55, length: 2, pcIncrement: 2, func: EOR_ZPX },
    absolute:   { code: 0x4D, length: 3, pcIncrement: 3, func: EOR_ABS },
    absoluteX:  { code: 0x5D, length: 3, pcIncrement: 3, func: EOR_ABX },
    absoluteY:  { code: 0x59, length: 3, pcIncrement: 3, func: EOR_ABY },
    indirectX:  { code: 0x41, length: 2, pcIncrement: 2, func: EOR_INX },
    indirectY:  { code: 0x51, length: 2, pcIncrement: 2, func: EOR_INY }
  },
  INC: {
    zeroPage:   { code: 0xE6, length: 2, pcIncrement: 2, func: INC_ZP },
    zeroPageX:  { code: 0xF6, length: 2, pcIncrement: 2, func: INC_ZPX },
    absolute:   { code: 0xEE, length: 3, pcIncrement: 3, func: INC_ABS },
    absoluteX:  { code: 0xFE, length: 3, pcIncrement: 3, func: INC_ABSX }
  },
  INX: { implied: { code: 0xE8, length: 1, pcIncrement: 1, func: INX_IMP } },
  INY: { implied: { code: 0xC8, length: 1, pcIncrement: 1, func: INY_IMP } },
  JMP: {
    absolute:   { code: 0x4C, length: 3, pcIncrement: 0, func: JMP_ABS },
    indirect:   { code: 0x6C, length: 3, pcIncrement: 0, func: JMP_IND }
  },
  JSR: { absolute: { code: 0x20, length: 3, pcIncrement: 0, func: JSR_ABS } },
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
  LSR: {
    accumulator: { code: 0x4A, length: 1, pcIncrement: 1, func: LSR_ACC },
    zeroPage:    { code: 0x46, length: 2, pcIncrement: 2, func: LSR_ZP },
    zeroPageX:   { code: 0x56, length: 2, pcIncrement: 2, func: LSR_ZPX },
    absolute:    { code: 0x4E, length: 3, pcIncrement: 3, func: LSR_ABS },
    absoluteX:   { code: 0x5E, length: 3, pcIncrement: 3, func: LSR_ABSX }
  },
  NOP: {
    implied:   { code: 0xEA, length: 1, pcIncrement: 1, func: NOP },
    // Unofficial single-byte NOPs
    implied1:  { code: 0x1A, length: 1, pcIncrement: 1, func: NOP },
    implied2:  { code: 0x3A, length: 1, pcIncrement: 1, func: NOP },
    implied3:  { code: 0x5A, length: 1, pcIncrement: 1, func: NOP },
    implied4:  { code: 0x7A, length: 1, pcIncrement: 1, func: NOP },
    implied5:  { code: 0xDA, length: 1, pcIncrement: 1, func: NOP },
    implied6:  { code: 0xFA, length: 1, pcIncrement: 1, func: NOP },
    // NOPs with operands (illegal "SKB"/"DOP" NOPs)
    imm1:      { code: 0x80, length: 2, pcIncrement: 2, func: NOP },
    imm2:      { code: 0x82, length: 2, pcIncrement: 2, func: NOP },
    imm3:      { code: 0x89, length: 2, pcIncrement: 2, func: NOP },
    imm4:      { code: 0xC2, length: 2, pcIncrement: 2, func: SKB_IMM },
    imm5:      { code: 0xE2, length: 2, pcIncrement: 2, func: NOP },
    zp1:       { code: 0x04, length: 2, pcIncrement: 2, func: NOP },
    zp2:       { code: 0x44, length: 2, pcIncrement: 2, func: NOP },
    zp3:       { code: 0x64, length: 2, pcIncrement: 2, func: NOP },
    zpx1:      { code: 0x14, length: 2, pcIncrement: 2, func: NOP },
    zpx2:      { code: 0x34, length: 2, pcIncrement: 2, func: NOP },
    zpx3:      { code: 0x54, length: 2, pcIncrement: 2, func: NOP },
    zpx4:      { code: 0x74, length: 2, pcIncrement: 2, func: NOP },
    zpx5:      { code: 0xD4, length: 2, pcIncrement: 2, func: NOP },
    zpx6:      { code: 0xF4, length: 2, pcIncrement: 2, func: NOP },
    abs1:      { code: 0x0C, length: 3, pcIncrement: 3, func: NOP },
    absx1:     { code: 0x1C, length: 3, pcIncrement: 3, func: NOP },
    absx2:     { code: 0x3C, length: 3, pcIncrement: 3, func: NOP },
    absx3:     { code: 0x5C, length: 3, pcIncrement: 3, func: NOP },
    absx4:     { code: 0x7C, length: 3, pcIncrement: 3, func: NOP },
    absx5:     { code: 0xDC, length: 3, pcIncrement: 3, func: NOP },
    absx6:     { code: 0xFC, length: 3, pcIncrement: 3, func: NOP },
    zpY:       { code: 0x92, length: 2, pcIncrement: 2, func: NOP_ZPY }
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
  PHA: { implied: { code: 0x48, length: 1, pcIncrement: 1, func: PHA_IMP } },
  PHP: { implied: { code: 0x08, length: 1, pcIncrement: 1, func: PHP_IMP } },
  PLA: { implied: { code: 0x68, length: 1, pcIncrement: 1, func: PLA_IMP } },
  PLP: { implied: { code: 0x28, length: 1, pcIncrement: 1, func: PLP_IMP } },
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
  RTI: { implied: { code: 0x40, length: 1, pcIncrement: 0, func: RTI_IMP } },
  RTS: { implied: { code: 0x60, length: 1, pcIncrement: 0, func: RTS_IMP } },
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
  SEC: { implied: { code: 0x38, length: 1, pcIncrement: 1, func: SEC_IMP } },
  SED: { implied: { code: 0xF8, length: 1, pcIncrement: 1, func: SED_IMP } },
  SEI: { implied: { code: 0x78, length: 1, pcIncrement: 1, func: SEI_IMP } },
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
  TAX: { implied: { code: 0xAA, length: 1, pcIncrement: 1, func: TAX_IMP } },
  TAY: { implied: { code: 0xA8, length: 1, pcIncrement: 1, func: TAY_IMP } },
  TSX: { implied: { code: 0xBA, length: 1, pcIncrement: 1, func: TSX_IMP } },
  TXA: { implied: { code: 0x8A, length: 1, pcIncrement: 1, func: TXA_IMP } },
  TXS: { implied: { code: 0x9A, length: 1, pcIncrement: 1, func: TXS_IMP } },
  TYA: { implied: { code: 0x98, length: 1, pcIncrement: 1, func: TYA_IMP } },

  // =================== ILLEGAL/UNOFFICIAL OPCODES =================== //
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
    zeroPage:    { code: 0x67, length: 2, pcIncrement: 2, func: RRA_ZP },
    zeroPageX:   { code: 0x77, length: 2, pcIncrement: 2, func: RRA_ZPX },
    absolute:    { code: 0x6F, length: 3, pcIncrement: 3, func: RRA_ABS },
    absoluteX:   { code: 0x7F, length: 3, pcIncrement: 3, func: RRA_ABSX },
    absoluteY:   { code: 0x7B, length: 3, pcIncrement: 3, func: RRA_ABSY },
    indirectX:   { code: 0x63, length: 2, pcIncrement: 2, func: RRA_INDX },
    indirectY:   { code: 0x73, length: 2, pcIncrement: 2, func: RRA_INDY }
  },
  ANC: {
    immediate:  { code: 0x0B, length: 2, pcIncrement: 2, func: ANC_IMM },
    immediate2: { code: 0x2B, length: 2, pcIncrement: 2, func: ANC_IMM }
  },
  ALR: { immediate: { code: 0x4B, length: 2, pcIncrement: 2, func: ALR_IMM } },
  ARR: { immediate: { code: 0x6B, length: 2, pcIncrement: 2, func: ARR_IMM } },
  AXA: {
    absoluteY:  { code: 0x9F, length: 3, pcIncrement: 3, func: AXA_ABSY },
    indirectY:  { code: 0x93, length: 2, pcIncrement: 2, func: AXA_INDY }
  },
  XAA: { immediate: { code: 0x8B, length: 2, pcIncrement: 2, func: XAA_IMM } }
};
