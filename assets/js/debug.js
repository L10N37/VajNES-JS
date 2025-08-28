let cpuRunning = false;

// internal only, don't build disasm rows unless the window is open
let disasmRunning = false;

let nmiCheckCounter = 0;
let nmiServiceCounter = 0;
let nmiPendingLocal=false;

// NTSC Resolution
const NES_W = 256;
const NES_H = 240;

// RENDER FRAME
ppuWorker.onmessage = (e) => {
  if (e.data.type === "frame") {
    //blitNESFramePaletteIndex(paletteIndexFrame, NES_W, NES_H);
    quickRenderNametable0(); // hack
    registerFrameUpdate();
  }
};

function checkInterrupts() {
  nmiCheckCounter++;

  // NMI edge latch is at SYNC[6]
  const edgeMarker = Atomics.load(SHARED.SYNC, 6);
  if (edgeMarker !== 0) {
    nmiServiceCounter++;

    if (debugLogging) {
      console.debug(
        `[CPU] NMI edge latched (#${nmiServiceCounter}) after ${nmiCheckCounter} checks`
      );
    }

    nmiCheckCounter = 0;

    nmiPendingLocal = true;
    Atomics.store(SHARED.SYNC, 5, 1);  // shadow flag
    Atomics.store(SHARED.SYNC, 6, 0);  // clear edge latch
  }

  // ---- handle interrupts ----
  if (nmiPendingLocal) {
    serviceNMI();   // adds +7 via addExtraCycles()
    nmiPendingLocal = false;
  }
  // temp IRQ block
  let irqPending = false;
  if (!CPUregisters.P.I && irqPending) {
    serviceIRQ();   // adds +7 via addExtraCycles()
  }
}

let __paceCarry = 0;
let __lastT = 0;
const NES_CPU_HZ    = 1_789_773;
const CYCLES_PER_MS = NES_CPU_HZ / 1000;
const CPU_BATCH     = 8;
const MAX_CARRY     = 2 * 16.7 * CYCLES_PER_MS;

window.step = function() {
  
  NoSignalAudio.setEnabled(false);

  const code = checkReadOffset(CPUregisters.PC);
  const execFn = OPCODES[code].func;
  if (!cpuRunning) return;

  if (!execFn) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=$${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
    pause();
    return;
  }

  const _op  = checkReadOffset(CPUregisters.PC + 1);
  const __op = checkReadOffset(CPUregisters.PC + 2);
  const disasmPc = CPUregisters.PC;

  // Breakpoint logic with step-over
  if (bpStepOnce) {
    bpStepOnce = false;
  } else {
    bpCheckOpcode(code, disasmPc);
    if (breakPending) {
      if (disasmRunning) DISASM.appendRow(buildDisasmRow(code, _op, __op, disasmPc));
      pause();
      breakPending = false;
      return;
    }
  }

    // make sure the PPU is always 3 ticks ahead (stall)
    let ppuBudget = Atomics.load(SHARED.CLOCKS, 1);
    while (ppuBudget > 0) {
    // refresh local copy each spin
    ppuBudget = Atomics.load(SHARED.CLOCKS, 1);
    }

  execFn();

  if (disasmRunning) DISASM.appendRow(buildDisasmRow(code, _op, __op, disasmPc));

  CPUregisters.PC = (CPUregisters.PC + OPCODES[code].pc) & 0xFFFF;

  const cyc = OPCODES[code].cycles | 0;
  if (cyc) addExtraCycles(cyc);

  checkInterrupts();
};

