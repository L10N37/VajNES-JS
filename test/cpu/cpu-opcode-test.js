// Helper: reset CPU registers and memory, and load instruction
function setup({ opcode, operands = [], A = 0x00, X = 0x00, Y = 0x00 }) {
  // Clear memory
  for (let i = 0; i < systemMemory.length; i++) systemMemory[i] = 0x00;
  // Reset registers
  CPUregisters.PC = 0x0000;
  CPUregisters.A  = A & 0xFF;
  CPUregisters.X  = X & 0xFF;
  CPUregisters.Y  = Y & 0xFF;
  // Load instruction and operands
  systemMemory[0] = opcode;
  operands.forEach((b, i) => systemMemory[1 + i] = b & 0xFF);
}

// Simple assertion
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// STA Tests
function test_STA_ZP() {
  setup({ opcode: 0x85, operands: [0x10], A: 0xAB });
  STA_ZP();
  assert(systemMemory[0x0010] === 0xAB, 'STA ZP should store A into zero page');
}

function test_STA_ZPX() {
  setup({ opcode: 0x95, operands: [0xF0], A: 0x12, X: 0x20 });
  STA_ZPX();
  // zero-page wrap: (0xF0 + 0x20) & 0xFF = 0x10
  assert(systemMemory[0x0010] === 0x12, 'STA ZPX should wrap within zero page');
}

function test_STA_ABS() {
  setup({ opcode: 0x8D, operands: [0x34, 0x12], A: 0xCD });
  STA_ABS();
  // $1234 falls in mirrored RAM ($0000–$1FFF), mirror to $1234 % 0x0800 = $0234
  assert(
    systemMemory[0x0234] === 0xCD,
    'STA ABS should store A into mirrored RAM at 0x0234'
  );
}

function test_STA_ABSX() {
  setup({ opcode: 0x9D, operands: [0x00, 0x10], A: 0xEF, X: 0x20 });
  STA_ABSX();
  // $1020 is also in mirrored RAM, so mirror to 0x1020 % 0x0800 = 0x0020
  assert(
    systemMemory[0x0020] === 0xEF,
    'STA ABSX should store A into mirrored RAM at 0x0020'
  );
}

function test_STA_ABSY() {
  setup({ opcode: 0x99, operands: [0x00, 0x20], A: 0x23, Y: 0x10 });
  STA_ABSY();

  const addr = 0x2010;            // $2000 + Y
  const reg  = addr & 0x0007;     // which PPU register

  if (typeof window.ppuWrite === 'function') {
    // PPU is hooked up ⇒ writes go into PPUregisters
    assert(
      window.PPUregisters[window.PPU_VARIABLES[reg]] === 0x23,
      `STA ABSY should write A to PPU register ${window.PPU_VARIABLES[reg]}`
    );
  } else {
    // fallback (no PPU) ⇒ writes go into systemMemory
    assert(
      systemMemory[addr] === 0x23,
      'STA ABSY should store A at absolute+Y in RAM'
    );
  }
}

function test_STA_INDX() {
  // pointer @ 0x10 + X=0x04 => zpAddr=0x14 -> fetch low/high from 0x14/0x15
  setup({ opcode: 0x81, operands: [0x10], A: 0x77, X: 0x04 });
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  STA_INDX();
  assert(systemMemory[0x8000] === 0x77, 'STA INDX should store via indexed indirect');
}

function test_STA_INDY() {
  // pointer @ 0x20 -> base from 0x20/0x21, then +Y
  setup({ opcode: 0x91, operands: [0x20], A: 0x9A, Y: 0x10 });
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x70;
  STA_INDY();
  assert(systemMemory[0x7010] === 0x9A, 'STA INDY should store via indirect indexed');
}

// LDA Tests
function test_LDA_IMM() {
  setup({ opcode: 0xA9, operands: [0x80] });
  LDA_IMM();
  assert(CPUregisters.A === 0x80, 'LDA IMM should load immediate value');
  assert(!CPUregisters.P.Z,  'LDA IMM Z flag');
  assert( CPUregisters.P.N,  'LDA IMM N flag');
}

function test_LDA_ZP() {
  setup({ opcode: 0xA5, operands: [0x10] });
  systemMemory[0x0010] = 0x00;
  LDA_ZP();
  assert(CPUregisters.A === 0x00, 'LDA ZP should load from zero page');
  assert(CPUregisters.P.Z,  'LDA ZP Z flag');
}

function test_LDA_ZPX() {
  setup({ opcode: 0xB5, operands: [0xF0], X: 0x20 });
  systemMemory[0x0010] = 0xFF;
  LDA_ZPX();
  assert(CPUregisters.A === 0xFF, 'LDA ZPX should wrap and load');
  assert(!CPUregisters.P.Z, 'LDA ZPX Z flag');
  assert(CPUregisters.P.N,  'LDA ZPX N flag');
}

function test_LDA_ABS() {
  setup({ opcode: 0xAD, operands: [0x34, 0x12] });
  const addr = 0x1234;
  // $1234 mirrors into $0000–$07FF: 0x1234 % 0x0800 = 0x0234
  const mirror = addr % 0x0800;
  systemMemory[mirror] = 0x55;
  LDA_ABS();
  assert(
    CPUregisters.A === 0x55,
    `LDA ABS should load from mirrored RAM at 0x${mirror.toString(16).padStart(4,'0')}`
  );
}

function test_LDA_ABSX() {
  // Use base 0x6000 (SRAM area) so no mirroring interferes
  setup({ opcode: 0xBD, operands: [0x00, 0x60], X: 0x01 });
  // Effective address = 0x6000 + 1 = 0x6001
  systemMemory[0x6001] = 0x0F;
  LDA_ABSX();
  assert(
    CPUregisters.A === 0x0F,
    'LDA ABSX should load from 0x6001 (0x6000 + X)'
  );
  assert(
    CPUregisters.P.Z === false && CPUregisters.P.N === false,
    'LDA ABSX should correctly set Z/N flags for non‑zero, positive'
  );
}

function test_LDA_ABSY() {
  setup({ opcode: 0xB9, operands: [0x00, 0x20], Y: 0x02 });
  systemMemory[0x2002] = 0xAA;
  LDA_ABSY();
  assert(CPUregisters.A === 0xAA, 'LDA ABSY should add Y to base');
}

function test_LDA_INDX() {
  setup({ opcode: 0xA1, operands: [0x10], X: 0x04 });
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x90;
  systemMemory[0x9000] = 0x42;
  LDA_INDX();
  assert(CPUregisters.A === 0x42, 'LDA INDX should load via indexed indirect');
}

function test_LDA_INDY() {
  setup({ opcode: 0xB1, operands: [0x20], Y: 0x10 });
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x80;
  systemMemory[0x8010] = 0x37;
  LDA_INDY();
  assert(CPUregisters.A === 0x37, 'LDA INDY should load via indirect indexed');
}

// LDX Tests
function test_LDX_IMM() {
  setup({ opcode: 0xA2, operands: [0x3C] });
  LDX_IMM();
  assert(CPUregisters.X === 0x3C, 'LDX IMM should load immediate into X');
}

function test_LDX_ZP() {
  setup({ opcode: 0xA6, operands: [0x20] });
  systemMemory[0x0020] = 0x7F;
  LDX_ZP();
  assert(CPUregisters.X === 0x7F, 'LDX ZP should load from zero page into X');
}

function test_LDX_ZPY() {
  setup({ opcode: 0xB6, operands: [0xE0], Y: 0x10 });
  systemMemory[0x00F0] = 0x10;
  LDX_ZPY();
  assert(CPUregisters.X === 0x10, 'LDX ZPY should wrap and load with Y offset');
}

function test_LDX_ABS() {
  setup({ opcode: 0xAE, operands: [0x00, 0x40] });
  systemMemory[0x4000] = 0xAA;
  LDX_ABS();
  assert(CPUregisters.X === 0xAA, 'LDX ABS should load from absolute into X');
}

function test_LDX_ABSY() {
  setup({ opcode: 0xBE, operands: [0x00, 0x50], Y: 0x01 });
  systemMemory[0x5001] = 0x55;
  LDX_ABSY();
  assert(CPUregisters.X === 0x55, 'LDX ABSY should add Y to base and load into X');
}

// ADC Tests
function test_ADC_IMM() {
  setup({ opcode: 0x69, operands: [0x10], A: 0x10 });
  CPUregisters.P.C = 0;
  ADC_IMM();
  assert(CPUregisters.A === 0x20, 'ADC IMM should add immediate and C flag');
}

function test_ADC_ZP() {
  setup({ opcode: 0x65, operands: [0x30], A: 0x05 });
  systemMemory[0x0030] = 0x05;
  CPUregisters.P.C = 0;
  ADC_ZP();
  assert(CPUregisters.A === 0x0A, 'ADC ZP should add zero page value');
}

function test_ADC_ZPX() {
  setup({ opcode: 0x75, operands: [0xF0], A: 0x01, X: 0x10 });
  systemMemory[0x0000] = 0x02; // wrap
  ADC_ZPX();
  assert(CPUregisters.A === 0x03, 'ADC ZPX should wrap and add');
}

function test_ADC_ABS() {
  setup({ opcode: 0x6D, operands: [0x00, 0x20], A: 0x20 });
  systemMemory[0x2000] = 0x10;
  CPUregisters.P.C = 0;
  ADC_ABS();
  assert(CPUregisters.A === 0x30, 'ADC ABS should add absolute value');
}

function test_ADC_ABSX() {
  setup({ opcode: 0x7D, operands: [0x00, 0x20], A: 0x00, X: 0x01 });
  systemMemory[0x2001] = 0x01;
  CPUregisters.P.C = 0;
  ADC_ABSX();
  assert(CPUregisters.A === 0x01, 'ADC ABSX should add with X offset');
}

function test_ADC_ABSY() {
  // use SRAM area ($6000–$7FFF) to avoid PPU register mirroring
  setup({ opcode: 0x79, operands: [0x00, 0x60], A: 0x02, Y: 0x02 });
  // effective address = 0x6000 + 2 = 0x6002
  systemMemory[0x6002] = 0x02;
  CPUregisters.P.C = 0;
  ADC_ABSY();
  assert(
    CPUregisters.A === 0x04,
    'ADC ABSY should add memory at 0x6002 to A with no carry'
  );
}

function test_ADC_INDX() {
  // (indirect,X) in PRG-ROM area
  setup({ opcode: 0x61, operands: [0x10], A: 0x03, X: 0x04 });
  // pointer = (0x10 + 4) & 0xFF = 0x14
  systemMemory[0x0014] = 0x00;  // low byte
  systemMemory[0x0015] = 0x90;  // high byte → base=0x9000
  // operand at 0x9000
  systemMemory[0x9000] = 0x04;
  CPUregisters.P.C = 0;
  ADC_INDX();
  assert(
    CPUregisters.A === 0x07,
    'ADC INDX should add value from 0x9000 to A (3 + 4)'
  );
}

function test_ADC_INDY() {
  // (indirect),Y in PRG-ROM area
  setup({ opcode: 0x71, operands: [0x20], A: 0x01, Y: 0x02 });
  // pointer at 0x20 → low=0x00, high=0x80 → base=0x8000
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x80;
  // operand at 0x8000 + Y = 0x8002
  systemMemory[0x8002] = 0x03;
  CPUregisters.P.C = 0;
  ADC_INDY();
  assert(
    CPUregisters.A === 0x04,
    'ADC INDY should add value from 0x8002 to A (1 + 3)'
  );
}

// AND Tests
function test_AND_IMM() {
  // Choose A=0xFF & immediate=0x80 → result=0x80 (non‑zero, bit7=1)
  setup({ opcode: 0x29, operands: [0x80], A: 0xFF });
  AND_IMM();
  assert(CPUregisters.A === 0x80, 'AND IMM should bitwise AND immediate with A');
  assert(!CPUregisters.P.Z,       'AND IMM Z flag should clear when result ≠ 0');
  assert(CPUregisters.P.N,        'AND IMM N flag should reflect bit 7 of result');
}

function test_AND_ZP() {
  setup({ opcode: 0x25, operands: [0x10], A: 0xAA });
  systemMemory[0x0010] = 0x0F;
  AND_ZP();
  assert(CPUregisters.A === (0xAA & 0x0F), 'AND ZP should AND A with value from zero page');
}

function test_AND_ZPX() {
  setup({ opcode: 0x35, operands: [0xF0], A: 0xFF, X: 0x20 });
  // zero‑page wrap: (0xF0 + 0x20) & 0xFF = 0x10
  systemMemory[0x0010] = 0x0F;
  AND_ZPX();
  assert(CPUregisters.A === (0xFF & 0x0F), 'AND ZPX should wrap and AND with zero‑page X offset');
}

function test_AND_ABS() {
  setup({ opcode: 0x2D, operands: [0x34, 0x12], A: 0x0F });
  systemMemory[0x1234] = 0xF0;
  AND_ABS();
  assert(CPUregisters.A === (0x0F & 0xF0), 'AND ABS should AND A with absolute memory');
}

