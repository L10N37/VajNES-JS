// PC Counter is currently incremented in 'debug.js' according to the opcode. 

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


////////////////////////// CPU Functions //////////////////////////
// http://www.6502.org/tutorials/6502opcodes.html#ADC
// https://en.wikipedia.org/wiki/MOS_Technology_6502#Registers
// https://www.masswerk.at/6502/6502_instruction_set.html
// https://www.pagetable.com/c64ref/6502/?tab=2#LDA 
// https://www.nesdev.org/obelisk-6502-guide/addressing.html

function SEI_IMP() {    // [x]  
  // opcode only sets status register 'I'
  CPUregisters.P.I=true;
}

function ADC_IMM() {    // [not certain, real CPU test in future]
  // store the original value of the accumulator
  let oldA = CPUregisters.A;
  // The immediate value is added to the accumulator
  CPUregisters.A = systemMemory[PC+1];
  // if carry flag is set, add '1' to the accumulator
  if (CPUregisters.P.C == true){
      CPUregisters.A++;
  }
  // if the result exceeds 255 set the carry flag to indicate the overflow
  if (CPUregisters.A > 255 ) {
      CPUregisters.P.C = true;
  }
  // https://en.wikipedia.org/wiki/Sign_bit 
  // check for overflow in the signed sense and set overflow flag accordingly
  // its confusing [https://forums.nesdev.org/viewtopic.php?t=6331]
  if ((oldA ^ CPUregisters.A) & (systemMemory[PC+1] ^ CPUregisters.A) & 0b10000000) {
      CPUregisters.P.V = true;
  } else {
      CPUregisters.P.V = false;
  }
}

function CLD_IMP() {  // [x]       

  // Clear decimal mode flag
  CPUregisters.P.D = false;       
}

function LDA_IMM(){   // [x]

  // load the accumulator with value of byte following instruction opcode
  CPUregisters.A = systemMemory[PC+1];

      // check and set or clear N & Z flags
      CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
      CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
}

function LDA_ZP(){
  
  // operand is the address to grab a byte from the zero page WRAM area from
  const address = systemMemory[PC+1];
  // and place the byte at this address into the A register
  CPUregisters.A = systemMemory[address];

        // check and set or clear N & Z flags
        CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
        CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
}

function LDA_ZPX(){

  // operand + contents of X register is the address to grab a byte from the zero page WRAM area from
  const address = systemMemory[PC+1] + CPUregisters.X;
  // then load this into A register
  CPUregisters.A = systemMemory[address];

      // check and set or clear N & Z flags
      CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
      CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
}

function LDA_ABS(){
// the 2 operands are concat into a 16 bit address
const address = (systemMemory[PC+2] << 8) | systemMemory[PC+1];
// the value stored at this address is loaded into register A
CPUregisters.A = systemMemory[address];

    // check and set or clear N & Z flags
    CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
    CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
}

function LDA_ABSX(){
  // Assembly example: LDA $3000,X   ; Load the accumulator with the value at memory location $3000 + X (3000 is 2 operands concat to 16 bit address)
  const address = (systemMemory[PC+2] << 8) | systemMemory[PC+1] + CPUregisters.X;
  CPUregisters.A = systemMemory[address];

      // check and set or clear N & Z flags
      CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
      CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
}

function LDA_ABSY(){
  // as above, but add the value of Y register to the address instead
  const address = (systemMemory[PC+2] << 8) | systemMemory[PC+1] + CPUregisters.Y;
  CPUregisters.A = systemMemory[address];

        // check and set or clear N & Z flags
        CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
        CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
  
}

function LDA_INDX(){
  // Operand is the low byte, next byte is the highbyte then add value of X reg to form address
   const address = (systemMemory[PC+2] << 8) | systemMemory[PC+1] + CPUregisters.Y;
   // Store the data in this location into Accumulator
   CPUregisters.A = systemMemory[address];
        // check and set or clear N & Z flags
        CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
        CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
}

// opcode has a documented bug that is worked around
// The workaround for this bug involves adjusting the effective address by adding the Y register after accessing the memory location, rather than before.
function LDA_INDY(){
  // Operand is the low byte, next byte is the highbyte then add value of Y reg to form address
   const address = (systemMemory[PC+2] << 8) | systemMemory[PC+1] + CPUregisters.Y;
   // Store the data in this location into Accumulator
   CPUregisters.A = systemMemory[address];
        // check and set or clear N & Z flags
        CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
        CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
}

