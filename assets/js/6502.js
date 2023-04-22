const CPUregisters = {
    A: 0x00,
    X: 0x00,
    Y: 0x00,
    S: 0x00,
    PC: 0x00,
    P: {
        C: 0,    // Carry
        Z: 0,    // Zero
        I: 0,    // Interrupt Disable
        D: 0,    // Decimal Mode
        B: 0,    // Break Command
        U: 'NA', // Unused
        V: 0,    // Overflow
        N: 0     // Negative
    }
};

const P_VARIABLES = ['C', 'Z', 'I', 'D', 'B', 'U', 'V', 'N'];

// Destructure for easier access
// P variables are accessible globally via c,z,i,d,b,u,v,n 
const { A, X, Y, S, PC } = CPUregisters;
console.log(CPUregisters);

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
    implied: {code: 0x78, length: 1, pcIncrement: 1}
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
    }
}
      
  
console.log(opcodes);