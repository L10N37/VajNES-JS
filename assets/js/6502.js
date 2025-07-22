const CPUregisters = {
  A: 0x00,
  X: 0x00,
  Y: 0x00,
  // initialized to 0xFF on power-up or reset?
  // https://www.nesdev.org/wiki/Stack
  S: 0xFF,
  PC: 0x0000,
  P: {
      C: false,    // Carry
      Z: false,    // Zero
      I: false,    // Interrupt Disable
      D: false,    // Decimal Mode
      B: false,    // Break Command
      U: 'NA',     // Unused ('U' Flag, technically always set to 1)
      V: false,    // Overflow
      N: false     // Negative
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
      C: false,    // Carry
      Z: false,    // Zero
      I: false,    // Interrupt Disable
      D: false,    // Decimal Mode
      B: false,    // Break Command
      U: 'NA',     // Unused ('U' Flag, technically always set to 1)
      V: false,    // Overflow
      N: false     // Negative
  };
  CPUregisters.PC = 0x0000;
}

////////////////////////// CPU Functions //////////////////////////
// http://www.6502.org/tutorials/6502opcodes.html#ADC
// https://en.wikipedia.org/wiki/MOS_Technology_6502#Registers
// https://www.masswerk.at/6502/6502_instruction_set.html
// https://www.pagetable.com/c64ref/6502/?tab=2#LDA 
// https://www.nesdev.org/obelisk-6502-guide/addressing.html

function SEI_IMP() {
  CPUregisters.P.I = true;
}

function CLD_IMP() {
  CPUregisters.P.D = false;
}

