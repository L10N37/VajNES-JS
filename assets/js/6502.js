
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
        U: 'NA',     // Unused
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
    if ((oldA ^ CPUregisters.A) & (systemMemory[PC+1] ^ CPUregisters.A) & 0x80) {
        CPUregisters.P.V = true;
    } else {
        CPUregisters.P.V = false;
    }
}

function ROL_ZP() {
    window.alert('not yet implemented');
  }

  function CLD_IMP() {  // [x]       
    // Clear decimal mode flag
    CPUregisters.P.D = false;       
  }

  function LDA_IMM(){   // [x]
    // load the accumulator with value of byte following instruction opcode
    CPUregisters.A = systemMemory[PC+1]; 
  }

  function LDA_ZP(){
    window.alert('not yet implemented');
  }

  function LDA_ZPX(){
    window.alert('not yet implemented');
  }

  function LDA_ABS(){
    window.alert('not yet implemented');
  }

  function LDA_ABSX(){
    window.alert('not yet implemented');
  }

  function LDA_ABSY(){
    window.alert('not yet implemented');
  }

  function LDA_INDX(){
    window.alert('not yet implemented');
  }

  function LDA_INDY(){
    window.alert('not yet implemented');
  }

  function STA_ZP(){
    window.alert('not yet implemented');
  }

  function STA_ZPX(){
    window.alert('not yet implemented');
  }

  function STA_ABS(){
    // take 2 following opcodes, concatenate into 16 bit address
    const address = (systemMemory[PC+2] << 8) | systemMemory[PC+1];
    // store the value of accumulator register @ this address
    systemMemory[address] = CPUregisters.A;
  }

  function STA_ABSX(){
    window.alert('not yet implemented');
  }

  function STA_ABSY(){
    window.alert('not yet implemented');
  }

  function STA_INDX(){
    window.alert('not yet implemented');
  }

  function STA_INDY(){
    window.alert('not yet implemented');
  }

