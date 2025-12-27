let cpuRunning = false;

// internal only, don't build disasm rows unless the window is open
let disasmRunning = false;
let perFrameStep = false;

let nmiPending = null;
let irqPending = 0;

// NTSC Resolution
const NES_W = 256;
const NES_H = 240;

let code = 0x00; // current opcode now global for CPU openbus logic

const DMA = {
  active: false,
  page:   0x00,
  addr:   0x0000,
  index:  0,     // 0..255
  tmp:    0x00,
  phase:  0,     // 0 = read, 1 = write
  pad:    0      // 1 or 2 cycles
};

function dmaMicroStep() {
  if (!DMA.active) return 0;

  // ---- alignment pad (1 or 2 cycles) ----
  if (DMA.pad > 0) {
    DMA.pad--;
    addCycles(1);
    return 1;
  }

  // ---- finished ----
  if (DMA.index >= 256) {
    DMA.active = false;
    return 0;
  }

  // ---- transfer ----
  if (DMA.phase === 0) {
    // READ cycle
    DMA.tmp = checkReadOffset(DMA.addr) & 0xFF;
    DMA.phase = 1;
    addCycles(1);
    return 1;
  } else {
    // WRITE cycle
    checkWriteOffset(0x2004, DMA.tmp);
    DMA.addr = (DMA.addr + 1) & 0xFFFF;
    DMA.index++;
    DMA.phase = 0;
    addCycles(1);
    return 1;
  }
}

function clearNmiEdge(){
  PPU_FRAME_FLAGS &= ~0b00000100;
}

function doesNmiEdgeExist() {
    return (PPU_FRAME_FLAGS & 0b00000100) !== 0;
}