function test_AND_ABSX() {
  // Use SRAM area to avoid mirroring: base $6000 + X
  setup({ opcode: 0x3D, operands: [0x00, 0x60], A: 0xFF, X: 0x01 });
  // Effective address = 0x6000 + 1 = 0x6001
  systemMemory[0x6001] = 0x55;
  AND_ABSX();
  // 0xFF & 0x55 = 0x55
  assert(
    CPUregisters.A === 0x55,
    'AND ABSX should AND A with value from 0x6001'
  );
  assert(
    CPUregisters.P.Z === false && CPUregisters.P.N === false,
    'AND ABSX should clear Z and N when result is non‑zero and bit 7 = 0'
  );
}

function test_AND_ABSY() {
  setup({ opcode: 0x39, operands: [0x00, 0x20], A: 0xAA, Y: 0x02 });
  systemMemory[0x2002] = 0x0F;
  AND_ABSY();
  assert(CPUregisters.A === (0xAA & 0x0F), 'AND ABSY should AND A with absolute Y offset');
}

function test_AND_INDX() {
  setup({ opcode: 0x21, operands: [0x10], A: 0xF0, X: 0x04 });
  // pointer @ (0x10 + X)=0x14 → fetch address from 0x14/0x15
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  systemMemory[0x8000] = 0x0F;
  AND_INDX();
  assert(CPUregisters.A === (0xF0 & 0x0F), 'AND INDX should AND via indexed indirect');
}

function test_AND_INDY() {
  setup({ opcode: 0x31, operands: [0x20], A: 0x0F, Y: 0x10 });
  // pointer @ 0x20 → 0x0020/0x0021, then + Y
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x70;
  systemMemory[0x7010] = 0xF0;
  AND_INDY();
  assert(CPUregisters.A === (0x0F & 0xF0), 'AND INDY should AND via indirect indexed');
}

// ASL Tests
function test_ASL_ACC() {
  // Case 1: original bit 7 = 1 → carry out, result = 0
  setup({ opcode: 0x0A, A: 0x80 });
  CPUregisters.P.C = 0;
  ASL_ACC();
  assert(CPUregisters.A === 0x00, 'ASL ACC should shift A left dropping bit 7');
  assert(CPUregisters.P.C === 1,  'ASL ACC should set C flag from original bit 7');
  assert(CPUregisters.P.Z === 1,  'ASL ACC should set Z when result = 0');
  assert(CPUregisters.P.N === 0,  'ASL ACC should clear N when result bit 7 = 0');

  // Case 2: original bit 7 = 0 → no carry, result positive
  setup({ opcode: 0x0A, A: 0x01 });
  CPUregisters.P.C = 1;
  ASL_ACC();
  assert(CPUregisters.A === 0x02, 'ASL ACC should shift A left by one');
  assert(CPUregisters.P.C === 0,  'ASL ACC should clear C when original bit 7 = 0');
  assert(CPUregisters.P.Z === 0,  'ASL ACC should clear Z when result ≠ 0');
  assert(CPUregisters.P.N === 0,  'ASL ACC should clear N when result bit 7 = 0');

  // Case 3: shift results in bit 7 = 1 → N flag
  setup({ opcode: 0x0A, A: 0x40 });
  CPUregisters.P.C = 0;
  ASL_ACC();
  assert(CPUregisters.A === 0x80, 'ASL ACC should shift A left to 0x80');
  assert(CPUregisters.P.C === 0,  'ASL ACC should clear C when original bit 7 = 0');
  assert(CPUregisters.P.Z === 0,  'ASL ACC should clear Z when result ≠ 0');
  assert(CPUregisters.P.N === 1,  'ASL ACC should set N when result bit 7 = 1');
}

function test_ASL_ZP() {
  setup({ opcode: 0x06, operands: [0x10] });
  systemMemory[0x0010] = 0x01;
  ASL_ZP();
  assert(systemMemory[0x0010] === 0x02, 'ASL ZP should shift zero‐page value left');
}

function test_ASL_ZPX() {
  setup({ opcode: 0x16, operands: [0xF0], X: 0x10 });
  // zero‑page wrap: (0xF0 + 0x10) & 0xFF = 0x00
  systemMemory[0x0000] = 0x02;
  ASL_ZPX();
  assert(systemMemory[0x0000] === 0x04, 'ASL ZPX should wrap and shift left with X offset');
}

function test_ASL_ABS() {
  setup({ opcode: 0x0E, operands: [0x00, 0x20] });
  systemMemory[0x2000] = 0x80;
  ASL_ABS();
  assert(systemMemory[0x2000] === 0x00, 'ASL ABS should shift absolute value left, dropping bit 7');
  assert(CPUregisters.P.C === 1,       'ASL ABS should set C flag from original bit 7');
}

function test_ASL_ABSX() {
  setup({ opcode: 0x1E, operands: [0x00, 0x20], X: 0x01 });
  systemMemory[0x2001] = 0x01;
  ASL_ABSX();
  assert(systemMemory[0x2001] === 0x02, 'ASL ABSX should shift left with X offset');
}

// BIT Tests
function test_BIT_ZP() {
  // Z flag set when A & M == 0
  setup({ opcode: 0x24, operands: [0x10], A: 0x00 });
  systemMemory[0x0010] = 0xFF;
  BIT_ZP();
  assert(CPUregisters.P.Z === 1, 'BIT ZP should set Z when (A & M) == 0');
  // V and N flags reflect bits 6 and 7 of M
  setup({ opcode: 0x24, operands: [0x10], A: 0xFF });
  systemMemory[0x0010] = 0xC0;  // bit7=1, bit6=1
  BIT_ZP();
  assert(CPUregisters.P.Z === 0, 'BIT ZP should clear Z when (A & M) != 0');
  assert(CPUregisters.P.V === 1, 'BIT ZP should set V from bit 6 of M');
  assert(CPUregisters.P.N === 1, 'BIT ZP should set N from bit 7 of M');
}

function test_BIT_ABS() {
  // absolute addressing version of BIT
  setup({ opcode: 0x2C, operands: [0x00, 0x20], A: 0x00 });
  systemMemory[0x2000] = 0x01;
  BIT_ABS();
  assert(CPUregisters.P.Z === 1, 'BIT ABS should set Z when (A & M) == 0');
  setup({ opcode: 0x2C, operands: [0x00, 0x20], A: 0xFF });
  systemMemory[0x2000] = 0x40;  // bit6=1, bit7=0
  BIT_ABS();
  assert(CPUregisters.P.Z === 0, 'BIT ABS should clear Z when (A & M) != 0');
  assert(CPUregisters.P.V === 1, 'BIT ABS should set V from bit 6 of M');
  assert(CPUregisters.P.N === 0, 'BIT ABS should set N from bit 7 of M');
}

// LSR Tests
function test_LSR_ACC() {
  // shift A right, bit 0 → C flag
  setup({ opcode: 0x4A, operands: [], A: 0x03 });
  CPUregisters.P.C = 0;
  LSR_ACC();
  assert(CPUregisters.A === 0x01, 'LSR ACC should shift A right by one');
  assert(CPUregisters.P.C === 1,  'LSR ACC should set C from original bit 0');
  // zero result case
  setup({ opcode: 0x4A, operands: [], A: 0x00 });
  CPUregisters.P.C = 1;
  LSR_ACC();
  assert(CPUregisters.A === 0x00, 'LSR ACC should leave zero as zero');
  assert(CPUregisters.P.C === 0,  'LSR ACC should clear C when shifting 0');
}

function test_LSR_ZP() {
  setup({ opcode: 0x46, operands: [0x10] });
  systemMemory[0x0010] = 0x02;
  CPUregisters.P.C = 0;
  LSR_ZP();
  assert(systemMemory[0x0010] === 0x01, 'LSR ZP should shift zero‑page value right');
  assert(CPUregisters.P.C === 0,        'LSR ZP should clear C when bit 0 was 0');
}

function test_LSR_ZPX() {
  setup({ opcode: 0x56, operands: [0xF0], X: 0x10 });
  // wrap to address 0x00
  systemMemory[0x0000] = 0x03;
  CPUregisters.P.C = 0;
  LSR_ZPX();
  assert(systemMemory[0x0000] === 0x01, 'LSR ZPX should wrap and shift right with X offset');
  assert(CPUregisters.P.C === 1,        'LSR ZPX should set C from original bit 0');
}

function test_LSR_ABS() {
  setup({ opcode: 0x4E, operands: [0x00, 0x20] });
  systemMemory[0x2000] = 0x01;
  CPUregisters.P.C = 0;
  LSR_ABS();
  assert(systemMemory[0x2000] === 0x00, 'LSR ABS should shift absolute value right');
  assert(CPUregisters.P.C === 1,        'LSR ABS should set C from original bit 0');
}

function test_LSR_ABSX() {
  setup({ opcode: 0x5E, operands: [0x00, 0x20], X: 0x01 });
  systemMemory[0x2001] = 0x02;
  CPUregisters.P.C = 0;
  LSR_ABSX();
  assert(systemMemory[0x2001] === 0x01, 'LSR ABSX should shift right with X offset');
}

// ORA Tests
function test_ORA_IMM() {
  // zero result and negative flag
  setup({ opcode: 0x09, operands: [0x00], A: 0x00 });
  ORA_IMM();
  assert(CPUregisters.A === 0x00,      'ORA IMM should OR A with immediate value');
  assert(CPUregisters.P.Z === 1,       'ORA IMM should set Z when result is zero');
  setup({ opcode: 0x09, operands: [0x80], A: 0x00 });
  ORA_IMM();
  assert(CPUregisters.A === 0x80,      'ORA IMM should set A correctly');
  assert(CPUregisters.P.N === 1,       'ORA IMM should set N from bit 7 of result');
}

function test_ORA_ZP() {
  setup({ opcode: 0x05, operands: [0x10], A: 0x01 });
  systemMemory[0x0010] = 0x02;
  ORA_ZP();
  assert(CPUregisters.A === 0x03,      'ORA ZP should OR A with zero‑page value');
}

function test_ORA_ZPX() {
  setup({ opcode: 0x15, operands: [0xF0], A: 0x01, X: 0x10 });
  systemMemory[0x0010] = 0x04;  // wrap => (0xF0+0x10)&FF = 0x00
  ORA_ZPX();
  assert(CPUregisters.A === 0x05,      'ORA ZPX should wrap and OR with X offset');
}

function test_ORA_ABS() {
  setup({ opcode: 0x0D, operands: [0x00, 0x20], A: 0x10 });
  systemMemory[0x2000] = 0x01;
  ORA_ABS();
  assert(CPUregisters.A === 0x11,      'ORA ABS should OR A with absolute memory');
}

function test_ORA_ABSX() {
  setup({ opcode: 0x1D, operands: [0x00, 0x20], A: 0x01, X: 0x01 });
  systemMemory[0x2001] = 0x02;
  ORA_ABSX();
  assert(CPUregisters.A === 0x03,      'ORA ABSX should OR with absolute X offset');
}

function test_ORA_ABSY() {
  setup({ opcode: 0x19, operands: [0x00, 0x30], A: 0x04, Y: 0x02 });
  systemMemory[0x3002] = 0x01;
  ORA_ABSY();
  assert(CPUregisters.A === 0x05,      'ORA ABSY should OR with absolute Y offset');
}

function test_ORA_INDX() {
  setup({ opcode: 0x01, operands: [0x10], A: 0x02, X: 0x04 });
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x90;
  systemMemory[0x9002] = 0x01;
  ORA_INDX();
  assert(CPUregisters.A === 0x03,      'ORA INDX should OR via indexed indirect');
}

function test_ORA_INDY() {
  setup({ opcode: 0x11, operands: [0x20], A: 0x08, Y: 0x02 });
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x80;
  systemMemory[0x800A] = 0x02;
  ORA_INDY();
  assert(CPUregisters.A === 0x0A,      'ORA INDY should OR via indirect indexed');
}

// BPL (Branch if Positive) Tests
function test_BPL_REL_notTaken() {
  setup({ opcode: 0x10, operands: [0x04] });
  CPUregisters.P.N = 1;                   // Negative flag set → branch not taken
  BPL_REL();
  assert(CPUregisters.PC === 2, 'BPL not taken should advance PC by 2');
}

function test_BPL_REL_takenForward() {
  setup({ opcode: 0x10, operands: [0x04] });
  CPUregisters.P.N = 0;                   // Negative flag clear → branch taken
  BPL_REL();
  assert(CPUregisters.PC === 6, 'BPL taken forward should add offset +4');
}

function test_BPL_REL_takenBackward() {
  setup({ opcode: 0x10, operands: [0xFC] }); // 0xFC = -4 signed
  CPUregisters.P.N = 0;
  BPL_REL();
  assert(CPUregisters.PC === ((2 - 4) & 0xFFFF), 'BPL taken backward should subtract 4 from PC');
}

// BMI (Branch if Minus) Tests
function test_BMI_REL_notTaken() {
  setup({ opcode: 0x30, operands: [0x03] });
  CPUregisters.P.N = 0;
  BMI_REL();
  assert(CPUregisters.PC === 2, 'BMI not taken should advance PC by 2');
}