//////////////////////// 6502 CPU opcode object //////////////////////// 
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
        ADC: {
        immediate: {code: 0x69, length: 2, pcIncrement: 2, func: ADC_IMM},
        zeroPage: {code: 0x65, length: 2, pcIncrement: 2},
        zeroPagex: {code: 0x75, length: 2, pcIncrement: 2},
        absolute: {code: 0x6D, length: 3, pcIncrement: 3},
        absolutex: {code: 0x7D, length: 3, pcIncrement: 3},
        absolutey: {code: 0x79, length: 3, pcIncrement: 3},
        indirectx: {code: 0x61, length: 2, pcIncrement: 2},
        indirecty: {code: 0x71, length: 2, pcIncrement: 2}
        },
        AND: {
        immediate: {code: 0x29, length: 2, pcIncrement: 2},
        zeroPage: {code: 0x25, length: 2, pcIncrement: 2},
        zeroPagex: {code: 0x35, length: 2, pcIncrement: 2},
        absolute: {code: 0x2D, length: 3, pcIncrement: 3},
        absolutex: {code: 0x3D, length: 3, pcIncrement: 3},
        absolutey: {code: 0x39, length: 3, pcIncrement: 3},
        indirectx: {code: 0x21, length: 2, pcIncrement: 2},
        indirecty: {code: 0x31, length: 2, pcIncrement: 2}
        },
        ASL: {
        accumulator: {code: 0x0A, length: 1, pcIncrement: 1},
        zeroPage: {code: 0x06, length: 2, pcIncrement: 2},
        zeroPagex: {code: 0x16, length: 2, pcIncrement: 2},
        absolute: {code: 0x0E, length: 3, pcIncrement: 3},
        absolutex: {code: 0x1E, length: 3, pcIncrement: 3}
        },
        BIT: {
        zeroPage: {code: 0x24, length: 2, pcIncrement: 2},
        absolute: {code: 0x2C, length: 3, pcIncrement: 3}
        },
        LSR: {
        accumulator: {code: 0x4A, length: 1, pcIncrement: 1},
        zeroPage: {code: 0x46, length: 2, pcIncrement: 2},
        zeroPagex: {code: 0x56, length: 2, pcIncrement: 2},
        absolute: {code: 0x4E, length: 3, pcIncrement: 3},
        absolutex: {code: 0x5E, length: 3, pcIncrement: 3}
        },
        ORA: {
        immediate: { code: 0x09, length: 2, pcIncrement: 2 },
        zeroPage: { code: 0x05, length: 2, pcIncrement: 2 },
        zeroPagex: { code: 0x15, length: 2, pcIncrement: 2 },
        absolute: { code: 0x0D, length: 3, pcIncrement: 3 },
        absolutex: { code: 0x1D, length: 3, pcIncrement: 3 },
        absolutey: { code: 0x19, length: 3, pcIncrement: 3 },
        indirectx: { code: 0x01, length: 2, pcIncrement: 2 },
        indirecty: { code: 0x11, length: 2, pcIncrement: 2 }
        },
        BPL: {
        relative: {code: 0x10, length: 2, pcIncrement: 2}
        },
        BMI: {
        relative: {code: 0x30, length: 2, pcIncrement: 2}
        },
        BVC: {
        relative: {code: 0x50, length: 2, pcIncrement: 2}
        },
        BCC: {
        relative: {code: 0x90, length: 2, pcIncrement: 2}
        },
        BCS: {
        relative: {code: 0xB0, length: 2, pcIncrement: 2}
        },
        BNE: {
        relative: {code: 0xD0, length: 2, pcIncrement: 2}
        },
        BNE: {
        relative: {code: 0xD0, length: 2, pcIncrement: 2}
        },
        BEQ: {
        relative: {code: 0xF0, length: 2, pcIncrement: 2}
        },
        BRK: {
        implied: {code: 0x00, length: 1, pcIncrement: 1}
        },
        CMP: {
        immediate: {code: 0xC9, length: 2, pcIncrement: 2},
        zeroPage: {code: 0xC5, length: 2, pcIncrement: 2},
        zeroPagex: {code: 0xD5, length: 2, pcIncrement: 2},
        absolute: {code: 0xCD, length: 3, pcIncrement: 3},
        absolutex: {code: 0xDD, length: 3, pcIncrement: 3},
        absolutey: {code: 0xD9, length: 3, pcIncrement: 3},
        indirectx: {code: 0xC1, length: 2, pcIncrement: 2},
        indirecty: {code: 0xD1, length: 2, pcIncrement: 2}
        },
        CPY: {
        immediate: {code: 0xC0, length: 2, pcIncrement: 2},
        zeroPage: {code: 0xC4, length: 2, pcIncrement: 2},
        absolute: {code: 0xCC, length: 3, pcIncrement: 3}
        },
        DEC: {
        zeroPage: {code: 0xC6, length: 2, pcIncrement: 2},
        zeroPagex: {code: 0xD6, length: 2, pcIncrement: 2},
        absolute: {code: 0xCE, length: 3, pcIncrement: 3},
        absolutex: {code: 0xDE, length: 3, pcIncrement: 3}
        },
        EOR: {
        immediate: {code: 0x49, length: 2, pcIncrement: 2},
        zeroPage: {code: 0x45, length: 2, pcIncrement: 2},
        zeroPagex: {code: 0x55, length: 2, pcIncrement: 2},
        absolute: {code: 0x4D, length: 3, pcIncrement: 3},
        absolutex: {code: 0x5D, length: 3, pcIncrement: 3},
        absolutey: {code: 0x59, length: 3, pcIncrement: 3},
        indirectx: {code: 0x41, length: 2, pcIncrement: 2},
        indirecty: {code: 0x51, length: 2, pcIncrement: 2}
        },
        CLC: {
        implied: {code: 0x18, length: 1, pcIncrement: 1}
        },
        SEC: {
        implied: {code: 0x38, length: 1, pcIncrement: 1}
        },
        CLI: {
        implied: {code: 0x58, length: 1, pcIncrement: 1}
        },
        SEI: {
        implied: {code: 0x78, length: 1, pcIncrement: 1, func: SEI_IMP}
        },
        CLV: {
        implied: {code: 0xB8, length: 1, pcIncrement: 1}
        },
        CLD: {
        implied: {code: 0xD8, length: 1, pcIncrement: 1, func: CLD_IMP}
        },
        SED: {
        implied: {code: 0xF8, length: 1, pcIncrement: 1}
        },
        INC: {
        zeroPage: {code: 0xE6, length: 2, pcIncrement: 2},
        zeroPagex: {code: 0xF6, length: 2, pcIncrement: 2},
        absolute: {code: 0xEE, length: 3, pcIncrement: 3},
        absolutex: {code: 0xFE, length: 3, pcIncrement: 3}
        },
        JMP: {
        absolute: {code: 0x4C, length: 3, pcIncrement: 3},
        indirect: {code: 0x6C, length: 3, pcIncrement: 3}
        },
        ROL: {
        accumulator: {code: 0x2A, length: 1, pcIncrement: 1},
        zeroPage: {code: 0x26, length: 2, pcIncrement: 2, func: ROL_ZP},
        zeroPagex: {code: 0x36, length: 2, pcIncrement: 2},
        absolute: {code: 0x2E, length: 3, pcIncrement: 3},
        absoluteX: {code: 0x3E, length: 3, pcIncrement: 3}
        },
}