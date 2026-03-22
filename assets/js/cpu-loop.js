let cpuRunning = false;

let step = {
  frame: false,
  opcode: 'false',
  nmi: false,
  irq: false,
  opcodeWhenEnabled: 0
};

let nmiPending = 0;
let code = 0x00; // current opcode now global for CPU openbus logic

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
    const used = window.step() | 0;
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
  }

  requestAnimationFrame(_mainLoopRAF);
}

window.step = function () {

  NoSignalAudio.setEnabled(false);
  if (!cpuRunning) return 0;

  // DMA first: returns 1 or 2 cycles per call (or 0 if finished)
  if (DMA.active) {
    const used = dmaMicroStep();   // calls consumeCycle() internally
    return used | 0;
  }

  code = checkReadOffset(CPUregisters.PC);

  // these fetches are for DISASM display only, the opcode handlers fetch the opcodes internally :P
  if (disasmRunning) {

  if (CPUregisters.PC >= 0x8000) {
    operand[1] = prgRom[((CPUregisters.PC + 1) & 0xFFFF) - 0x8000];
    operand[2] = prgRom[((CPUregisters.PC + 2) & 0xFFFF) - 0x8000];
  }
  const len = OPCODES[code].pc;
  if (len < 2) operand[1] = "--"; // no operand1
  if (len < 3) operand[2] = "--"; // no operand2
  }

  const op = OPCODES[code];

  if (!op || !op.func) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=$${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
    pause();
    return 0;
  }

  const before = cpuCycles;

  consumeCycle(); // opcode fetch cycle

  disasm();

  // 0x78 → SEI (set I after poll), 0x58 → CLI (clear I after poll), 0x28 → PLP (restore P after poll)
  // these instructions will disable interrupts, but poll for IRQ mid instruction (here we have already fetched our opcode
  // so we are 'mid-instruction), we capture the IRQ decision before they set the I flag
  if (code === 0x78 || code === 0x58 || code === 0x28) {
      if (!CPUregisters.P.I && Object.values(irqAssert).some(Boolean)) {
          irqBypassI = true;
      }
  }

  op.func(); // call opcode handler

  const after = cpuCycles;
  const used  = (after - before) | 0;

  //=================================================
  // ---- handle interrupts ----
  // Only take NMI if it's pending *and not suppressed this vblank*

  // poll for interrupts after the current instruction finishes (unless SEI, CLI, PLP, we captured the decision in advance)
  if (irqBypassI) {
      serviceIRQ(irqBypassI);
      irqBypassI = false;
  }
  irqTimingEngine();

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

  // step per opcode, if enabled, pause, this is the end of the opcode handler / cpu-loop
  if (step.opcode === 'stepMode' || step.opcode === 'firstPress') {
  return;
  }
    
  return used;

};

function handleStepToggle() {

  if (step.opcode === 'stepMode') {
    run();
    console.log("stepMode:", code.toString(16));
    cpuRunning = false;
  }

  if (step.opcode === 'false') {
    step.opcode = 'stepMode';
    console.log("stepMode:", code.toString(16));
    cpuRunning = false;
  }

}