function test_BMI_REL_takenForward() {
  setup({ opcode: 0x30, operands: [0x03] });
  CPUregisters.P.N = 1;
  BMI_REL();
  assert(CPUregisters.PC === 5, 'BMI taken forward should add offset +3');
}

function test_BMI_REL_takenBackward() {
  setup({ opcode: 0x30, operands: [0xFD] }); // -3
  CPUregisters.P.N = 1;
  BMI_REL();
  assert(CPUregisters.PC === ((2 - 3) & 0xFFFF), 'BMI taken backward should subtract 3 from PC');
}

// BVC (Branch if Overflow Clear) Tests
function test_BVC_REL_notTaken() {
  setup({ opcode: 0x50, operands: [0x05] });
  CPUregisters.P.V = 1;
  BVC_REL();
  assert(CPUregisters.PC === 2, 'BVC not taken should advance PC by 2');
}

function test_BVC_REL_takenForward() {
  setup({ opcode: 0x50, operands: [0x05] });
  CPUregisters.P.V = 0;
  BVC_REL();
  assert(CPUregisters.PC === 7, 'BVC taken forward should add offset +5');
}

function test_BVC_REL_takenBackward() {
  setup({ opcode: 0x50, operands: [0xFB] }); // -5
  CPUregisters.P.V = 0;
  BVC_REL();
  assert(CPUregisters.PC === ((2 - 5) & 0xFFFF), 'BVC taken backward should subtract 5 from PC');
}

// BCC (Branch if Carry Clear) Tests
function test_BCC_REL_notTaken() {
  setup({ opcode: 0x90, operands: [0x02] });
  CPUregisters.P.C = 1;
  BCC_REL();
  assert(CPUregisters.PC === 2, 'BCC not taken should advance PC by 2');
}

function test_BCC_REL_takenForward() {
  setup({ opcode: 0x90, operands: [0x02] });
  CPUregisters.P.C = 0;
  BCC_REL();
  assert(CPUregisters.PC === 4, 'BCC taken forward should add offset +2');
}

function test_BCC_REL_takenBackward() {
  setup({ opcode: 0x90, operands: [0xFE] }); // -2
  CPUregisters.P.C = 0;
  BCC_REL();
  assert(CPUregisters.PC === ((2 - 2) & 0xFFFF), 'BCC taken backward should subtract 2 from PC');
}

// BCS (Branch if Carry Set) Tests
function test_BCS_REL_notTaken() {
  setup({ opcode: 0xB0, operands: [0x03] });
  CPUregisters.P.C = 0;
  BCS_REL();
  assert(CPUregisters.PC === 2, 'BCS not taken should advance PC by 2');
}

function test_BCS_REL_takenForward() {
  setup({ opcode: 0xB0, operands: [0x03] });
  CPUregisters.P.C = 1;
  BCS_REL();
  assert(CPUregisters.PC === 5, 'BCS taken forward should add offset +3');
}

function test_BCS_REL_takenBackward() {
  setup({ opcode: 0xB0, operands: [0xFD] }); // -3
  CPUregisters.P.C = 1;
  BCS_REL();
  assert(CPUregisters.PC === ((2 - 3) & 0xFFFF), 'BCS taken backward should subtract 3 from PC');
}

// BNE (Branch if Not Equal) Tests
function test_BNE_REL_notTaken() {
  setup({ opcode: 0xD0, operands: [0x04] });
  CPUregisters.P.Z = 1;
  BNE_REL();
  assert(CPUregisters.PC === 2, 'BNE not taken should advance PC by 2');
}

function test_BNE_REL_takenForward() {
  setup({ opcode: 0xD0, operands: [0x04] });
  CPUregisters.P.Z = 0;
  BNE_REL();
  assert(CPUregisters.PC === 6, 'BNE taken forward should add offset +4');
}

function test_BNE_REL_takenBackward() {
  setup({ opcode: 0xD0, operands: [0xFC] }); // -4
  CPUregisters.P.Z = 0;
  BNE_REL();
  assert(CPUregisters.PC === ((2 - 4) & 0xFFFF), 'BNE taken backward should subtract 4 from PC');
}

// BEQ (Branch if Equal) Tests
function test_BEQ_REL_notTaken() {
  setup({ opcode: 0xF0, operands: [0x06] });
  CPUregisters.P.Z = 0;
  BEQ_REL();
  assert(CPUregisters.PC === 2, 'BEQ not taken should advance PC by 2');
}

function test_BEQ_REL_takenForward() {
  setup({ opcode: 0xF0, operands: [0x06] });
  CPUregisters.P.Z = 1;
  BEQ_REL();
  assert(CPUregisters.PC === 8, 'BEQ taken forward should add offset +6');
}

function test_BEQ_REL_takenBackward() {
  setup({ opcode: 0xF0, operands: [0xFA] }); // -6
  CPUregisters.P.Z = 1;
  BEQ_REL();
  assert(CPUregisters.PC === ((2 - 6) & 0xFFFF), 'BEQ taken backward should subtract 6 from PC');
}

// BRK (Force Interrupt) Tests
function test_BRK_IMP() {
  setup({ opcode: 0x00 });
  CPUregisters.PC = 0x1234;
  CPUregisters.S = 0xFF;
  CPUregisters.P = { N:1, V:0, D:1, I:0, Z:1, C:0 };
  systemMemory[0xFFFE] = 0x78;
  systemMemory[0xFFFF] = 0x56;

  BRK_IMP();
  assert(CPUregisters.P.I === 1,     'BRK should set Interrupt Disable flag');
  assert(CPUregisters.PC === 0x5678, 'BRK should load PC from vector');
  assert(CPUregisters.S === 0xFC,    'BRK should push 3 bytes: PC high, PC low, and status');
}

// TXS (Transfer X to Stack Pointer) Tests
function test_TXS_IMP() {
  setup({ opcode: 0x9A });
  CPUregisters.X = 0x42;
  CPUregisters.S = 0x00;
  TXS_IMP();
  assert(CPUregisters.S === 0x42, 'TXS should copy X into S');
}

// CMP Tests
function test_CMP_IMM() {
  // A > M
  setup({ opcode: 0xC9, operands: [0x10], A: 0x20 });
  CMP_IMM();
  assert(CPUregisters.P.C === 1, 'CMP IMM: Carry set when A ≥ M');
  assert(CPUregisters.P.Z === 0, 'CMP IMM: Zero clear when A ≠ M');
  assert(CPUregisters.P.N === 0, 'CMP IMM: Negative clear when A ≥ M');

  // A == M
  setup({ opcode: 0xC9, operands: [0x20], A: 0x20 });
  CMP_IMM();
  assert(CPUregisters.P.C === 1, 'CMP IMM: Carry set when A == M');
  assert(CPUregisters.P.Z === 1, 'CMP IMM: Zero set when A == M');
  assert(CPUregisters.P.N === 0, 'CMP IMM: Negative clear when A == M');

  // A < M
  setup({ opcode: 0xC9, operands: [0x30], A: 0x20 });
  CMP_IMM();
  assert(CPUregisters.P.C === 0, 'CMP IMM: Carry clear when A < M');
  assert(CPUregisters.P.Z === 0, 'CMP IMM: Zero clear when A < M');
  assert(CPUregisters.P.N === 1, 'CMP IMM: Negative set when result negative');
}

function test_CMP_ZP() {
  // A > M
  setup({ opcode: 0xC5, operands: [0x10], A: 0x05 });
  systemMemory[0x0010] = 0x03;
  CMP_ZP();
  assert(CPUregisters.P.C === 1, 'CMP ZP: Carry set when A ≥ M');

  // A < M (zero‑page wrap not involved)
  setup({ opcode: 0xC5, operands: [0x10], A: 0x02 });
  systemMemory[0x0010] = 0x04;
  CMP_ZP();
  assert(CPUregisters.P.C === 0, 'CMP ZP: Carry clear when A < M');
  assert(CPUregisters.P.N === 1, 'CMP ZP: Negative set when result negative');
}

function test_CMP_ZPX() {
  // wrap within zero page
  setup({ opcode: 0xD5, operands: [0xF0], A: 0x10, X: 0x20 });
  const addr = (0xF0 + 0x20) & 0xFF;
  systemMemory[addr] = 0x08;
  CMP_ZPX();
  assert(CPUregisters.P.C === 1, 'CMP ZPX: Carry set when A ≥ M after wrap');

  // A < M
  setup({ opcode: 0xD5, operands: [0xF0], A: 0x05, X: 0x20 });
  systemMemory[addr] = 0x06;
  CMP_ZPX();
  assert(CPUregisters.P.C === 0, 'CMP ZPX: Carry clear when A < M');
}

function test_CMP_ABS() {
  // A == M
  setup({ opcode: 0xCD, operands: [0x00, 0x20], A: 0x55 });
  systemMemory[0x2000] = 0x55;
  CMP_ABS();
  assert(CPUregisters.P.Z === 1, 'CMP ABS: Zero set when A == M');

  // A < M
  setup({ opcode: 0xCD, operands: [0x00, 0x20], A: 0x10 });
  systemMemory[0x2000] = 0x20;
  CMP_ABS();
  assert(CPUregisters.P.C === 0, 'CMP ABS: Carry clear when A < M');
  assert(CPUregisters.P.N === 1, 'CMP ABS: Negative set when result negative');
}

function test_CMP_ABSX() {
  setup({ opcode: 0xDD, operands: [0x00, 0x10], A: 0x03, X: 0x02 });
  systemMemory[0x1002] = 0x02;
  CMP_ABSX();
  assert(CPUregisters.P.C === 1, 'CMP ABSX: Carry set with X offset');

  setup({ opcode: 0xDD, operands: [0x00, 0x10], A: 0x01, X: 0x02 });
  systemMemory[0x1002] = 0x04;
  CMP_ABSX();
  assert(CPUregisters.P.C === 0, 'CMP ABSX: Carry clear when A < M');
}

function test_CMP_ABSY() {
  setup({ opcode: 0xD9, operands: [0x00, 0x20], A: 0xFF, Y: 0x01 });
  systemMemory[0x2001] = 0x7F;
  CMP_ABSY();
  assert(CPUregisters.P.N === 0, 'CMP ABSY: Negative clear when A ≥ M');

  setup({ opcode: 0xD9, operands: [0x00, 0x20], A: 0x00, Y: 0x01 });
  systemMemory[0x2001] = 0x01;
  CMP_ABSY();
  assert(CPUregisters.P.C === 0, 'CMP ABSY: Carry clear when A < M');
}

function test_CMP_INDX() {
  setup({ opcode: 0xC1, operands: [0x10], A: 0x10, X: 0x04 });
  // pointer calculation
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  systemMemory[0x8000] = 0x10;
  CMP_INDX();
  assert(CPUregisters.P.Z === 1, 'CMP INDX: Zero set when A == M via indexed indirect');
}

function test_CMP_INDY() {
  setup({ opcode: 0xD1, operands: [0x20], A: 0x05, Y: 0x02 });
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x90;
  systemMemory[0x9002] = 0x06;
  CMP_INDY();
  assert(CPUregisters.P.C === 0, 'CMP INDY: Carry clear when A < M via indirect indexed');
}

// CPY Tests
function test_CPY_IMM() {
  // equal
  setup({ opcode: 0xC0, operands: [0x07], Y: 0x07 });
  CPY_IMM();
  assert(CPUregisters.P.Z === 1, 'CPY IMM: Zero set when Y == M');

  // less
  setup({ opcode: 0xC0, operands: [0x08], Y: 0x07 });
  CPY_IMM();
  assert(CPUregisters.P.C === 0, 'CPY IMM: Carry clear when Y < M');
  assert(CPUregisters.P.N === 1, 'CPY IMM: Negative set when result negative');
}

function test_CPY_ZP() {
  setup({ opcode: 0xC4, operands: [0x30], Y: 0x05 });
  systemMemory[0x0030] = 0x05;
  CPY_ZP();
  assert(CPUregisters.P.Z === 1, 'CPY ZP: Zero set when Y == M');
}

function test_CPY_ABS() {
  setup({ opcode: 0xCC, operands: [0x00, 0x40], Y: 0x01 });
  systemMemory[0x4000] = 0x02;
  CPY_ABS();
  assert(CPUregisters.P.C === 0, 'CPY ABS: Carry clear when Y < M');
}

// DEC Tests
function test_DEC_ZP() {
  const addr = 0x10;
  setup({ opcode: 0xC6, operands: [addr] });
  // normal decrement
  systemMemory[addr] = 0x02;
  DEC_ZP();
  assert(systemMemory[addr] === 0x01, 'DEC ZP should decrement memory by one');
  // wrap underflow to 0xFF
  systemMemory[addr] = 0x00;
  DEC_ZP();
  assert(systemMemory[addr] === 0xFF, 'DEC ZP should wrap 0 → 0xFF');
  assert(CPUregisters.P.Z === 0, 'DEC ZP should clear Z when result ≠ 0');
  assert(CPUregisters.P.N === 1, 'DEC ZP should set N when bit 7 of result is set');
}