window.run = function() {
  if (cpuRunning) return;
  cpuRunning = true;

  __lastT = performance.now();
  __paceCarry = 0;

  (function pacedLoop() {
    if (!cpuRunning) return;

    const now = performance.now();
    const dt  = now - __lastT;
    __lastT   = now;

    let targetFloat = dt * CYCLES_PER_MS + __paceCarry;
    let target      = targetFloat | 0;
    __paceCarry     = targetFloat - target;

    if (target > 0) {
      const startCycles = Atomics.load(SHARED.CLOCKS, 0);
      const BUDGET_MS   = Math.max(0.6 * dt, 10);
      const deadline    = now + BUDGET_MS;

      let produced = 0;
      while (produced < target && performance.now() < deadline) {
        for (let i = 0; i < CPU_BATCH; i++) {
          if (!cpuRunning) break;   // instant pause check
          step();
        }
        if (!cpuRunning) break;     // bail out mid-frame if paused
        produced = Atomics.load(SHARED.CLOCKS, 0) - startCycles;
      }

      if (produced < target) {
        __paceCarry += (target - produced);
        if (__paceCarry > MAX_CARRY) __paceCarry = MAX_CARRY;
      }
    }

    if (cpuRunning) requestAnimationFrame(pacedLoop);
  })();
};

  window.pause = function() {
  cpuRunning = false;
  if (typeof updateDebugTables === 'function') {
    try { updateDebugTables(); } catch (e) {}
  }
}

