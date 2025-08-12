//easier to patch up my cycles for the test suite, then adjust test suite (some suites now false failing due to cycles)
let ppuTicksToRun;
//let lastCpuCycleCount;

let running = false;
let debugLogging = false;

// pending NMI tracker
let nmiPending = false;

function run() {
  if (running) return;    // already running?
  running = true;
  loop();
}

function loop() {
  if (!running) return;   // stopped?
  step();
  // schedule next step as a fresh task, unwinding the stack
  setTimeout(loop, 0);
}

function pause() {
  running = false;        // stop scheduling new steps
  updateDebugTables();    // update debug tables
}

// ======================== OPCODE LUTS ========================

// move directly to opcode handlers eventually to optimise
const opcodePcIncs = [ 
2,2,0,2,2,2,2,2,1,2,1,2,3,3,3,3,0,2,0,2,2,2,2,2,1,3,1,3,3,3,3,3,
0,2,0,2,2,2,2,2,1,2,1,2,3,3,3,3,0,2,0,2,2,2,2,2,1,3,1,3,3,3,3,3,
0,2,0,2,2,2,2,2,1,2,1,2,0,3,3,3,0,2,0,2,2,2,2,2,1,3,1,3,3,3,3,3,
0,2,0,2,2,2,2,2,1,2,1,2,0,3,3,3,0,2,0,2,2,2,2,2,1,3,1,3,3,3,3,3,
0,2,2,2,2,2,2,2,1,2,1,2,3,3,3,3,0,2,2,2,2,2,2,2,1,3,1,3,3,3,3,3,
2,2,2,2,2,2,2,2,1,2,1,2,3,3,3,3,0,2,0,2,2,2,2,2,1,3,1,3,3,3,3,3,
2,2,2,2,2,2,2,2,1,2,1,2,3,3,3,3,0,2,0,2,2,2,2,2,1,3,1,3,3,3,3,3,
2,2,2,2,2,2,2,2,1,2,1,0,3,3,3,3,0,2,0,2,2,2,2,2,1,3,1,3,3,3,3,3
];
// move directly to opcode handlers eventually to optimise
const opcodeCyclesInc = [
2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4,
4,6,0,6,3,3,3,3,2,2,2,2,4,4,4,4,2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4,
2,6,0,6,3,3,3,3,2,2,2,2,4,4,4,4,2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4,
2,6,0,6,3,3,3,3,2,2,2,2,5,4,4,4,2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4,
2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,2,5,4,5,4,4,4,4,2,4,2,4,4,4,4,4,
2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4,
2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4,
2,6,2,6,3,3,3,3,2,2,2,0,4,4,4,4,2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4
];

const opcodeHex = [
"0x00","0x01","0x02","0x03","0x04","0x05","0x06","0x07","0x08","0x09","0x0A","0x0B",
"0x0C","0x0D","0x0E","0x0F","0x10","0x11",null,"0x13","0x14","0x15","0x16","0x17",
"0x18","0x19","0x1A","0x1B","0x1C","0x1D","0x1E","0x1F","0x20","0x21",null,"0x23",
"0x24","0x25","0x26","0x27","0x28","0x29","0x2A","0x2B","0x2C","0x2D","0x2E","0x2F",
"0x30","0x31",null,"0x33","0x34","0x35","0x36","0x37","0x38","0x39","0x3A","0x3B",
"0x3C","0x3D","0x3E","0x3F","0x40","0x41",null,"0x43","0x44","0x45","0x46","0x47",
"0x48","0x49","0x4A","0x4B","0x4C","0x4D","0x4E","0x4F","0x50","0x51",null,"0x53",
"0x54","0x55","0x56","0x57","0x58","0x59","0x5A","0x5B","0x5C","0x5D","0x5E","0x5F",
"0x60","0x61",null,"0x63","0x64","0x65","0x66","0x67","0x68","0x69","0x6A","0x6B",
"0x6C","0x6D","0x6E","0x6F","0x70","0x71",null,"0x73","0x74","0x75","0x76","0x77",
"0x78","0x79","0x7A","0x7B","0x7C","0x7D","0x7E","0x7F","0x80","0x81","0x82","0x83",
"0x84","0x85","0x86","0x87","0x88","0x89","0x8A","0x8B","0x8C","0x8D","0x8E","0x8F",
"0x90","0x91","0x92","0x93","0x94","0x95","0x96","0x97","0x98","0x99","0x9A","0x9B",
"0x9C","0x9D","0x9E","0x9F","0xA0","0xA1","0xA2","0xA3","0xA4","0xA5","0xA6","0xA7",
"0xA8","0xA9","0xAA","0xAB","0xAC","0xAD","0xAE","0xAF","0xB0","0xB1",null,"0xB3",
"0xB4","0xB5","0xB6","0xB7","0xB8","0xB9","0xBA","0xBB","0xBC","0xBD","0xBE","0xBF",
"0xC0","0xC1","0xC2","0xC3","0xC4","0xC5","0xC6","0xC7","0xC8","0xC9","0xCA","0xCB",
"0xCC","0xCD","0xCE","0xCF","0xD0","0xD1",null,"0xD3","0xD4","0xD5","0xD6","0xD7",
"0xD8","0xD9","0xDA","0xDB","0xDC","0xDD","0xDE","0xDF","0xE0","0xE1","0xE2","0xE3",
"0xE4","0xE5","0xE6","0xE7","0xE8","0xE9","0xEA",null,"0xEC","0xED","0xEE","0xEF",
"0xF0","0xF1",null,"0xF3","0xF4","0xF5","0xF6","0xF7","0xF8","0xF9","0xFA","0xFB",
"0xFC","0xFD","0xFE","0xFF"
];