function test_DEC_ZPX() {
  const base = 0xF0, X = 0x20;
  const addr = (base + X) & 0xFF;
  setup({ opcode: 0xD6, operands: [base], X });
  systemMemory[addr] = 0x01;
  DEC_ZPX();
  assert(systemMemory[addr] === 0x00, 'DEC ZPX should decrement with zero‑page wrap');
}

function test_DEC_ABS() {
  const addr = 0x1234;
  setup({ opcode: 0xCE, operands: [0x34, 0x12] });
  systemMemory[addr] = 0x10;
  DEC_ABS();
  assert(systemMemory[addr] === 0x0F, 'DEC ABS should decrement absolute memory');
}

function test_DEC_ABSX() {
  const base = 0x2000, X = 0x01;
  setup({ opcode: 0xDE, operands: [0x00, 0x20], X });
  systemMemory[base + X] = 0x00;
  DEC_ABSX();
  assert(systemMemory[base + X] === 0xFF, 'DEC ABSX should wrap underflow with X offset');
}

// EOR Tests
function test_EOR_IMM() {
  setup({ opcode: 0x49, operands: [0xFF], A: 0xFF });
  EOR_IMM();
  assert(CPUregisters.A === 0x00, 'EOR IMM should XOR A with immediate');
  assert(CPUregisters.P.Z === 1, 'EOR IMM should set Z when result is zero');

  setup({ opcode: 0x49, operands: [0x01], A: 0x80 });
  EOR_IMM();
  assert(CPUregisters.A === 0x81, 'EOR IMM should produce correct result');
  assert(CPUregisters.P.N === 1, 'EOR IMM should set N from bit 7 of result');
}

function test_EOR_ZP() {
  setup({ opcode: 0x45, operands: [0x20], A: 0x0F });
  systemMemory[0x0020] = 0xF0;
  EOR_ZP();
  assert(CPUregisters.A === 0xFF, 'EOR ZP should XOR with zero‑page value');
}

function test_EOR_ZPX() {
  const base = 0xF0, X = 0x10;
  setup({ opcode: 0x55, operands: [base], A: 0x0F, X });
  systemMemory[(base + X) & 0xFF] = 0xF0;
  EOR_ZPX();
  assert(CPUregisters.A === 0xFF, 'EOR ZPX should wrap and XOR with X offset');
}

function test_EOR_ABS() {
  setup({ opcode: 0x4D, operands: [0x00, 0x30], A: 0xFF });
  systemMemory[0x3000] = 0x0F;
  EOR_ABS();
  assert(CPUregisters.A === 0xF0, 'EOR ABS should XOR with absolute memory');
}

function test_EOR_ABSX() {
  setup({ opcode: 0x5D, operands: [0x00, 0x30], A: 0x0F, X: 0x01 });
  systemMemory[0x3001] = 0xF0;
  EOR_ABSX();
  assert(CPUregisters.A === 0xFF, 'EOR ABSX should XOR with absolute X offset');
}

function test_EOR_ABSY() {
  setup({ opcode: 0x59, operands: [0x00, 0x40], A: 0xF0, Y: 0x02 });
  systemMemory[0x4002] = 0x0F;
  EOR_ABSY();
  assert(CPUregisters.A === 0xFF, 'EOR ABSY should XOR with absolute Y offset');
}

function test_EOR_INDX() {
  setup({ opcode: 0x41, operands: [0x10], A: 0x55, X: 0x04 });
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  systemMemory[0x8055] = 0xFF >>> 8; // place a dummy location
  systemMemory[0x8000] = 0xAA;
  EOR_INDX();
  assert(CPUregisters.A === (0x55 ^ 0xAA), 'EOR INDX should XOR via indexed indirect');
}

function test_EOR_INDY() {
  setup({ opcode: 0x51, operands: [0x20], A: 0x0F, Y: 0x01 });
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x90;
  systemMemory[0x9001] = 0xF0;
  EOR_INDY();
  assert(CPUregisters.A === (0x0F ^ 0xF0), 'EOR INDY should XOR via indirect indexed');
}

// CLC (Clear Carry) Test
function test_CLC_IMP() {
  setup({ opcode: 0x18 });
  CPUregisters.P.C = 1;
  CLC_IMP();
  assert(CPUregisters.P.C === 0, 'CLC should clear the carry flag');
}

// SEC (Set Carry) Test
function test_SEC_IMP() {
  setup({ opcode: 0x38 });
  CPUregisters.P.C = 0;
  SEC_IMP();
  assert(CPUregisters.P.C === 1, 'SEC should set the carry flag');
}

// CLI (Clear Interrupt Disable) Test
function test_CLI_IMP() {
  setup({ opcode: 0x58 });
  CPUregisters.P.I = 1;
  CLI_IMP();
  assert(CPUregisters.P.I === 0, 'CLI should clear the interrupt disable flag');
}

// SEI (Set Interrupt Disable) Test
function test_SEI_IMP() {
  setup({ opcode: 0x78 });
  CPUregisters.P.I = 0;
  SEI_IMP();
  assert(CPUregisters.P.I === 1, 'SEI should set the interrupt disable flag');
}

// CLV (Clear Overflow) Test
function test_CLV_IMP() {
  setup({ opcode: 0xB8 });
  CPUregisters.P.V = 1;
  CLV_IMP();
  assert(CPUregisters.P.V === 0, 'CLV should clear the overflow flag');
}

// CLD (Clear Decimal) Test
function test_CLD_IMP() {
  setup({ opcode: 0xD8 });
  CPUregisters.P.D = 1;
  CLD_IMP();
  assert(CPUregisters.P.D === 0, 'CLD should clear the decimal flag');
}

// SED (Set Decimal) Test
function test_SED_IMP() {
  setup({ opcode: 0xF8 });
  CPUregisters.P.D = 0;
  SED_IMP();
  assert(CPUregisters.P.D === 1, 'SED should set the decimal flag');
}

// INC Tests
function test_INC_ZP() {
  const addr = 0x10;
  setup({ opcode: 0xE6, operands: [addr] });
  // normal increment
  systemMemory[addr] = 0x01;
  INC_ZP();
  assert(systemMemory[addr] === 0x02, 'INC ZP should increment memory by one');
  assert(CPUregisters.P.Z === 0, 'INC ZP should clear Z when result ≠ 0');
  assert(CPUregisters.P.N === 0, 'INC ZP should clear N when result bit 7 = 0');

  // wrap and flags
  systemMemory[addr] = 0xFF;
  INC_ZP();
  assert(systemMemory[addr] === 0x00, 'INC ZP should wrap 0xFF → 0x00');
  assert(CPUregisters.P.Z === 1, 'INC ZP should set Z when result = 0');
  assert(CPUregisters.P.N === 0, 'INC ZP should clear N when result bit 7 = 0');
}

function test_INC_ZPX() {
  const base = 0xF0, X = 0x20;
  const addr = (base + X) & 0xFF;
  setup({ opcode: 0xF6, operands: [base], X });
  systemMemory[addr] = 0x00;
  INC_ZPX();
  assert(systemMemory[addr] === 0x01, 'INC ZPX should wrap zero‑page address and increment');
}

function test_INC_ABS() {
  const a = 0x1234;
  setup({ opcode: 0xEE, operands: [0x34, 0x12] });
  systemMemory[a] = 0x7F;
  INC_ABS();
  assert(systemMemory[a] === 0x80, 'INC ABS should increment absolute memory');
  assert(CPUregisters.P.N === 1, 'INC ABS should set N when bit 7 of result = 1');
}

function test_INC_ABSX() {
  const base = 0x2000, X = 0x01;
  const addr = base + X;
  setup({ opcode: 0xFE, operands: [0x00, 0x20], X });
  systemMemory[addr] = 0xFF;
  INC_ABSX();
  assert(systemMemory[addr] === 0x00, 'INC ABSX should wrap and increment with X offset');
  assert(CPUregisters.P.Z === 1, 'INC ABSX should set Z when result = 0');
}

// JMP Tests
function test_JMP_ABS() {
  setup({ opcode: 0x4C, operands: [0x34, 0x12] });
  CPUregisters.PC = 0x0000;
  JMP_ABS();
  assert(CPUregisters.PC === 0x1234, 'JMP_ABS should set PC to absolute address');
}

function test_JMP_IND_normal() {
  // pointer at 0x1000 points to 0x2000
  setup({ opcode: 0x6C, operands: [0x00, 0x10] });
  systemMemory[0x1000] = 0x00; // low byte
  systemMemory[0x1001] = 0x20; // high byte
  JMP_IND();
  assert(CPUregisters.PC === 0x2000, 'JMP_IND should set PC via indirect pointer');
}

function test_JMP_IND_pageBoundaryBug() {
  // Emulate 6502 bug: pointer low byte at 0x10FF wraps to 0x1000 for high byte
  setup({ opcode: 0x6C, operands: [0xFF, 0x10] });
  systemMemory[0x10FF] = 0xAA;
  systemMemory[0x1000] = 0xBB;
  JMP_IND();
  assert(CPUregisters.PC === 0xBBAA, 'JMP_IND should wrap page boundary when fetching high byte');
}

// ROL Tests
function test_ROL_ACC_carryIn() {
  setup({ opcode: 0x2A });
  CPUregisters.A = 0x01;
  CPUregisters.P.C = 1;
  ROL_ACC();
  assert(CPUregisters.A === 0x03, 'ROL_ACC should rotate left including carry in');
  assert(CPUregisters.P.C === 0,   'ROL_ACC should set carry from original bit 7');
}

function test_ROL_ACC_carryOut() {
  setup({ opcode: 0x2A });
  CPUregisters.A = 0x80;
  CPUregisters.P.C = 0;
  ROL_ACC();
  assert(CPUregisters.A === 0x00, 'ROL_ACC should rotate left dropping bit 7');
  assert(CPUregisters.P.C === 1,  'ROL_ACC should set carry from original bit 7');
  assert(CPUregisters.P.Z === 1,  'ROL_ACC should set Z when result = 0');
}

function test_ROL_ZP() {
  setup({ opcode: 0x26, operands: [0x10] });
  systemMemory[0x0010] = 0x01;
  CPUregisters.P.C = 0;
  ROL_ZP();
  assert(systemMemory[0x0010] === 0x02, 'ROL_ZP should rotate memory left');
}

function test_ROL_ZPX_wrap() {
  setup({ opcode: 0x36, operands: [0xF0], X: 0x20 });
  const addr = (0xF0 + 0x20) & 0xFF;
  systemMemory[addr] = 0x80;
  CPUregisters.P.C = 1;
  ROL_ZPX();
  assert(systemMemory[addr] === 0x01, 'ROL_ZPX should wrap zero‑page and include carry');
}

function test_ROL_ABS() {
  setup({ opcode: 0x2E, operands: [0x00, 0x20] });
  systemMemory[0x2000] = 0xFF;
  CPUregisters.P.C = 0;
  ROL_ABS();
  assert(systemMemory[0x2000] === 0xFE, 'ROL_ABS should rotate absolute memory left');
  assert(CPUregisters.P.C === 1,        'ROL_ABS should set carry from original bit 7');
}

function test_ROL_ABSX() {
  setup({ opcode: 0x3E, operands: [0x00, 0x20], X: 0x01 });
  systemMemory[0x2001] = 0x00;
  CPUregisters.P.C = 1;
  ROL_ABSX();
  assert(systemMemory[0x2001] === 0x01, 'ROL_ABSX should rotate left with X offset and carry in');
}

// JSR Tests
function test_JSR_ABS() {
  setup({ opcode: 0x20, operands: [0x00, 0x30] });
  CPUregisters.PC = 0x0000;
  CPUregisters.S = 0xFF;
  JSR_ABS();
  // After pushing PC+2=0x0002, SP should be decremented by 2
  assert(CPUregisters.PC === 0x3000, 'JSR_ABS should set PC to subroutine address');
  assert(CPUregisters.S === 0xFD,   'JSR_ABS should push two return bytes');
  const low = systemMemory[0x100 + 0xFF];
  const high = systemMemory[0x100 + 0xFE];
  assert((high << 8 | low) === 0x0002, 'JSR_ABS should push return address (PC+2)');
}

// STY Tests
function test_STY_ZP() {
  setup({ opcode: 0x84, operands: [0x20], Y: 0x55 });
  STY_ZP();
  assert(systemMemory[0x0020] === 0x55, 'STY_ZP should store Y into zero page');
}

function test_STY_ZPX_wrap() {
  setup({ opcode: 0x94, operands: [0xF0], Y: 0xAA, X: 0x20 });
  const addr = (0xF0 + 0x20) & 0xFF;
  STY_ZPX();
  assert(systemMemory[addr] === 0xAA, 'STY_ZPX should wrap zero‑page with X offset');
}

function test_STY_ABS() {
  setup({ opcode: 0x8C, operands: [0x00, 0x40], Y: 0x33 });
  STY_ABS();
  assert(systemMemory[0x4000] === 0x33, 'STY_ABS should store Y into absolute memory');
}

