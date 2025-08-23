// tuning - batch and BUDGET_MS = Math.max(0.8 * dt, 10); (pre multiplier)
// then runPacedWithSampler(50000, 500)

let cpuRunning = false;

// internal only, don't build disasm rows unless the window is open
let disasmRunning = false;

const CPU_BATCH = 5; // downside: will process this many opcodes prior to pausing... 

let nmiCheckCounter = 0;
let nmiServiceCounter = 0;
let nmiPendingLocal=false;

// NTSC timing
const NES_CPU_HZ    = 1_789_773;           // 1.789773 MHz
const CYCLES_PER_MS = NES_CPU_HZ / 1000;   // ~1789.773 cycles per ms
// NTSC Resolution
const NES_W = 256;
const NES_H = 240;

function renderFrame(){
    // ---- frame blit ----
  if (PPU_FRAME_FLAGS == 0b00000001) {
    blitNESFramePaletteIndex(paletteIndexFrame, NES_W, NES_H);
    registerFrameUpdate(); // FPS counter screen overlay
    PPU_FRAME_FLAGS = 0x00;
  }
}

function checkInterrupts() {
  nmiCheckCounter++;

  const edgeMarker = Atomics.load(SHARED.SYNC, 4);
  if (edgeMarker !== 0) {
    nmiServiceCounter++;
    
    if (debugLogging) {
      console.debug(`[CPU] NMI edge latched (#${nmiServiceCounter}) after ${nmiCheckCounter} checks`);
    }

    nmiCheckCounter = 0;

    nmiPendingLocal = true;
    Atomics.store(SHARED.SYNC, 5, 1);
    Atomics.store(SHARED.SYNC, 4, 0);
  }

    // ---- handle interrupts ----
  if (nmiPendingLocal){
    serviceNMI();   // adds +7 via addExtraCycles()
    nmiPendingLocal = false;
  }

  if (!CPUregisters.P.I) {
    serviceIRQ();   // adds +7 via addExtraCycles()
  }
  
}

// offset handler takes care of prgRom being based @ 0x0000
  function step() {

  // kick PPU worker via SAB bit #pointless, it can just wait for cpu cycles and start dotting
  //Atomics.or(SHARED.EVENTS, 0, 0b00000100);

  renderFrame();

  // disable CRT fuzz noise
  NoSignalAudio.setEnabled(false);

  // if we're paused, briefly let the PPU worker run this step
  const wasPaused = !cpuRunning;
  if (wasPaused) Atomics.or(SHARED.EVENTS, 0, 0b00000100); // set RUN bit

  // realigns with our prgRom base being 0x00 by being passed through offset handler
  const code   = checkReadOffset(CPUregisters.PC);

  // execute opcode handler
  const execFn = OPCODES[code].func;

  console.debug("PC @ 0x" + CPUregisters.PC.toString(16).padStart(4, "0").toUpperCase());
  console.debug("Code @ 0x" + code.toString(16).padStart(2, "0").toUpperCase());

  if (!execFn) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=$${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);

    // Clear bit 2 (0b00000100) to halt the PPU
    Atomics.and(SHARED.EVENTS, 0, ~0b00000100);

    // Pause on bad opcode
    pause();

    return;
  }

    // for disasm
    const _op   = checkReadOffset(CPUregisters.PC + 1);
    const __op  = checkReadOffset(CPUregisters.PC + 2);
    // disasm PC is the current PC, not the next one
    const disasmPc = CPUregisters.PC;  

  execFn();

  if (disasmRunning){
    // build disasm row now so we have pre handler PC + post handler modifications to regs in a row
    const disasmRow = buildDisasmRow(code, _op, __op, disasmPc);
    // send the row for output
    DISASM.appendRow(disasmRow);
  }
  
  // increment PC to point at next opcode, if PC modified in opcode handler, this adds zero
  CPUregisters.PC = CPUregisters.PC + OPCODES[code].pc;

  // Base cycles (CPU + PPU budget)
  // coerce a value into an integer | 0
  const cyc = OPCODES[code].cycles | 0;
  if (cyc) {
    Atomics.add(SHARED.CLOCKS, 0, cyc);
    Atomics.add(SHARED.CLOCKS, 1, 3 * cyc);
  }

  // if we temporarily enabled the worker, put it back to paused
  if (wasPaused) Atomics.and(SHARED.EVENTS, 0, ~0b00000100); // clear RUN bit

  checkInterrupts();

}

