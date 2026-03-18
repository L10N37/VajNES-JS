let cpuRunning = false;

// internal only, don't build disasm rows unless the window is open
let disasmRunning = false;
let perFrameStep = false;

let nmiPending = 0;
let irqLatch = false; // timing latch
let code = 0x00; // current opcode now global for CPU openbus logic
let operand1 = "--";
let operand2 = "--";

function clearNmiEdge(){
  PPU_FRAME_FLAGS &= ~0b00000100;
}

function doesNmiEdgeExist() {
    return (PPU_FRAME_FLAGS & 0b00000100) !== 0;
}

function checkNmi() {
  if (!doesNmiEdgeExist()) return;

  nmiPending = (currentFrame);

  if (debug.videoTiming) {
    console.debug(
      `%c[NMI ARMED] cpu=${cpuCycles} ppu=${ppuCycles} frame=${currentFrame} sl=${currentScanline} dot=${currentDot}`,
      "color:black;background:lime;font-weight:bold;font-size:14px;"
    );
  }
}

const NTSC_CPU_CYCLES_PER_FRAME = 29780;

// Lock to 60fps (exact), independent of monitor refresh rate (144Hz etc)
const EMU_FPS   = 60;
const FRAME_MS  = 1000 / EMU_FPS;

// Prevent spiral-of-death if a tab stalls; run at most N frames per RAF tick.
const MAX_FRAMES_PER_TICK = 2;

let _lastNow = 0;
let _accumMs = 0;

function _runOneEmuFrame() {
  // Run CPU until we consume one full frame worth of CPU cycles.
  // (step() returns real cycles used, including DMA microsteps)
  let frameCycles = 0;

  while (cpuRunning && frameCycles < NTSC_CPU_CYCLES_PER_FRAME) {
    const used = step() | 0;
    if (used <= 0) break; // paused/break/unknown opcode path
    frameCycles += used;
  }
}

function _mainLoopRAF(now) {
  if (!cpuRunning) return;

  if (!_lastNow) _lastNow = now;
  let dt = now - _lastNow;
  _lastNow = now;

  // Clamp crazy dt (background tab etc) so we don't attempt to catch up forever
  if (dt < 0) dt = 0;
  if (dt > 250) dt = 250;

  _accumMs += dt;

  let frames = 0;
  while (cpuRunning && _accumMs >= FRAME_MS && frames < MAX_FRAMES_PER_TICK) {
    _accumMs -= FRAME_MS;
    frames++;

    _runOneEmuFrame();

    if (perFrameStep) {
      pause();
      break;
    }
  }

  requestAnimationFrame(_mainLoopRAF);
}

window.step = function () {

  debug.logging = false;
  NoSignalAudio.setEnabled(false);
  if (!cpuRunning) return 0;

  // DMA first: returns 1 or 2 cycles per call (or 0 if finished)
  if (DMA.active) {
    const used = dmaMicroStep();   // calls consumeCycle() internally
    return used | 0;
  }

  code = checkReadOffset(CPUregisters.PC);

  if (CPUregisters.PC >= 0x8000) {

    operand1 = prgRom[((CPUregisters.PC + 1) & 0xFFFF) - 0x8000];
    operand2 = prgRom[((CPUregisters.PC + 2) & 0xFFFF) - 0x8000];

  }

  if (OPCODES[code].pc === 1) operand2 = "na";

  const op = OPCODES[code];

  if (!op || !op.func) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=$${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
    pause();
    return 0;
  }

  // Measure cycles consumed by this opcode (handlers call addCycle internally)
  const before = cpuCycles;

  consumeCycle(); // opcode fetch cycle

  disasm();
  op.func();

  if (irqLatch) {
  serviceIRQ();
  irqLatch = false;
  irqAssert.RTI = false;
  }

  if ((irqAssert.dmcDma || irqAssert.mmc3 || irqAssert.RTI) && !CPUregisters.P.I) irqLatch = true;

  const after = cpuCycles;
  const used  = (after - before) | 0;

  //=================================================
  // ---- handle interrupts ----
  // Only take NMI if it's pending *and not suppressed this vblank*

  if (nmiPending) {
    if (debug.videoTiming) {
      console.debug(
        `%c[NMI handler entered] cpu=${cpuCycles} ppu=${ppuCycles} frame=${(currentFrame)} sl=${(currentScanline)} dot=${(currentDot)}`,
        "color:white;background:red;font-weight:bold;font-size:14px;"
      );
    }
    serviceNMI();
    nmiPending = 0;
  }

  checkNmi();
  // set the flag here, check if NMI is due NEXT step
  // this order is specifically c oded to pass NMI control tests
  // i.e. do not call checkInterrupts prior to handling of interrupts
  //=================================================

  // Return actual CPU cycles the opcode consumed
  return used;
};