// LDY Tests
function test_LDY_IMM() {
  // positive value
  setup({ opcode: 0xA0, operands: [0x10] });
  LDY_IMM();
  assert(CPUregisters.Y === 0x10, 'LDY IMM should load immediate into Y');
  assert(CPUregisters.P.Z === 0,  'LDY IMM should clear Z when Y ≠ 0');
  assert(CPUregisters.P.N === 0,  'LDY IMM should clear N when bit 7 = 0');

  // zero value
  setup({ opcode: 0xA0, operands: [0x00] });
  LDY_IMM();
  assert(CPUregisters.Y === 0x00, 'LDY IMM should load zero');
  assert(CPUregisters.P.Z === 1,  'LDY IMM should set Z when Y = 0');

  // negative value
  setup({ opcode: 0xA0, operands: [0x80] });
  LDY_IMM();
  assert(CPUregisters.Y === 0x80, 'LDY IMM should load negative value');
  assert(CPUregisters.P.N === 1,  'LDY IMM should set N when bit 7 = 1');
}

function test_LDY_ZP() {
  setup({ opcode: 0xA4, operands: [0x20] });
  systemMemory[0x0020] = 0x7F;
  LDY_ZP();
  assert(CPUregisters.Y === 0x7F, 'LDY ZP should load from zero page');
}

function test_LDY_ZPX() {
  setup({ opcode: 0xB4, operands: [0xF0], X: 0x20 });
  const addr = (0xF0 + 0x20) & 0xFF;
  systemMemory[addr] = 0x01;
  LDY_ZPX();
  assert(CPUregisters.Y === 0x01, 'LDY ZPX should wrap and load with X offset');
}

function test_LDY_ABS() {
  setup({ opcode: 0xAC, operands: [0x34, 0x12] });
  systemMemory[0x1234] = 0xAA;
  LDY_ABS();
  assert(CPUregisters.Y === 0xAA, 'LDY ABS should load from absolute address');
}

function test_LDY_ABSX() {
  setup({ opcode: 0xBC, operands: [0x00, 0x20], X: 0x01 });
  systemMemory[0x2001] = 0x55;
  LDY_ABSX();
  assert(CPUregisters.Y === 0x55, 'LDY ABSX should load with X offset');
}

// BVS Tests
function test_BVS_REL_notTaken() {
  setup({ opcode: 0x70, operands: [0x05] });
  CPUregisters.P.V = 0;
  BVS_REL();
  assert(CPUregisters.PC === 2, 'BVS not taken when V = 0 should advance PC by 2');
}

function test_BVS_REL_takenForward() {
  setup({ opcode: 0x70, operands: [0x05] });
  CPUregisters.P.V = 1;
  BVS_REL();
  assert(CPUregisters.PC === 7, 'BVS taken forward should add offset +5');
}

function test_BVS_REL_takenBackward() {
  setup({ opcode: 0x70, operands: [0xFB] }); // -5
  CPUregisters.P.V = 1;
  BVS_REL();
  assert(CPUregisters.PC === ((2 - 5) & 0xFFFF), 'BVS taken backward should subtract 5');
}

// NOP Test
function test_NOP_IMP() {
  setup({ opcode: 0xEA });
  CPUregisters.PC = 0x10;
  NOP_IMP();
  assert(CPUregisters.PC === 0x11, 'NOP should increment PC by 1');
}

// PHA Test
function test_PHA_IMP() {
  setup({ opcode: 0x48 });
  CPUregisters.A = 0x77;
  CPUregisters.S = 0xFF;
  PHA_IMP();
  assert(CPUregisters.S === 0xFE, 'PHA should decrement S by 1');
  assert(systemMemory[0x1FF] === 0x77, 'PHA should push A onto stack');
}

// PHP Test
function test_PHP_IMP() {
  setup({ opcode: 0x08 });
  CPUregisters.P = { N:1, V:0, D:1, I:0, Z:1, C:0 };
  CPUregisters.S = 0xFF;
  PHP_IMP();
  const val = systemMemory[0x1FF];
  assert((val & 0x80) !== 0, 'PHP should push N flag');
  assert((val & 0x08) !== 0, 'PHP should push D flag');
  assert((val & 0x10) !== 0, 'PHP should set B flag');
}

// PLA Test
function test_PLA_IMP() {
  setup({ opcode: 0x68 });
  CPUregisters.S = 0xFC;
  systemMemory[0x1FD] = 0xAA;
  PLA_IMP();
  assert(CPUregisters.S === 0xFE, 'PLA should increment S by 1');
  assert(CPUregisters.A === 0xAA, 'PLA should pull value into A');
  assert(CPUregisters.P.Z === 0,  'PLA should clear Z when A ≠ 0');
}

// PLP Test
function test_PLP_IMP() {
  setup({ opcode: 0x28 });
  CPUregisters.S = 0xFC;
  systemMemory[0x1FD] = 0b10010010; // N=1,V=0,D=0,I=1,Z=0,C=0, B bit ignored
  PLP_IMP();
  assert(CPUregisters.S === 0xFE,      'PLP should increment S by 1');
  assert(CPUregisters.P.N === 1,       'PLP should restore N flag');
  assert(CPUregisters.P.I === 1,       'PLP should restore I flag');
}

// RTI Test
function test_RTI_IMP() {
  setup({ opcode: 0x40 });
  CPUregisters.S = 0xFC;
  systemMemory[0x1FD] = 0b01000001; // N=0,V=1,D=0,I=0,Z=0,C=1
  systemMemory[0x1FE] = 0x34;
  systemMemory[0x1FF] = 0x12;
  RTI_IMP();
  assert(CPUregisters.S === 0xFF,      'RTI should increment S by 3');
  assert(CPUregisters.P.V === 1,       'RTI should restore V flag');
  assert(CPUregisters.P.C === 1,       'RTI should restore C flag');
  assert(CPUregisters.PC === 0x1234,   'RTI should set PC from stack');
}

// RTS Test
function test_RTS_IMP() {
  setup({ opcode: 0x60 });
  CPUregisters.S = 0xFC;
  systemMemory[0x1FD] = 0x00;
  systemMemory[0x1FE] = 0x10;
  RTS_IMP();
  assert(CPUregisters.S === 0xFE,      'RTS should increment S by 2');
  assert(CPUregisters.PC === 0x1001,   'RTS should set PC = popped address + 1');
}

// SBC Tests
function test_SBC_IMM_noBorrow() {
  setup({ opcode: 0xE9, operands: [0x05], A: 0x10 });
  CPUregisters.P.C = 1;
  SBC_IMM();
  assert(CPUregisters.A === 0x0B,       'SBC IMM should subtract immediate without borrow');
  assert(CPUregisters.P.C === 1,       'SBC IMM should set C when no borrow');
  assert(CPUregisters.P.N === 0,       'SBC IMM should clear N when result ≥ 0');
}

function test_SBC_IMM_withBorrow() {
  setup({ opcode: 0xE9, operands: [0x05], A: 0x03 });
  CPUregisters.P.C = 0;
  SBC_IMM();
  assert(CPUregisters.A === 0xFD,       'SBC IMM should subtract with borrow and wrap');
  assert(CPUregisters.P.C === 0,       'SBC IMM should clear C when borrow');
  assert(CPUregisters.P.N === 1,       'SBC IMM should set N when result < 0');
}

// SBC Zero Page
function test_SBC_ZP() {
  setup({ opcode: 0xE5, operands: [0x20], A: 0x20 });
  systemMemory[0x0020] = 0x10;
  CPUregisters.P.C = 1;
  SBC_ZP();
  assert(CPUregisters.A === 0x10,       'SBC ZP should subtract zero‑page value without borrow');
}

// SBC Zero Page,X
function test_SBC_ZPX() {
  setup({ opcode: 0xF5, operands: [0xF0], A: 0x05, X: 0x20 });
  const addr = (0xF0 + 0x20) & 0xFF;
  systemMemory[addr] = 0x06;
  CPUregisters.P.C = 0;
  SBC_ZPX();
  assert(CPUregisters.A === 0xFE,       'SBC ZPX should subtract with borrow and wrap on zero‑page X');
}

// SBC Absolute
function test_SBC_ABS() {
  setup({ opcode: 0xED, operands: [0x00, 0x30], A: 0x50 });
  systemMemory[0x3000] = 0x20;
  CPUregisters.P.C = 1;
  SBC_ABS();
  assert(CPUregisters.A === 0x30,       'SBC ABS should subtract absolute value without borrow');
}

// SBC Absolute,X
function test_SBC_ABSX() {
  setup({ opcode: 0xFD, operands: [0x00, 0x30], A: 0x10, X: 0x01 });
  systemMemory[0x3001] = 0x20;
  CPUregisters.P.C = 0;
  SBC_ABSX();
  assert(CPUregisters.A === 0xEF,       'SBC ABSX should subtract with borrow and wrap on absolute X');
}

// SBC Absolute,Y
function test_SBC_ABSY() {
  setup({ opcode: 0xF9, operands: [0x00, 0x40], A: 0x40, Y: 0x02 });
  systemMemory[0x4002] = 0x10;
  CPUregisters.P.C = 1;
  SBC_ABSY();
  assert(CPUregisters.A === 0x30,       'SBC ABSY should subtract absolute Y value without borrow');
}

// SBC (Indirect,X)
function test_SBC_INDX() {
  setup({ opcode: 0xE1, operands: [0x10], A: 0x05, X: 0x04 });
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  systemMemory[0x8000] = 0x03;
  CPUregisters.P.C = 0;
  SBC_INDX();
  assert(CPUregisters.A === 0x01,       'SBC INDX should subtract via indexed indirect with borrow');
}

// SBC (Indirect),Y
function test_SBC_INDY() {
  setup({ opcode: 0xF1, operands: [0x20], A: 0x10, Y: 0x02 });
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x90;
  systemMemory[0x9002] = 0x05;
  CPUregisters.P.C = 1;
  SBC_INDY();
  assert(CPUregisters.A === 0x0B,       'SBC INDY should subtract via indirect indexed without borrow');
}

// CPX Tests
function test_CPX_IMM() {
  setup({ opcode: 0xE0, operands: [0x05], X: 0x05 });
  CPX_IMM();
  assert(CPUregisters.P.Z === 1,       'CPX IMM should set Z when X == M');
  assert(CPUregisters.P.C === 1,       'CPX IMM should set C when X ≥ M');
}

function test_CPX_ZP() {
  setup({ opcode: 0xE4, operands: [0x30], X: 0x02 });
  systemMemory[0x0030] = 0x03;
  CPX_ZP();
  assert(CPUregisters.P.C === 0,       'CPX ZP should clear C when X < M');
  assert(CPUregisters.P.N === 1,       'CPX ZP should set N when result negative');
}

function test_CPX_ABS() {
  setup({ opcode: 0xEC, operands: [0x00, 0x40], X: 0x04 });
  systemMemory[0x4000] = 0x04;
  CPX_ABS();
  assert(CPUregisters.P.Z === 1,       'CPX ABS should set Z when X == M at absolute');
}

// DEX Tests
function test_DEX_IMP() {
  setup({ opcode: 0xCA });
  CPUregisters.X = 0x01;
  DEX_IMP();
  assert(CPUregisters.X === 0x00,      'DEX should decrement X by one');
  assert(CPUregisters.P.Z === 1,       'DEX should set Z when result = 0');
}

function test_DEX_IMP_underflow() {
  setup({ opcode: 0xCA });
  CPUregisters.X = 0x00;
  DEX_IMP();
  assert(CPUregisters.X === 0xFF,      'DEX should wrap underflow to 0xFF');
  assert(CPUregisters.P.N === 1,       'DEX should set N when result bit 7 = 1');
}

// DEY Tests
function test_DEY_IMP() {
  setup({ opcode: 0x88 });
  CPUregisters.Y = 0x02;
  DEY_IMP();
  assert(CPUregisters.Y === 0x01,      'DEY should decrement Y by one');
}

function test_DEY_IMP_underflow() {
  setup({ opcode: 0x88 });
  CPUregisters.Y = 0x00;
  DEY_IMP();
  assert(CPUregisters.Y === 0xFF,      'DEY should wrap underflow to 0xFF');
  assert(CPUregisters.P.N === 1,       'DEY should set N when result bit 7 = 1');
}

// INX Tests
function test_INX_IMP() {
  setup({ opcode: 0xE8 });
  CPUregisters.X = 0xFF;
  INX_IMP();
  assert(CPUregisters.X === 0x00,      'INX should wrap overflow to 0x00');
  assert(CPUregisters.P.Z === 1,       'INX should set Z when result = 0');
}

// INY Tests
function test_INY_IMP() {
  setup({ opcode: 0xC8 });
  CPUregisters.Y = 0x7F;
  INY_IMP();
  assert(CPUregisters.Y === 0x80,      'INY should increment Y and set N when bit 7 = 1');
}

// ROR Tests
function test_ROR_ACC_basic() {
  setup({ opcode: 0x6A });
  CPUregisters.A = 0x01;       // bit 0 = 1
  CPUregisters.P.C = 0;        // carry in = 0
  ROR_ACC();
  assert(CPUregisters.A === 0x00, 'ROR_ACC should shift A right dropping bit 0');
  assert(CPUregisters.P.C === 1,  'ROR_ACC should set C from original bit 0');
  assert(CPUregisters.P.Z === 1,  'ROR_ACC should set Z when result = 0');
}