function STA_ZP(){
    // shove the operand byte (representing half a 16 bit address) across to the left 8 bits, smash 
    // the value stored in x register next to it forming the full 16 bit address
    const address = (systemMemory[PC+1] << 8) | CPUregisters.X;
    // load the data at this address into the A register
  systemMemory[address] = CPUregisters.A;
}

function STA_ZPX() {
  const address = (systemMemory[PC + 1] + CPUregisters.X) % 256; // ensure the address wraps around to zero page
  systemMemory[address] = CPUregisters.A;
}
  
function STA_ABS(){
  // take 2 following opcodes, concatenate into 16 bit address
  const address = (systemMemory[PC+2] << 8) | systemMemory[PC+1];
  // store the value of accumulator register @ this address
  systemMemory[address] = CPUregisters.A;
}

function STA_ABSX() {
  // Take the two following opcodes, concatenate them into a 16-bit address, and add the value of X register to it
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.X;
  // Store the value of the accumulator (A) at this address
  systemMemory[address] = CPUregisters.A;
}

function STA_ABSY() {
  // Take the two following opcodes, concatenate them into a 16-bit address, and add the value of Y register to it
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.Y;
  // Store the value of the accumulator (A) at this address
  systemMemory[address] = CPUregisters.A;
}

function STA_INDX() {
  // Operand is the low byte, next byte is the high byte, and add the value of X register to form the address
  const operand = systemMemory[PC + 1];
  const lowByteAddress = (operand + CPUregisters.X) & 0xFF; // Ensure the address wraps around to zero page
  const highByteAddress = (operand + CPUregisters.X + 1) & 0xFF; // Wrap around to zero page for high byte
  const address = (systemMemory[highByteAddress] << 8) | systemMemory[lowByteAddress];
  // Store the value of the accumulator (A) at this address
  systemMemory[address] = CPUregisters.A;
}

function STA_INDY() {
  // Operand is the low byte, next byte is the high byte, and add the value of Y register to form the address
  const operand = systemMemory[PC + 1];
  const lowByteAddress = operand & 0xFF; // Zero page address
  const highByteAddress = (operand + 1) & 0xFF; // Wrap around to zero page for high byte
  const address = ((systemMemory[highByteAddress] << 8) | systemMemory[lowByteAddress]) + CPUregisters.Y;
  // Store the value of the accumulator (A) at this address
  systemMemory[address] = CPUregisters.A;
}


function LDX_IMM() {
  // Load the X register with the value of the byte following the instruction opcode
  CPUregisters.X = systemMemory[PC + 1];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.X === 0) ? true : false;
  CPUregisters.P.N = (CPUregisters.X & 0b10000000) ? true : false;
}

function LDX_ZP() {
  // Load the X register with the value stored at the zero-page address specified by the following byte
  const address = systemMemory[PC + 1];
  CPUregisters.X = systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.X === 0) ? true : false;
  CPUregisters.P.N = (CPUregisters.X & 0b10000000) ? true : false;
}

function LDX_ZPY() {
  // Load the X register with the value stored at the zero-page address specified by the following byte added to the Y register
  const address = (systemMemory[PC + 1] + CPUregisters.Y) % 256; // Ensure the address wraps around to zero page
  CPUregisters.X = systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.X === 0) ? true : false;
  CPUregisters.P.N = (CPUregisters.X & 0b10000000) ? true : false;
}

function LDX_ABS() {
  // Load the X register with the value stored at the absolute address specified by the two following bytes
  const address = (systemMemory[PC + 2] << 8) | systemMemory[PC + 1];
  CPUregisters.X = systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.X === 0) ? true : false;
  CPUregisters.P.N = (CPUregisters.X & 0b10000000) ? true : false;
}

function LDX_ABSY() {
  // Load the X register with the value stored at the absolute address specified by the two following bytes added to the Y register
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.Y;
  CPUregisters.X = systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.X === 0) ? true : false;
  CPUregisters.P.N = (CPUregisters.X & 0b10000000) ? true : false;
}

