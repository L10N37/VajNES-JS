// ============================
// debug.js — CPU control + loop
// ============================

let debugLogging = false;

function run() {
  if (cpuRunning) return;
  startEmu();
}

function pause() {
  pauseEmu();
  updateDebugTables();
}

// ============================
// CPU Step
// ============================

/*
Normal emulation: cpuLoop() calls step() without arguments → only runs if cpuRunning is true.
Manual stepping: Call step(true) from button or console → skips the cpuRunning check and forces one instruction.
*/
function step(force = false) {
  if (!force && !cpuRunning) return;

  NoSignalAudio.setEnabled(false); // wont hurt to loop this until i find somewhere that i can call it once

  const code = prgRom[(CPUregisters.PC - 0x8000) & 0x7FFF];
  const execFn = opcodeFuncs[code];

  if (!execFn) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=0x${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
    return;
  }

  if (debugLogging) {
    console.log(`0x${code.toString(16).toUpperCase()}`);
    console.log(`PC=> $${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  //ouch we were doing a double cycles increment here since re-aliasing shared variable to 'cpuCycles' 
  execFn();
  CPUregisters.PC = (CPUregisters.PC + opcodePcIncs[code]) & 0xFFFF;
  Atomics.add(SHARED.CLOCKS, 0, opcodeCyclesInc[code]); // base cycles

  // Handle NMI if requested
  if (nmiPending) {
    serviceNMI();
    nmiPending = !nmiPending
    // +7 cycles insta-added in handler for PPU worker to see
  }

}

  window.run = run;
  window.pause = pause;

// ============================
// Handle messages from main / clock worker
// ============================
onmessage = (e) => {
  const msg = e.data;

  if (msg.type === "cpu-tick") {
    step();
  }
};

// ============================
// Frame blit from PPU worker
// ============================
ppuWorker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'frame') {
    const w = msg.w || 256;
    const h = msg.h || 240;
    if (msg.format === 'indices' || msg.bpp === 8) {
      const indices = new Uint8Array(msg.buffer);
      blitNESFramePaletteIndex(indices, w, h);
    } else {
      const rgb = new Uint32Array(msg.buffer);
      blitNESFrameRGBA(rgb, w, h);
    }
  }
};

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

const opcodeFuncs = [     
  BRK_IMP,    ORA_INDX, /*opCodeTest*/, SLO_INDX,   NOP_ZP,     ORA_ZP,     ASL_ZP,     SLO_ZP,
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