function test_ROR_ACC_withCarry() {
  setup({ opcode: 0x6A });
  CPUregisters.A = 0x00;
  CPUregisters.P.C = 1;        // carry in = 1
  ROR_ACC();
  assert(CPUregisters.A === 0x80, 'ROR_ACC should rotate carry into bit 7');
  assert(CPUregisters.P.C === 0,  'ROR_ACC should clear C from original bit 0');
  assert(CPUregisters.P.N === 1,  'ROR_ACC should set N when result bit 7 = 1');
}

function test_ROR_ZP() {
  const addr = 0x10;
  setup({ opcode: 0x66, operands: [addr] });
  systemMemory[addr] = 0x02;   // bit 0 = 0
  CPUregisters.P.C = 1;        // carry in = 1
  ROR_ZP();
  assert(systemMemory[addr] === 0x81, 'ROR_ZP should rotate memory right including carry');
  assert(CPUregisters.P.C === 0,       'ROR_ZP should clear C when memory bit 0 = 0');
}

function test_ROR_ZPX_wrap() {
  const base = 0xF0, X = 0x20;
  const addr = (base + X) & 0xFF;
  setup({ opcode: 0x76, operands: [base], X });
  systemMemory[addr] = 0x03;   // bit 0 = 1
  CPUregisters.P.C = 0;
  ROR_ZPX();
  assert(systemMemory[addr] === 0x01, 'ROR_ZPX should wrap zero‑page and shift right');
  assert(CPUregisters.P.C === 1,       'ROR_ZPX should set C from original bit 0');
}

function test_ROR_ABS() {
  setup({ opcode: 0x6E, operands: [0x00, 0x20] });
  systemMemory[0x2000] = 0xFF; // bit 0 = 1
  CPUregisters.P.C = 1;        // carry in = 1
  ROR_ABS();
  assert(systemMemory[0x2000] === 0xFF, 'ROR_ABS should rotate memory right with carry in');
  assert(CPUregisters.P.C === 1,        'ROR_ABS should set C from original bit 0');
}

function test_ROR_ABSX() {
  setup({ opcode: 0x7E, operands: [0x00, 0x20], X: 0x01 });
  systemMemory[0x2001] = 0x00;
  CPUregisters.P.C = 1;
  ROR_ABSX();
  assert(systemMemory[0x2001] === 0x80, 'ROR_ABSX should rotate memory right with X offset and carry in');
}

// TAX Test
function test_TAX_IMP() {
  setup({ opcode: 0xAA });
  CPUregisters.A = 0x00;
  TAX_IMP();
  assert(CPUregisters.X === 0x00, 'TAX should transfer A=0 to X');
  assert(CPUregisters.P.Z === 1,  'TAX should set Z when X = 0');
  CPUregisters.A = 0x80;
  TAX_IMP();
  assert(CPUregisters.X === 0x80, 'TAX should transfer A to X');
  assert(CPUregisters.P.N === 1,  'TAX should set N when bit 7 = 1');
}

// TAY Test
function test_TAY_IMP() {
  setup({ opcode: 0xA8 });
  CPUregisters.A = 0x01;
  TAY_IMP();
  assert(CPUregisters.Y === 0x01, 'TAY should transfer A to Y');
}

// STX Tests
function test_STX_ZP() {
  setup({ opcode: 0x86, operands: [0x30], X: 0x42 });
  STX_ZP();
  assert(systemMemory[0x0030] === 0x42, 'STX_ZP should store X into zero page');
}

function test_STX_ZPY_wrap() {
  setup({ opcode: 0x96, operands: [0xF0], Y: 0x01, X: 0x20 });
  const addr = (0xF0 + Y) & 0xFF;
  STX_ZPY();
  assert(systemMemory[addr] === 0x01, 'STX_ZPY should wrap zero-page with Y offset');
}

function test_STX_ABS() {
  setup({ opcode: 0x8E, operands: [0x00, 0x40], X: 0x99 });
  STX_ABS();
  assert(systemMemory[0x4000] === 0x99, 'STX_ABS should store X into absolute memory');
}

// LAX Tests
function test_LAX_ZP() {
  // zero result → Z flag set
  setup({ opcode: 0xA7, operands: [0x10] });
  systemMemory[0x0010] = 0x00;
  LAX_ZP();
  assert(CPUregisters.A === 0x00 && CPUregisters.X === 0x00, 'LAX_ZP should load A and X from zero page');
  assert(CPUregisters.P.Z === 1, 'LAX_ZP should set Z when value = 0');

  // negative result → N flag set
  setup({ opcode: 0xA7, operands: [0x10] });
  systemMemory[0x0010] = 0x80;
  LAX_ZP();
  assert(CPUregisters.A === 0x80 && CPUregisters.X === 0x80, 'LAX_ZP should load A and X correctly');
  assert(CPUregisters.P.N === 1, 'LAX_ZP should set N when bit 7 = 1');
}

function test_LAX_ZPY() {
  // wrap within zero page
  setup({ opcode: 0xB7, operands: [0xF0], Y: 0x20 });
  const addr = (0xF0 + 0x20) & 0xFF;
  systemMemory[addr] = 0x42;
  LAX_ZPY();
  assert(CPUregisters.A === 0x42 && CPUregisters.X === 0x42, 'LAX_ZPY should wrap and load A and X');
}

function test_LAX_ABS() {
  setup({ opcode: 0xAF, operands: [0x34, 0x12] });
  systemMemory[0x1234] = 0x7F;
  LAX_ABS();
  assert(CPUregisters.A === 0x7F && CPUregisters.X === 0x7F, 'LAX_ABS should load A and X from absolute address');
}

function test_LAX_ABSY() {
  setup({ opcode: 0xBF, operands: [0x00, 0x20], Y: 0x01 });
  systemMemory[0x2001] = 0xFF;
  LAX_ABSY();
  assert(CPUregisters.A === 0xFF && CPUregisters.X === 0xFF, 'LAX_ABSY should load A and X with Y offset');
  assert(CPUregisters.P.N === 1, 'LAX_ABSY should set N when bit 7 = 1');
}

function test_LAX_INDX() {
  setup({ opcode: 0xA3, operands: [0x10], X: 0x04 });
  // pointer at (0x10 + X)=0x14
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  systemMemory[0x8000] = 0x21;
  LAX_INDX();
  assert(CPUregisters.A === 0x21 && CPUregisters.X === 0x21, 'LAX_INDX should load via indexed indirect');
}

function test_LAX_INDY() {
  setup({ opcode: 0xB3, operands: [0x20], Y: 0x02 });
  // pointer at 0x20 → fetch from 0x20/0x21, then +Y
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x70;
  systemMemory[0x7012] = 0x37;
  LAX_INDY();
  assert(CPUregisters.A === 0x37 && CPUregisters.X === 0x37, 'LAX_INDY should load via indirect indexed');
}

// SAX Tests
function test_SAX_ZP() {
  setup({ opcode: 0x87, operands: [0x30], A: 0x0F, X: 0xF0 });
  SAX_ZP();
  assert(systemMemory[0x0030] === (0x0F & 0xF0), 'SAX_ZP should store A & X into zero page');
}

function test_SAX_ZPY() {
  setup({ opcode: 0x97, operands: [0xF0], X: 0xAA, Y: 0x20 });
  const addr = (0xF0 + 0x20) & 0xFF;
  SAX_ZPY();
  assert(systemMemory[addr] === (0xAA & 0xAA), 'SAX_ZPY should wrap and store A & X with Y offset');
}

function test_SAX_ABS() {
  setup({ opcode: 0x8F, operands: [0x00, 0x40], A: 0x55, X: 0x0F });
  SAX_ABS();
  assert(systemMemory[0x4000] === (0x55 & 0x0F), 'SAX_ABS should store A & X into absolute memory');
}

function test_SAX_INDX() {
  setup({ opcode: 0x83, operands: [0x10], X: 0x04, A: 0xF0 });
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  SAX_INDX();
  assert(systemMemory[0x8004] === (0xF0 & 0x04), 'SAX_INDX should store A & X via indexed indirect');
}

// DCP Tests (DEC + CMP combo)
function test_DCP_ZP() {
  const addr = 0x10;
  setup({ opcode: 0xC7, operands: [addr], A: 0x01 });
  systemMemory[addr] = 0x02;
  DCP_ZP();
  // after DEC: M=0x01 → CMP: A(0x01) == M → Z set, C set
  assert(systemMemory[addr] === 0x01, 'DCP_ZP should decrement memory');
  assert(CPUregisters.P.Z === 1 && CPUregisters.P.C === 1, 'DCP_ZP should set Z and C when A == M');

  // underflow case
  setup({ opcode: 0xC7, operands: [addr], A: 0x00 });
  systemMemory[addr] = 0x00;
  DCP_ZP();
  // after DEC: M=0xFF → CMP: A(0x00) < M → C clear, N set
  assert(systemMemory[addr] === 0xFF, 'DCP_ZP should wrap 0→0xFF');
  assert(CPUregisters.P.C === 0 && CPUregisters.P.N === 1, 'DCP_ZP should clear C and set N when A < M');
}

function test_DCP_ZPX() {
  const base = 0xF0, X = 0x20, addr = (base + X) & 0xFF;
  setup({ opcode: 0xD7, operands: [base], A: 0x05, X });
  systemMemory[addr] = 0x05;
  DCP_ZPX();
  // after DEC: M=0x04 → CMP: A(0x05)>M → C set, Z clear
  assert(systemMemory[addr] === 0x04, 'DCP_ZPX should decrement wrapped zero‑page');
  assert(CPUregisters.P.C === 1 && CPUregisters.P.Z === 0, 'DCP_ZPX should set C when A > M');
}

function test_DCP_ABS() {
  const addr = 0x1234;
  setup({ opcode: 0xCF, operands: [0x34, 0x12], A: 0x03 });
  systemMemory[addr] = 0x03;
  DCP_ABS();
  // after DEC: M=0x02 → CMP: A(0x03)>M → C set
  assert(systemMemory[addr] === 0x02, 'DCP_ABS should decrement absolute memory');
  assert(CPUregisters.P.C === 1, 'DCP_ABS should set C when A > M');
}

function test_DCP_ABSX() {
  const base = 0x2000, X = 0x02, addr = base + X;
  setup({ opcode: 0xDF, operands: [0x00, 0x20], A: 0x00, X });
  systemMemory[addr] = 0x00;
  DCP_ABSX();
  // after DEC: M=0xFF → CMP: A(0x00)<M → C clear, N set
  assert(systemMemory[addr] === 0xFF, 'DCP_ABSX should wrap and decrement with X offset');
  assert(CPUregisters.P.C === 0 && CPUregisters.P.N === 1, 'DCP_ABSX should clear C and set N when A < M');
}

function test_DCP_ABSY() {
  const base = 0x3000, Y = 0x01, addr = base + Y;
  setup({ opcode: 0xDB, operands: [0x00, 0x30], A: 0x02, Y });
  systemMemory[addr] = 0x03;
  DCP_ABSY();
  // after DEC: M=0x02 → CMP: A==M → Z set, C set
  assert(systemMemory[addr] === 0x02, 'DCP_ABSY should decrement with Y offset');
  assert(CPUregisters.P.Z === 1 && CPUregisters.P.C === 1, 'DCP_ABSY should set Z and C when A == M');
}

function test_DCP_INDX() {
  setup({ opcode: 0xC3, operands: [0x10], A: 0x05, X: 0x04 });
  // pointer at (0x10+X)=0x14
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  systemMemory[0x8000] = 0x05;
  DCP_INDX();
  // after DEC: M=0x04 → CMP: A(0x05)>M → C set
  assert(systemMemory[0x8000] === 0x04, 'DCP_INDX should decrement via indexed indirect');
  assert(CPUregisters.P.C === 1, 'DCP_INDX should set C when A > M');
}

function test_DCP_INDY() {
  setup({ opcode: 0xD3, operands: [0x20], A: 0x00, Y: 0x02 });
  // pointer at 0x20→ fetch base, then +Y
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x90;
  systemMemory[0x9002] = 0x00;
  DCP_INDY();
  // after DEC: M=0xFF → CMP: A(0x00)<M → C clear
  assert(systemMemory[0x9002] === 0xFF, 'DCP_INDY should wrap and decrement via indirect indexed');
  assert(CPUregisters.P.C === 0, 'DCP_INDY should clear C when A < M');
}

// ISC Tests (INC + SBC combo)
function test_ISC_ZP() {
  const addr = 0x10;
  setup({ opcode: 0xE7, operands: [addr], A: 0x05 });
  CPUregisters.P.C = 1;
  systemMemory[addr] = 0x01;
  ISC_ZP();
  // after INC: M=0x02 → SBC: A(0x05)-M=0x03 → C set
  assert(systemMemory[addr] === 0x02, 'ISC_ZP should increment memory');
  assert(CPUregisters.A === 0x03 && CPUregisters.P.C === 1, 'ISC_ZP should subtract incremented value without borrow');
}