// ====================================== PACED RUN + SAMPLER ======================================
// Real-time pacing state
// runPacedWithSampler(5000, 500)
let __paceCarry = 0;  // keep fractional cycles and (if needed) small deficits
let __lastT = 0;

// run(): paced to ~NES time using wall-clock
  function run() {
  if (cpuRunning) return;
  cpuRunning = true;

  __lastT = performance.now();
  __paceCarry = 0;

  (function pacedLoop() {
    if (!cpuRunning) return;

    const now = performance.now();
    const dt  = now - __lastT;                 // ms since last frame (~16.7ms on rAF)
    __lastT   = now;

    // How many cycles *should* elapse since last tick + carry
    let targetFloat = dt * CYCLES_PER_MS + __paceCarry;
    let target      = targetFloat | 0;         // floor to int
    __paceCarry     = targetFloat - target;    // keep fractional remainder only

    if (target > 0) {
      const startCycles = Atomics.load(SHARED.CLOCKS, 0);

      // Time budget scales with dt; allow most of the frame to produce cycles
      // (minimum keeps us from starving on low rAF rates)
      const BUDGET_MS = Math.max(0.6 * dt, 10);
      const deadline  = now + BUDGET_MS;

      let produced = 0;
      while (produced < target && performance.now() < deadline) {
        // small batches to stay responsive
        for (let i = 0; i < CPU_BATCH; i++) step();
        produced = Atomics.load(SHARED.CLOCKS, 0) - startCycles;
      }

      // If we missed the target, roll the deficit forward as positive carry so we *try* to catch up.
      if (produced < target) {
        __paceCarry += (target - produced);
        // Clamp to avoid runaway (no more than ~2 frames worth)
        const MAX_CARRY = 2 * 16.7 * CYCLES_PER_MS;
        if (__paceCarry > MAX_CARRY) __paceCarry = MAX_CARRY;
      }
    }

    requestAnimationFrame(pacedLoop);
  })();
}

// Pause (keeps your existing external API)
  function pause() {
  cpuRunning = false;

  // stop PPU worker, clear bit 2
  Atomics.and(SHARED.EVENTS, 0, ~0b00000100);

  if (typeof updateDebugTables === 'function') {
    try { updateDebugTables(); } catch (e) {}
  }
}

// One-call sampler + summary while paced run is active
// Usage: runPacedWithSampler(5000, 500)
function runPacedWithSampler(msTotal = 5000, msSample = 500) {
  if (cpuRunning) { console.warn("[runPacedWithSampler] CPU already running."); return; }

  // start paced loop
  run();

  const startT   = performance.now();
  const startCPU = Atomics.load(SHARED.CLOCKS, 0);
  const startPPU = Atomics.load(SHARED.CLOCKS, 1);

  let last = {
    t: startT,
    ev: Atomics.load(SHARED.EVENTS, 0),
    cpu: startCPU,
    ppu: startPPU,
    bud: (SHARED.SYNC ? Atomics.load(SHARED.SYNC, 0) : 0),
    burn:(SHARED.SYNC ? Atomics.load(SHARED.SYNC, 1) : 0),
  };

  const bits = n => n.toString(2).padStart(8,'0');

  function logInterval(prev, cur) {
    const dt   = (cur.t - prev.t);
    const dcpu = cur.cpu - prev.cpu;
    const dppu = cur.ppu - prev.ppu;
    const exp  = 3 * dcpu;   // expected ΔPPU for this interval
    const util = (cur.bud > 0) ? ((cur.burn / cur.bud) * 100).toFixed(1) : '—';
    const runOn= (cur.ev & 0b100) ? "ON" : "OFF";
    console.debug(
      `EVENTS[0]=${cur.ev} (bits ${bits(cur.ev)}) RUN=${runOn}\n` +
      `CPU total=${cur.cpu}   ΔCPU=${dcpu}\n` +
      `PPU total=${cur.ppu}   ΔPPU=${dppu}   expected=${exp}\n` +
      `budget=${cur.bud}  burned=${cur.burn}  util=${util}%\n` +
      `interval=${dt.toFixed(2)} ms`
    );
  }

  const sampler = setInterval(() => {
    const cur = {
      t: performance.now(),
      ev: Atomics.load(SHARED.EVENTS, 0),
      cpu: Atomics.load(SHARED.CLOCKS, 0),
      ppu: Atomics.load(SHARED.CLOCKS, 1),
      bud: (SHARED.SYNC ? Atomics.load(SHARED.SYNC, 0) : 0),
      burn:(SHARED.SYNC ? Atomics.load(SHARED.SYNC, 1) : 0),
    };
    logInterval(last, cur);
    last = cur;
  }, msSample);

  // stop sampler + print summary, leave emu running (call pause() when you want)
  setTimeout(() => {
    clearInterval(sampler);

    const stopT   = performance.now();
    const stopCPU = Atomics.load(SHARED.CLOCKS, 0);
    const elapsed = stopT - startT;
    const produced = stopCPU - startCPU;
    const cps = produced / (elapsed / 1000);
    const ratio = (cps / NES_CPU_HZ).toFixed(2);

    logInterval(last, {
      t: stopT,
      ev: Atomics.load(SHARED.EVENTS, 0),
      cpu: stopCPU,
      ppu: Atomics.load(SHARED.CLOCKS, 1),
      bud: (SHARED.SYNC ? Atomics.load(SHARED.SYNC, 0) : 0),
      burn:(SHARED.SYNC ? Atomics.load(SHARED.SYNC, 1) : 0),
    });

    console.debug(
      `[SUMMARY] elapsed=${elapsed.toFixed(1)} ms\n` +
      `[SUMMARY] CPU cycles produced=${produced}\n` +
      `[SUMMARY] cycles/sec=${Math.round(cps)}  (NES ${NES_CPU_HZ} → x${ratio})`
    );
  }, msTotal);
}

