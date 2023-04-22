const CPUregisters = {
    A: { 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 },
    X: { 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 },
    Y: { 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 },
    // default to bit 2 set (unused)
    S: {
      15: 0,
      14: 0,
      13: 0,
      12: 0,
      11: 0,
      10: 0,
      9: 0,
      8: 0,
      7: 0,
      6: 0,
      5: 0,
      4: 0,
      3: 0,
      2: 1,
      1: 0,
      0: 0
    },
    PC: { 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 },
    // status register (P)
    P: {
        0: 0,       // C
        1: 0,       // Z
        2: 0,       // I
        3: 0,       // D
        4: 0,       // B
        5: 'NA',    // unused
        6: 1,       // V
        7: 0        // N
      }      
  };

// Destructure for easier access
const { A, X, Y, S, PC, P } = CPUregisters;
console.log(CPUregisters)

// 6502 CPU opcode object
const opcodes = {
    ADC: {
      immediate: 0x69,
      zeroPage: 0x65,
      zeroPagex: 0x75,
      absolute: 0x6D,
      absolutex: 0x7D,
      absolutey: 0x79,
      indirectx: 0x61,
      indirecty: 0x71
    },
    AND: {
      immediate: 0x29,
      zeroPage: 0x25,
      zeroPagex: 0x35,
      absolute: 0x2D,
      absolutex: 0x3D,
      absolutey: 0x39,
      indirectx: 0x21,
      indirecty: 0x31
    },
    ASL: {
      accumulator: 0x0A,
      zeroPage: 0x06,
      zeroPagex: 0x16,
      absolute: 0x0E,
      absolutex: 0x1E
    },
    BIT: {
      zeroPage: 0x24,
      absolute: 0x2C
    },
    BPL: {
      relative: 0x10
    },
    BMI: {
      relative: 0x30
    },
    BVC: {
      relative: 0x50
    },
    BCC: {
      relative: 0x90
    },
    BCS: {
      relative: 0xB0
    },
    BNE: {
      relative: 0xD0
    },
    BEQ: {
      relative: 0xF0
    },
    BRK: {
      implied: 0x00
    },
    CMP: {
      immediate: 0xC9,
      zeroPage: 0xC5,
      zeroPagex: 0xD5,
      absolute: 0xCD,
      absolutex: 0xDD,
      absolutey: 0xD9,
      indirectx: 0xC1,
      indirecty: 0xD1
    },
    CPY: {
      immediate: 0xC0,
      zeroPage: 0xC4,
      absolute: 0xCC
    },
    DEC: {
      zeroPage: 0xC6,
      zeroPagex: 0xD6,
      absolute: 0xCE,
      absolutex: 0xDE
    },
    EOR: {
      immediate: 0x49,
      zeroPage: 0x45,
      zeroPagex: 0x55,
      absolute: 0x4D,
      absolutex: 0x5D,
      absolutey: 0x59,
      indirectx: 0x41,
      indirecty: 0x51
    },
    CLC: {
      implied: 0x18
    },
    SEC: {
      implied: 0x38
    },
    CLI: {
      implied: 0x58
    },
    SEI: {
      implied: 0x78
    },
    CLV: {
      implied: 0xB8
    },
    CLD: {
      implied: 0xD8
    },
    SED: {
      implied: 0xF8
    },
    INC: {
      zeroPage: 0xE6,
      zeroPagex: 0xF6,
      absolute: 0xEE,
      absolutex: 0xFE
    },
    JMP: {
      absolute: 0x4C,
      indirect: 0x6C
    }
}
  
console.log(opcodes);