function LDA_IMM() {
  CPUregisters.A = cpuRead(CPUregisters.PC + 1);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function LDA_ZP() {
  const addr = cpuRead(CPUregisters.PC + 1);
  CPUregisters.A = cpuRead(addr);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function LDA_ZPX() {
  const addr = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  CPUregisters.A = cpuRead(addr);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function LDA_ABS() {
  const addr = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
  CPUregisters.A = cpuRead(addr);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function STA_ABSX() {
  const addr = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  cpuWrite(addr, CPUregisters.A);
}

function ADC_IMM() {
  const value = cpuRead(CPUregisters.PC + 1);
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);
  CPUregisters.P.C = sum > 255;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_IMM() {
  CPUregisters.A &= cpuRead(CPUregisters.PC + 1);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}


function LDA_ABSX() {
  const base = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
  const addr = (base + CPUregisters.X) & 0xFFFF;
  CPUregisters.A = cpuRead(addr);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function LDA_ABSY() {
  const base = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
  const addr = (base + CPUregisters.Y) & 0xFFFF;
  CPUregisters.A = cpuRead(addr);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function LDA_INDX() {
  const zpAddr = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addr = (cpuRead((zpAddr + 1) & 0xFF) << 8) | cpuRead(zpAddr);
  CPUregisters.A = cpuRead(addr);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function LDA_INDY() {
  const zpAddr = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead((zpAddr + 1) & 0xFF) << 8) | cpuRead(zpAddr);
  const addr = (base + CPUregisters.Y) & 0xFFFF;
  CPUregisters.A = cpuRead(addr);
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function STA_ZP() {
  const addr = cpuRead(CPUregisters.PC + 1);
  cpuWrite(addr, CPUregisters.A);
}

function STA_ZPX() {
  const addr = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  cpuWrite(addr, CPUregisters.A);
}

function STA_ABS() {
  const addr = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
  cpuWrite(addr, CPUregisters.A);
}

function STA_ABSY() {
  const base = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
  const addr = (base + CPUregisters.Y) & 0xFFFF;
  cpuWrite(addr, CPUregisters.A);
}

function STA_INDX() {
  const zpAddr = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const addr = (cpuRead((zpAddr + 1) & 0xFF) << 8) | cpuRead(zpAddr);
  cpuWrite(addr, CPUregisters.A);
}

function STA_INDY() {
  const zpAddr = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead((zpAddr + 1) & 0xFF) << 8) | cpuRead(zpAddr);
  const addr = (base + CPUregisters.Y) & 0xFFFF;
  cpuWrite(addr, CPUregisters.A);
}

function ADC_ZP() {
  const addr = cpuRead(CPUregisters.PC + 1);
  const value = cpuRead(addr);
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);
  CPUregisters.P.C = sum > 255;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_INX() {
  const operand = cpuRead(CPUregisters.PC + 1);
  const lowByteAddr = (operand + CPUregisters.X) & 0xFF;
  const highByteAddr = (operand + CPUregisters.X + 1) & 0xFF;
  const address = (cpuRead(highByteAddr) << 8) | cpuRead(lowByteAddr);
  const value = cpuRead(address);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_INY() {
  const operand = cpuRead(CPUregisters.PC + 1);
  const lowByteAddr = operand & 0xFF;
  const highByteAddr = (operand + 1) & 0xFF;
  const address = ((cpuRead(highByteAddr) << 8) | cpuRead(lowByteAddr)) + CPUregisters.Y;
  const value = cpuRead(address);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function CLC_IMP() { CPUregisters.P.C = false; }
function SEC_IMP() { CPUregisters.P.C = true; }
function CLI_IMP() { CPUregisters.P.I = false; }
function CLV_IMP() { CPUregisters.P.V = false; }
function SED_IMP() { CPUregisters.P.D = true; }

function INC_ZP() {
  const address = cpuRead(CPUregisters.PC + 1);
  const value = (cpuRead(address) + 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function INC_ZPX() {
  const address = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const value = (cpuRead(address) + 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function INC_ABS() {
  const address = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
  const value = (cpuRead(address) + 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function INC_ABSX() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  const value = (cpuRead(address) + 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function JMP_ABS() {
  CPUregisters.PC = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
}

function JMP_IND() {
  const pointer = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
  const lowByte = cpuRead(pointer);
  const highByte = (pointer & 0xFF) === 0xFF
    ? cpuRead(pointer & 0xFF00)
    : cpuRead(pointer + 1);
  CPUregisters.PC = (highByte << 8) | lowByte;
}

function ROL_ACC() {
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (CPUregisters.A & 0x80) !== 0;
  CPUregisters.A = ((CPUregisters.A << 1) | carryIn) & 0xFF;
  CPUregisters.P.C = carryOut;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ROL_ZP() {
  const address = cpuRead(CPUregisters.PC + 1);
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (value & 0x80) !== 0;
  const result = ((value << 1) | carryIn) & 0xFF;
  cpuWrite(address, result);
  CPUregisters.P.C = carryOut;

  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ROL_ZPX() {
  const address = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (value & 0x80) !== 0;
  const result = ((value << 1) | carryIn) & 0xFF;
  cpuWrite(address, result);
  CPUregisters.P.C = carryOut;

  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ROL_ABS() {
  const address = (cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1);
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (value & 0x80) !== 0;
  const result = ((value << 1) | carryIn) & 0xFF;
  cpuWrite(address, result);
  CPUregisters.P.C = carryOut;

  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ROL_ABSX() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const carryOut = (value & 0x80) !== 0;
  const result = ((value << 1) | carryIn) & 0xFF;
  cpuWrite(address, result);
  CPUregisters.P.C = carryOut;

  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function TXS_IMP() {
  CPUregisters.S = CPUregisters.X;
}

function LDX_IMM() {
  // Load immediate value into X register (immediate operand is next byte)
  CPUregisters.X = systemMemory[CPUregisters.PC + 1];
  
  // Set zero and negative flags
  CPUregisters.P.Z = (CPUregisters.X === 0);
  CPUregisters.P.N = (CPUregisters.X & 0x80) !== 0;
}

function LDX_ZP() {
  // Load value from zero page into X
  const address = systemMemory[CPUregisters.PC + 1];
  CPUregisters.X = cpuRead(address);
  
  // Set zero and negative flags
  CPUregisters.P.Z = (CPUregisters.X === 0);
  CPUregisters.P.N = (CPUregisters.X & 0x80) !== 0;
}

function LDX_ZPY() {
  // Load value from zero page address + Y into X
  const baseAddr = systemMemory[CPUregisters.PC + 1];
  const address = (baseAddr + CPUregisters.Y) & 0xFF; // zero page wrap
  CPUregisters.X = cpuRead(address);
  
  // Set zero and negative flags
  CPUregisters.P.Z = (CPUregisters.X === 0);
  CPUregisters.P.N = (CPUregisters.X & 0x80) !== 0;
}

function LDX_ABS() {
  // Load value from absolute address into X
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const address = (high << 8) | low;
  CPUregisters.X = cpuRead(address);
  
  // Set zero and negative flags
  CPUregisters.P.Z = (CPUregisters.X === 0);
  CPUregisters.P.N = (CPUregisters.X & 0x80) !== 0;
}

function LDX_ABSY() {
  // Load value from absolute address + Y offset into X
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseAddress = (high << 8) | low;
  const address = (baseAddress + CPUregisters.Y) & 0xFFFF;
  CPUregisters.X = cpuRead(address);
  
  // Set zero and negative flags
  CPUregisters.P.Z = (CPUregisters.X === 0);
  CPUregisters.P.N = (CPUregisters.X & 0x80) !== 0;
}

function ADC_IMM() {
  const value = cpuRead(CPUregisters.PC + 1);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = result > 0xFF;
  CPUregisters.P.Z = (result & 0xFF) === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
  CPUregisters.P.V = (~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_ZP() {
  const address = cpuRead(CPUregisters.PC + 1);
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = result > 0xFF;
  CPUregisters.P.Z = (result & 0xFF) === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
  CPUregisters.P.V = (~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_ZPX() {
  const baseAddr = cpuRead(CPUregisters.PC + 1);
  const address = (baseAddr + CPUregisters.X) & 0xFF;
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = result > 0xFF;
  CPUregisters.P.Z = (result & 0xFF) === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
  CPUregisters.P.V = (~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_ABS() {
  const low = cpuRead(CPUregisters.PC + 1);
  const high = cpuRead(CPUregisters.PC + 2);
  const address = (high << 8) | low;
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = result > 0xFF;
  CPUregisters.P.Z = (result & 0xFF) === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
  CPUregisters.P.V = (~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_ABSX() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseAddress = (high << 8) | low;
  const address = (baseAddress + CPUregisters.X) & 0xFFFF;
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = result > 0xFF;
  CPUregisters.P.Z = (result & 0xFF) === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
  CPUregisters.P.V = (~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_ABSY() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseAddress = (high << 8) | low;
  const address = (baseAddress + CPUregisters.Y) & 0xFFFF;
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = result > 0xFF;
  CPUregisters.P.Z = (result & 0xFF) === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
  CPUregisters.P.V = (~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_INDX() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const ptr = (operand + CPUregisters.X) & 0xFF;
  const low = cpuRead(ptr);
  const high = cpuRead((ptr + 1) & 0xFF);
  const address = (high << 8) | low;
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = result > 0xFF;
  CPUregisters.P.Z = (result & 0xFF) === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
  CPUregisters.P.V = (~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0;
  CPUregisters.A = result & 0xFF;
}

function ADC_INDY() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const low = cpuRead(operand & 0xFF);
  const high = cpuRead((operand + 1) & 0xFF);
  const baseAddress = (high << 8) | low;
  const address = (baseAddress + CPUregisters.Y) & 0xFFFF;
  const value = cpuRead(address);
  const carryIn = CPUregisters.P.C ? 1 : 0;
  const result = CPUregisters.A + value + carryIn;

  CPUregisters.P.C = result > 0xFF;
  CPUregisters.P.Z = (result & 0xFF) === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
  CPUregisters.P.V = (~(CPUregisters.A ^ value) & (CPUregisters.A ^ result) & 0x80) !== 0;
  CPUregisters.A = result & 0xFF;
}

function AND_IMM() {
  const value = systemMemory[CPUregisters.PC + 1];
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  const value = cpuRead(address);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ZPX() {
  const baseAddr = systemMemory[CPUregisters.PC + 1];
  const address = (baseAddr + CPUregisters.X) & 0xFF;
  const value = cpuRead(address);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ABS() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const address = (high << 8) | low;
  const value = cpuRead(address);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ABSX() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseAddress = (high << 8) | low;
  const address = (baseAddress + CPUregisters.X) & 0xFFFF;
  const value = cpuRead(address);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ABSY() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseAddress = (high << 8) | low;
  const address = (baseAddress + CPUregisters.Y) & 0xFFFF;
  const value = cpuRead(address);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_INDX() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const ptr = (operand + CPUregisters.X) & 0xFF;
  const low = cpuRead(ptr);
  const high = cpuRead((ptr + 1) & 0xFF);
  const address = (high << 8) | low;
  const value = cpuRead(address);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_INDY() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const low = cpuRead(operand & 0xFF);
  const high = cpuRead((operand + 1) & 0xFF);
  const baseAddress = (high << 8) | low;
  const address = (baseAddress + CPUregisters.Y) & 0xFFFF;
  const value = cpuRead(address);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ASL_ACC() {
  // Capture original A and perform shift
  const oldA   = CPUregisters.A & 0xFF;
  const result = (oldA << 1) & 0xFF;

  // C = old bit 7
  CPUregisters.P.C = (oldA & 0x80) >>> 7;
  // Store shifted result
  CPUregisters.A   = result;
  // Z = result == 0
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  // N = result bit 7
  CPUregisters.P.N = (result & 0x80) >>> 7;
}

function ASL_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  const value = cpuRead(address);
  const carryOut = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[address] = result;
  CPUregisters.P.C = carryOut;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ASL_ZPX() {
  const baseAddr = systemMemory[CPUregisters.PC + 1];
  const address = (baseAddr + CPUregisters.X) & 0xFF;
  const value = cpuRead(address);
  const carryOut = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[address] = result;
  CPUregisters.P.C = carryOut;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ASL_ABS() {
  // Fetch the two‑byte address
  const lo   = systemMemory[CPUregisters.PC + 1];
  const hi   = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;

  // Read, shift, and compute carry
  const oldVal = cpuRead(addr) & 0xFF;
  const result = (oldVal << 1) & 0xFF;
  const carry  = (oldVal & 0x80) >>> 7;

  // Write back and update flags as 0/1
  cpuWrite(addr, result);
  CPUregisters.P.C = carry;                    // 1 if bit 7 was set
  CPUregisters.P.Z = result === 0 ? 1 : 0;      // 1 if result==0
  CPUregisters.P.N = (result & 0x80) >>> 7;     // bit 7 of the result
}

function ASL_ABSX() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const baseAddress = (high << 8) | low;
  const address = (baseAddress + CPUregisters.X) & 0xFFFF;
  const value = cpuRead(address);
  const carryOut = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[address] = result;
  CPUregisters.P.C = carryOut;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function BIT_ZP() {
  // Zero‑page addressing
  const zpAddr = systemMemory[CPUregisters.PC + 1] & 0xFF;
  const m      = cpuRead(zpAddr) & 0xFF;
  const res    = CPUregisters.A & m;

  // Z = (A & M) == 0
  CPUregisters.P.Z = (res === 0 ? 1 : 0);
  // V = M bit 6
  CPUregisters.P.V = (m & 0x40) >>> 6;
  // N = M bit 7
  CPUregisters.P.N = (m & 0x80) >>> 7;
}

function BIT_ABS() {
  // Absolute addressing
  const lo   = systemMemory[CPUregisters.PC + 1];
  const hi   = systemMemory[CPUregisters.PC + 2];
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const m    = cpuRead(addr) & 0xFF;
  const res  = CPUregisters.A & m;

  CPUregisters.P.Z = (res === 0 ? 1 : 0);
  CPUregisters.P.V = (m & 0x40) >>> 6;
  CPUregisters.P.N = (m & 0x80) >>> 7;
}

// Logical Shift Right — Accumulator
function LSR_ACC() {
  const oldA  = CPUregisters.A & 0xFF;
  const result = (oldA >>> 1) & 0xFF;
  // C = old bit 0
  CPUregisters.P.C = oldA & 0x01;
  // store result
  CPUregisters.A   = result;
  // Z = result == 0
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  // N = always 0 after LSR
  CPUregisters.P.N = 0;
}

// LSR on zero page
function LSR_ZP() {
  const zpAddr = systemMemory[CPUregisters.PC + 1] & 0xFF;
  const oldVal = cpuRead(zpAddr) & 0xFF;
  const result = (oldVal >>> 1) & 0xFF;
  CPUregisters.P.C = oldVal & 0x01;
  cpuWrite(zpAddr, result);
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = 0;
}

// LSR on zero page, X‑indexed
function LSR_ZPX() {
  const base   = systemMemory[CPUregisters.PC + 1] & 0xFF;
  const addr   = (base + CPUregisters.X) & 0xFF;
  const oldVal = cpuRead(addr) & 0xFF;
  const result = (oldVal >>> 1) & 0xFF;
  CPUregisters.P.C = oldVal & 0x01;
  cpuWrite(addr, result);
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = 0;
}

// LSR on absolute address
function LSR_ABS() {
  const lo   = systemMemory[CPUregisters.PC + 1];
  const hi   = systemMemory[CPUregisters.PC + 2];
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const oldVal = cpuRead(addr) & 0xFF;
  const result = (oldVal >>> 1) & 0xFF;
  CPUregisters.P.C = oldVal & 0x01;
  cpuWrite(addr, result);
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = 0;
}

// LSR on absolute address with X‑offset
function LSR_ABSX() {
  const lo   = systemMemory[CPUregisters.PC + 1];
  const hi   = systemMemory[CPUregisters.PC + 2];
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + CPUregisters.X) & 0xFFFF;
  const oldVal = cpuRead(addr) & 0xFF;
  const result = (oldVal >>> 1) & 0xFF;
  CPUregisters.P.C = oldVal & 0x01;
  cpuWrite(addr, result);
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = 0;
}

function ORA_IMM() {
  // Fetch immediate operand
  const value  = systemMemory[CPUregisters.PC + 1] & 0xFF;
  // Compute result
  const result = (CPUregisters.A | value) & 0xFF;
  // Store back into A
  CPUregisters.A = result;
  // Z = result == 0?
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  // N = bit 7 of result
  CPUregisters.P.N = (result & 0x80) >>> 7;
}

function ORA_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  const value = cpuRead(address);
  CPUregisters.A |= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ZPX() {
  const address = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const value = cpuRead(address);
  CPUregisters.A |= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ABS() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const address = (high << 8) | low;
  const value = cpuRead(address);
  CPUregisters.A |= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ABSX() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const address = ((high << 8) | low) + CPUregisters.X;
  const value = cpuRead(address);
  CPUregisters.A |= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ABSY() {
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const address = ((high << 8) | low) + CPUregisters.Y;
  const value = cpuRead(address);
  CPUregisters.A |= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_INDX() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const ptr = (operand + CPUregisters.X) & 0xFF;
  const low = cpuRead(ptr);
  const high = cpuRead((ptr + 1) & 0xFF);
  const address = (high << 8) | low;
  const value = cpuRead(address);
  CPUregisters.A |= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_INDY() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const low = cpuRead(operand);
  const high = cpuRead((operand + 1) & 0xFF);
  const address = ((high << 8) | low) + CPUregisters.Y;
  const value = cpuRead(address);
  CPUregisters.A |= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function BPL_REL() {
  const offset = systemMemory[CPUregisters.PC + 1];
  CPUregisters.PC += 2; // Move PC past opcode and operand

  // Signed 8-bit offset conversion
  const signedOffset = (offset < 0x80) ? offset : offset - 0x100;

  if (!CPUregisters.P.N) {
    CPUregisters.PC += signedOffset;
  }
}

function BMI_REL() {
  const offset = systemMemory[CPUregisters.PC + 1];
  CPUregisters.PC += 2; // Advance PC past opcode and operand

  // Convert offset to signed 8-bit value
  const signedOffset = (offset < 0x80) ? offset : offset - 0x100;

  if (CPUregisters.P.N) {
    CPUregisters.PC += signedOffset;
  }
}

function BVC_REL() {
  const offset = systemMemory[CPUregisters.PC + 1];
  CPUregisters.PC += 2; // Move PC past opcode and operand

  // Convert unsigned offset to signed 8-bit integer
  const signedOffset = (offset < 0x80) ? offset : offset - 0x100;

  // Branch if Overflow flag clear (V = 0)
  if (!CPUregisters.P.V) {
    CPUregisters.PC += signedOffset;
  }
}

function BCC_REL() {
  const offset = systemMemory[CPUregisters.PC + 1];
  CPUregisters.PC += 2; // advance PC past opcode and operand

  // Convert unsigned byte to signed 8-bit integer
  const signedOffset = (offset < 0x80) ? offset : offset - 0x100;

  // Branch if carry flag clear (C = 0)
  if (!CPUregisters.P.C) {
    CPUregisters.PC += signedOffset;
  }
}

function BCS_REL() {
  const offset = systemMemory[CPUregisters.PC + 1];
  CPUregisters.PC += 2; // Move past opcode and operand

  // Convert offset to signed 8-bit
  const signedOffset = (offset < 0x80) ? offset : offset - 0x100;

  // Branch if carry flag set (C = 1)
  if (CPUregisters.P.C) {
    CPUregisters.PC += signedOffset;
  }
}

function BNE_REL() {
  const offset = systemMemory[CPUregisters.PC + 1];
  CPUregisters.PC += 2; // advance PC past opcode and operand

  // Convert to signed 8-bit
  const signedOffset = (offset < 0x80) ? offset : offset - 0x100;

  // Branch if zero flag clear (Z = 0)
  if (!CPUregisters.P.Z) {
    CPUregisters.PC += signedOffset;
  }
}

function BEQ_REL() {
  const raw   = systemMemory[CPUregisters.PC + 1];
  const off   = raw < 0x80 ? raw : raw - 0x100;
  console.log(
    `BEQ @0x${CPUregisters.PC.toString(16)} raw=${raw.toString(16)} off=${off}`
  );

  CPUregisters.PC += 2;
  if (CPUregisters.P.Z) {
    CPUregisters.PC += off;
  }
  console.log(` → PC=0x${CPUregisters.PC.toString(16)}`);
  console.log(`  Z flag = ${CPUregisters.P.Z}`);

}

function BRK_IMP() {
  // Increment PC by 2 (BRK is 1 opcode byte + 1 padding byte)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

  // Push high byte of PC onto stack
  systemMemory[0x100 + CPUregisters.S] = (CPUregisters.PC >> 8) & 0xFF;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Push low byte of PC onto stack
  systemMemory[0x100 + CPUregisters.S] = CPUregisters.PC & 0xFF;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Build status register byte with B flag set (bit 4)
  let status = 0;
  if (CPUregisters.P.N) status |= 0x80;
  if (CPUregisters.P.V) status |= 0x40;
  status |= 0x20; // unused bit, always set
  status |= 0x10; // B flag set for BRK
  if (CPUregisters.P.D) status |= 0x08;
  if (CPUregisters.P.I) status |= 0x04;
  if (CPUregisters.P.Z) status |= 0x02;
  if (CPUregisters.P.C) status |= 0x01;

  // Push status register onto stack
  systemMemory[0x100 + CPUregisters.S] = status;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Set interrupt disable flag
  CPUregisters.P.I = true;

  // Load new PC from IRQ vector at 0xFFFE/0xFFFF
  const low = systemMemory[0xFFFE];
  const high = systemMemory[0xFFFF];
  CPUregisters.PC = (high << 8) | low;
}

function CMP_IMM() {
  const operand = cpuRead(CPUregisters.PC + 1);
  const result  = (CPUregisters.A - operand) & 0xFF;

  CPUregisters.P.C = CPUregisters.A >= operand;       // Carry = no borrow
  CPUregisters.P.Z = (result === 0);                  // Zero  = equal
  CPUregisters.P.N = (result & 0x80) !== 0;            // Negative = bit7 of result

  CPUregisters.PC += 2;                               // Advance past opcode + operand
  // (Consumes 2 cycles total)
}

function CMP_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  const operand = systemMemory[address];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CMP_ZPX() {
  const address = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const operand = systemMemory[address];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CMP_ABS() {
  const address = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const operand = systemMemory[address];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CMP_ABSX() {
  const baseAddress = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const address = (baseAddress + CPUregisters.X) & 0xFFFF;
  const operand = systemMemory[address];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CMP_ABSY() {
  const baseAddress = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const address = (baseAddress + CPUregisters.Y) & 0xFFFF;
  const operand = systemMemory[address];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CMP_INDX() {
  const zpAddr = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const lowByte = systemMemory[zpAddr];
  const highByte = systemMemory[(zpAddr + 1) & 0xFF];
  const address = (highByte << 8) | lowByte;
  const operand = systemMemory[address];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CMP_INDY() {
  const zpAddr = systemMemory[CPUregisters.PC + 1];
  const lowByte = systemMemory[zpAddr];
  const highByte = systemMemory[(zpAddr + 1) & 0xFF];
  const address = ((highByte << 8) | lowByte) + CPUregisters.Y;
  const operand = systemMemory[address & 0xFFFF];
  const result = (CPUregisters.A - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CPY_IMM() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const result = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.Y >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CPY_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  const operand = systemMemory[address];
  const result = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.Y >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function CPY_ABS() {
  const address = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const operand = systemMemory[address];
  const result = (CPUregisters.Y - operand) & 0xFF;
  CPUregisters.P.C = CPUregisters.Y >= operand;
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function DEC_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  const value = (systemMemory[address] - 1) & 0xFF;
  systemMemory[address] = value;
  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function DEC_ZPX() {
  const address = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const value = (systemMemory[address] - 1) & 0xFF;
  systemMemory[address] = value;
  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function DEC_ABS() {
  const address = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const value = (systemMemory[address] - 1) & 0xFF;
  systemMemory[address] = value;
  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function DEC_ABX() {
  const address = ((systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1]) + CPUregisters.X;
  const value = (systemMemory[address] - 1) & 0xFF;
  systemMemory[address] = value;
  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function DEC_ABSX() {
  const address = (((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X) & 0xFFFF;
  let value = (cpuRead(address) - 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = (value & 0x80) !== 0;
  CPUregisters.PC += 3;
}

function EOR_IMM() {
  const value = systemMemory[CPUregisters.PC + 1];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_ZP() {
  const address = systemMemory[CPUregisters.PC + 1];
  const value = systemMemory[address];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_ZPX() {
  const address = (systemMemory[CPUregisters.PC + 1] + CPUregisters.X) & 0xFF;
  const value = systemMemory[address];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_ABS() {
  const address = (systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1];
  const value = systemMemory[address];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_ABX() {
  const address = (((systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1]) + CPUregisters.X) & 0xFFFF;
  const value = systemMemory[address];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_ABY() {
  const address = (((systemMemory[CPUregisters.PC + 2] << 8) | systemMemory[CPUregisters.PC + 1]) + CPUregisters.Y) & 0xFFFF;
  const value = systemMemory[address];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_INX() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const lowByteAddr = (operand + CPUregisters.X) & 0xFF;
  const highByteAddr = (operand + CPUregisters.X + 1) & 0xFF;
  const address = (systemMemory[highByteAddr] << 8) | systemMemory[lowByteAddr];
  const value = systemMemory[address];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_INY() {
  const operand = systemMemory[CPUregisters.PC + 1];
  const lowByteAddr = operand & 0xFF;
  const highByteAddr = (operand + 1) & 0xFF;
  const address = (((systemMemory[highByteAddr] << 8) | systemMemory[lowByteAddr]) + CPUregisters.Y) & 0xFFFF;
  const value = systemMemory[address];
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function EOR_ABSX() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  const value = cpuRead(address);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
  CPUregisters.PC += 3;
}

function EOR_ABSY() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.Y;
  const value = cpuRead(address);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
  CPUregisters.PC += 3;
}

function EOR_INDX() {
  const zpAddr = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = cpuRead(zpAddr) | (cpuRead((zpAddr + 1) & 0xFF) << 8);
  const value = cpuRead(address);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
  CPUregisters.PC += 2;
}

function EOR_INDY() {
  const zpAddr = cpuRead(CPUregisters.PC + 1);
  const address = ((cpuRead(zpAddr + 1) << 8) | cpuRead(zpAddr)) + CPUregisters.Y;
  const value = cpuRead(address);
  CPUregisters.A ^= value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
  CPUregisters.PC += 2;
}

function JSR_ABS() {
  // Fetch target address from next two bytes (little endian)
  const low = systemMemory[CPUregisters.PC + 1];
  const high = systemMemory[CPUregisters.PC + 2];
  const target = (high << 8) | low;

  // Compute return address = PC + 2 (last byte of JSR instruction)
  const returnAddress = (CPUregisters.PC + 2) & 0xFFFF;

  // 6502 stack pointer (CPUregisters.S) starts at 0xFF and goes down
  // Push return address - 1 onto stack (high byte first)
  systemMemory[0x0100 + CPUregisters.S] = (returnAddress >> 8) & 0xFF;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  systemMemory[0x0100 + CPUregisters.S] = returnAddress & 0xFF;
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // Set PC to target address (jump)
  CPUregisters.PC = target;
}

function STY_ZP() {
  const addr = cpuRead(CPUregisters.PC + 1);
  cpuWrite(addr, CPUregisters.Y);
}

function STY_ZPX() {
  const addr = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  cpuWrite(addr, CPUregisters.Y);
}

function STY_ABS() {
  const lo = cpuRead(CPUregisters.PC + 1);
  const hi = cpuRead(CPUregisters.PC + 2);
  const addr = (hi << 8) | lo;
  cpuWrite(addr, CPUregisters.Y);
}

function LDY_IMM() {
  const value = systemMemory[CPUregisters.PC + 1];
  CPUregisters.Y = value;

  CPUregisters.STATUS = (CPUregisters.STATUS & 0x7D) |
                        (value === 0 ? 0x02 : 0x00) |
                        (value & 0x80);
}

function LDY_ZP() {
  const addr = systemMemory[CPUregisters.PC + 1];
  const value = systemMemory[addr & 0xFF];
  CPUregisters.Y = value;

  CPUregisters.STATUS = (CPUregisters.STATUS & 0x7D) |
                        (value === 0 ? 0x02 : 0x00) |
                        (value & 0x80);
}

function LDY_ZPX() {
  const base = systemMemory[CPUregisters.PC + 1];
  const addr = (base + CPUregisters.X) & 0xFF;
  const value = systemMemory[addr];
  CPUregisters.Y = value;

  CPUregisters.STATUS = (CPUregisters.STATUS & 0x7D) |
                        (value === 0 ? 0x02 : 0x00) |
                        (value & 0x80);
}

function LDY_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;
  const value = systemMemory[addr];
  CPUregisters.Y = value;

  CPUregisters.STATUS = (CPUregisters.STATUS & 0x7D) |
                        (value === 0 ? 0x02 : 0x00) |
                        (value & 0x80);
}

function LDY_ABSX() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = ((hi << 8) | lo) + CPUregisters.X;
  const value = systemMemory[addr & 0xFFFF];
  CPUregisters.Y = value;

  CPUregisters.STATUS = (CPUregisters.STATUS & 0x7D) |
                        (value === 0 ? 0x02 : 0x00) |
                        (value & 0x80);
}

function SBC_IMM() {
  const value = cpuRead(CPUregisters.PC + 1) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;

  CPUregisters.PC += 2;
}

function SBC_ZP() {
  const addr = cpuRead(CPUregisters.PC + 1);
  const value = cpuRead(addr) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;

  CPUregisters.PC += 2;
}

function SBC_ZPX() {
  const addr = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const value = cpuRead(addr) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;

  CPUregisters.PC += 2;
}

function SBC_ABS() {
  const lo = cpuRead(CPUregisters.PC + 1);
  const hi = cpuRead(CPUregisters.PC + 2);
  const addr = (hi << 8) | lo;
  const value = cpuRead(addr) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;

  CPUregisters.PC += 3;
}

function SBC_ABSX() {
  const lo = cpuRead(CPUregisters.PC + 1);
  const hi = cpuRead(CPUregisters.PC + 2);
  const addr = ((hi << 8) | lo) + CPUregisters.X;
  const value = cpuRead(addr & 0xFFFF) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;

  CPUregisters.PC += 3;
}

function SBC_ABSY() {
  const lo = cpuRead(CPUregisters.PC + 1);
  const hi = cpuRead(CPUregisters.PC + 2);
  const addr = ((hi << 8) | lo) + CPUregisters.Y;
  const value = cpuRead(addr & 0xFFFF) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;

  CPUregisters.PC += 3;
}

function SBC_INDX() {
  const zpAddr = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const lo = cpuRead(zpAddr);
  const hi = cpuRead((zpAddr + 1) & 0xFF);
  const addr = (hi << 8) | lo;
  const value = cpuRead(addr) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;

  CPUregisters.PC += 2;
}

function SBC_INDY() {
  const zpAddr = cpuRead(CPUregisters.PC + 1);
  const lo = cpuRead(zpAddr);
  const hi = cpuRead((zpAddr + 1) & 0xFF);
  const addr = ((hi << 8) | lo) + CPUregisters.Y;
  const value = cpuRead(addr & 0xFFFF) ^ 0xFF;
  const sum = CPUregisters.A + value + CPUregisters.P.C;

  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) ? 1 : 0;
  CPUregisters.A = sum & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;

  CPUregisters.PC += 2;
}

// BVS - Branch on Overflow Set (relative)
function BVS_REL() {
  if ((CPUregisters.SR & 0x40) !== 0) { // Overflow flag set?
    let offset = systemMemory[CPUregisters.PC + 1];
    if (offset & 0x80) offset -= 0x100; // signed 8-bit offset
    CPUregisters.PC += offset + 2;
  } else {
    CPUregisters.PC += 2;
  }
}

// TYA - Transfer Y to A (implied)
function TYA_IMP() {
  CPUregisters.A = CPUregisters.Y;
  CPUregisters.SR = (CPUregisters.SR & 0x7D) | (CPUregisters.A === 0 ? 0x02 : 0) | (CPUregisters.A & 0x80 ? 0x80 : 0);
  CPUregisters.PC += 1;
}

// TXA - Transfer X to A (implied)
function TXA_IMP() {
  CPUregisters.A = CPUregisters.X;
  CPUregisters.SR = (CPUregisters.SR & 0x7D) | (CPUregisters.A === 0 ? 0x02 : 0) | (CPUregisters.A & 0x80 ? 0x80 : 0);
  CPUregisters.PC += 1;
}

// TSX - Transfer Stack Pointer to X (implied)
function TSX_IMP() {
  CPUregisters.X = CPUregisters.SP;
  CPUregisters.SR = (CPUregisters.SR & 0x7D) | (CPUregisters.X === 0 ? 0x02 : 0) | (CPUregisters.X & 0x80 ? 0x80 : 0);
  CPUregisters.PC += 1;
}

// PHP - Push Processor Status on stack (implied)
function PHP_IMP() {
  systemMemory[0x100 + CPUregisters.SP] = CPUregisters.SR | 0x10; // set break flag in pushed status
  CPUregisters.SP = (CPUregisters.SP - 1) & 0xFF;
  CPUregisters.PC += 1;
}

// PLP - Pull Processor Status from stack (implied)
function PLP_IMP() {
  CPUregisters.SP = (CPUregisters.SP + 1) & 0xFF;
  CPUregisters.SR = systemMemory[0x100 + CPUregisters.SP] & 0xEF; // clear break flag on pull
  CPUregisters.PC += 1;
}

// PHA - Push Accumulator (implied)
function PHA_IMP() {
  systemMemory[0x100 + CPUregisters.SP] = CPUregisters.A;
  CPUregisters.SP = (CPUregisters.SP - 1) & 0xFF;
  CPUregisters.PC += 1;
}

// PLA - Pull Accumulator (implied)
function PLA_IMP() {
  CPUregisters.SP = (CPUregisters.SP + 1) & 0xFF;
  CPUregisters.A = systemMemory[0x100 + CPUregisters.SP];
  CPUregisters.SR = (CPUregisters.SR & 0x7D) | (CPUregisters.A === 0 ? 0x02 : 0) | (CPUregisters.A & 0x80 ? 0x80 : 0);
  CPUregisters.PC += 1;
}

// RTI - Return from Interrupt (implied)
function RTI_IMP() {
  CPUregisters.SP = (CPUregisters.SP + 1) & 0xFF;
  CPUregisters.SR = systemMemory[0x100 + CPUregisters.SP] & 0xEF; // clear break flag

  CPUregisters.SP = (CPUregisters.SP + 1) & 0xFF;
  let pcl = systemMemory[0x100 + CPUregisters.SP];

  CPUregisters.SP = (CPUregisters.SP + 1) & 0xFF;
  let pch = systemMemory[0x100 + CPUregisters.SP];

  CPUregisters.PC = (pch << 8) | pcl;
}

// RTS - Return from Subroutine (implied)
function RTS_IMP() {
  CPUregisters.SP = (CPUregisters.SP + 1) & 0xFF;
  let pcl = systemMemory[0x100 + CPUregisters.SP];

  CPUregisters.SP = (CPUregisters.SP + 1) & 0xFF;
  let pch = systemMemory[0x100 + CPUregisters.SP];

  CPUregisters.PC = ((pch << 8) | pcl) + 1;
}

function NOP_ZPY() {
  // dummy read from (ZP + Y) but do nothing else
  const zp = cpuRead(CPUregisters.PC + 1);
  cpuRead((zp + CPUregisters.Y) & 0xFF);
}

function NOP_ZPY() {}
function NOP_IMP() {}
function NOP_IMM() {}
function NOP_ZP() {}
function NOP_ABS() {}
function NOP_ZPX() {}
function NOP_ABSX() {}
function NOP_IMP() {}
function NOP_IMM1() {}
function NOP_IMM2() {}
function NOP_IMM3() {}
function NOP_IMM4() {}
function NOP_IMM5() {}
function NOP_IMM6() {}
function NOP_IMM_2B() {}
function NOP_ZP1() {}
function NOP_ZP2() {}
function NOP_ZP3() {}
function NOP_ZPX1() {}
function NOP_ZPX2() {}
function NOP_ZPX3() {}
function NOP_ZPX4() {}
function NOP_ZPX5() {}
function NOP_ZPX6() {}
function NOP_ABS1() {}
function NOP_ABSX1() {}
function NOP_ABSX2() {}
function NOP_ABSX3() {}
function NOP_ABSX4() {}
function NOP_ABSX5() {}
function NOP_ABSX6() {}

function CPX_IMM() {
  const value = cpuRead(CPUregisters.PC + 1);
  const result = (CPUregisters.X - value) & 0xFF;

  CPUregisters.P.C = CPUregisters.X >= value ? 1 : 0;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) !== 0 ? 1 : 0;
}

function CPX_ZP() {
  const addr = cpuRead(CPUregisters.PC + 1);
  const value = cpuRead(addr);
  const result = (CPUregisters.X - value) & 0xFF;

  CPUregisters.P.C = CPUregisters.X >= value ? 1 : 0;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) !== 0 ? 1 : 0;
}

function CPX_ABS() {
  const lo = cpuRead(CPUregisters.PC + 1);
  const hi = cpuRead(CPUregisters.PC + 2);
  const addr = (hi << 8) | lo;
  const value = cpuRead(addr);
  const result = (CPUregisters.X - value) & 0xFF;

  CPUregisters.P.C = CPUregisters.X >= value ? 1 : 0;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) !== 0 ? 1 : 0;
}

function DEX_IMP() {
  CPUregisters.X = (CPUregisters.X - 1) & 0xFF;
  CPUregisters.P.Z = CPUregisters.X === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) !== 0 ? 1 : 0;
}

function DEY_IMP() {
  CPUregisters.Y = (CPUregisters.Y - 1) & 0xFF;
  CPUregisters.P.Z = CPUregisters.Y === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.Y & 0x80) !== 0 ? 1 : 0;
}

function INX_IMP() {
  CPUregisters.X = (CPUregisters.X + 1) & 0xFF;
  CPUregisters.P.Z = CPUregisters.X === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) !== 0 ? 1 : 0;
}

function INY_IMP() {
  CPUregisters.Y = (CPUregisters.Y + 1) & 0xFF;
  CPUregisters.P.Z = CPUregisters.Y === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.Y & 0x80) !== 0 ? 1 : 0;
}

function ROR_ACC() {
  const carryIn = CPUregisters.P.C;
  CPUregisters.P.C = CPUregisters.A & 0x01;
  CPUregisters.A = (CPUregisters.A >> 1) | (carryIn << 7);
  CPUregisters.A &= 0xFF;

  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0 ? 1 : 0;
}

function ROR_ZP() {
  const addr = cpuRead(CPUregisters.PC + 1);
  const value = cpuRead(addr);
  const carryIn = CPUregisters.P.C;
  const carryOut = value & 0x01;

  const result = ((value >> 1) | (carryIn << 7)) & 0xFF;
  cpuWrite(addr, result);

  CPUregisters.P.C = carryOut;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) !== 0 ? 1 : 0;
}

function ROR_ZPX() {
  const base = cpuRead(CPUregisters.PC + 1);
  const addr = (base + CPUregisters.X) & 0xFF;
  const value = cpuRead(addr);
  const carryIn = CPUregisters.P.C;
  const carryOut = value & 0x01;

  const result = ((value >> 1) | (carryIn << 7)) & 0xFF;
  cpuWrite(addr, result);

  CPUregisters.P.C = carryOut;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) !== 0 ? 1 : 0;
}

function ROR_ABS() {
  const lo = cpuRead(CPUregisters.PC + 1);
  const hi = cpuRead(CPUregisters.PC + 2);
  const addr = (hi << 8) | lo;
  const value = cpuRead(addr);
  const carryIn = CPUregisters.P.C;
  const carryOut = value & 0x01;

  const result = ((value >> 1) | (carryIn << 7)) & 0xFF;
  cpuWrite(addr, result);

  CPUregisters.P.C = carryOut;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) !== 0 ? 1 : 0;
}

function ROR_ABSX() {
  const lo = cpuRead(CPUregisters.PC + 1);
  const hi = cpuRead(CPUregisters.PC + 2);
  const baseAddr = (hi << 8) | lo;
  const addr = (baseAddr + CPUregisters.X) & 0xFFFF;
  const value = cpuRead(addr);
  const carryIn = CPUregisters.P.C;
  const carryOut = value & 0x01;

  const result = ((value >> 1) | (carryIn << 7)) & 0xFF;
  cpuWrite(addr, result);

  CPUregisters.P.C = carryOut;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) !== 0 ? 1 : 0;
}
function TAX_IMP() {
  CPUregisters.X = CPUregisters.A;
  CPUregisters.P.Z = CPUregisters.X === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) !== 0 ? 1 : 0;
}

function TAY_IMP() {
  CPUregisters.Y = CPUregisters.A;
  CPUregisters.P.Z = CPUregisters.Y === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.Y & 0x80) !== 0 ? 1 : 0;
}

function STX_ZP() {
  const addr = cpuRead(CPUregisters.PC + 1);
  cpuWrite(addr, CPUregisters.X);
}

function STX_ZPY() {
  const base = cpuRead(CPUregisters.PC + 1);
  const addr = (base + CPUregisters.Y) & 0xFF; // zero page wrap
  cpuWrite(addr, CPUregisters.X);
}

function STX_ABS() {
  const lo = cpuRead(CPUregisters.PC + 1);
  const hi = cpuRead(CPUregisters.PC + 2);
  const addr = (hi << 8) | lo;
  cpuWrite(addr, CPUregisters.X);
}

  //          ................. illegalOpcode functions ................. 

  function LAX_ZP() {
  const addr = systemMemory[CPUregisters.PC + 1];
  const value = cpuRead(addr);
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = ((value & 0x80) !== 0);
  CPUregisters.PC += 2;
}

function LAX_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;
  const value = cpuRead(addr);
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = (value === 0);
  CPUregisters.P.N = ((value & 0x80) !== 0);
  CPUregisters.PC += 3;
}

function LAX_ZPY() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.Y) & 0xFF;
  const value = cpuRead(pointer);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = value === 0;
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function LAX_ABSY() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.Y;
  const value = cpuRead(address);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = value === 0;
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function LAX_INDX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  const value = cpuRead(address);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = value === 0;
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function LAX_INDY() {
  const pointer = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  const address = base + CPUregisters.Y;
  const value = cpuRead(address);
  CPUregisters.A = value;
  CPUregisters.X = value;

  CPUregisters.P.Z = value === 0;
  CPUregisters.P.N = (value & 0x80) !== 0;
}

function SAX_ZP() {
  const addr = systemMemory[CPUregisters.PC + 1];
  cpuWrite(addr, CPUregisters.A & CPUregisters.X);
  CPUregisters.PC += 2;
}

function SAX_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;
  cpuWrite(addr, CPUregisters.A & CPUregisters.X);
  CPUregisters.PC += 3;
}

function SAX_INDX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  const value = CPUregisters.A & CPUregisters.X;
  cpuWrite(address, value);
}

function SAX_ZPY() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.Y) & 0xFF;
  const value = CPUregisters.A & CPUregisters.X;
  cpuWrite(pointer, value);
}

function DCP_ZP() {
  const addr = systemMemory[CPUregisters.PC + 1];
  let value = (cpuRead(addr) - 1) & 0xFF;
  cpuWrite(addr, value);

  const result = CPUregisters.A - value;
  CPUregisters.P.C= (CPUregisters.A >= value);
  CPUregisters.P.Z= ((result & 0xFF) === 0);
  CPUregisters.P.N= ((result & 0x80) !== 0);
}

function DCP_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;

  let value = (cpuRead(addr) - 1) & 0xFF;
  cpuWrite(addr, value);

  const result = CPUregisters.A - value;
  CPUregisters.P.C= (CPUregisters.A >= value);
  CPUregisters.P.Z= ((result & 0xFF) === 0);
  CPUregisters.P.N= ((result & 0x80) !== 0);
}

function DCP_ZPX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = pointer;
  let value = (cpuRead(address) - 1) & 0xFF;
  cpuWrite(address, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= value;
  CPUregisters.P.Z = result === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function DCP_ABSX() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = (cpuRead(address) - 1) & 0xFF;
  cpuWrite(address, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= value;
  CPUregisters.P.Z = result === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function DCP_ABSY() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = (cpuRead(address) - 1) & 0xFF;
  cpuWrite(address, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= value;
  CPUregisters.P.Z = result === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function DCP_INDX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  let value = (cpuRead(address) - 1) & 0xFF;
  cpuWrite(address, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= value;
  CPUregisters.P.Z = result === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function DCP_INDY() {
  const pointer = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  const address = base + CPUregisters.Y;
  let value = (cpuRead(address) - 1) & 0xFF;
  cpuWrite(address, value);

  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = CPUregisters.A >= value;
  CPUregisters.P.Z = result === 0;
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ISC_ZP() {
  const addr = systemMemory[CPUregisters.PC + 1];
  let value = (cpuRead(addr) + 1) & 0xFF;
  cpuWrite(addr, value);

  const temp = CPUregisters.A - value - (1 - getFlagC());
  CPUregisters.P.C= (temp >= 0);
  CPUregisters.A = temp & 0xFF;
  CPUregisters.P.Z= (CPUregisters.A === 0);
  CPUregisters.P.N= ((CPUregisters.A & 0x80) !== 0);

  CPUregisters.PC += 2;
}

function ISC_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;

  let value = (cpuRead(addr) + 1) & 0xFF;
  cpuWrite(addr, value);

  const temp = CPUregisters.A - value - (1 - getFlagC());
  CPUregisters.P.C = (temp >= 0);
  CPUregisters.A = temp & 0xFF;
  CPUregisters.P.Z= (CPUregisters.A === 0);
  CPUregisters.P.N =((CPUregisters.A & 0x80) !== 0);

  CPUregisters.PC += 3;
}

function ISC_ZPX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let value = (cpuRead(pointer) + 1) & 0xFF;
  cpuWrite(pointer, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = CPUregisters.A < 0x100;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ISC_ABSX() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = (cpuRead(address) + 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = CPUregisters.A < 0x100;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ISC_ABSY() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = (cpuRead(address) + 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = CPUregisters.A < 0x100;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ISC_INDX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  let value = (cpuRead(address) + 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = CPUregisters.A < 0x100;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ISC_INDY() {
  const pointer = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  const address = base + CPUregisters.Y;
  let value = (cpuRead(address) + 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.A = (CPUregisters.A - value - (CPUregisters.P.C ? 0 : 1)) & 0xFF;

  CPUregisters.P.C = CPUregisters.A < 0x100;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SLO_ZP() {
  const addr = systemMemory[CPUregisters.PC + 1];
  let value = cpuRead(addr);
  CPUregisters.P.C = ((value & 0x80) !== 0);
  value = (value << 1) & 0xFF;
  cpuWrite(addr, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0);
  CPUregisters.PC += 2;
}

function SLO_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;
  let value = cpuRead(addr);
  CPUregisters.P.C = ((value & 0x80) !== 0);
  value = (value << 1) & 0xFF;
  cpuWrite(addr, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0);
  CPUregisters.PC += 3;
}

function SLO_ABSX() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = cpuRead(address);
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = (value << 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SLO_ABSY() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = cpuRead(address);
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = (value << 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SLO_INDX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  let value = cpuRead(address);
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = (value << 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SLO_INDY() {
  const pointer = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  const address = base + CPUregisters.Y;
  let value = cpuRead(address);
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = (value << 1) & 0xFF;
  cpuWrite(address, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SLO_ZPX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let value = cpuRead(pointer);
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = (value << 1) & 0xFF;
  cpuWrite(pointer, value);

  CPUregisters.A |= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function RLA_ZP() {
  const addr = systemMemory[CPUregisters.PC + 1];
  let value = cpuRead(addr);
  const carry = getFlagC() ? 1 : 0;
  CPUregisters.P.C = ((value & 0x80) !== 0);
  value = ((value << 1) | carry) & 0xFF;
  cpuWrite(addr, value);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0);
  CPUregisters.PC += 2;
}

function RLA_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;
  let value = cpuRead(addr);
  const carry = getFlagC() ? 1 : 0;
  CPUregisters.P.C = ((value & 0x80) !== 0);
  value = ((value << 1) | carry) & 0xFF;
  cpuWrite(addr, value);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0);
  CPUregisters.PC += 3;
}

function RLA_ABSX() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = cpuRead(address);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  cpuWrite(address, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function RLA_ABSY() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = cpuRead(address);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  cpuWrite(address, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function RLA_INDX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  let value = cpuRead(address);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  cpuWrite(address, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function RLA_INDY() {
  const pointer = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  const address = base + CPUregisters.Y;
  let value = cpuRead(address);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  cpuWrite(address, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function RLA_ZPX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let value = cpuRead(pointer);
  const oldCarry = CPUregisters.P.C ? 1 : 0;
  CPUregisters.P.C = (value & 0x80) !== 0;
  value = ((value << 1) & 0xFF) | oldCarry;
  cpuWrite(pointer, value);

  CPUregisters.A &= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SRE_ZP() {
  const addr = systemMemory[CPUregisters.PC + 1];
  let value = cpuRead(addr);
  CPUregisters.P.C = ((value & 0x01) !== 0);
  value = (value >> 1) & 0xFF;
  cpuWrite(addr, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0);
  CPUregisters.PC += 2;
}

function SRE_ABS() {
  const lo = systemMemory[CPUregisters.PC + 1];
  const hi = systemMemory[CPUregisters.PC + 2];
  const addr = (hi << 8) | lo;
  let value = cpuRead(addr);
  CPUregisters.P.C = ((value & 0x01) !== 0);
  value = (value >> 1) & 0xFF;
  cpuWrite(addr, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0);
  CPUregisters.PC += 3;
}

function SRE_ABSX() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.X;
  let value = cpuRead(address);
  CPUregisters.P.C = value & 0x01;
  value >>= 1;
  cpuWrite(address, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SRE_ABSY() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.Y;
  let value = cpuRead(address);
  CPUregisters.P.C = value & 0x01;
  value >>= 1;
  cpuWrite(address, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SRE_INDX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  const address = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  let value = cpuRead(address);
  CPUregisters.P.C = value & 0x01;
  value >>= 1;
  cpuWrite(address, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SRE_INDY() {
  const pointer = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead((pointer + 1) & 0xFF) << 8) | cpuRead(pointer);
  const address = base + CPUregisters.Y;
  let value = cpuRead(address);
  CPUregisters.P.C = value & 0x01;
  value >>= 1;
  cpuWrite(address, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function SRE_ZPX() {
  const pointer = (cpuRead(CPUregisters.PC + 1) + CPUregisters.X) & 0xFF;
  let value = cpuRead(pointer);
  CPUregisters.P.C = value & 0x01;
  value >>= 1;
  cpuWrite(pointer, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ANC_IMM() {
  const value = systemMemory[CPUregisters.PC + 1];
  CPUregisters.A &= value;
  CPUregisters.P.C = ((CPUregisters.A & 0x80) !== 0);
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0);
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
  const value = cpuRead(CPUregisters.PC + 1);
  CPUregisters.A &= value;
  CPUregisters.A >>= 1;
  CPUregisters.P.C = (CPUregisters.A & 0x40) !== 0;
  CPUregisters.P.Z = CPUregisters.A === 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
  CPUregisters.P.V = ((CPUregisters.A >> 5) & 1) ^ ((CPUregisters.A >> 6) & 1);
}

function XAA_IMM() {
  const value = cpuRead(CPUregisters.PC + 1);
  CPUregisters.A = CPUregisters.X & value;

  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;

  CPUregisters.PC += 2;
}

function AXA_ABSY() {
  const address = ((cpuRead(CPUregisters.PC + 2) << 8) | cpuRead(CPUregisters.PC + 1)) + CPUregisters.Y;
  const value = CPUregisters.A & CPUregisters.X;
  cpuWrite(address, value & (address >> 8) + 1);
}

function AXA_INDY() {
  const pointer = cpuRead(CPUregisters.PC + 1);
  const base = (cpuRead(pointer + 1) << 8) | cpuRead(pointer);
  const address = base + CPUregisters.Y;
  const value = CPUregisters.A & CPUregisters.X;
  cpuWrite(address, value & (address >> 8) + 1);
}

//////////////////////// 6502 CPU opcode object ////////////////////////
// TO DO: Add cycles, work out boundary cross stuff
const opcodes = {
  STA: {
    zeroPage: { code: 0x85, length: 2, pcIncrement: 2, func: STA_ZP },
    zeroPageX: { code: 0x95, length: 2, pcIncrement: 2, func: STA_ZPX },
    absolute: { code: 0x8D, length: 3, pcIncrement: 3, func: STA_ABS },
    absoluteX: { code: 0x9D, length: 3, pcIncrement: 3, func: STA_ABSX },
    absoluteY: { code: 0x99, length: 3, pcIncrement: 3, func: STA_ABSY },
    indirectX: { code: 0x81, length: 2, pcIncrement: 2, func: STA_INDX },
    indirectY: { code: 0x91, length: 2, pcIncrement: 2, func: STA_INDY }
  },
  LDA: {
    immediate: { code: 0xA9, length: 2, pcIncrement: 2, func: LDA_IMM },
    zeroPage: { code: 0xA5, length: 2, pcIncrement: 2, func: LDA_ZP },
    zeroPageX: { code: 0xB5, length: 2, pcIncrement: 2, func: LDA_ZPX },
    absolute: { code: 0xAD, length: 3, pcIncrement: 3, func: LDA_ABS },
    absoluteX: { code: 0xBD, length: 3, pcIncrement: 3, func: LDA_ABSX },
    absoluteY: { code: 0xB9, length: 3, pcIncrement: 3, func: LDA_ABSY },
    indirectX: { code: 0xA1, length: 2, pcIncrement: 2, func: LDA_INDX },
    indirectY: { code: 0xB1, length: 2, pcIncrement: 2, func: LDA_INDY }
  },
  LDX: {
    immediate: { code: 0xA2, length: 2, pcIncrement: 2, func: LDX_IMM },
    zeroPage: { code: 0xA6, length: 2, pcIncrement: 2, func: LDX_ZP },
    zeroPageY: { code: 0xB6, length: 2, pcIncrement: 2, func: LDX_ZPY },
    absolute: { code: 0xAE, length: 3, pcIncrement: 3, func: LDX_ABS },
    absoluteY: { code: 0xBE, length: 3, pcIncrement: 3, func: LDX_ABSY }
  },
  ADC: {
    immediate: { code: 0x69, length: 2, pcIncrement: 2, func: ADC_IMM },
    zeroPage: { code: 0x65, length: 2, pcIncrement: 2, func: ADC_ZP },
    zeroPageX: { code: 0x75, length: 2, pcIncrement: 2, func: ADC_ZPX },
    absolute: { code: 0x6D, length: 3, pcIncrement: 3, func: ADC_ABS },
    absoluteX: { code: 0x7D, length: 3, pcIncrement: 3, func: ADC_ABSX },
    absoluteY: { code: 0x79, length: 3, pcIncrement: 3, func: ADC_ABSY },
    indirectX: { code: 0x61, length: 2, pcIncrement: 2, func: ADC_INDX },
    indirectY: { code: 0x71, length: 2, pcIncrement: 2, func: ADC_INDY }
  },
  AND: {
    immediate: { code: 0x29, length: 2, pcIncrement: 2, func: AND_IMM },
    zeroPage: { code: 0x25, length: 2, pcIncrement: 2, func: AND_ZP },
    zeroPageX: { code: 0x35, length: 2, pcIncrement: 2, func: AND_ZPX },
    absolute: { code: 0x2D, length: 3, pcIncrement: 3, func: AND_ABS },
    absoluteX: { code: 0x3D, length: 3, pcIncrement: 3, func: AND_ABSX },
    absoluteY: { code: 0x39, length: 3, pcIncrement: 3, func: AND_ABSY },
    indirectX: { code: 0x21, length: 2, pcIncrement: 2, func: AND_INDX },
    indirectY: { code: 0x31, length: 2, pcIncrement: 2, func: AND_INDY }
  },
  ASL: {
    accumulator: { code: 0x0A, length: 1, pcIncrement: 1, func: ASL_ACC },
    zeroPage: { code: 0x06, length: 2, pcIncrement: 2, func: ASL_ZP },
    zeroPageX: { code: 0x16, length: 2, pcIncrement: 2, func: ASL_ZPX },
    absolute: { code: 0x0E, length: 3, pcIncrement: 3, func: ASL_ABS },
    absoluteX: { code: 0x1E, length: 3, pcIncrement: 3, func: ASL_ABSX }
  },
  BIT: {
    zeroPage: { code: 0x24, length: 2, pcIncrement: 2, func: BIT_ZP },
    absolute: { code: 0x2C, length: 3, pcIncrement: 3, func: BIT_ABS }
  },
  LSR: {
    accumulator: { code: 0x4A, length: 1, pcIncrement: 1, func: LSR_ACC },
    zeroPage: { code: 0x46, length: 2, pcIncrement: 2, func: LSR_ZP },
    zeroPageX: { code: 0x56, length: 2, pcIncrement: 2, func: LSR_ZPX },
    absolute: { code: 0x4E, length: 3, pcIncrement: 3, func: LSR_ABS },
    absoluteX: { code: 0x5E, length: 3, pcIncrement: 3, func: LSR_ABSX }
  },
  ORA: {
    immediate: { code: 0x09, length: 2, pcIncrement: 2, func: ORA_IMM },
    zeroPage: { code: 0x05, length: 2, pcIncrement: 2, func: ORA_ZP },
    zeroPageX: { code: 0x15, length: 2, pcIncrement: 2, func: ORA_ZPX },
    absolute: { code: 0x0D, length: 3, pcIncrement: 3, func: ORA_ABS },
    absoluteX: { code: 0x1D, length: 3, pcIncrement: 3, func: ORA_ABSX },
    absoluteY: { code: 0x19, length: 3, pcIncrement: 3, func: ORA_ABSY },
    indirectX: { code: 0x01, length: 2, pcIncrement: 2, func: ORA_INDX },
    indirectY: { code: 0x11, length: 2, pcIncrement: 2, func: ORA_INDY }
  },
  BPL: {
    relative: { code: 0x10, length: 2, pcIncrement: 2, func: BPL_REL }
  },
  BMI: {
    relative: { code: 0x30, length: 2, pcIncrement: 2, func: BMI_REL }
  },
  BVC: {
    relative: { code: 0x50, length: 2, pcIncrement: 2, func: BVC_REL }
  },
  BCC: {
    relative: { code: 0x90, length: 2, pcIncrement: 2, func: BCC_REL }
  },
  BCS: {
    relative: { code: 0xB0, length: 2, pcIncrement: 2, func: BCS_REL }
  },
  BNE: {
    relative: { code: 0xD0, length: 2, pcIncrement: 2, func: BNE_REL }
  },
  BEQ: {
    relative: { code: 0xF0, length: 2, pcIncrement: 2, func: BEQ_REL }
  },
  BRK: {
    implied: { code: 0x00, length: 1, pcIncrement: 1, func: BRK_IMP }
  },
  TXS: {
    implied: { code: 0x9A, length: 1, pcIncrement: 1, func: TXS_IMP }
  },
  CMP: {
    immediate: { code: 0xC9, length: 2, pcIncrement: 2, func: CMP_IMM },
    zeroPage: { code: 0xC5, length: 2, pcIncrement: 2, func: CMP_ZP },
    zeroPageX: { code: 0xD5, length: 2, pcIncrement: 2, func: CMP_ZPX },
    absolute: { code: 0xCD, length: 3, pcIncrement: 3, func: CMP_ABS },
    absoluteX: { code: 0xDD, length: 3, pcIncrement: 3, func: CMP_ABSX },
    absoluteY: { code: 0xD9, length: 3, pcIncrement: 3, func: CMP_ABSY },
    indirectX: { code: 0xC1, length: 2, pcIncrement: 2, func: CMP_INDX },
    indirectY: { code: 0xD1, length: 2, pcIncrement: 2, func: CMP_INDY }
  },
  CPY: {
    immediate: { code: 0xC0, length: 2, pcIncrement: 2, func: CPY_IMM },
    zeroPage: { code: 0xC4, length: 2, pcIncrement: 2, func: CPY_ZP },
    absolute: { code: 0xCC, length: 3, pcIncrement: 3, func: CPY_ABS }
  },
  DEC: {
    zeroPage: { code: 0xC6, length: 2, pcIncrement: 2, func: DEC_ZP },
    zeroPageX: { code: 0xD6, length: 2, pcIncrement: 2, func: DEC_ZPX },
    absolute: { code: 0xCE, length: 3, pcIncrement: 3, func: DEC_ABS },
    absoluteX: { code: 0xDE, length: 3, pcIncrement: 3, func: DEC_ABSX }
  },
  EOR: {
    immediate: { code: 0x49, length: 2, pcIncrement: 2, func: EOR_IMM },
    zeroPage: { code: 0x45, length: 2, pcIncrement: 2, func: EOR_ZP },
    zeroPageX: { code: 0x55, length: 2, pcIncrement: 2, func: EOR_ZPX },
    absolute: { code: 0x4D, length: 3, pcIncrement: 3, func: EOR_ABS },
    absoluteX: { code: 0x5D, length: 3, pcIncrement: 3, func: EOR_ABSX },
    absoluteY: { code: 0x59, length: 3, pcIncrement: 3, func: EOR_ABSY },
    indirectX: { code: 0x41, length: 2, pcIncrement: 2, func: EOR_INDX },
    indirectY: { code: 0x51, length: 2, pcIncrement: 2, func: EOR_INDY }
  },
  CLC: {
    implied: { code: 0x18, length: 1, pcIncrement: 1, func: CLC_IMP }
  },
  SEC: {
    implied: { code: 0x38, length: 1, pcIncrement: 1, func: SEC_IMP }
  },
  CLI: {
    implied: { code: 0x58, length: 1, pcIncrement: 1, func: CLI_IMP }
  },
  SEI: {
    implied: { code: 0x78, length: 1, pcIncrement: 1, func: SEI_IMP }
  },
  CLV: {
    implied: { code: 0xB8, length: 1, pcIncrement: 1, func: CLV_IMP }
  },
  CLD: {
    implied: { code: 0xD8, length: 1, pcIncrement: 1, func: CLD_IMP }
  },
  SED: {
    implied: { code: 0xF8, length: 1, pcIncrement: 1, func: SED_IMP }
  },
  INC: {
    zeroPage: { code: 0xE6, length: 2, pcIncrement: 2, func: INC_ZP },
    zeroPageX: { code: 0xF6, length: 2, pcIncrement: 2, func: INC_ZPX },
    absolute: { code: 0xEE, length: 3, pcIncrement: 3, func: INC_ABS },
    absoluteX: { code: 0xFE, length: 3, pcIncrement: 3, func: INC_ABSX }
  },
  JMP: {
    absolute: { code: 0x4C, length: 3, pcIncrement: 3, func: JMP_ABS },
    indirect: { code: 0x6C, length: 3, pcIncrement: 3, func: JMP_IND }
  },
  ROL: {
    accumulator: { code: 0x2A, length: 1, pcIncrement: 1, func: ROL_ACC },
    zeroPage: { code: 0x26, length: 2, pcIncrement: 2, func: ROL_ZP },
    zeroPageX: { code: 0x36, length: 2, pcIncrement: 2, func: ROL_ZPX },
    absolute: { code: 0x2E, length: 3, pcIncrement: 3, func: ROL_ABS },
    absoluteX: { code: 0x3E, length: 3, pcIncrement: 3, func: ROL_ABSX }
  },
  JSR: {
    absolute: { code: 0x20, length: 3, pcIncrement: 3, func: JSR_ABS }
  },
  STY: {
    zeroPage:  { code: 0x84, length: 2, pcIncrement: 2, func: STY_ZP },
    zeroPageX: { code: 0x94, length: 2, pcIncrement: 2, func: STY_ZPX },
    absolute:  { code: 0x8C, length: 3, pcIncrement: 3, func: STY_ABS }
  },
  LDY: {
    immediate: { code: 0xA0, length: 2, pcIncrement: 2, func: LDY_IMM },
    zeroPage: { code: 0xA4, length: 2, pcIncrement: 2, func: LDY_ZP },
    zeroPageX: { code: 0xB4, length: 2, pcIncrement: 2, func: LDY_ZPX },
    absolute: { code: 0xAC, length: 3, pcIncrement: 3, func: LDY_ABS },
    absoluteX: { code: 0xBC, length: 3, pcIncrement: 3, func: LDY_ABSX }
  },
  BVS: {
    relative: { code: 0x70, length: 2, pcIncrement: 2, func: BVS_REL }
  },
  NOP: {
  implied: { code: 0xEA, length: 1, pcIncrement: 1, func: NOP_IMP }, // Official
  // Unofficial 1-byte NOPs
  implied1: { code: 0x1A, length: 1, pcIncrement: 1, func: NOP_IMM },
  implied2: { code: 0x3A, length: 1, pcIncrement: 1, func: NOP_IMM },
  implied3: { code: 0x5A, length: 1, pcIncrement: 1, func: NOP_IMM },
  implied4: { code: 0x7A, length: 1, pcIncrement: 1, func: NOP_IMM },
  implied5: { code: 0xDA, length: 1, pcIncrement: 1, func: NOP_IMM },
  implied6: { code: 0xFA, length: 1, pcIncrement: 1, func: NOP_IMM },
  // NOP immediate (actually ignores the next byte)
  imm1: { code: 0x80, length: 2, pcIncrement: 2, func: NOP_IMM },
  imm2: { code: 0x82, length: 2, pcIncrement: 2, func: NOP_IMM },
  // Zero Page NOPs
  zp1: { code: 0x04, length: 2, pcIncrement: 2, func: NOP_ZP },
  zp2: { code: 0x44, length: 2, pcIncrement: 2, func: NOP_ZP },
  zp3: { code: 0x64, length: 2, pcIncrement: 2, func: NOP_ZP },
  // Zero Page,X NOPs
  zpx1: { code: 0x14, length: 2, pcIncrement: 2, func: NOP_ZPX },
  zpx2: { code: 0x34, length: 2, pcIncrement: 2, func: NOP_ZPX },
  zpx3: { code: 0x54, length: 2, pcIncrement: 2, func: NOP_ZPX },
  zpx4: { code: 0x74, length: 2, pcIncrement: 2, func: NOP_ZPX },
  zpx5: { code: 0xD4, length: 2, pcIncrement: 2, func: NOP_ZPX },
  zpx6: { code: 0xF4, length: 2, pcIncrement: 2, func: NOP_ZPX },
  // Absolute NOP
  abs1: { code: 0x0C, length: 3, pcIncrement: 3, func: NOP_ABS },
  // Absolute,X NOPs
  absx1: { code: 0x1C, length: 3, pcIncrement: 3, func: NOP_ABSX },
  absx2: { code: 0x3C, length: 3, pcIncrement: 3, func: NOP_ABSX },
  absx3: { code: 0x5C, length: 3, pcIncrement: 3, func: NOP_ABSX },
  absx4: { code: 0x7C, length: 3, pcIncrement: 3, func: NOP_ABSX },
  absx5: { code: 0xDC, length: 3, pcIncrement: 3, func: NOP_ABSX },
  absx6: { code: 0xFC, length: 3, pcIncrement: 3, func: NOP_ABSX },
  // Zero-Page,Y NOP (illegal, code 0x92)
  zpY: { code: 0x92, length: 2, pcIncrement: 2, func: NOP_ZPY }
  },
  PHA: {
    implied: { code: 0x48, length: 1, pcIncrement: 1, func: PHA_IMP }
  },
  PHP: {
    implied: { code: 0x08, length: 1, pcIncrement: 1, func: PHP_IMP }
  },
  PLA: {
    implied: { code: 0x68, length: 1, pcIncrement: 1, func: PLA_IMP }
  },
  PLP: {
    implied: { code: 0x28, length: 1, pcIncrement: 1, func: PLP_IMP }
  },
  RTI: {
    implied: { code: 0x40, length: 1, pcIncrement: 1, func: RTI_IMP }
  },
  RTS: {
    implied: { code: 0x60, length: 1, pcIncrement: 1, func: RTS_IMP }
  },
  SBC: {
    immediate: { code: 0xE9, length: 2, pcIncrement: 2, func: SBC_IMM },
    zeroPage: { code: 0xE5, length: 2, pcIncrement: 2, func: SBC_ZP },
    zeroPageX: { code: 0xF5, length: 2, pcIncrement: 2, func: SBC_ZPX },
    absolute: { code: 0xED, length: 3, pcIncrement: 3, func: SBC_ABS },
    absoluteX: { code: 0xFD, length: 3, pcIncrement: 3, func: SBC_ABSX },
    absoluteY: { code: 0xF9, length: 3, pcIncrement: 3, func: SBC_ABSY },
    indirectX: { code: 0xE1, length: 2, pcIncrement: 2, func: SBC_INDX },
    indirectY: { code: 0xF1, length: 2, pcIncrement: 2, func: SBC_INDY }
  },
  CPX: {
    immediate: { code: 0xE0, length: 2, pcIncrement: 2, func: CPX_IMM },
    zeroPage:  { code: 0xE4, length: 2, pcIncrement: 2, func: CPX_ZP },
    absolute:  { code: 0xEC, length: 3, pcIncrement: 3, func: CPX_ABS }
  },
  DEX: {
    implied:   { code: 0xCA, length: 1, pcIncrement: 1, func: DEX_IMP }
  },
  DEY: {
    implied:   { code: 0x88, length: 1, pcIncrement: 1, func: DEY_IMP }
  },
  INX: {
    implied:   { code: 0xE8, length: 1, pcIncrement: 1, func: INX_IMP }
  },
  INY: {
    implied:   { code: 0xC8, length: 1, pcIncrement: 1, func: INY_IMP }
  },
  ROR: {
    accumulator: { code: 0x6A, length: 1, pcIncrement: 1, func: ROR_ACC },
    zeroPage:    { code: 0x66, length: 2, pcIncrement: 2, func: ROR_ZP },
    zeroPageX:   { code: 0x76, length: 2, pcIncrement: 2, func: ROR_ZPX },
    absolute:    { code: 0x6E, length: 3, pcIncrement: 3, func: ROR_ABS },
    absoluteX:   { code: 0x7E, length: 3, pcIncrement: 3, func: ROR_ABSX }
  },
  TAX: {
    implied:   { code: 0xAA, length: 1, pcIncrement: 1, func: TAX_IMP }
  },
  TAY: {
    implied:   { code: 0xA8, length: 1, pcIncrement: 1, func: TAY_IMP }
    
  },
  STX: {
  zeroPage:  { code: 0x86, length: 2, pcIncrement: 2, func: STX_ZP },
  zeroPageY: { code: 0x96, length: 2, pcIncrement: 2, func: STX_ZPY },
  absolute:  { code: 0x8E, length: 3, pcIncrement: 3, func: STX_ABS }
  },

  //          ................. illegalOpcodes ................. 

  // LAX (Load A and X)
  LAX: {
    zeroPage:    { code: 0xA7, length: 2, pcIncrement: 2, func: LAX_ZP },
    zeroPageY:   { code: 0xB7, length: 2, pcIncrement: 2, func: LAX_ZPY },
    absolute:    { code: 0xAF, length: 3, pcIncrement: 3, func: LAX_ABS },
    absoluteY:   { code: 0xBF, length: 3, pcIncrement: 3, func: LAX_ABSY },
    indirectX:   { code: 0xA3, length: 2, pcIncrement: 2, func: LAX_INDX },
    indirectY:   { code: 0xB3, length: 2, pcIncrement: 2, func: LAX_INDY }
  },

  // SAX (Store A & X)
  SAX: {
    zeroPage:    { code: 0x87, length: 2, pcIncrement: 2, func: SAX_ZP },
    zeroPageY:   { code: 0x97, length: 2, pcIncrement: 2, func: SAX_ZPY }, // unofficial mode but some docs list it
    absolute:    { code: 0x8F, length: 3, pcIncrement: 3, func: SAX_ABS },
    indirectX:   { code: 0x83, length: 2, pcIncrement: 2, func: SAX_INDX }
  },

  // DCP (DEC + CMP combo)
  DCP: {
    zeroPage:    { code: 0xC7, length: 2, pcIncrement: 2, func: DCP_ZP },
    zeroPageX:   { code: 0xD7, length: 2, pcIncrement: 2, func: DCP_ZPX },
    absolute:    { code: 0xCF, length: 3, pcIncrement: 3, func: DCP_ABS },
    absoluteX:   { code: 0xDF, length: 3, pcIncrement: 3, func: DCP_ABSX },
    absoluteY:   { code: 0xDB, length: 3, pcIncrement: 3, func: DCP_ABSY },
    indirectX:   { code: 0xC3, length: 2, pcIncrement: 2, func: DCP_INDX },
    indirectY:   { code: 0xD3, length: 2, pcIncrement: 2, func: DCP_INDY }
  },

  // ISC (INC + SBC combo)
  ISC: {
    zeroPage:    { code: 0xE7, length: 2, pcIncrement: 2, func: ISC_ZP },
    zeroPageX:   { code: 0xF7, length: 2, pcIncrement: 2, func: ISC_ZPX },
    absolute:    { code: 0xEF, length: 3, pcIncrement: 3, func: ISC_ABS },
    absoluteX:   { code: 0xFF, length: 3, pcIncrement: 3, func: ISC_ABSX },
    absoluteY:   { code: 0xFB, length: 3, pcIncrement: 3, func: ISC_ABSY },
    indirectX:   { code: 0xE3, length: 2, pcIncrement: 2, func: ISC_INDX },
    indirectY:   { code: 0xF3, length: 2, pcIncrement: 2, func: ISC_INDY }
  },

  // SLO (ASL + ORA combo)
  SLO: {
    zeroPage:    { code: 0x07, length: 2, pcIncrement: 2, func: SLO_ZP },
    zeroPageX:   { code: 0x17, length: 2, pcIncrement: 2, func: SLO_ZPX },
    absolute:    { code: 0x0F, length: 3, pcIncrement: 3, func: SLO_ABS },
    absoluteX:   { code: 0x1F, length: 3, pcIncrement: 3, func: SLO_ABSX },
    absoluteY:   { code: 0x1B, length: 3, pcIncrement: 3, func: SLO_ABSY },
    indirectX:   { code: 0x03, length: 2, pcIncrement: 2, func: SLO_INDX },
    indirectY:   { code: 0x13, length: 2, pcIncrement: 2, func: SLO_INDY }
  },

  // RLA (ROL + AND combo)
  RLA: {
    zeroPage:    { code: 0x27, length: 2, pcIncrement: 2, func: RLA_ZP },
    zeroPageX:   { code: 0x37, length: 2, pcIncrement: 2, func: RLA_ZPX },
    absolute:    { code: 0x2F, length: 3, pcIncrement: 3, func: RLA_ABS },
    absoluteX:   { code: 0x3F, length: 3, pcIncrement: 3, func: RLA_ABSX },
    absoluteY:   { code: 0x3B, length: 3, pcIncrement: 3, func: RLA_ABSY },
    indirectX:   { code: 0x23, length: 2, pcIncrement: 2, func: RLA_INDX },
    indirectY:   { code: 0x33, length: 2, pcIncrement: 2, func: RLA_INDY }
  },

  // SRE (LSR + EOR combo)
  SRE: {
    zeroPage:    { code: 0x47, length: 2, pcIncrement: 2, func: SRE_ZP },
    zeroPageX:   { code: 0x57, length: 2, pcIncrement: 2, func: SRE_ZPX },
    absolute:    { code: 0x4F, length: 3, pcIncrement: 3, func: SRE_ABS },
    absoluteX:   { code: 0x5F, length: 3, pcIncrement: 3, func: SRE_ABSX },
    absoluteY:   { code: 0x5B, length: 3, pcIncrement: 3, func: SRE_ABSY },
    indirectX:   { code: 0x43, length: 2, pcIncrement: 2, func: SRE_INDX },
    indirectY:   { code: 0x53, length: 2, pcIncrement: 2, func: SRE_INDY }
  },

  // ANC (AND + carry flag)
  ANC: {
    immediate:   { code: 0x0B, length: 2, pcIncrement: 2, func: ANC_IMM },
    immediate2:  { code: 0x2B, length: 2, pcIncrement: 2, func: ANC_IMM }  // same function as 0x0B
  },

  // ALR (AND + LSR)
  ALR: {
    immediate:   { code: 0x4B, length: 2, pcIncrement: 2, func: ALR_IMM }
  },

  // ARR (AND + ROR)
  ARR: {
    immediate:   { code: 0x6B, length: 2, pcIncrement: 2, func: ARR_IMM }
  },

  // AXA (AND + X, odd behavior)
  AXA: {
    absoluteY:   { code: 0x9F, length: 3, pcIncrement: 3, func: AXA_ABSY },
    indirectY:   { code: 0x93, length: 2, pcIncrement: 2, func: AXA_INDY }
  },

  // XAA (X & A combined - odd)
  XAA: {
    immediate:   { code: 0x8B, length: 2, pcIncrement: 2, func: XAA_IMM }
  },

  TXA: {
    implied:     {code: 0x8A, length: 1, pcIncrement: 1, func: TXA_IMP}
  }
};