// ======================== OPCODE DISPATCH TABLE ========================
// move pc/cyc directly to opcode handlers eventually to optimise
// all opcodes setting PC manually have zero increment
const OPCODES = [
  { pc:0, cycles:7, func: BRK_IMP },   { pc:2, cycles:6, func: ORA_INDX }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: SLO_INDX }, // 6->8
  { pc:2, cycles:3, func: NOP_ZP },    { pc:2, cycles:3, func: ORA_ZP },   { pc:2, cycles:5, func: ASL_ZP },   { pc:2, cycles:5, func: SLO_ZP },   // ASL 3->5
  { pc:1, cycles:2, func: PHP_IMP },   { pc:2, cycles:2, func: ORA_IMM },  { pc:1, cycles:2, func: ASL_ACC },  { pc:2, cycles:2, func: ANC_IMM },
  { pc:3, cycles:4, func: NOP_ABS },   { pc:3, cycles:4, func: ORA_ABS },  { pc:3, cycles:6, func: ASL_ABS },  { pc:3, cycles:6, func: SLO_ABS },  // ASL/SLO 4->6

  { pc:0, cycles:2, func: BPL_REL },   { pc:2, cycles:5, func: ORA_INDY }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: SLO_INDY }, // 5->8
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: ORA_ZPX },  { pc:2, cycles:6, func: ASL_ZPX },  { pc:2, cycles:6, func: SLO_ZPX },  // ASL/SLO 4->6
  { pc:1, cycles:2, func: CLC_IMP },   { pc:3, cycles:4, func: ORA_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:7, func: SLO_ABSY }, // 4->7 (ABS,Y RMW)
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: ORA_ABSX }, { pc:3, cycles:7, func: ASL_ABSX }, { pc:3, cycles:7, func: SLO_ABSX }, // ASL/SLO 4->7

  { pc:0, cycles:4, func: JSR_ABS },   { pc:2, cycles:6, func: AND_INDX }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: RLA_INDX }, // 6->8
  { pc:2, cycles:3, func: BIT_ZP },    { pc:2, cycles:3, func: AND_ZP },   { pc:2, cycles:5, func: ROL_ZP },   { pc:2, cycles:5, func: RLA_ZP },   // ROL/RLA 3->5
  { pc:1, cycles:2, func: PLP_IMP },   { pc:2, cycles:2, func: AND_IMM },  { pc:1, cycles:2, func: ROL_ACC },  { pc:2, cycles:2, func: ANC_IMM },
  { pc:3, cycles:4, func: BIT_ABS },   { pc:3, cycles:4, func: AND_ABS },  { pc:3, cycles:6, func: ROL_ABS },  { pc:3, cycles:6, func: RLA_ABS },  // 4->6

  { pc:0, cycles:2, func: BMI_REL },   { pc:2, cycles:5, func: AND_INDY }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: RLA_INDY }, // 5/6->8
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: AND_ZPX },  { pc:2, cycles:6, func: ROL_ZPX },  { pc:2, cycles:6, func: RLA_ZPX },  // 4->6
  { pc:1, cycles:2, func: SEC_IMP },   { pc:3, cycles:4, func: AND_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:7, func: RLA_ABSY }, // 4->7 (ABS,Y RMW)
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: AND_ABSX }, { pc:3, cycles:7, func: ROL_ABSX }, { pc:3, cycles:7, func: RLA_ABSX }, // 4->7

  { pc:0, cycles:2, func: RTI_IMP },   { pc:2, cycles:6, func: EOR_INDX }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: SRE_INDX }, // 6->8
  { pc:2, cycles:3, func: NOP_ZP },    { pc:2, cycles:3, func: EOR_ZP },   { pc:2, cycles:5, func: LSR_ZP },   { pc:2, cycles:5, func: SRE_ZP },   // LSR/SRE 3->5
  { pc:1, cycles:2, func: PHA_IMP },   { pc:2, cycles:2, func: EOR_IMM },  { pc:1, cycles:2, func: LSR_ACC },  { pc:2, cycles:2, func: ALR_IMM },
  { pc:0, cycles:4, func: JMP_ABS },   { pc:3, cycles:4, func: EOR_ABS },  { pc:3, cycles:6, func: LSR_ABS },  { pc:3, cycles:6, func: SRE_ABS },  // 4->6

  { pc:0, cycles:2, func: BVC_REL },   { pc:2, cycles:5, func: EOR_INDY }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: SRE_INDY }, // 5->8
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: EOR_ZPX },  { pc:2, cycles:6, func: LSR_ZPX },  { pc:2, cycles:6, func: SRE_ZPX },  // 4->6
  { pc:1, cycles:2, func: CLI_IMP },   { pc:3, cycles:4, func: EOR_ABSY },  { pc:1, cycles:2, func: NOP },      { pc:3, cycles:7, func: SRE_ABSY }, // 4->7 (ABS,Y RMW)
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: EOR_ABSX },  { pc:3, cycles:7, func: LSR_ABSX }, { pc:3, cycles:7, func: SRE_ABSX }, // 4->7

  { pc:0, cycles:2, func: RTS_IMP },   { pc:2, cycles:6, func: ADC_INDX }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: RRA_INDX }, // 6->8
  { pc:2, cycles:3, func: NOP_ZP },    { pc:2, cycles:3, func: ADC_ZP },   { pc:2, cycles:5, func: ROR_ZP },   { pc:2, cycles:5, func: RRA_ZP },   // ROR/RRA 3->5
  { pc:1, cycles:2, func: PLA_IMP },   { pc:2, cycles:2, func: ADC_IMM },  { pc:1, cycles:2, func: ROR_ACC },  { pc:2, cycles:2, func: ARR_IMM },
  { pc:0, cycles:4, func: JMP_IND },   { pc:3, cycles:4, func: ADC_ABS },  { pc:3, cycles:6, func: ROR_ABS },  { pc:3, cycles:6, func: RRA_ABS },  // 4->6

  { pc:0, cycles:2, func: BVS_REL },   { pc:2, cycles:5, func: ADC_INDY }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: RRA_INDY }, // 5/6->8
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: ADC_ZPX },  { pc:2, cycles:6, func: ROR_ZPX },  { pc:2, cycles:6, func: RRA_ZPX },  // 4->6
  { pc:1, cycles:2, func: SEI_IMP },   { pc:3, cycles:4, func: ADC_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:7, func: RRA_ABSY }, // 4->7 (ABS,Y RMW)
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: ADC_ABSX }, { pc:3, cycles:7, func: ROR_ABSX }, { pc:3, cycles:7, func: RRA_ABSX }, // 4->7

  { pc:2, cycles:2, func: DOP_IMM },   { pc:2, cycles:6, func: STA_INDX }, { pc:2, cycles:2, func: NOP },      { pc:2, cycles:6, func: SAX_INDX },
  { pc:2, cycles:3, func: STY_ZP },    { pc:2, cycles:3, func: STA_ZP },   { pc:2, cycles:3, func: STX_ZP },   { pc:2, cycles:3, func: SAX_ZP },
  { pc:1, cycles:2, func: DEY_IMP },   { pc:2, cycles:2, func: NOP },      { pc:1, cycles:2, func: TXA_IMP },  { pc:2, cycles:2, func: XAA_IMM },
  { pc:3, cycles:4, func: STY_ABS },   { pc:3, cycles:4, func: STA_ABS },  { pc:3, cycles:4, func: STX_ABS },  { pc:3, cycles:4, func: SAX_ABS },

  { pc:0, cycles:2, func: BCC_REL },   { pc:2, cycles:6, func: STA_INDY }, { pc:2, cycles:2, func: NOP_ZPY },  { pc:2, cycles:6, func: AXA_INDY },
  { pc:2, cycles:4, func: STY_ZPX },   { pc:2, cycles:4, func: STA_ZPX },  { pc:2, cycles:4, func: STX_ZPY },  { pc:2, cycles:4, func: SAX_ZPY },
  { pc:1, cycles:2, func: TYA_IMP },   { pc:3, cycles:4, func: STA_ABSY }, { pc:1, cycles:2, func: TXS_IMP },  { pc:3, cycles:4, func: TAS_ABSY },
  { pc:3, cycles:4, func: SHY_ABSX },  { pc:3, cycles:4, func: STA_ABSX }, { pc:3, cycles:4, func: SHX_ABSY }, { pc:3, cycles:4, func: AXA_ABSY },

  { pc:2, cycles:2, func: LDY_IMM },   { pc:2, cycles:6, func: LDA_INDX }, { pc:2, cycles:2, func: LDX_IMM },  { pc:2, cycles:6, func: LAX_INDX },
  { pc:2, cycles:3, func: LDY_ZP },    { pc:2, cycles:3, func: LDA_ZP },   { pc:2, cycles:3, func: LDX_ZP },   { pc:2, cycles:3, func: LAX_ZP },
  { pc:1, cycles:2, func: TAY_IMP },   { pc:2, cycles:2, func: LDA_IMM },  { pc:1, cycles:2, func: TAX_IMP },  { pc:2, cycles:2, func: LAX_IMM },
  { pc:3, cycles:4, func: LDY_ABS },   { pc:3, cycles:4, func: LDA_ABS },  { pc:3, cycles:4, func: LDX_ABS },  { pc:3, cycles:4, func: LAX_ABS },

  { pc:0, cycles:2, func: BCS_REL },   { pc:2, cycles:6, func: LDA_INDY }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:6, func: LAX_INDY },
  { pc:2, cycles:4, func: LDY_ZPX },   { pc:2, cycles:4, func: LDA_ZPX },  { pc:2, cycles:4, func: LDX_ZPY },  { pc:2, cycles:4, func: LAX_ZPY },
  { pc:1, cycles:2, func: CLV_IMP },   { pc:3, cycles:4, func: LDA_ABSY }, { pc:1, cycles:2, func: TSX_IMP },  { pc:3, cycles:4, func: LAS_ABSY },
  { pc:3, cycles:4, func: LDY_ABSX },  { pc:3, cycles:4, func: LDA_ABSX }, { pc:3, cycles:4, func: LDX_ABSY }, { pc:3, cycles:4, func: LAX_ABSY },

  { pc:2, cycles:2, func: CPY_IMM },   { pc:2, cycles:6, func: CMP_INDX }, { pc:2, cycles:2, func: NOP },      { pc:2, cycles:8, func: DCP_INDX }, // 6->8
  { pc:2, cycles:3, func: CPY_ZP },    { pc:2, cycles:3, func: CMP_ZP },   { pc:2, cycles:5, func: DEC_ZP },   { pc:2, cycles:5, func: DCP_ZP },   // DEC/DCP 3->5
  { pc:1, cycles:2, func: INY_IMP },   { pc:2, cycles:2, func: CMP_IMM },  { pc:1, cycles:2, func: DEX_IMP },  { pc:2, cycles:2, func: SBX_IMM },
  { pc:3, cycles:4, func: CPY_ABS },   { pc:3, cycles:4, func: CMP_ABS },  { pc:3, cycles:6, func: DEC_ABS },  { pc:3, cycles:6, func: DCP_ABS },  // 4->6

  { pc:0, cycles:2, func: BNE_REL },   { pc:2, cycles:6, func: CMP_INDY }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: DCP_INDY }, // 6->8
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: CMP_ZPX },  { pc:2, cycles:6, func: DEC_ZPX },  { pc:2, cycles:6, func: DCP_ZPX },  // 4->6
  { pc:1, cycles:2, func: CLD_IMP },   { pc:3, cycles:4, func: CMP_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:7, func: DCP_ABSY }, // 4->7 (ABS,Y RMW)
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: CMP_ABSX }, { pc:3, cycles:7, func: DEC_ABSX }, { pc:3, cycles:7, func: DCP_ABSX }, // 4->7

  { pc:2, cycles:2, func: CPX_IMM },   { pc:2, cycles:6, func: SBC_INDX }, { pc:2, cycles:2, func: NOP },      { pc:2, cycles:8, func: ISC_INDX }, // 6->8
  { pc:2, cycles:3, func: CPX_ZP },    { pc:2, cycles:3, func: SBC_ZP },   { pc:2, cycles:5, func: INC_ZP },   { pc:2, cycles:5, func: ISC_ZP },   // INC/ISC 3->5
  { pc:1, cycles:2, func: INX_IMP },   { pc:2, cycles:2, func: SBC_IMM },  { pc:1, cycles:2, func: NOP },      { pc:2, cycles:2, func: SBC_IMM },

  { pc:3, cycles:4, func: CPX_ABS },   { pc:3, cycles:4, func: SBC_ABS },  { pc:3, cycles:6, func: INC_ABS },  { pc:3, cycles:6, func: ISC_ABS },  // 4->6

  { pc:0, cycles:2, func: BEQ_REL },   { pc:2, cycles:6, func: SBC_INDY }, { pc:1, cycles:2, func: KIL_IMP },  { pc:2, cycles:8, func: ISC_INDY }, // 6->8
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: SBC_ZPX },  { pc:2, cycles:6, func: INC_ZPX },  { pc:2, cycles:6, func: ISC_ZPX },  // 4->6
  { pc:1, cycles:2, func: SED_IMP },   { pc:3, cycles:4, func: SBC_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:7, func: ISC_ABSY }, // 4->7 (ABS,Y RMW)
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: SBC_ABSX }, { pc:3, cycles:7, func: INC_ABSX }, { pc:3, cycles:7, func: ISC_ABSX }, // 4->7
];

  function buildDisasmRow(opc, op1, op2, pc, len) {
  // --- ensure correct len for control flow opcodes ---
  if (len === 0) {
    if (opc === 0x00 || opc === 0x40 || opc === 0x60) len = 1;     // BRK/RTI/RTS
    else if (opc === 0x20 || opc === 0x4C || opc === 0x6C) len = 3; // JSR/JMP abs/ind
    else len = 2; // branches
  }

  const pad2 = v => v.toString(16).toUpperCase().padStart(2, "0");
  const pad4 = v => v.toString(16).toUpperCase().padStart(4, "0");

  // --- NES label resolver ---
  const getLabel = addr => {
    const hw = {
      0x2000:"PPUCTRL",0x2001:"PPUMASK",0x2002:"PPUSTATUS",0x2003:"OAMADDR",
      0x2004:"OAMDATA",0x2005:"PPUSCROLL",0x2006:"PPUADDR",0x2007:"PPUDATA",
      0x4000:"SQ1_VOL",0x4001:"SQ1_SWEEP",0x4002:"SQ1_LO",0x4003:"SQ1_HI",
      0x4004:"SQ2_VOL",0x4005:"SQ2_SWEEP",0x4006:"SQ2_LO",0x4007:"SQ2_HI",
      0x4008:"TRI_LINEAR",0x400A:"TRI_LO",0x400B:"TRI_HI",
      0x400C:"NOISE_VOL",0x400E:"NOISE_LO",0x400F:"NOISE_HI",
      0x4010:"DMC_FREQ",0x4011:"DMC_RAW",0x4012:"DMC_START",0x4013:"DMC_LEN",
      0x4014:"OAMDMA",0x4015:"SND_CHN",0x4016:"JOY1",0x4017:"JOY2"
    };
    if (hw[addr]) return hw[addr];
    if (addr <= 0x00FF) return "$" + pad2(addr);
    if (addr <= 0x01FF) return "STACK";
    if (addr <= 0x07FF) return "RAM";
    if (addr >= 0x8000) return "sub_" + pad4(addr);
    return "$" + pad4(addr);
  };

  // --- mnemonic & addressing mode ---
  const name = OPCODES[opc]?.func?.name || "";
  const mnemonic = name.split("_")[0]?.toUpperCase() || "???";
  const mode = name.split("_")[1]?.toUpperCase() || "IMP";

  // --- operand formatting ---
  let operand = "";
  switch (mode) {
    case "IMM":  operand = "#$" + pad2(op1); break;
    case "ZP":   operand = getLabel(op1); break;
    case "ZPX":  operand = "$" + pad2(op1) + ",X"; break;
    case "ZPY":  operand = "$" + pad2(op1) + ",Y"; break;
    case "ABS":  operand = getLabel((op2 << 8) | op1); break;
    case "ABSX": operand = getLabel((op2 << 8) | op1) + ",X"; break;
    case "ABSY": operand = getLabel((op2 << 8) | op1) + ",Y"; break;
    case "IND":  operand = "($" + pad2(op2) + pad2(op1) + ")"; break;
    case "INDX": operand = "($" + pad2(op1) + ",X)"; break;
    case "INDY": operand = "($" + pad2(op1) + "),Y"; break;
    case "REL": {
      const offset = (op1 & 0x80) ? op1 - 0x100 : op1;
      const target = (pc + 2 + offset) & 0xFFFF;
      operand = getLabel(target);
      break;
    }
    case "ACC": operand = "A"; break;
    case "IMP": operand = ""; break;
  }

  // --- raw bytes field ---
  let opfield = "";
  if (len === 2) opfield = pad2(op1);
  else if (len === 3) opfield = `${pad2(op1)} ${pad2(op2)}`;

  const f = CPUregisters.P;

  // --- NOTES column ---
  let notes = "";

  // Branch resolution
  switch (mnemonic) {
    case "BPL": notes = f.N ? "(not taken)" : "(taken)"; break;
    case "BMI": notes = f.N ? "(taken)" : "(not taken)"; break;
    case "BVC": notes = f.V ? "(not taken)" : "(taken)"; break;
    case "BVS": notes = f.V ? "(taken)" : "(not taken)"; break;
    case "BCC": notes = f.C ? "(not taken)" : "(taken)"; break;
    case "BCS": notes = f.C ? "(taken)" : "(not taken)"; break;
    case "BNE": notes = f.Z ? "(not taken)" : "(taken)"; break;
    case "BEQ": notes = f.Z ? "(taken)" : "(not taken)"; break;
  }

  // PPU status/control hints
  if (operand === "PPUSTATUS") {
    notes = (CPUregisters.A & 0x80) ? "VBlank set" : "VBlank clear";
  }
  if (operand === "PPUCTRL") {
    notes = (CPUregisters.A & 0x80) ? "NMI enabled" : "NMI disabled";
  }

  // --- final HTML row ---
  return `<tr>
    <td class="col-pc">$${pad4(pc)}</td>
    <td class="col-opc">${pad2(opc)}</td>
    <td class="col-op">${opfield}</td>
    <td class="col-mn">${mnemonic} ${operand}</td>
    <td class="col-notes">${notes}</td>
    <td class="col-reg">${pad2(CPUregisters.A)}</td>
    <td class="col-reg">${pad2(CPUregisters.X)}</td>
    <td class="col-reg">${pad2(CPUregisters.Y)}</td>
    <td class="col-bit">${f.C ? 1 : 0}</td>
    <td class="col-bit">${f.Z ? 1 : 0}</td>
    <td class="col-bit">${f.I ? 1 : 0}</td>
    <td class="col-bit">${f.D ? 1 : 0}</td>
    <td class="col-bit">${f.V ? 1 : 0}</td>
    <td class="col-bit">${f.N ? 1 : 0}</td>
    <td class="col-reg">${pad2(CPUregisters.S)}</td>
  </tr>`;
}