const opcodeFuncs = [
  BRK_IMP,    ORA_INDX, /*testByte*/, SLO_INDX,   NOP_ZP,     ORA_ZP,     ASL_ZP,     SLO_ZP,
  PHP_IMP,    ORA_IMM,    ASL_ACC,    ANC_IMM,    NOP_ABS,    ORA_ABS,    ASL_ABS,    SLO_ABS,

  BPL_REL,    ORA_INDY,   /*null*/,   SLO_INDY,   NOP_ZPX,    ORA_ZPX,    ASL_ZPX,    SLO_ZPX,
  CLC_IMP,    ORA_ABSY,   NOP,        SLO_ABSY,   NOP_ABSX,   ORA_ABSX,   ASL_ABSX,   SLO_ABSX,

  JSR_ABS,    AND_INDX,   /*null*/,   RLA_INDX,   BIT_ZP,     AND_ZP,     ROL_ZP,     RLA_ZP,
  PLP_IMP,    AND_IMM,    ROL_ACC,    ANC_IMM,    BIT_ABS,    AND_ABS,    ROL_ABS,    RLA_ABS,

  BMI_REL,    AND_INDY,   /*null*/,   RLA_INDY,   NOP_ZPX,    AND_ZPX,    ROL_ZPX,    RLA_ZPX,
  SEC_IMP,    AND_ABSY,   NOP,        RLA_ABSY,   NOP_ABSX,   AND_ABSX,   ROL_ABSX,   RLA_ABSX,

  RTI_IMP,    EOR_INDX,   /*null*/,   SRE_INDX,   NOP_ZP,     EOR_ZP,     LSR_ZP,     SRE_ZP,
  PHA_IMP,    EOR_IMM,    LSR_ACC,    ALR_IMM,    JMP_ABS,    EOR_ABS,    LSR_ABS,    SRE_ABS,

  BVC_REL,    EOR_INDY,   /*null*/,   SRE_INDY,   NOP_ZPX,    EOR_ZPX,    LSR_ZPX,    SRE_ZPX,
  CLI_IMP,    EOR_ABY,    NOP,        SRE_ABSY,   NOP_ABSX,   EOR_ABX,    LSR_ABSX,   SRE_ABSX,

  RTS_IMP,    ADC_INDX,   /*null*/,   RRA_INDX,   NOP_ZP,     ADC_ZP,     ROR_ZP,     RRA_ZP,
  PLA_IMP,    ADC_IMM,    ROR_ACC,    ARR_IMM,    JMP_IND,    ADC_ABS,    ROR_ABS,    RRA_ABS,

  BVS_REL,    ADC_INDY,   /*null*/,   RRA_INDY,   NOP_ZPX,    ADC_ZPX,    ROR_ZPX,    RRA_ZPX,
  SEI_IMP,    ADC_ABSY,   NOP,        RRA_ABSY,   NOP_ABSX,   ADC_ABSX,   ROR_ABSX,   RRA_ABSX,

  BRA_REL,    STA_INDX,   NOP,        SAX_INDX,   STY_ZP,     STA_ZP,     STX_ZP,     SAX_ZP,
  DEY_IMP,    NOP,        TXA_IMP,    XAA_IMM,    STY_ABS,    STA_ABS,    STX_ABS,    SAX_ABS,

  BCC_REL,    STA_INDY,   NOP_ZPY,    AXA_INDY,   STY_ZPX,    STA_ZPX,    STX_ZPY,    SAX_ZPY,
  TYA_IMP,    STA_ABSY,   TXS_IMP,    TAS_ABSY,   SHY_ABSX,   STA_ABSX,   SHX_ABSY,   AXA_ABSY,

  LDY_IMM,    LDA_INDX,   LDX_IMM,    LAX_INDX,   LDY_ZP,     LDA_ZP,     LDX_ZP,     LAX_ZP,
  TAY_IMP,    LDA_IMM,    TAX_IMP,    LAX_IMM,    LDY_ABS,    LDA_ABS,    LDX_ABS,    LAX_ABS,

  BCS_REL,    LDA_INDY,   /*null*/,   LAX_INDY,   LDY_ZPX,    LDA_ZPX,    LDX_ZPY,    LAX_ZPY,
  CLV_IMP,    LDA_ABSY,   TSX_IMP,    LAS_ABSY,   LDY_ABSX,   LDA_ABSX,   LDX_ABSY,   LAX_ABSY,

  CPY_IMM,    CMP_INDX,   NOP,        DCP_INDX,   CPY_ZP,     CMP_ZP,     DEC_ZP,     DCP_ZP,
  INY_IMP,    CMP_IMM,    DEX_IMP,    SBX_IMM,    CPY_ABS,    CMP_ABS,    DEC_ABS,    DCP_ABS,

  BNE_REL,    CMP_INDY,   /*null*/,   DCP_INDY,   NOP_ZPX,    CMP_ZPX,    DEC_ZPX,    DCP_ZPX,
  CLD_IMP,    CMP_ABSY,   NOP,        DCP_ABSY,   NOP_ABSX,   CMP_ABSX,   DEC_ABSX,   DCP_ABSX,

  CPX_IMM,    SBC_INDX,   NOP,        ISC_INDX,   CPX_ZP,     SBC_ZP,     INC_ZP,     ISC_ZP,
  INX_IMP,    SBC_IMM,    NOP,        /*null*/,   CPX_ABS,    SBC_ABS,    INC_ABS,    ISC_ABS,

  BEQ_REL,    SBC_INDY,   /*null*/,   ISC_INDY,   NOP_ZPX,    SBC_ZPX,    INC_ZPX,    ISC_ZPX,
  SED_IMP,    SBC_ABSY,   NOP,        ISC_ABSY,   NOP_ABSX,   SBC_ABSX,   INC_ABSX,   ISC_ABSX
];