function checkInterrupts() {
  if (!doesNmiEdgeExist()) return;

  nmiPending = (currentFrame);

  if (debugVideoTiming) {
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

// peek-only PRG read (does not touch cpuOpenBus / does not call checkReadOffset)
function peekPRG(addr){
  addr &= 0xFFFF;
  if (addr < 0x8000) return 0x00;
  if (typeof mmc1CpuRead === "function" && typeof mapperNumber === "number" && mapperNumber === 1) {
    // assumes mmc1CpuRead is pure on reads; if not, replace with direct PRG ROM indexing
    return mmc1CpuRead(addr) & 0xFF;
  }
  return prgRom[addr - 0x8000] & 0xFF;
}

window.step = function () {
  debugLogging = false;
  NoSignalAudio.setEnabled(false);
  if (!cpuRunning) return 0;

  // DMA first: returns 1 or 2 cycles per call (or 0 if finished)
  if (DMA.active) {
    const used = dmaMicroStep();   // calls addCycles() internally
    return used | 0;
  }

  code = checkReadOffset(CPUregisters.PC);

  const op = OPCODES[code];

  if (!op || !op.func) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=$${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
    pause();
    return 0;
  }

  if (disasmRunning){
    var _op  = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF);
    var __op = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF);
    var disasmPc = CPUregisters.PC;
  }

  if (bpStepOnce) {
    bpStepOnce = false;
  } else {
    bpCheckOpcode(code, disasmPc);
    if (breakPending) {
      if (disasmRunning) DISASM.appendRow(buildDisasmRow(code, _op, __op, disasmPc));
      pause();
      breakPending = false;
      return 0;
    }
  }

  // Measure cycles consumed by this opcode (handlers call addCycles internally)
  const before = cpuCycles;

  op.func(); // executes and calls addCycles(...) multiple times

  const after = cpuCycles;
  const used  = (after - before) | 0;

  if (disasmRunning) DISASM.appendRow(buildDisasmRow(code, _op, __op, disasmPc));

  // Advance PC according to the opcode metadata
  CPUregisters.PC = (CPUregisters.PC + op.pc) & 0xFFFF;

  //=================================================
  // ---- handle interrupts ----
  // Only take NMI if it's pending *and not suppressed this vblank*
  if (nmiPending) {
    if (debugVideoTiming) {
      const s = SHARED.SYNC;
      console.debug(
        `%c[NMI handler entered] cpu=${cpuCycles} ppu=${ppuCycles} frame=${(s[4]|0)} sl=${(s[2]|0)} dot=${(s[3]|0)}`,
        "color:white;background:red;font-weight:bold;font-size:14px;"
      );
    }
    serviceNMI();
    nmiPending = 0;
  }

  if (irqPending === 1) {
    serviceIRQ();
    irqPending = 0;
  }
  // just latch, service after next inst.
  if (!CPUregisters.P.I) {
    irqPending++;
  }

  checkInterrupts();
  // set the flag here, check if NMI is due NEXT step
  // this order is specifically coded to pass NMI control tests
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
// move pc/cyc directly to opcode handlers eventually to optimise
// all opcodes setting PC manually have zero increment
const OPCODES = [
  { pc:0, func: BRK_IMP },   { pc:2, func: ORA_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: SLO_INDX },
  { pc:2, func: NOP_ZP },    { pc:2, func: ORA_ZP },   { pc:2, func: ASL_ZP },   { pc:2, func: SLO_ZP },
  { pc:1, func: PHP_IMP },   { pc:2, func: ORA_IMM },  { pc:1, func: ASL_ACC },  { pc:2, func: ANC_IMM },
  { pc:3, func: NOP_ABS },   { pc:3, func: ORA_ABS },  { pc:3, func: ASL_ABS },  { pc:3, func: SLO_ABS },

  { pc:0, func: BPL_REL },   { pc:2, func: ORA_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: SLO_INDY },
  { pc:2, func: NOP_ZPX },   { pc:2, func: ORA_ZPX },  { pc:2, func: ASL_ZPX },  { pc:2, func: SLO_ZPX },
  { pc:1, func: CLC_IMP },   { pc:3, func: ORA_ABSY }, { pc:1, func: NOP },      { pc:3, func: SLO_ABSY },
  { pc:3, func: NOP_ABSX },  { pc:3, func: ORA_ABSX }, { pc:3, func: ASL_ABSX }, { pc:3, func: SLO_ABSX },

  { pc:0, func: JSR_ABS },   { pc:2, func: AND_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: RLA_INDX },
  { pc:2, func: BIT_ZP },    { pc:2, func: AND_ZP },   { pc:2, func: ROL_ZP },   { pc:2, func: RLA_ZP },
  { pc:1, func: PLP_IMP },   { pc:2, func: AND_IMM },  { pc:1, func: ROL_ACC },  { pc:2, func: ANC_IMM },
  { pc:3, func: BIT_ABS },   { pc:3, func: AND_ABS },  { pc:3, func: ROL_ABS },  { pc:3, func: RLA_ABS },

  { pc:0, func: BMI_REL },   { pc:2, func: AND_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: RLA_INDY },
  { pc:2, func: NOP_ZPX },   { pc:2, func: AND_ZPX },  { pc:2, func: ROL_ZPX },  { pc:2, func: RLA_ZPX },
  { pc:1, func: SEC_IMP },   { pc:3, func: AND_ABSY }, { pc:1, func: NOP },      { pc:3, func: RLA_ABSY },
  { pc:3, func: NOP_ABSX },  { pc:3, func: AND_ABSX }, { pc:3, func: ROL_ABSX }, { pc:3, func: RLA_ABSX },

  { pc:0, func: RTI_IMP },   { pc:2, func: EOR_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: SRE_INDX },
  { pc:2, func: NOP_ZP },    { pc:2, func: EOR_ZP },   { pc:2, func: LSR_ZP },   { pc:2, func: SRE_ZP },
  { pc:1, func: PHA_IMP },   { pc:2, func: EOR_IMM },  { pc:1, func: LSR_ACC },  { pc:2, func: ALR_IMM },
  { pc:0, func: JMP_ABS },   { pc:3, func: EOR_ABS },  { pc:3, func: LSR_ABS },  { pc:3, func: SRE_ABS },

  { pc:0, func: BVC_REL },   { pc:2, func: EOR_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: SRE_INDY },
  { pc:2, func: NOP_ZPX },   { pc:2, func: EOR_ZPX },  { pc:2, func: LSR_ZPX },  { pc:2, func: SRE_ZPX },
  { pc:1, func: CLI_IMP },   { pc:3, func: EOR_ABSY }, { pc:1, func: NOP },      { pc:3, func: SRE_ABSY },
  { pc:3, func: NOP_ABSX },  { pc:3, func: EOR_ABSX }, { pc:3, func: LSR_ABSX }, { pc:3, func: SRE_ABSX },

  { pc:0, func: RTS_IMP },   { pc:2, func: ADC_INDX }, { pc:1, func: KIL_IMP },  { pc:2, func: RRA_INDX },
  { pc:2, func: NOP_ZP },    { pc:2, func: ADC_ZP },   { pc:2, func: ROR_ZP },   { pc:2, func: RRA_ZP },
  { pc:1, func: PLA_IMP },   { pc:2, func: ADC_IMM },  { pc:1, func: ROR_ACC },  { pc:2, func: ARR_IMM },
  { pc:0, func: JMP_IND },   { pc:3, func: ADC_ABS },  { pc:3, func: ROR_ABS },  { pc:3, func: RRA_ABS },

  { pc:0, func: BVS_REL },   { pc:2, func: ADC_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: RRA_INDY },
  { pc:2, func: NOP_ZPX },   { pc:2, func: ADC_ZPX },  { pc:2, func: ROR_ZPX },  { pc:2, func: RRA_ZPX },
  { pc:1, func: SEI_IMP },   { pc:3, func: ADC_ABSY }, { pc:1, func: NOP },      { pc:3, func: RRA_ABSY },
  { pc:3, func: NOP_ABSX },  { pc:3, func: ADC_ABSX }, { pc:3, func: ROR_ABSX }, { pc:3, func: RRA_ABSX },

  { pc:2, func: DOP_IMM },   { pc:2, func: STA_INDX }, { pc:2, func: NOP_0x82 },      { pc:2, func: SAX_INDX },
  { pc:2, func: STY_ZP },    { pc:2, func: STA_ZP },   { pc:2, func: STX_ZP },   { pc:2, func: SAX_ZP },
  { pc:1, func: DEY_IMP },   { pc:2, func: NOP },      { pc:1, func: TXA_IMP },  { pc:2, func: XAA_IMM },
  { pc:3, func: STY_ABS },   { pc:3, func: STA_ABS },  { pc:3, func: STX_ABS },  { pc:3, func: SAX_ABS },

  { pc:0, func: BCC_REL },   { pc:2, func: STA_INDY }, { pc:2, func: NOP_ZPY },  { pc:2, func: SHA_INDY },
  { pc:2, func: STY_ZPX },   { pc:2, func: STA_ZPX },  { pc:2, func: STX_ZPY },  { pc:2, func: SAX_ZPY },
  { pc:1, func: TYA_IMP },   { pc:3, func: STA_ABSY }, { pc:1, func: TXS_IMP },  { pc:3, func: TAS_ABSY },
  { pc:3, func: SHY_ABSX },  { pc:3, func: STA_ABSX }, { pc:3, func: SHX_ABSY }, { pc:3, func: SHA_ABSY },

  { pc:2, func: LDY_IMM },   { pc:2, func: LDA_INDX }, { pc:2, func: LDX_IMM },  { pc:2, func: LAX_INDX },
  { pc:2, func: LDY_ZP },    { pc:2, func: LDA_ZP },   { pc:2, func: LDX_ZP },   { pc:2, func: LAX_ZP },
  { pc:1, func: TAY_IMP },   { pc:2, func: LDA_IMM },  { pc:1, func: TAX_IMP },  { pc:2, func: LAX_IMM },
  { pc:3, func: LDY_ABS },   { pc:3, func: LDA_ABS },  { pc:3, func: LDX_ABS },  { pc:3, func: LAX_ABS },

  { pc:0, func: BCS_REL },   { pc:2, func: LDA_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: LAX_INDY },
  { pc:2, func: LDY_ZPX },   { pc:2, func: LDA_ZPX },  { pc:2, func: LDX_ZPY },  { pc:2, func: LAX_ZPY },
  { pc:1, func: CLV_IMP },   { pc:3, func: LDA_ABSY }, { pc:1, func: TSX_IMP },  { pc:3, func: LAS_ABSY },
  { pc:3, func: LDY_ABSX },  { pc:3, func: LDA_ABSX }, { pc:3, func: LDX_ABSY }, { pc:3, func: LAX_ABSY },

  { pc:2, func: CPY_IMM },   { pc:2, func: CMP_INDX }, { pc:2, func: NOP },      { pc:2, func: DCP_INDX },
  { pc:2, func: CPY_ZP },    { pc:2, func: CMP_ZP },   { pc:2, func: DEC_ZP },   { pc:2, func: DCP_ZP },
  { pc:1, func: INY_IMP },   { pc:2, func: CMP_IMM },  { pc:1, func: DEX_IMP },  { pc:2, func: SBX_IMM },
  { pc:3, func: CPY_ABS },   { pc:3, func: CMP_ABS },  { pc:3, func: DEC_ABS },  { pc:3, func: DCP_ABS },

  { pc:0, func: BNE_REL },   { pc:2, func: CMP_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: DCP_INDY },
  { pc:2, func: NOP_ZPX },   { pc:2, func: CMP_ZPX },  { pc:2, func: DEC_ZPX },  { pc:2, func: DCP_ZPX },
  { pc:1, func: CLD_IMP },   { pc:3, func: CMP_ABSY }, { pc:1, func: NOP },      { pc:3, func: DCP_ABSY },
  { pc:3, func: NOP_ABSX },  { pc:3, func: CMP_ABSX }, { pc:3, func: DEC_ABSX }, { pc:3, func: DCP_ABSX },

  { pc:2, func: CPX_IMM },   { pc:2, func: SBC_INDX }, { pc:2, func: NOP },      { pc:2, func: ISC_INDX },
  { pc:2, func: CPX_ZP },    { pc:2, func: SBC_ZP },   { pc:2, func: INC_ZP },   { pc:2, func: ISC_ZP },
  { pc:1, func: INX_IMP },   { pc:2, func: SBC_IMM },  { pc:1, func: NOP },      { pc:2, func: SBC_IMM },
  { pc:3, func: CPX_ABS },   { pc:3, func: SBC_ABS },  { pc:3, func: INC_ABS },  { pc:3, func: ISC_ABS },

  { pc:0, func: BEQ_REL },   { pc:2, func: SBC_INDY }, { pc:1, func: KIL_IMP },  { pc:2, func: ISC_INDY },
  { pc:2, func: NOP_ZPX },   { pc:2, func: SBC_ZPX },  { pc:2, func: INC_ZPX },  { pc:2, func: ISC_ZPX },
  { pc:1, func: SED_IMP },   { pc:3, func: SBC_ABSY }, { pc:1, func: NOP },      { pc:3, func: ISC_ABSY },
  { pc:3, func: NOP_ABSX },  { pc:3, func: SBC_ABSX }, { pc:3, func: INC_ABSX }, { pc:3, func: ISC_ABSX },
];

function buildDisasmRow(opc, op1, op2, pc, len) {
  // --- ensure correct len for control flow opcodes ---
  if (len === 0) {
    if (opc === 0x00 || opc === 0x40 || opc === 0x60) len = 1;      // BRK/RTI/RTS
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

  if (operand === "PPUSTATUS") {
    notes = (PPUSTATUS & 0x80) ? "VBlank set" : "VBlank clear";
  }

  if (operand === "PPUCTRL") {
    notes = (PPUCTRL & 0x80) ? "NMI enabled" : "NMI disabled";
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
