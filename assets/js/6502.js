
const CPUregisters = {
    A: 0x00,
    X: 0x00,
    Y: 0x00,
    S: 0x00,
    PC: 0x00,
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

let P_VARIABLES = ['C', 'Z', 'I', 'D', 'B', 'U', 'V', 'N'];

// Destructure for easier access
let { A, X, Y, S, PC } = CPUregisters;

// 6502 CPU opcode object
const opcodes = {
    ADC: {
    immediate: {code: 0x69, length: 2, pcIncrement: 2},
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
    implied: {code: 0x78, length: 1, pcIncrement: 1, function: 'SEI()'}
    },
    CLV: {
    implied: {code: 0xB8, length: 1, pcIncrement: 1}
    },
    CLD: {
    implied: {code: 0xD8, length: 1, pcIncrement: 1}
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
    zeroPage: {code: 0x26, length: 2, pcIncrement: 2},
    zeroPagex: {code: 0x36, length: 2, pcIncrement: 2},
    absolute: {code: 0x2E, length: 3, pcIncrement: 3},
    absoluteX: {code: 0x3E, length: 3, pcIncrement: 3}
},

}

// TO DO: break opcodes into even amount and ID them, make separate smaller switch cases
// and call the ID'd switch for optimisation
function opcodeSwitch(codeToProcess,opcode) {
switch (codeToProcess) {
    case 0x78:
        SEI();
        break;
    case 0x69:
        ADC_IMM();
        break;
    case 0x26:
        ROL_ZP();
        break;
    default: window.alert(`Opcode ${hexPrefix}${codeToProcess} not implemented`);
        break;
    }
}

function SEI() {
    // opcode only sets status register 'I', tested good
    CPUregisters.P.I=true;
    }

function ADC_IMM() {
    A = parseInt(loadedROM[PC+1], 16);
    console.log(`Operand for 0x69 is ${loadedROM[PC+1]}`);
    console.log (`the new value of A reg is ${A}`);
    CPUregisters.P.C == true ? A : A+=1;
}

function ROL_ZP() {
    zpgAddr= parseInt(loadedROM[PC+1], 16);
    // Load the value at the specified zero-page memory location
    let value = workRamIdArray[zpgAddr];
    // Rotate left and shift in the carry flag
    const carry = (value & 0x80) >> 7;
    value = ((value << 1) & 0xfe) | parseInt(CPUregisters.P.C);
    // Update the carry flag
    CPUregisters.P.C = (carry == 0) ? false : true;
    // Store the updated value back to the same zero-page memory location
    memoryMap[zpgAddr] = (memoryMap[zpgAddr] != 0) ? value : memoryMap[zpgAddr];
    // Update the zero and negative flags
    CPUregisters.P.Z = value === 0;
    CPUregisters.P.N = (value & 0x80) !== 0;
  }