function ADC_IMM() {
  const value = systemMemory[PC + 1];

  // Perform the addition with the carry flag
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);

  // Update the carry flag
  CPUregisters.P.C = (sum > 255);

  // Update the overflow flag
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;

  // Update the accumulator register
  CPUregisters.A = sum & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ADC_ZP() {
  const address = systemMemory[PC + 1];
  const value = systemMemory[address];

  // Perform the addition with the carry flag
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);

  // Update the carry flag
  CPUregisters.P.C = (sum > 255);

  // Update the overflow flag
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;

  // Update the accumulator register
  CPUregisters.A = sum & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ADC_ZPX() {
  const address = (systemMemory[PC + 1] + CPUregisters.X) % 256;
  const value = systemMemory[address];

  // Perform the addition with the carry flag
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);

  // Update the carry flag
  CPUregisters.P.C = (sum > 255);

  // Update the overflow flag
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;

  // Update the accumulator register
  CPUregisters.A = sum & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ADC_ABS() {
  const address = (systemMemory[PC + 2] << 8) | systemMemory[PC + 1];
  const value = systemMemory[address];

  // Perform the addition with the carry flag
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);

  // Update the carry flag
  CPUregisters.P.C = (sum > 255);

  // Update the overflow flag
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;

  // Update the accumulator register
  CPUregisters.A = sum & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ADC_ABSX() {
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.X;
  const value = systemMemory[address];

  // Perform the addition with the carry flag
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);

  // Update the carry flag
  CPUregisters.P.C = (sum > 255);

  // Update the overflow flag
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;

  // Update the accumulator register
  CPUregisters.A = sum & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ADC_ABSY() {
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.Y;
  const value = systemMemory[address];

  // Perform the addition with the carry flag
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);

  // Update the carry flag
  CPUregisters.P.C = (sum > 255);

  // Update the overflow flag
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;

  // Update the accumulator register
  CPUregisters.A = sum & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ADC_INDX() {
  const operand = systemMemory[PC + 1];
  const lowByteAddress = (operand + CPUregisters.X) & 0xFF;
  const highByteAddress = (operand + CPUregisters.X + 1) & 0xFF;
  const address = (systemMemory[highByteAddress] << 8) | systemMemory[lowByteAddress];
  const value = systemMemory[address];

  // Perform the addition with the carry flag
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);

  // Update the carry flag
  CPUregisters.P.C = (sum > 255);

  // Update the overflow flag
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;

  // Update the accumulator register
  CPUregisters.A = sum & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ADC_INDY() {
  const operand = systemMemory[PC + 1];
  const lowByteAddress = operand & 0xFF;
  const highByteAddress = (operand + 1) & 0xFF;
  const address = ((systemMemory[highByteAddress] << 8) | systemMemory[lowByteAddress]) + CPUregisters.Y;
  const value = systemMemory[address];

  // Perform the addition with the carry flag
  const sum = CPUregisters.A + value + (CPUregisters.P.C ? 1 : 0);

  // Update the carry flag
  CPUregisters.P.C = (sum > 255);

  // Update the overflow flag
  CPUregisters.P.V = ((CPUregisters.A ^ sum) & (value ^ sum) & 0x80) !== 0;

  // Update the accumulator register
  CPUregisters.A = sum & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_IMM() {
    // value of A register is logical ANDed with the operand
    // this result is stored back in A register
  CPUregisters.A = CPUregisters.A & systemMemory[PC+1];

      // check and set or clear N & Z flags
      CPUregisters.P.Z = (CPUregisters.A === 0) ? true : false;
      CPUregisters.P.N = (CPUregisters.A & 0b10000000) ? true : false;
}

function AND_ZP() {
  const address = systemMemory[PC + 1];
  const value = systemMemory[address];
  CPUregisters.A &= value;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ZPX() {
  const address = (systemMemory[PC + 1] + CPUregisters.X) % 256;
  const value = systemMemory[address];
  CPUregisters.A &= value;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ABS() {
  const address = (systemMemory[PC + 2] << 8) | systemMemory[PC + 1];
  const value = systemMemory[address];
  CPUregisters.A &= value;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ABSX() {
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.X;
  const value = systemMemory[address];
  CPUregisters.A &= value;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_ABSY() {
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.Y;
  const value = systemMemory[address];
  CPUregisters.A &= value;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_INDX() {
  const operand = systemMemory[PC + 1];
  const lowByteAddress = (operand + CPUregisters.X) & 0xFF;
  const highByteAddress = (operand + CPUregisters.X + 1) & 0xFF;
  const address = (systemMemory[highByteAddress] << 8) | systemMemory[lowByteAddress];
  const value = systemMemory[address];
  CPUregisters.A &= value;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function AND_INDY() {
  const operand = systemMemory[PC + 1];
  const lowByteAddress = operand & 0xFF;
  const highByteAddress = (operand + 1) & 0xFF;
  const address = ((systemMemory[highByteAddress] << 8) | systemMemory[lowByteAddress]) + CPUregisters.Y;
  const value = systemMemory[address];
  CPUregisters.A &= value;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ASL_ACC() {
  CPUregisters.P.C = (CPUregisters.A & 0x80) !== 0;
  CPUregisters.A = (CPUregisters.A << 1) & 0xFF;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ASL_ZP() {
  const address = systemMemory[PC + 1];
  const value = systemMemory[address];
  CPUregisters.P.C = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[address] = result;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ASL_ZPX() {
  const address = (systemMemory[PC + 1] + CPUregisters.X) % 256;
  const value = systemMemory[address];
  CPUregisters.P.C = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[address] = result;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ASL_ABS() {
  const address = (systemMemory[PC + 2] << 8) | systemMemory[PC + 1];
  const value = systemMemory[address];
  CPUregisters.P.C = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[address] = result;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ASL_ABSX() {
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.X;
  const value = systemMemory[address];
  CPUregisters.P.C = (value & 0x80) !== 0;
  const result = (value << 1) & 0xFF;
  systemMemory[address] = result;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function BIT_ZP() {
  const address = systemMemory[PC + 1];
  const value = systemMemory[address];

  CPUregisters.P.Z = (value & CPUregisters.A) === 0;
  CPUregisters.P.N = (value & 0x80) !== 0;
  CPUregisters.P.V = (value & 0x40) !== 0;
}

function BIT_ABS() {
  const address = (systemMemory[PC + 2] << 8) | systemMemory[PC + 1];
  const value = systemMemory[address];

  CPUregisters.P.Z = (value & CPUregisters.A) === 0;
  CPUregisters.P.N = (value & 0x80) !== 0;
  CPUregisters.P.V = (value & 0x40) !== 0;
}

function BIT_ABS() {
  const address = (systemMemory[PC + 2] << 8) | systemMemory[PC + 1];
  const value = systemMemory[address];

  CPUregisters.P.Z = (value & CPUregisters.A) === 0;
  CPUregisters.P.N = (value & 0x80) !== 0;
  CPUregisters.P.V = (value & 0x40) !== 0;
}

function LSR_ACC() {
  CPUregisters.P.C = CPUregisters.A & 0x01;
  CPUregisters.A = CPUregisters.A >> 1;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function LSR_ZP() {
  const address = systemMemory[PC + 1];
  const value = systemMemory[address];
  CPUregisters.P.C = value & 0x01;
  const result = value >> 1;
  systemMemory[address] = result;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function LSR_ZPX() {
  const address = (systemMemory[PC + 1] + CPUregisters.X) % 256;
  const value = systemMemory[address];
  CPUregisters.P.C = value & 0x01;
  const result = value >> 1;
  systemMemory[address] = result;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function LSR_ABS() {
  const address = (systemMemory[PC + 2] << 8) | systemMemory[PC + 1];
  const value = systemMemory[address];
  CPUregisters.P.C = value & 0x01;
  const result = value >> 1;
  systemMemory[address] = result;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function LSR_ABSX() {
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.X;
  const value = systemMemory[address];
  CPUregisters.P.C = value & 0x01;
  const result = value >> 1;
  systemMemory[address] = result;

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (result === 0);
  CPUregisters.P.N = (result & 0x80) !== 0;
}

function ORA_IMM() {
  CPUregisters.A |= systemMemory[PC + 1];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ZP() {
  const address = systemMemory[PC + 1];
  CPUregisters.A |= systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ZPX() {
  const address = (systemMemory[PC + 1] + CPUregisters.X) % 256;
  CPUregisters.A |= systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ABS() {
  const address = (systemMemory[PC + 2] << 8) | systemMemory[PC + 1];
  CPUregisters.A |= systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ABSX() {
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.X;
  CPUregisters.A |= systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_ABSY() {
  const address = ((systemMemory[PC + 2] << 8) | systemMemory[PC + 1]) + CPUregisters.Y;
  CPUregisters.A |= systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_INDX() {
  const baseAddress = systemMemory[PC + 1] + CPUregisters.X;
  const lowByte = systemMemory[baseAddress];
  const highByte = systemMemory[(baseAddress + 1) % 256];
  const address = (highByte << 8) | lowByte;
  CPUregisters.A |= systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function ORA_INDY() {
  const baseAddress = systemMemory[PC + 1];
  const lowByte = systemMemory[baseAddress];
  const highByte = systemMemory[(baseAddress + 1) % 256];
  const address = ((highByte << 8) | lowByte) + CPUregisters.Y;
  CPUregisters.A |= systemMemory[address];

  // Check and set or clear N & Z flags
  CPUregisters.P.Z = (CPUregisters.A === 0);
  CPUregisters.P.N = (CPUregisters.A & 0x80) !== 0;
}

function BPL_REL() {
  const offset = systemMemory[PC + 1];
  if (!CPUregisters.P.N) {
    CPUregisters.PC = (PC + 2 + offset) & 0xFFFF;
  }
}

function BMI_REL() {
  const offset = systemMemory[PC + 1];
  if (CPUregisters.P.N) {
    CPUregisters.PC = (PC + 2 + offset) & 0xFFFF;
  }
}

function BVC_REL() {
  const offset = systemMemory[PC + 1];
  if (!CPUregisters.P.V) {
    CPUregisters.PC = (PC + 2 + offset) & 0xFFFF;
  }
}

function BCC_REL() {
  const offset = systemMemory[PC + 1];
  if (!CPUregisters.P.C) {
    CPUregisters.PC = (PC + 2 + offset) & 0xFFFF;
  }
}

function BCS_REL() {
  const offset = systemMemory[PC + 1];
  if (CPUregisters.P.C) {
    CPUregisters.PC = (PC + 2 + offset) & 0xFFFF;
  }
}

function BNE_REL() {
  const offset = systemMemory[PC + 1];
  if (!CPUregisters.P.Z) {
    CPUregisters.PC = (PC + 2 + offset) & 0xFFFF;
  }
}

function BEQ_REL() {
  // function is bypassed if zero flag is not set
  if (CPUregisters.P.Z == true) {
    // test bit 7 (MSB), if set jump PC counter forward by operand amount
    if (systemMemory[PC+1] & 0b10000000) {
      // If the bit is set, the branch target is forwards
      PC += systemMemory[PC+1];
    } else {
      // If the bit is not set, the branch target is backwards
      PC -= (256 - systemMemory[PC+1]);
    }
  }
}

function BRK_IMP() {
  window.alert('not yet implemented');
}

function CMP_IMM() {
  window.alert('not yet implemented');
}

function CMP_ZP() {
  window.alert('not yet implemented');
}

function CMP_ZPX() {
  window.alert('not yet implemented');
}

function CMP_ABS() {
  window.alert('not yet implemented');
}

function CMP_ABSX() {
  window.alert('not yet implemented');
}

function CMP_ABSY() {
  window.alert('not yet implemented');
}

function CMP_INDX() {
  window.alert('not yet implemented');
}

function CMP_INDY() {
  window.alert('not yet implemented');
}

function CPY_IMM() {
alert("CPY immediate instruction not implemented");
}

function CPY_ZP() {
alert("CPY zero page instruction not implemented");
}

function CPY_ABS() {
alert("CPY absolute instruction not implemented");
}

function DEC_ZP() {
alert('DEC Zero Page not implemented');
}

function DEC_ZPX() {
alert('DEC Zero Page X not implemented');
}

function DEC_ABS() {
alert('DEC Absolute not implemented');
}

function DEC_ABX() {
alert('DEC Absolute X not implemented');
}
function EOR_IMM() {
alert("EOR immediate");
}

function EOR_ZP() {
alert("EOR zero page");
}

function EOR_ZPX() {
alert("EOR zero page, X");
}

function EOR_ABS() {
alert("EOR absolute");
}

function EOR_ABX() {
alert("EOR absolute, X");
}

function EOR_ABY() {
alert("EOR absolute, Y");
}

function EOR_INX() {
alert("EOR (indirect,X)");
}

function EOR_INY() {
alert("EOR (indirect),Y");
}
function  CLC_IMP(){

}

function  SEC_IMP(){

}

function  CLI_IMP(){

}

function CLV_IMP(){

}

function  SED_IMP(){

}
function INC_ZP() {
window.alert("function not yet implemented");
}

function INC_ZPX() {
window.alert("function not yet implemented");
}

function INC_ABS() {
window.alert("function not yet implemented");
}

function INC_ABSX() {
window.alert("function not yet implemented");
}

function JMP_ABS() {
window.alert("function not yet implemented");
}

function JMP_IND() {
window.alert("function not yet implemented");
}

function ROL_ACC() {
window.alert("function not yet implemented");
}

function ROL_ZP() {
window.alert("function not yet implemented");
}

function ROL_ZPX() {
window.alert("function not yet implemented");
}

function ROL_ABS() {
window.alert("function not yet implemented");
}

function ROL_ABSX() {
window.alert("function not yet implemented");
}

function TXS_IMP() {
CPUregisters.S =  CPUregisters.X;
}


//////////////////////// 6502 CPU opcode object ////////////////////////
// TO DO: Add cycles, work out boundary cross stuff
  const opcodes = {
      STA: {
        zeroPage: {code: 0x85, length: 2, pcIncrement: 2, func: STA_ZP},
        zeroPageX: {code: 0x95, length: 2, pcIncrement: 2, func: STA_ZPX},
        absolute: {code: 0x8D, length: 3, pcIncrement: 3, func: STA_ABS},
        absoluteX: {code: 0x9D, length: 3, pcIncrement: 3, func: STA_ABSX},
        absoluteY: {code: 0x99, length: 3, pcIncrement: 3, func: STA_ABSY},
        indirectX: {code: 0x81, length: 2, pcIncrement: 2, func: STA_INDX},
        indirectY: {code: 0x91, length: 2, pcIncrement: 2, func: STA_INDY},
      },
      LDA: {
      immediate: {code: 0xA9, length: 2, pcIncrement: 2, func: LDA_IMM},
      zeroPage: {code: 0xA5, length: 2, pcIncrement: 2, func: LDA_ZP},
      zeroPageX: {code: 0xB5, length: 2, pcIncrement: 2, func: LDA_ZPX},
      absolute: {code: 0xAD, length: 3, pcIncrement: 3, func: LDA_ABS},
      absoluteX: {code: 0xBD, length: 3, pcIncrement: 3, func: LDA_ABSX},
      absoluteY: {code: 0xB9, length: 3, pcIncrement: 3, func: LDA_ABSY},
      indirectX: {code: 0xA1, length: 2, pcIncrement: 2, func: LDA_INDX},
      indirectY: {code: 0xB1, length: 2, pcIncrement: 2, func: LDA_INDY},
      },
      LDX: {
        immediate: {code: 0xA2, length: 2, pcIncrement: 2, func: LDX_IMM},
        zeroPage: {code: 0xA6, length: 2, pcIncrement: 2, func: LDX_ZP},
        zeroPageY: {code: 0xB6, length: 2, pcIncrement: 2, func: LDX_ZPY},
        absolute: {code: 0xAE, length: 3, pcIncrement: 3, func: LDX_ABS},
        absoluteY: {code: 0xBE, length: 3, pcIncrement: 3, func: LDX_ABSY}
      },
      ADC:{
        immediate: {code: 0x69, length: 2, pcIncrement: 2, func: ADC_IMM},
        zeroPage: {code: 0x65, length: 2, pcIncrement: 2, func: ADC_ZP},
        zeroPagex: {code: 0x75, length: 2, pcIncrement: 2, func: ADC_ZPX},
        absolute: {code: 0x6D, length: 3, pcIncrement: 3, func: ADC_ABS},
        absolutex: {code: 0x7D, length: 3, pcIncrement: 3, func: ADC_ABSX},
        absolutey: {code: 0x79, length: 3, pcIncrement: 3, func: ADC_ABSY},
        indirectx: {code: 0x61, length: 2, pcIncrement: 2, func: ADC_INDX},
        indirecty: {code: 0x71, length: 2, pcIncrement: 2, func: ADC_INDY}
      },
      AND: {
          immediate: { code: 0x29, length: 2, pcIncrement: 2, func: AND_IMM },
          zeroPage: { code: 0x25, length: 2, pcIncrement: 2, func: AND_ZP },
          zeroPagex: { code: 0x35, length: 2, pcIncrement: 2, func: AND_ZPX },
          absolute: { code: 0x2D, length: 3, pcIncrement: 3, func: AND_ABS },
          absolutex: { code: 0x3D, length: 3, pcIncrement: 3, func: AND_ABSX },
          absolutey: { code: 0x39, length: 3, pcIncrement: 3, func: AND_ABSY },
          indirectx: { code: 0x21, length: 2, pcIncrement: 2, func: AND_INDX },
          indirecty: { code: 0x31, length: 2, pcIncrement: 2, func: AND_INDY }
      },
      ASL: {
        accumulator: {code: 0x0A, length: 1, pcIncrement: 1, func: ASL_ACC},
        zeroPage: {code: 0x06, length: 2, pcIncrement: 2, func: ASL_ZP},
        zeroPagex: {code: 0x16, length: 2, pcIncrement: 2, func: ASL_ZPX},
        absolute: {code: 0x0E, length: 3, pcIncrement: 3, func: ASL_ABS},
        absolutex: {code: 0x1E, length: 3, pcIncrement: 3, func: ASL_ABSX}
      },
       BIT: {
        zeroPage: {code: 0x24, length: 2, pcIncrement: 2, func: BIT_ZP},
        absolute: {code: 0x2C, length: 3, pcIncrement: 3, func: BIT_ABS}
      },
      LSR: {
        accumulator: {code: 0x4A, length: 1, pcIncrement: 1, func: LSR_ACC},
        zeroPage: {code: 0x46, length: 2, pcIncrement: 2, func: LSR_ZP},
        zeroPagex: {code: 0x56, length: 2, pcIncrement: 2, func: LSR_ZPX},
        absolute: {code: 0x4E, length: 3, pcIncrement: 3, func: LSR_ABS},
        absolutex: {code: 0x5E, length: 3, pcIncrement: 3, func: LSR_ABSX}
      },
      ORA: {
        immediate: { code: 0x09, length: 2, pcIncrement: 2, func: ORA_IMM },
        zeroPage: { code: 0x05, length: 2, pcIncrement: 2, func: ORA_ZP },
        zeroPagex: { code: 0x15, length: 2, pcIncrement: 2, func: ORA_ZPX },
        absolute: { code: 0x0D, length: 3, pcIncrement: 3, func: ORA_ABS },
        absolutex: { code: 0x1D, length: 3, pcIncrement: 3, func: ORA_ABSX },
        absolutey: { code: 0x19, length: 3, pcIncrement: 3, func: ORA_ABSY },
        indirectx: { code: 0x01, length: 2, pcIncrement: 2, func: ORA_INDX },
        indirecty: { code: 0x11, length: 2, pcIncrement: 2, func: ORA_INDY }
      },
      BPL: {
        relative: {code: 0x10, length: 2, pcIncrement: 2, func: BPL_REL}
      },
      BMI: {
        relative: {code: 0x30, length: 2, pcIncrement: 2, func: BMI_REL}
      },
      BVC: {
        relative: {code: 0x50, length: 2, pcIncrement: 2, func: BVC_REL}
      },
      BCC: {
        relative: {code: 0x90, length: 2, pcIncrement: 2, func: BCC_REL}
      },
      BCS: {
        relative: {code: 0xB0, length: 2, pcIncrement: 2, func: BCS_REL}
      },
      BNE: {
        relative: {code: 0xD0, length: 2, pcIncrement: 2, func: BNE_REL}
      },
      BEQ: {
        relative: {code: 0xF0, length: 2, pcIncrement: 2, func: BEQ_REL}
      },
      BRK: {
        implied: {code: 0x00, length: 1, pcIncrement: 1, func: BRK_IMP}
      },
      TXS:  {
        implied: {code: 0x9A,length: 1,pcIncrement: 1, func: TXS_IMP}
      },
      CMP: {
        immediate: { code: 0xC9, length: 2, pcIncrement: 2, func: CMP_IMM },
        zeroPage: { code: 0xC5, length: 2, pcIncrement: 2, func: CMP_ZP },
        zeroPagex: { code: 0xD5, length: 2, pcIncrement: 2, func: CMP_ZPX },
        absolute: { code: 0xCD, length: 3, pcIncrement: 3, func: CMP_ABS },
        absolutex: { code: 0xDD, length: 3, pcIncrement: 3, func: CMP_ABSX },
        absolutey: { code: 0xD9, length: 3, pcIncrement: 3, func: CMP_ABSY },
        indirectx: { code: 0xC1, length: 2, pcIncrement: 2, func: CMP_INDX },
        indirecty: { code: 0xD1, length: 2, pcIncrement: 2, func: CMP_INDY }
      },
      CPY: {
        immediate: {code: 0xC0, length: 2, pcIncrement: 2, func: CPY_IMM},
        zeroPage: {code: 0xC4, length: 2, pcIncrement: 2, func: CPY_ZP},
        absolute: {code: 0xCC, length: 3, pcIncrement: 3, func: CPY_ABS}
        },
        DEC: {
        zeroPage: {code: 0xC6, length: 2, pcIncrement: 2, func: DEC_ZP},
        zeroPagex: {code: 0xD6, length: 2, pcIncrement: 2, func: DEC_ZPX},
        absolute: {code: 0xCE, length: 3, pcIncrement: 3, func: DEC_ABS},
        absolutex: {code: 0xDE, length: 3, pcIncrement: 3, func: DEC_ABX}
        },
        EOR: {
        immediate: {code: 0x49, length: 2, pcIncrement: 2, func: EOR_IMM},
        zeroPage: {code: 0x45, length: 2, pcIncrement: 2, func: EOR_ZP},
        zeroPagex: {code: 0x55, length: 2, pcIncrement: 2, func: EOR_ZPX},
        absolute: {code: 0x4D, length: 3, pcIncrement: 3, func: EOR_ABS},
        absolutex: {code: 0x5D, length: 3, pcIncrement: 3, func: EOR_ABX},
        absolutey: {code: 0x59, length: 3, pcIncrement: 3, func: EOR_ABY},
        indirectx: {code: 0x41, length: 2, pcIncrement: 2, func: EOR_INX},
        indirecty: {code: 0x51, length: 2, pcIncrement: 2, func: EOR_INY}
        },
        CLC: {
          implied: {code: 0x18, length: 1, pcIncrement: 1, func: CLC_IMP}
        },
        SEC: {
          implied: {code: 0x38, length: 1, pcIncrement: 1, func: SEC_IMP}
        },
        CLI: {
          implied: {code: 0x58, length: 1, pcIncrement: 1, func: CLI_IMP}
        },
        SEI: {
          implied: {code: 0x78, length: 1, pcIncrement: 1, func: SEI_IMP}
        },
        CLV: {
          implied: {code: 0xB8, length: 1, pcIncrement: 1, func: CLV_IMP}
        },
        CLD: {
          implied: {code: 0xD8, length: 1, pcIncrement: 1, func: CLD_IMP}
        },
        SED: {
          implied: {code: 0xF8, length: 1, pcIncrement: 1, func: SED_IMP}
        },
        INC: {
          zeroPage: {code: 0xE6, length: 2, pcIncrement: 2, func: INC_ZP},
          zeroPagex: {code: 0xF6, length: 2, pcIncrement: 2, func: INC_ZPX},
          absolute: {code: 0xEE, length: 3, pcIncrement: 3, func: INC_ABS},
          absolutex: {code: 0xFE, length: 3, pcIncrement: 3, func: INC_ABSX}
        },
        JMP: {
          absolute: {code: 0x4C, length: 3, pcIncrement: 3, func: JMP_ABS},
          indirect: {code: 0x6C, length: 3, pcIncrement: 3, func: JMP_IND}
        },
        ROL: {
          accumulator: {code: 0x2A, length: 1, pcIncrement: 1, func: ROL_ACC},
          zeroPage: {code: 0x26, length: 2, pcIncrement: 2, func: ROL_ZP},
          zeroPagex: {code: 0x36, length: 2, pcIncrement: 2, func: ROL_ZPX},
          absolute: {code: 0x2E, length: 3, pcIncrement: 3, func: ROL_ABS},
          absoluteX: {code: 0x3E, length: 3, pcIncrement: 3, func: ROL_ABSX}
        }
      }