// step per opcode ~ tilde key or GUI button
window.addEventListener("keydown", (e) => {
  if (e.code === "Backquote") {
  handleStepToggle(); 
  }
});

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
// all opcodes setting PC manually have zero increment -> legacy
const OPCODES = [
  { pc:1, func: BRK_IMP },   { pc:2, func: ORA_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: SLO_INDX },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: ORA_ZP },   { pc:2, func: ASL_ZP },   { pc:2, func: SLO_ZP },
  { pc:1, func: PHP_IMP },   { pc:2, func: ORA_IMM },  { pc:1, func: ASL_ACC },  { pc:2, func: ANC_IMM },
  { pc:3, func: NOP_HANDLER },{ pc:3, func: ORA_ABS },  { pc:3, func: ASL_ABS },  { pc:3, func: SLO_ABS },

  { pc:2, func: BRANCH_REL },{ pc:2, func: ORA_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: SLO_INDY },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: ORA_ZPX },  { pc:2, func: ASL_ZPX },  { pc:2, func: SLO_ZPX },
  { pc:1, func: CLC_IMP },   { pc:3, func: ORA_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: SLO_ABSY },
  { pc:3, func: NOP_HANDLER },{ pc:3, func: ORA_ABSX }, { pc:3, func: ASL_ABSX }, { pc:3, func: SLO_ABSX },

  { pc:3, func: JSR_ABS },   { pc:2, func: AND_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: RLA_INDX },
  { pc:2, func: BIT_ZP },    { pc:2, func: AND_ZP },   { pc:2, func: ROL_ZP },   { pc:2, func: RLA_ZP },
  { pc:1, func: PLP_IMP },   { pc:2, func: AND_IMM },  { pc:1, func: ROL_ACC },  { pc:2, func: ANC_IMM },
  { pc:3, func: BIT_ABS },   { pc:3, func: AND_ABS },  { pc:3, func: ROL_ABS },  { pc:3, func: RLA_ABS },

  { pc:2, func: BRANCH_REL },{ pc:2, func: AND_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: RLA_INDY },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: AND_ZPX },  { pc:2, func: ROL_ZPX },  { pc:2, func: RLA_ZPX },
  { pc:1, func: SEC_IMP },   { pc:3, func: AND_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: RLA_ABSY },
  { pc:3, func: NOP_HANDLER },{ pc:3, func: AND_ABSX }, { pc:3, func: ROL_ABSX }, { pc:3, func: RLA_ABSX },

  { pc:1, func: RTI_IMP },   { pc:2, func: EOR_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: SRE_INDX },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: EOR_ZP },   { pc:2, func: LSR_ZP },   { pc:2, func: SRE_ZP },
  { pc:1, func: PHA_IMP },   { pc:2, func: EOR_IMM },  { pc:1, func: LSR_ACC },  { pc:2, func: ALR_IMM },
  { pc:3, func: JMP_ABS },   { pc:3, func: EOR_ABS },  { pc:3, func: LSR_ABS },  { pc:3, func: SRE_ABS },

  { pc:2, func: BRANCH_REL },{ pc:2, func: EOR_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: SRE_INDY },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: EOR_ZPX },  { pc:2, func: LSR_ZPX },  { pc:2, func: SRE_ZPX },
  { pc:1, func: CLI_IMP },   { pc:3, func: EOR_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: SRE_ABSY },
  { pc:3, func: NOP_HANDLER },{ pc:3, func: EOR_ABSX }, { pc:3, func: LSR_ABSX }, { pc:3, func: SRE_ABSX },

  { pc:1, func: RTS_IMP },   { pc:2, func: ADC_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: RRA_INDX },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: ADC_ZP },   { pc:2, func: ROR_ZP },   { pc:2, func: RRA_ZP },
  { pc:1, func: PLA_IMP },   { pc:2, func: ADC_IMM },  { pc:1, func: ROR_ACC },  { pc:2, func: ARR_IMM },
  { pc:3, func: JMP_IND },   { pc:3, func: ADC_ABS },  { pc:3, func: ROR_ABS },  { pc:3, func: RRA_ABS },

  { pc:2, func: BRANCH_REL },{ pc:2, func: ADC_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: RRA_INDY },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: ADC_ZPX },  { pc:2, func: ROR_ZPX },  { pc:2, func: RRA_ZPX },
  { pc:1, func: SEI_IMP },   { pc:3, func: ADC_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: RRA_ABSY },
  { pc:3, func: NOP_HANDLER },{ pc:3, func: ADC_ABSX }, { pc:3, func: ROR_ABSX }, { pc:3, func: RRA_ABSX },

  { pc:2, func: DOP_IMM },   { pc:2, func: STA_INDX }, { pc:2, func: NOP_HANDLER },{ pc:2, func: SAX_INDX },
  { pc:2, func: STY_ZP },    { pc:2, func: STA_ZP },   { pc:2, func: STX_ZP },   { pc:2, func: SAX_ZP },
  { pc:1, func: DEY_IMP },   { pc:2, func: NOP_HANDLER },{ pc:1, func: TXA_IMP }, { pc:2, func: XAA_IMM },
  { pc:3, func: STY_ABS },   { pc:3, func: STA_ABS },  { pc:3, func: STX_ABS },  { pc:3, func: SAX_ABS },

  { pc:2, func: BRANCH_REL },{ pc:2, func: STA_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: SHA_INDY },
  { pc:2, func: STY_ZPX },   { pc:2, func: STA_ZPX },  { pc:2, func: STX_ZPY },  { pc:2, func: SAX_ZPY },
  { pc:1, func: TYA_IMP },   { pc:3, func: STA_ABSY }, { pc:1, func: TXS_IMP },  { pc:3, func: TAS_ABSY },
  { pc:3, func: SHY_ABSX },  { pc:3, func: STA_ABSX }, { pc:3, func: SHX_ABSY }, { pc:3, func: SHA_ABSY },

  { pc:2, func: LDY_IMM },   { pc:2, func: LDA_INDX }, { pc:2, func: LDX_IMM },  { pc:2, func: LAX_INDX },
  { pc:2, func: LDY_ZP },    { pc:2, func: LDA_ZP },   { pc:2, func: LDX_ZP },   { pc:2, func: LAX_ZP },
  { pc:1, func: TAY_IMP },   { pc:2, func: LDA_IMM },  { pc:1, func: TAX_IMP },  { pc:2, func: LAX_IMM },
  { pc:3, func: LDY_ABS },   { pc:3, func: LDA_ABS },  { pc:3, func: LDX_ABS },  { pc:3, func: LAX_ABS },

  { pc:2, func: BRANCH_REL },{ pc:2, func: LDA_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: LAX_INDY },
  { pc:2, func: LDY_ZPX },   { pc:2, func: LDA_ZPX },  { pc:2, func: LDX_ZPY },  { pc:2, func: LAX_ZPY },
  { pc:1, func: CLV_IMP },   { pc:3, func: LDA_ABSY }, { pc:1, func: TSX_IMP },  { pc:3, func: LAS_ABSY },
  { pc:3, func: LDY_ABSX },  { pc:3, func: LDA_ABSX }, { pc:3, func: LDX_ABSY }, { pc:3, func: LAX_ABSY },

  { pc:2, func: CPY_IMM },   { pc:2, func: CMP_INDX }, { pc:2, func: NOP_HANDLER },{ pc:2, func: DCP_INDX },
  { pc:2, func: CPY_ZP },    { pc:2, func: CMP_ZP },   { pc:2, func: DEC_ZP },   { pc:2, func: DCP_ZP },
  { pc:1, func: INY_IMP },   { pc:2, func: CMP_IMM },  { pc:1, func: DEX_IMP },  { pc:2, func: SBX_IMM },
  { pc:3, func: CPY_ABS },   { pc:3, func: CMP_ABS },  { pc:3, func: DEC_ABS },  { pc:3, func: DCP_ABS },

  { pc:2, func: BRANCH_REL },{ pc:2, func: CMP_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: DCP_INDY },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: CMP_ZPX },  { pc:2, func: DEC_ZPX },  { pc:2, func: DCP_ZPX },
  { pc:1, func: CLD_IMP },   { pc:3, func: CMP_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: DCP_ABSY },
  { pc:3, func: NOP_HANDLER },{ pc:3, func: CMP_ABSX }, { pc:3, func: DEC_ABSX }, { pc:3, func: DCP_ABSX },

  { pc:2, func: CPX_IMM },   { pc:2, func: SBC_INDX }, { pc:2, func: NOP_HANDLER },{ pc:2, func: ISC_INDX },
  { pc:2, func: CPX_ZP },    { pc:2, func: SBC_ZP },   { pc:2, func: INC_ZP },   { pc:2, func: ISC_ZP },
  { pc:1, func: INX_IMP },   { pc:2, func: SBC_IMM },  { pc:1, func: NOP_HANDLER },{ pc:2, func: SBC_IMM },
  { pc:3, func: CPX_ABS },   { pc:3, func: SBC_ABS },  { pc:3, func: INC_ABS },  { pc:3, func: ISC_ABS },

  { pc:2, func: BRANCH_REL },{ pc:2, func: SBC_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: ISC_INDY },
  { pc:2, func: NOP_HANDLER },{ pc:2, func: SBC_ZPX },  { pc:2, func: INC_ZPX },  { pc:2, func: ISC_ZPX },
  { pc:1, func: SED_IMP },   { pc:3, func: SBC_ABSY }, { pc:1, func: NOP_HANDLER },{ pc:3, func: ISC_ABSY },
  { pc:3, func: NOP_HANDLER },{ pc:3, func: SBC_ABSX }, { pc:3, func: INC_ABSX }, { pc:3, func: ISC_ABSX },
];