window.run = function () {
  if (cpuRunning) return;
  cpuRunning = true;

  // reset loop timing state
  _lastNow = 0;
  _accumMs = 0;

  requestAnimationFrame(_mainLoopRAF);
};

window.pause = function () {
  cpuRunning = false;
  if (typeof updateDebugTables === 'function') {
    try { updateDebugTables(); } catch (_) {}
  }
};

// ======================== OPCODE DISPATCH TABLE ========================
// move pc/cyc directly to opcode handlers eventually to optimise -> done
// all opcodes setting PC manually have zero increment -> kinda legacy, the pc attribute -is- used
// by the disasm, ones that are zero should be 2 on a quick check .. and for lengths of 1 there is a simple "na" filter
// so the zero fields should slip through on the disasm anyways and log both operands
const OPCODES = [
  { pc:0, func: BRK_IMP },   { pc:2, func: ORA_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: SLO_INDX },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: ORA_ZP },   { pc:2, func: ASL_ZP },   { pc:2, func: SLO_ZP },
  { pc:1, func: PHP_IMP },   { pc:2, func: ORA_IMM },  { pc:1, func: ASL_ACC },  { pc:2, func: ANC_IMM },
  { pc:3, func: NOP_HANDLER },   { pc:3, func: ORA_ABS },  { pc:3, func: ASL_ABS },  { pc:3, func: SLO_ABS },
  { pc:0, func: BRANCH_REL },   { pc:2, func: ORA_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: SLO_INDY },
  { pc:2, func: NOP_HANDLER },   { pc:2, func: ORA_ZPX },  { pc:2, func: ASL_ZPX },{ pc:2, func: SLO_ZPX },
  { pc:1, func: CLC_IMP },   { pc:3, func: ORA_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: SLO_ABSY },
  { pc:3, func: NOP_HANDLER },  { pc:3, func: ORA_ABSX }, { pc:3, func: ASL_ABSX }, { pc:3, func: SLO_ABSX },
  { pc:0, func: JSR_ABS },   { pc:2, func: AND_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: RLA_INDX },
  { pc:2, func: BIT_ZP },    { pc:2, func: AND_ZP },   { pc:2, func: ROL_ZP },   { pc:2, func: RLA_ZP },
  { pc:1, func: PLP_IMP },   { pc:2, func: AND_IMM },  { pc:1, func: ROL_ACC },  { pc:2, func: ANC_IMM },
  { pc:3, func: BIT_ABS },   { pc:3, func: AND_ABS },  { pc:3, func: ROL_ABS },  { pc:3, func: RLA_ABS },
  { pc:0, func: BRANCH_REL },   { pc:2, func: AND_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: RLA_INDY },
  { pc:2, func: NOP_HANDLER },   { pc:2, func: AND_ZPX },  { pc:2, func: ROL_ZPX },  { pc:2, func: RLA_ZPX },
  { pc:1, func: SEC_IMP },   { pc:3, func: AND_ABSY }, { pc:1, func: NOP_HANDLER },      { pc:3, func: RLA_ABSY },
  { pc:3, func: NOP_HANDLER },  { pc:3, func: AND_ABSX }, { pc:3, func: ROL_ABSX }, { pc:3, func: RLA_ABSX },
  { pc:0, func: RTI_IMP },   { pc:2, func: EOR_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: SRE_INDX },
  { pc:2, func: NOP_HANDLER },    { pc:2, func: EOR_ZP },   { pc:2, func: LSR_ZP },   { pc:2, func: SRE_ZP },
  { pc:1, func: PHA_IMP },   { pc:2, func: EOR_IMM },  { pc:1, func: LSR_ACC },  { pc:2, func: ALR_IMM },
  { pc:0, func: JMP_ABS },   { pc:3, func: EOR_ABS },  { pc:3, func: LSR_ABS },  { pc:3, func: SRE_ABS },
  { pc:0, func: BRANCH_REL },   { pc:2, func: EOR_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: SRE_INDY },
  { pc:2, func: NOP_HANDLER },   { pc:2, func: EOR_ZPX },  { pc:2, func: LSR_ZPX },{ pc:2, func: SRE_ZPX },
  { pc:1, func: CLI_IMP },   { pc:3, func: EOR_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: SRE_ABSY },
  { pc:3, func: NOP_HANDLER },  { pc:3, func: EOR_ABSX }, { pc:3, func: LSR_ABSX }, { pc:3, func: SRE_ABSX },
  { pc:0, func: RTS_IMP },   { pc:2, func: ADC_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: RRA_INDX },
  { pc:2, func: NOP_HANDLER },    { pc:2, func: ADC_ZP },   { pc:2, func: ROR_ZP },   { pc:2, func: RRA_ZP },
  { pc:1, func: PLA_IMP },   { pc:2, func: ADC_IMM },  { pc:1, func: ROR_ACC },  { pc:2, func: ARR_IMM },
  { pc:0, func: JMP_IND },   { pc:3, func: ADC_ABS },  { pc:3, func: ROR_ABS },  { pc:3, func: RRA_ABS },

  { pc:0, func: BRANCH_REL },   { pc:2, func: ADC_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: RRA_INDY },
  { pc:2, func: NOP_HANDLER },   { pc:2, func: ADC_ZPX },  { pc:2, func: ROR_ZPX },  { pc:2, func: RRA_ZPX },
  { pc:1, func: SEI_IMP },   { pc:3, func: ADC_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: RRA_ABSY },
  { pc:3, func: NOP_HANDLER },  { pc:3, func: ADC_ABSX }, { pc:3, func: ROR_ABSX }, { pc:3, func: RRA_ABSX },

  { pc:2, func: DOP_IMM },   { pc:2, func: STA_INDX }, { pc:2, func: NOP_HANDLER }, { pc:2, func: SAX_INDX },
  { pc:2, func: STY_ZP },    { pc:2, func: STA_ZP },   { pc:2, func: STX_ZP },   { pc:2, func: SAX_ZP },
  { pc:1, func: DEY_IMP },   { pc:2, func: NOP_HANDLER },{ pc:1, func: TXA_IMP },  { pc:2, func: XAA_IMM },
  { pc:3, func: STY_ABS },   { pc:3, func: STA_ABS },  { pc:3, func: STX_ABS },  { pc:3, func: SAX_ABS },

  { pc:0, func: BRANCH_REL },   { pc:2, func: STA_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: SHA_INDY },
  { pc:2, func: STY_ZPX },   { pc:2, func: STA_ZPX },  { pc:2, func: STX_ZPY },  { pc:2, func: SAX_ZPY },
  { pc:1, func: TYA_IMP },   { pc:3, func: STA_ABSY }, { pc:1, func: TXS_IMP },  { pc:3, func: TAS_ABSY },
  { pc:3, func: SHY_ABSX },  { pc:3, func: STA_ABSX }, { pc:3, func: SHX_ABSY }, { pc:3, func: SHA_ABSY },

  { pc:2, func: LDY_IMM },   { pc:2, func: LDA_INDX }, { pc:2, func: LDX_IMM },  { pc:2, func: LAX_INDX },
  { pc:2, func: LDY_ZP },    { pc:2, func: LDA_ZP },   { pc:2, func: LDX_ZP },   { pc:2, func: LAX_ZP },
  { pc:1, func: TAY_IMP },   { pc:2, func: LDA_IMM },  { pc:1, func: TAX_IMP },  { pc:2, func: LAX_IMM },
  { pc:3, func: LDY_ABS },   { pc:3, func: LDA_ABS },  { pc:3, func: LDX_ABS },  { pc:3, func: LAX_ABS },

  { pc:0, func: BRANCH_REL },   { pc:2, func: LDA_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: LAX_INDY },
  { pc:2, func: LDY_ZPX },   { pc:2, func: LDA_ZPX },  { pc:2, func: LDX_ZPY },  { pc:2, func: LAX_ZPY },
  { pc:1, func: CLV_IMP },   { pc:3, func: LDA_ABSY }, { pc:1, func: TSX_IMP },  { pc:3, func: LAS_ABSY },
  { pc:3, func: LDY_ABSX },  { pc:3, func: LDA_ABSX }, { pc:3, func: LDX_ABSY }, { pc:3, func: LAX_ABSY },

  { pc:2, func: CPY_IMM },   { pc:2, func: CMP_INDX }, { pc:2, func: NOP_HANDLER },      { pc:2, func: DCP_INDX },
  { pc:2, func: CPY_ZP },    { pc:2, func: CMP_ZP },   { pc:2, func: DEC_ZP },   { pc:2, func: DCP_ZP },
  { pc:1, func: INY_IMP },   { pc:2, func: CMP_IMM },  { pc:1, func: DEX_IMP },  { pc:2, func: SBX_IMM },
  { pc:3, func: CPY_ABS },   { pc:3, func: CMP_ABS },  { pc:3, func: DEC_ABS },  { pc:3, func: DCP_ABS },

  { pc:0, func: BRANCH_REL },   { pc:2, func: CMP_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: DCP_INDY },
  { pc:2, func: NOP_HANDLER },   { pc:2, func: CMP_ZPX },  { pc:2, func: DEC_ZPX },  { pc:2, func: DCP_ZPX },
  { pc:1, func: CLD_IMP },   { pc:3, func: CMP_ABSY }, { pc:1, func: NOP_HANDLER },      { pc:3, func: DCP_ABSY },
  { pc:3, func: NOP_HANDLER },  { pc:3, func: CMP_ABSX }, { pc:3, func: DEC_ABSX }, { pc:3, func: DCP_ABSX },

  { pc:2, func: CPX_IMM },   { pc:2, func: SBC_INDX }, { pc:2, func: NOP_HANDLER },      { pc:2, func: ISC_INDX },
  { pc:2, func: CPX_ZP },    { pc:2, func: SBC_ZP },   { pc:2, func: INC_ZP },   { pc:2, func: ISC_ZP },
  { pc:1, func: INX_IMP },   { pc:2, func: SBC_IMM },  { pc:1, func: NOP_HANDLER },      { pc:2, func: SBC_IMM },
  { pc:3, func: CPX_ABS },   { pc:3, func: SBC_ABS },  { pc:3, func: INC_ABS },  { pc:3, func: ISC_ABS },

  { pc:0, func: BRANCH_REL },   { pc:2, func: SBC_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: ISC_INDY },
  { pc:2, func: NOP_HANDLER },   { pc:2, func: SBC_ZPX },  { pc:2, func: INC_ZPX },  { pc:2, func: ISC_ZPX },
  { pc:1, func: SED_IMP },   { pc:3, func: SBC_ABSY }, { pc:1, func: NOP_HANDLER },      { pc:3, func: ISC_ABSY },
  { pc:3, func: NOP_HANDLER },  { pc:3, func: SBC_ABSX }, { pc:3, func: INC_ABSX }, { pc:3, func: ISC_ABSX },
];