// interrupt is called once per full frame
function serviceNMI() {
  const pc = CPUregisters.PC & 0xFFFF;

  if (ppuDebugLogging){
  console.log(`%c[CPU: NMI taken] frame=${PPUclock.frame} PC=$${pc.toString(16).padStart(4, "0").toUpperCase()}`,
              "background:#004; color:#0ff; font-weight:bold");
  }

  // push PCH
  checkWriteOffset(0x0100 + (CPUregisters.S & 0xFF), (pc >>> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // push PCL
  checkWriteOffset(0x0100 + (CPUregisters.S & 0xFF), pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // push P with B=0, bit5=1
  const pushedP = ((CPUregisters.P & ~0x10) | 0x20) & 0xFF;
  checkWriteOffset(0x0100 + (CPUregisters.S & 0xFF), pushedP);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // set I flag
  CPUregisters.P = (CPUregisters.P | 0x04) & 0xFF;

  // fetch vector
  const lo = checkReadOffset(0xFFFA) & 0xFF;
  const hi = checkReadOffset(0xFFFB) & 0xFF;
  const newPC = ((hi << 8) | lo) & 0xFFFF;

  if (ppuDebugLogging){
  console.log(`%c[CPU: NMI vector → $${newPC.toString(16).padStart(4, "0").toUpperCase()}] frame=${PPUclock.frame}`,
              "background:#004; color:#0ff; font-weight:bold");
  }

  CPUregisters.PC = newPC;
}

// ── Single‐step executor ──
function step() {

  const code = prgRom[(CPUregisters.PC - 0x8000) & 0xFFFF];
  const execFn = opcodeFuncs[code];

  if (!execFn) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=0x${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
    return;
  }

  if (debugLogging){
  console.log("instr:", `0x${code.toString(16).toUpperCase()}`);
  console.log(`PC=> 0x${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
  }

  // Execute instruction
  execFn();

  // Advance cycles & PC
  CPUregisters.PC = (CPUregisters.PC + opcodePcIncs[code]);

  // pseudo 3:1 PPU with cycles
  //lastCpuCycleCount = cpuCycles & 0xFFFF;
  cpuCycles = (cpuCycles + opcodeCyclesInc[code]) & 0xFFFF;
  // ppuTicksToRun = (cpuCycles - lastCpuCycleCount) * 3;



  // run 3 ppuTicks per cpu Cycle, but only at 700+ CPU cycles (~21000 PPU ticks in batch!)

  // ppuTick will take the cpuCycles count, multiply by 3, and tick over that amount, on return
  // cpuCycles will be reset to zero

  if (nmiPending) {
    nmiPending = false;
    serviceNMI();
    cpuCycles += 7;// 7 CPU cycles spent for NMI servicing
  }

  if (cpuCycles >= 500) ppuTick(); // tweaked the batch value , nothing helps, we cant afford "per tick" accurate PPU. 

}
  