// ======================== OPCODE DISPATCH TABLE ========================
// move pc/cyc directly to opcode handlers eventually to optimise
// all opcodes setting PC manually have zero increment
const OPCODES = [
  { pc:1, cycles:2, func: BRK_IMP },   { pc:2, cycles:6, func: ORA_INDX }, { pc:0, cycles:2, func: null },     { pc:2, cycles:6, func: SLO_INDX },
  { pc:2, cycles:3, func: NOP_ZP },    { pc:2, cycles:3, func: ORA_ZP },   { pc:2, cycles:3, func: ASL_ZP },   { pc:2, cycles:3, func: SLO_ZP },
  { pc:1, cycles:2, func: PHP_IMP },   { pc:2, cycles:2, func: ORA_IMM },  { pc:1, cycles:2, func: ASL_ACC },  { pc:2, cycles:2, func: ANC_IMM },
  { pc:3, cycles:4, func: NOP_ABS },   { pc:3, cycles:4, func: ORA_ABS },  { pc:3, cycles:4, func: ASL_ABS },  { pc:3, cycles:4, func: SLO_ABS },

  { pc:0, cycles:2, func: BPL_REL },   { pc:2, cycles:5, func: ORA_INDY }, { pc:0, cycles:0, func: null },     { pc:2, cycles:5, func: SLO_INDY },
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: ORA_ZPX },  { pc:2, cycles:4, func: ASL_ZPX },  { pc:2, cycles:4, func: SLO_ZPX },
  { pc:1, cycles:2, func: CLC_IMP },   { pc:3, cycles:4, func: ORA_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:4, func: SLO_ABSY },
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: ORA_ABSX }, { pc:3, cycles:4, func: ASL_ABSX }, { pc:3, cycles:4, func: SLO_ABSX },

  { pc:0, cycles:4, func: JSR_ABS },   { pc:2, cycles:6, func: AND_INDX }, { pc:0, cycles:0, func: null },     { pc:2, cycles:6, func: RLA_INDX },
  { pc:2, cycles:3, func: BIT_ZP },    { pc:2, cycles:3, func: AND_ZP },   { pc:2, cycles:3, func: ROL_ZP },   { pc:2, cycles:3, func: RLA_ZP },
  { pc:1, cycles:2, func: PLP_IMP },   { pc:2, cycles:2, func: AND_IMM },  { pc:1, cycles:2, func: ROL_ACC },  { pc:2, cycles:2, func: ANC_IMM },
  { pc:3, cycles:4, func: BIT_ABS },   { pc:3, cycles:4, func: AND_ABS },  { pc:3, cycles:4, func: ROL_ABS },  { pc:3, cycles:4, func: RLA_ABS },

  { pc:0, cycles:2, func: BMI_REL },   { pc:2, cycles:5, func: AND_INDY }, { pc:0, cycles:0, func: null },     { pc:2, cycles:5, func: RLA_INDY },
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: AND_ZPX },  { pc:2, cycles:4, func: ROL_ZPX },  { pc:2, cycles:4, func: RLA_ZPX },
  { pc:1, cycles:2, func: SEC_IMP },   { pc:3, cycles:4, func: AND_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:4, func: RLA_ABSY },
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: AND_ABSX }, { pc:3, cycles:4, func: ROL_ABSX }, { pc:3, cycles:4, func: RLA_ABSX },

  { pc:0, cycles:2, func: RTI_IMP },   { pc:2, cycles:6, func: EOR_INDX }, { pc:0, cycles:0, func: null },     { pc:2, cycles:6, func: SRE_INDX },
  { pc:2, cycles:3, func: NOP_ZP },    { pc:2, cycles:3, func: EOR_ZP },   { pc:2, cycles:3, func: LSR_ZP },   { pc:2, cycles:3, func: SRE_ZP },
  { pc:1, cycles:2, func: PHA_IMP },   { pc:2, cycles:2, func: EOR_IMM },  { pc:1, cycles:2, func: LSR_ACC },  { pc:2, cycles:2, func: ALR_IMM },
  { pc:3, cycles:4, func: JMP_ABS },   { pc:3, cycles:4, func: EOR_ABS },  { pc:3, cycles:4, func: LSR_ABS },  { pc:3, cycles:4, func: SRE_ABS },

  { pc:0, cycles:2, func: BVC_REL },   { pc:2, cycles:5, func: EOR_INDY }, { pc:0, cycles:0, func: null },     { pc:2, cycles:5, func: SRE_INDY },
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: EOR_ZPX },  { pc:2, cycles:4, func: LSR_ZPX },  { pc:2, cycles:4, func: SRE_ZPX },
  { pc:1, cycles:2, func: CLI_IMP },   { pc:3, cycles:4, func: EOR_ABY },  { pc:1, cycles:2, func: NOP },      { pc:3, cycles:4, func: SRE_ABSY },
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: EOR_ABX },  { pc:3, cycles:4, func: LSR_ABSX }, { pc:3, cycles:4, func: SRE_ABSX },

  { pc:0, cycles:2, func: RTS_IMP },   { pc:2, cycles:6, func: ADC_INDX }, { pc:0, cycles:0, func: null },     { pc:2, cycles:6, func: RRA_INDX },
  { pc:2, cycles:3, func: NOP_ZP },    { pc:2, cycles:3, func: ADC_ZP },   { pc:2, cycles:3, func: ROR_ZP },   { pc:2, cycles:3, func: RRA_ZP },
  { pc:1, cycles:2, func: PLA_IMP },   { pc:2, cycles:2, func: ADC_IMM },  { pc:1, cycles:2, func: ROR_ACC },  { pc:2, cycles:2, func: ARR_IMM },
  { pc:3, cycles:4, func: JMP_IND },   { pc:3, cycles:4, func: ADC_ABS },  { pc:3, cycles:4, func: ROR_ABS },  { pc:3, cycles:4, func: RRA_ABS },

  { pc:0, cycles:2, func: BVS_REL },   { pc:2, cycles:5, func: ADC_INDY }, { pc:0, cycles:0, func: null },     { pc:2, cycles:5, func: RRA_INDY },
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: ADC_ZPX },  { pc:2, cycles:4, func: ROR_ZPX },  { pc:2, cycles:4, func: RRA_ZPX },
  { pc:1, cycles:2, func: SEI_IMP },   { pc:3, cycles:4, func: ADC_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:4, func: RRA_ABSY },
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: ADC_ABSX }, { pc:3, cycles:4, func: ROR_ABSX }, { pc:3, cycles:4, func: RRA_ABSX },

  { pc:0, cycles:2, func: BRA_REL },   { pc:2, cycles:6, func: STA_INDX }, { pc:2, cycles:2, func: NOP },      { pc:2, cycles:6, func: SAX_INDX },
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

  { pc:0, cycles:2, func: BCS_REL },   { pc:2, cycles:6, func: LDA_INDY }, { pc:0, cycles:0, func: null },     { pc:2, cycles:6, func: LAX_INDY },
  { pc:2, cycles:4, func: LDY_ZPX },   { pc:2, cycles:4, func: LDA_ZPX },  { pc:2, cycles:4, func: LDX_ZPY },  { pc:2, cycles:4, func: LAX_ZPY },
  { pc:1, cycles:2, func: CLV_IMP },   { pc:3, cycles:4, func: LDA_ABSY }, { pc:1, cycles:2, func: TSX_IMP },  { pc:3, cycles:4, func: LAS_ABSY },
  { pc:3, cycles:4, func: LDY_ABSX },  { pc:3, cycles:4, func: LDA_ABSX }, { pc:3, cycles:4, func: LDX_ABSY }, { pc:3, cycles:4, func: LAX_ABSY },

  { pc:2, cycles:2, func: CPY_IMM },   { pc:2, cycles:6, func: CMP_INDX }, { pc:2, cycles:2, func: NOP },      { pc:2, cycles:6, func: DCP_INDX },
  { pc:2, cycles:3, func: CPY_ZP },    { pc:2, cycles:3, func: CMP_ZP },   { pc:2, cycles:3, func: DEC_ZP },   { pc:2, cycles:3, func: DCP_ZP },
  { pc:1, cycles:2, func: INY_IMP },   { pc:2, cycles:2, func: CMP_IMM },  { pc:1, cycles:2, func: DEX_IMP },  { pc:2, cycles:2, func: SBX_IMM },
  { pc:3, cycles:4, func: CPY_ABS },   { pc:3, cycles:4, func: CMP_ABS },  { pc:3, cycles:4, func: DEC_ABS },  { pc:3, cycles:4, func: DCP_ABS },

  { pc:0, cycles:2, func: BNE_REL },   { pc:2, cycles:6, func: CMP_INDY }, { pc:0, cycles:0, func: null },     { pc:2, cycles:6, func: DCP_INDY },
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: CMP_ZPX },  { pc:2, cycles:4, func: DEC_ZPX },  { pc:2, cycles:4, func: DCP_ZPX },
  { pc:1, cycles:2, func: CLD_IMP },   { pc:3, cycles:4, func: CMP_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:4, func: DCP_ABSY },
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: CMP_ABSX }, { pc:3, cycles:4, func: DEC_ABSX }, { pc:3, cycles:4, func: DCP_ABSX },

  { pc:2, cycles:2, func: CPX_IMM },   { pc:2, cycles:6, func: SBC_INDX }, { pc:2, cycles:2, func: NOP },      { pc:2, cycles:6, func: ISC_INDX },
  { pc:2, cycles:3, func: CPX_ZP },    { pc:2, cycles:3, func: SBC_ZP },   { pc:2, cycles:3, func: INC_ZP },   { pc:2, cycles:3, func: ISC_ZP },
  { pc:1, cycles:2, func: INX_IMP },   { pc:2, cycles:2, func: SBC_IMM },  { pc:1, cycles:2, func: NOP },      { pc:0, cycles:0, func: null },
  { pc:3, cycles:4, func: CPX_ABS },   { pc:3, cycles:4, func: SBC_ABS },  { pc:3, cycles:4, func: INC_ABS },  { pc:3, cycles:4, func: ISC_ABS },

  { pc:0, cycles:2, func: BEQ_REL },   { pc:2, cycles:6, func: SBC_INDY }, { pc:0, cycles:0, func: null },     { pc:2, cycles:6, func: ISC_INDY },
  { pc:2, cycles:4, func: NOP_ZPX },   { pc:2, cycles:4, func: SBC_ZPX },  { pc:2, cycles:4, func: INC_ZPX },  { pc:2, cycles:4, func: ISC_ZPX },
  { pc:1, cycles:2, func: SED_IMP },   { pc:3, cycles:4, func: SBC_ABSY }, { pc:1, cycles:2, func: NOP },      { pc:3, cycles:4, func: ISC_ABSY },
  { pc:3, cycles:4, func: NOP_ABSX },  { pc:3, cycles:4, func: SBC_ABSX }, { pc:3, cycles:4, func: INC_ABSX }, { pc:3, cycles:4, func: ISC_ABSX },
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