function test_ISC_ZPX() {
  const base = 0xF0, X = 0x10, addr = (base + X) & 0xFF;
  setup({ opcode: 0xF7, operands: [base], A: 0x00, X });
  CPUregisters.P.C = 0;
  systemMemory[addr] = 0xFF;
  ISC_ZPX();
  // after INC: M=0x00 → SBC with borrow: 0x00 - 0x00 -1 = 0xFF → C clear
  assert(systemMemory[addr] === 0x00, 'ISC_ZPX should wrap and increment with X offset');
  assert(CPUregisters.A === 0xFF && CPUregisters.P.C === 0, 'ISC_ZPX should subtract with borrow');
}

function test_ISC_ABS() {
  const addr = 0x2000;
  setup({ opcode: 0xEF, operands: [0x00, 0x20], A: 0x10 });
  CPUregisters.P.C = 1;
  systemMemory[addr] = 0x0F;
  ISC_ABS();
  // after INC: M=0x10 → SBC: A(0x10)-0x10=0x00 → Z set
  assert(systemMemory[addr] === 0x10, 'ISC_ABS should increment absolute memory');
  assert(CPUregisters.A === 0x00 && CPUregisters.P.Z === 1, 'ISC_ABS should subtract incremented value and set Z');
}

function test_ISC_ABSX() {
  const base = 0x2000, X = 0x02, addr = base + X;
  setup({ opcode: 0xFF, operands: [0x00, 0x20], A: 0x00, X });
  CPUregisters.P.C = 0;
  systemMemory[addr] = 0xFF;
  ISC_ABSX();
  // INC→0x00, SBC borrow→0xFF
  assert(systemMemory[addr] === 0x00, 'ISC_ABSX should increment with X offset');
  assert(CPUregisters.A === 0xFF && CPUregisters.P.C === 0, 'ISC_ABSX should subtract with borrow');
}

function test_ISC_ABSY() {
  const base = 0x3000, Y = 0x01, addr = base + Y;
  setup({ opcode: 0xFB, operands: [0x00, 0x30], A: 0x05, Y });
  CPUregisters.P.C = 1;
  systemMemory[addr] = 0x04;
  ISC_ABSY();
  // INC→0x05, SBC→0x00
  assert(systemMemory[addr] === 0x05, 'ISC_ABSY should increment with Y offset');
  assert(CPUregisters.A === 0x00 && CPUregisters.P.Z === 1, 'ISC_ABSY should subtract incremented value and set Z');
}

function test_ISC_INDX() {
  setup({ opcode: 0xE3, operands: [0x10], A: 0x02, X: 0x04 });
  CPUregisters.P.C = 1;
  // pointer at 0x14→0x80; memory=0x01
  systemMemory[0x0014] = 0x00; systemMemory[0x0015] = 0x80; systemMemory[0x8000] = 0x01;
  ISC_INDX();
  // INC→0x02, SBC→0x00
  assert(systemMemory[0x8000] === 0x02, 'ISC_INDX should increment via indexed indirect');
  assert(CPUregisters.A === 0x00 && CPUregisters.P.Z === 1, 'ISC_INDX should subtract incremented and set Z');
}

function test_ISC_INDY() {
  setup({ opcode: 0xF3, operands: [0x20], A: 0x00, Y: 0x02 });
  CPUregisters.P.C = 0;
  // pointer at 0x20→0x21; memory=0xFF
  systemMemory[0x0020] = 0x00; systemMemory[0x0021] = 0x90; systemMemory[0x9002] = 0xFF;
  ISC_INDY();
  // INC→0x00, SBC borrow→0xFF
  assert(systemMemory[0x9002] === 0x00, 'ISC_INDY should increment via indirect indexed');
  assert(CPUregisters.A === 0xFF && CPUregisters.P.C === 0, 'ISC_INDY should subtract with borrow and wrap');
}

// SLO Tests
function test_SLO_ZP() {
  const addr = 0x10;
  // normal shift + OR
  setup({ opcode: 0x07, operands: [addr], A: 0x01 });
  systemMemory[addr] = 0x02;    // bit7=0
  SLO_ZP();
  assert(systemMemory[addr] === 0x04, 'SLO_ZP should shift memory left by one');
  assert(CPUregisters.P.C === 0, 'SLO_ZP should clear C when original bit7=0');
  assert(CPUregisters.A === 0x05, 'SLO_ZP should OR shifted memory into A');
  // wrap shift + carry
  setup({ opcode: 0x07, operands: [addr], A: 0x00 });
  systemMemory[addr] = 0x80;    // bit7=1
  SLO_ZP();
  assert(systemMemory[addr] === 0x00, 'SLO_ZP should wrap 0x80→0x00');
  assert(CPUregisters.P.C === 1, 'SLO_ZP should set C from original bit7');
}

function test_SLO_ZPX() {
  const base = 0xF0, X = 0x10;
  const addr = (base + X) & 0xFF;
  setup({ opcode: 0x17, operands: [base], A: 0x00, X });
  systemMemory[addr] = 0x80;    // bit7=1
  SLO_ZPX();
  assert(systemMemory[addr] === 0x00, 'SLO_ZPX should wrap & shift memory left at zero‑page X');
  assert(CPUregisters.P.C === 1,    'SLO_ZPX should set C from original bit7');
}

function test_SLO_ABS() {
  const addr = 0x1234;
  setup({ opcode: 0x0F, operands: [0x34, 0x12], A: 0x10 });
  systemMemory[addr] = 0x01;    // bit7=0
  SLO_ABS();
  assert(systemMemory[addr] === 0x02, 'SLO_ABS should shift absolute memory left');
  assert(CPUregisters.P.C === 0,      'SLO_ABS should clear C when original bit7=0');
  assert(CPUregisters.A === 0x12,     'SLO_ABS should OR shifted memory into A');
}

function test_SLO_ABSX() {
  const base = 0x2000, X = 0x01;
  const addr = base + X;
  setup({ opcode: 0x1F, operands: [0x00, 0x20], A: 0x00, X });
  systemMemory[addr] = 0x80;    // bit7=1
  SLO_ABSX();
  assert(systemMemory[addr] === 0x00, 'SLO_ABSX should shift & wrap absolute X memory');
  assert(CPUregisters.P.C === 1,      'SLO_ABSX should set C from original bit7');
}

function test_SLO_ABSY() {
  const base = 0x3000, Y = 0x02;
  const addr = base + Y;
  setup({ opcode: 0x1B, operands: [0x00, 0x30], A: 0xFF, Y });
  systemMemory[addr] = 0x02;    // bit7=0
  SLO_ABSY();
  assert(systemMemory[addr] === 0x04, 'SLO_ABSY should shift absolute Y memory left');
  assert(CPUregisters.A === 0xFF,     'SLO_ABSY should OR shifted memory into A');
}

function test_SLO_INDX() {
  setup({ opcode: 0x03, operands: [0x10], A: 0x01, X: 0x04 });
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80; // pointer → 0x8000
  systemMemory[0x8000] = 0x02; // bit7=0
  SLO_INDX();
  assert(systemMemory[0x8000] === 0x04, 'SLO_INDX should shift memory via indexed indirect');
  assert(CPUregisters.A === 0x05,      'SLO_INDX should OR shifted memory into A');
}

function test_SLO_INDY() {
  setup({ opcode: 0x13, operands: [0x20], A: 0x00, Y: 0x03 });
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x90; // base → 0x9000
  systemMemory[0x9003] = 0x80; // bit7=1
  SLO_INDY();
  assert(systemMemory[0x9003] === 0x00, 'SLO_INDY should wrap & shift memory via indirect indexed');
  assert(CPUregisters.P.C === 1,        'SLO_INDY should set C from original bit7');
}

// RLA Tests (ROL + AND combo)
function test_RLA_ZP() {
  const addr = 0x10;
  setup({ opcode: 0x27, operands: [addr], A: 0xFF });
  CPUregisters.P.C = 1;
  systemMemory[addr] = 0x80;  // bit7=1
  RLA_ZP();
  assert(systemMemory[addr] === 0x01, 'RLA_ZP should rotate memory left with carry in');
  assert(CPUregisters.A === 0x01,      'RLA_ZP should AND rotated memory into A');
}

function test_RLA_ZPX() {
  const base = 0xF0, X = 0x10;
  const addr = (base + X) & 0xFF;
  setup({ opcode: 0x37, operands: [base], A: 0x0F, X });
  CPUregisters.P.C = 0;
  systemMemory[addr] = 0x02;  // bit7=0
  RLA_ZPX();
  assert(systemMemory[addr] === 0x04, 'RLA_ZPX should rotate zero‑page X memory left');
  assert(CPUregisters.P.C === 0,      'RLA_ZPX should clear C when original bit7=0');
  assert(CPUregisters.A === 0x04,     'RLA_ZPX should AND rotated memory into A');
}

function test_RLA_ABS() {
  const addr = 0x1234;
  setup({ opcode: 0x2F, operands: [0x34, 0x12], A: 0xF0 });
  CPUregisters.P.C = 1;
  systemMemory[addr] = 0x00;  // bit7=0
  RLA_ABS();
  assert(systemMemory[addr] === 0x01, 'RLA_ABS should rotate absolute memory left');
  assert(CPUregisters.A === 0x00,     'RLA_ABS should AND rotated memory into A');
}

function test_RLA_ABSX() {
  const base = 0x2000, X = 0x01;
  const addr = base + X;
  setup({ opcode: 0x3F, operands: [0x00, 0x20], A: 0xFF, X });
  CPUregisters.P.C = 0;
  systemMemory[addr] = 0x80;  // bit7=1
  RLA_ABSX();
  assert(systemMemory[addr] === 0x00, 'RLA_ABSX should wrap & rotate absolute X memory');
  assert(CPUregisters.P.C === 1,      'RLA_ABSX should set C from original bit7');
  assert(CPUregisters.A === 0x00,     'RLA_ABSX should AND rotated memory into A');
}

function test_RLA_ABSY() {
  const base = 0x3000, Y = 0x02;
  const addr = base + Y;
  setup({ opcode: 0x3B, operands: [0x00, 0x30], A: 0x0F, Y });
  CPUregisters.P.C = 1;
  systemMemory[addr] = 0x02;  // bit7=0
  RLA_ABSY();
  assert(systemMemory[addr] === 0x05, 'RLA_ABSY should rotate absolute Y memory left');
  assert(CPUregisters.A === 0x05,     'RLA_ABSY should AND rotated memory into A');
}

function test_RLA_INDX() {
  setup({ opcode: 0x23, operands: [0x10], A: 0xAA, X: 0x04 });
  CPUregisters.P.C = 0;
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80; // ptr→0x8000
  systemMemory[0x8000] = 0x01; // bit7=0
  RLA_INDX();
  assert(systemMemory[0x8000] === 0x02, 'RLA_INDX should rotate via indexed indirect');
  assert(CPUregisters.A === (0xAA & 0x02), 'RLA_INDX should AND rotated memory into A');
}

function test_RLA_INDY() {
  setup({ opcode: 0x33, operands: [0x20], A: 0xFF, Y: 0x03 });
  CPUregisters.P.C = 1;
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x90; // ptr→0x9000
  systemMemory[0x9003] = 0x80; // bit7=1
  RLA_INDY();
  assert(systemMemory[0x9003] === 0x01, 'RLA_INDY should wrap & rotate via indirect indexed');
  assert(CPUregisters.A === (0xFF & 0x01), 'RLA_INDY should AND rotated memory into A');
}

// SRE Tests
function test_SRE_ZP() {
  const addr = 0x10;
  // case: memory bit0=1, carry out, zero result, A unchanged by EOR
  setup({ opcode: 0x47, operands: [addr], A: 0x01 });
  systemMemory[addr] = 0x01;
  CPUregisters.P.C = 0;
  SRE_ZP();
  assert(systemMemory[addr] === 0x00,       'SRE_ZP should LSR memory (1→0)');
  assert(CPUregisters.P.C === 1,           'SRE_ZP should set C from original bit 0');
  assert(CPUregisters.A === 0x01,          'SRE_ZP should EOR shifted memory into A');
  assert(CPUregisters.P.Z === 0,           'SRE_ZP should clear Z when A≠0');

  // case: memory bit1=1→shift yields 0x80, EOR sets N
  setup({ opcode: 0x47, operands: [addr], A: 0x00 });
  systemMemory[addr] = 0x02;
  CPUregisters.P.C = 0;
  SRE_ZP();
  assert(systemMemory[addr] === 0x01,       'SRE_ZP should LSR memory (2→1)');
  assert(CPUregisters.P.C === 0,           'SRE_ZP should clear C when original bit 0=0');
  assert(CPUregisters.A === 0x01,          'SRE_ZP should EOR shifted memory into A');
  assert(CPUregisters.P.N === 0,           'SRE_ZP should clear N when result bit 7=0');
}

function test_SRE_ZPX() {
  const base = 0xF0, X = 0x20, addr = (base + X) & 0xFF;
  setup({ opcode: 0x57, operands: [base], A: 0xFF, X });
  systemMemory[addr] = 0x02;
  CPUregisters.P.C = 1;
  SRE_ZPX();
  assert(systemMemory[addr] === 0x01,       'SRE_ZPX should wrap and LSR memory');
  assert(CPUregisters.P.C === 0,           'SRE_ZPX should clear C when original bit 0=0');
  assert(CPUregisters.A === 0xFE,          'SRE_ZPX should EOR shifted memory into A');
}

function test_SRE_ABS() {
  setup({ opcode: 0x4F, operands: [0x00, 0x20], A: 0x0F });
  systemMemory[0x2000] = 0x03;
  CPUregisters.P.C = 0;
  SRE_ABS();
  assert(systemMemory[0x2000] === 0x01,    'SRE_ABS should LSR absolute memory');
  assert(CPUregisters.A === 0x0E,          'SRE_ABS should EOR shifted memory into A');
}

function test_SRE_ABSX() {
  setup({ opcode: 0x5F, operands: [0x00, 0x20], A: 0xFF, X: 0x01 });
  systemMemory[0x2001] = 0x01;
  CPUregisters.P.C = 0;
  SRE_ABSX();
  assert(systemMemory[0x2001] === 0x00,    'SRE_ABSX should LSR with X offset');
  assert(CPUregisters.P.C === 1,           'SRE_ABSX should set C from original bit 0');
  assert(CPUregisters.A === 0xFF,          'SRE_ABSX should EOR shifted memory into A');
}

function test_SRE_ABSY() {
  setup({ opcode: 0x5B, operands: [0x00, 0x20], A: 0x0F, Y: 0x02 });
  systemMemory[0x2002] = 0x02;
  CPUregisters.P.C = 0;
  SRE_ABSY();
  assert(systemMemory[0x2002] === 0x01,    'SRE_ABSY should LSR with Y offset');
  assert(CPUregisters.A === 0x0E,          'SRE_ABSY should EOR shifted memory into A');
}

function test_SRE_INDX() {
  setup({ opcode: 0x43, operands: [0x10], A: 0xAA, X: 0x04 });
  systemMemory[0x0014] = 0x00;
  systemMemory[0x0015] = 0x80;
  systemMemory[0x8000] = 0x03;
  CPUregisters.P.C = 0;
  SRE_INDX();
  assert(systemMemory[0x8000] === 0x01,    'SRE_INDX should LSR via indexed indirect');
  assert(CPUregisters.A === 0xAB,          'SRE_INDX should EOR shifted memory into A');
}

function test_SRE_INDY() {
  setup({ opcode: 0x53, operands: [0x20], A: 0x0F, Y: 0x01 });
  systemMemory[0x0020] = 0x00;
  systemMemory[0x0021] = 0x90;
  systemMemory[0x9001] = 0x02;
  CPUregisters.P.C = 1;
  SRE_INDY();
  assert(systemMemory[0x9001] === 0x01,    'SRE_INDY should wrap & LSR via indirect indexed');
  assert(CPUregisters.A === 0x0E,          'SRE_INDY should EOR shifted memory into A');
}

// ANC Tests
function test_ANC_IMM_0B() {
  setup({ opcode: 0x0B, operands: [0x80], A: 0x80 });
  CPUregisters.P.C = 0;
  ANC_IMM();
  assert(CPUregisters.A === 0x80,          'ANC_IMM should AND immediate into A');
  assert(CPUregisters.P.C === 1,           'ANC_IMM should set C from result bit 7');
  assert(CPUregisters.P.N === 1,           'ANC_IMM should set N when bit 7 = 1');
}

function test_ANC_IMM_2B() {
  setup({ opcode: 0x2B, operands: [0x7F], A: 0xFF });
  CPUregisters.P.C = 0;
  ANC_IMM();
  assert(CPUregisters.A === 0x7F,          'ANC_IMM(2B) should AND immediate into A');
  assert(CPUregisters.P.C === 0,           'ANC_IMM(2B) should clear C when result < 0x80');
}

// ALR Tests
function test_ALR_IMM() {
  setup({ opcode: 0x4B, operands: [0x03], A: 0x07 });
  CPUregisters.P.C = 0;
  ALR_IMM();
  assert(CPUregisters.A === 0x01,          'ALR_IMM should AND then LSR');
  assert(CPUregisters.P.C === 1,           'ALR_IMM should set C from original AND result bit 0');
}

// ARR Tests
function test_ARR_IMM() {
  setup({ opcode: 0x6B, operands: [0x03], A: 0x06 });
  CPUregisters.P.C = 1;
  ARR_IMM();
  assert(CPUregisters.A === 0x81,          'ARR_IMM should AND then ROR with carry_in');
  assert(CPUregisters.P.C === 0,           'ARR_IMM should clear C when original result bit 0=0');
  assert(CPUregisters.P.N === 1,           'ARR_IMM should set N from result bit 7');
}

// AXA (A & X store) Tests
function test_AXA_ABSY() {
  // absolute,Y addressing
  setup({ opcode: 0x9F, operands: [0x00, 0x20], A: 0xF0, X: 0x0F, Y: 0x02 });
  AXA_ABSY();
  assert(systemMemory[0x2002] === (0xF0 & 0x0F), 'AXA_ABSY should store A & X into memory at absolute + Y');
}

function test_AXA_INDY() {
  // (indirect),Y addressing
  setup({ opcode: 0x93, operands: [0x10], A: 0x55, X: 0xAA, Y: 0x03 });
  // pointer at 0x10→fetch PSW from 0x10/0x11, then + Y
  systemMemory[0x0010] = 0x00;
  systemMemory[0x0011] = 0x80;
  AXA_INDY();
  assert(systemMemory[0x8003] === (0x55 & 0xAA), 'AXA_INDY should store A & X via indirect indexed');
}

// XAA (X & A immediate) Tests
function test_XAA_IMM() {
  setup({ opcode: 0x8B, operands: [0x0F], A: 0xF0, X: 0x0F });
  XAA_IMM();
  const expected = 0x0F & 0xF0;
  assert(CPUregisters.A === expected, 'XAA_IMM should set A to (X & A & immediate)');
  assert(CPUregisters.P.Z === (expected === 0 ? 1 : 0), 'XAA_IMM should set Z when result = 0');
  assert(CPUregisters.P.N === ((expected & 0x80) !== 0 ? 1 : 0), 'XAA_IMM should set N from bit 7 of result');
}

/// Test Runner
(function runAllTests() {
  const tests = [
    // STA & LDA
    test_STA_ZP, test_STA_ZPX, test_STA_ABS, test_STA_ABSX, test_STA_ABSY, test_STA_INDX, test_STA_INDY,
    test_LDA_IMM, test_LDA_ZP, test_LDA_ZPX, test_LDA_ABS, test_LDA_ABSX, test_LDA_ABSY, test_LDA_INDX, test_LDA_INDY,
    // LDX & ADC
    test_LDX_IMM, test_LDX_ZP, test_LDX_ZPY, test_LDX_ABS, test_LDX_ABSY,
    test_ADC_IMM, test_ADC_ZP, test_ADC_ZPX, test_ADC_ABS, test_ADC_ABSX, test_ADC_ABSY, test_ADC_INDX, test_ADC_INDY,
    // AND & ASL
    test_AND_IMM, test_AND_ZP, test_AND_ZPX, test_AND_ABS, test_AND_ABSX, test_AND_ABSY, test_AND_INDX, test_AND_INDY,
    test_ASL_ACC, test_ASL_ZP, test_ASL_ZPX, test_ASL_ABS, test_ASL_ABSX,
    // BIT, LSR & ORA
    test_BIT_ZP, test_BIT_ABS,
    test_LSR_ACC, test_LSR_ZP, test_LSR_ZPX, test_LSR_ABS, test_LSR_ABSX,
    test_ORA_IMM, test_ORA_ZP, test_ORA_ZPX, test_ORA_ABS, test_ORA_ABSX, test_ORA_ABSY, test_ORA_INDX, test_ORA_INDY,
    // Branches, BRK & TXS
    test_BPL_REL_notTaken, test_BPL_REL_takenForward, test_BPL_REL_takenBackward,
    test_BMI_REL_notTaken, test_BMI_REL_takenForward, test_BMI_REL_takenBackward,
    test_BVC_REL_notTaken, test_BVC_REL_takenForward, test_BVC_REL_takenBackward,
    test_BCC_REL_notTaken, test_BCC_REL_takenForward, test_BCC_REL_takenBackward,
    test_BCS_REL_notTaken, test_BCS_REL_takenForward, test_BCS_REL_takenBackward,
    test_BNE_REL_notTaken, test_BNE_REL_takenForward, test_BNE_REL_takenBackward,
    test_BEQ_REL_notTaken, test_BEQ_REL_takenForward, test_BEQ_REL_takenBackward,
    test_BRK_IMP, test_TXS_IMP,
    // CMP & CPY
    test_CMP_IMM, test_CMP_ZP, test_CMP_ZPX, test_CMP_ABS, test_CMP_ABSX, test_CMP_ABSY, test_CMP_INDX, test_CMP_INDY,
    test_CPY_IMM, test_CPY_ZP, test_CPY_ABS,
    // DEC & EOR
    test_DEC_ZP, test_DEC_ZPX, test_DEC_ABS, test_DEC_ABSX,
    test_EOR_IMM, test_EOR_ZP, test_EOR_ZPX, test_EOR_ABS, test_EOR_ABSX, test_EOR_ABSY, test_EOR_INDX, test_EOR_INDY,
    // Flags & INC
    test_CLC_IMP, test_SEC_IMP, test_CLI_IMP, test_SEI_IMP, test_CLV_IMP, test_CLD_IMP, test_SED_IMP,
    test_INC_ZP, test_INC_ZPX, test_INC_ABS, test_INC_ABSX,
    // JMP, ROL, JSR & STY
    test_JMP_ABS, test_JMP_IND_normal, test_JMP_IND_pageBoundaryBug,
    test_ROL_ACC_carryIn, test_ROL_ACC_carryOut, test_ROL_ZP, test_ROL_ZPX_wrap, test_ROL_ABS, test_ROL_ABSX,
    test_JSR_ABS, test_STY_ZP, test_STY_ZPX_wrap, test_STY_ABS,
    // LDY, BVS, NOP, PHA, PHP, PLA, PLP, RTI, RTS
    test_LDY_IMM, test_LDY_ZP, test_LDY_ZPX, test_LDY_ABS, test_LDY_ABSX,
    test_BVS_REL_notTaken, test_BVS_REL_takenForward, test_BVS_REL_takenBackward,
    test_NOP_IMP, test_PHA_IMP, test_PHP_IMP, test_PLA_IMP, test_PLP_IMP, test_RTI_IMP, test_RTS_IMP,
    // SBC, CPX, DEX, DEY, INX, INY
    test_SBC_IMM_noBorrow, test_SBC_IMM_withBorrow, test_SBC_ZP, test_SBC_ZPX, test_SBC_ABS, test_SBC_ABSX, test_SBC_ABSY, test_SBC_INDX, test_SBC_INDY,
    test_CPX_IMM, test_CPX_ZP, test_CPX_ABS,
    test_DEX_IMP, test_DEX_IMP_underflow, test_DEY_IMP, test_DEY_IMP_underflow, test_INX_IMP, test_INY_IMP,
    // ROR, TAX, TAY & STX
    test_ROR_ACC_basic, test_ROR_ACC_withCarry, test_ROR_ZP, test_ROR_ZPX_wrap, test_ROR_ABS, test_ROR_ABSX,
    test_TAX_IMP, test_TAY_IMP, test_STX_ZP, test_STX_ZPY_wrap, test_STX_ABS,
    // LAX & SAX
    test_LAX_ZP, test_LAX_ZPY, test_LAX_ABS, test_LAX_ABSY, test_LAX_INDX, test_LAX_INDY,
    test_SAX_ZP, test_SAX_ZPY, test_SAX_ABS, test_SAX_INDX,
    // DCP & ISC
    test_DCP_ZP, test_DCP_ZPX, test_DCP_ABS, test_DCP_ABSX, test_DCP_ABSY, test_DCP_INDX, test_DCP_INDY,
    test_ISC_ZP, test_ISC_ZPX, test_ISC_ABS, test_ISC_ABSX, test_ISC_ABSY, test_ISC_INDX, test_ISC_INDY,
    // SLO & RLA
    test_SLO_ZP, test_SLO_ZPX, test_SLO_ABS, test_SLO_ABSX, test_SLO_ABSY, test_SLO_INDX, test_SLO_INDY,
    test_RLA_ZP, test_RLA_ZPX, test_RLA_ABS, test_RLA_ABSX, test_RLA_ABSY, test_RLA_INDX, test_RLA_INDY,
    // SRE, ANC, ALR, ARR
    test_SRE_ZP, test_SRE_ZPX, test_SRE_ABS, test_SRE_ABSX, test_SRE_ABSY, test_SRE_INDX, test_SRE_INDY,
    test_ANC_IMM_0B, test_ANC_IMM_2B, test_ALR_IMM, test_ARR_IMM,
    // AXA & XAA
    test_AXA_ABSY, test_AXA_INDY, test_XAA_IMM
  ];

  tests.forEach(fn => {
    try {
      fn();
      console.log(`${fn.name} passed`);
    } catch (e) {
      console.error(`${fn.name} failed: ${e.message}`);
    }
  });
})();