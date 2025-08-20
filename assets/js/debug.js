// tuning - batch and BUDGET_MS = Math.max(0.8 * dt, 10); (pre multiplier)
// then runPacedWithSampler(50000, 500)
let cpuRunning = false;
const CPU_BATCH = 1000; // adjust if you want larger inner batches

/*
50,0000
[SUMMARY] elapsed=50010.6 ms
[SUMMARY] CPU cycles produced=90023494
[SUMMARY] cycles/sec=1800088  (NES 1789773 → x1.01)
*/

// ============================
// NTSC timing
// ============================
const NES_CPU_HZ    = 1_789_773;           // 1.789773 MHz
const CYCLES_PER_MS = NES_CPU_HZ / 1000;   // ~1789.773 cycles per ms

function disasmData(disasmCode, disasmOp_, disasmOp__) {
  // PC16
  DISASM.RING_U16[0] = CPUregisters.PC & 0xFFFF;

  // opcode + operands
  DISASM.RING_U8[2]  = disasmCode;
  DISASM.RING_U8[3]  = disasmOp_;
  DISASM.RING_U8[4]  = disasmOp__;

  // registers
  DISASM.RING_U8[5]  = CPUregisters.A;
  DISASM.RING_U8[6]  = CPUregisters.X;
  DISASM.RING_U8[7]  = CPUregisters.Y;
  DISASM.RING_U8[8]  = CPUregisters.S;

  // flags
  DISASM.RING_U8[9]  = CPUregisters.P.C;
  DISASM.RING_U8[10] = CPUregisters.P.Z;
  DISASM.RING_U8[11] = CPUregisters.P.I;
  DISASM.RING_U8[12] = CPUregisters.P.D;
  DISASM.RING_U8[13] = CPUregisters.P.V;
  DISASM.RING_U8[14] = CPUregisters.P.N;
}

let nmiCheckCounter = 0;
let nmiServiceCounter = 0;

function checkInterrupts() {
  nmiCheckCounter++;

  const edgeMarker = Atomics.load(SHARED.SYNC, 4);
  if (edgeMarker !== 0) {
    nmiServiceCounter++;
    console.log(`[CPU] NMI edge latched (#${nmiServiceCounter}) after ${nmiCheckCounter} checks`);

    nmiCheckCounter = 0;

    // now we set nmiPending (the SAB flag) here
    Atomics.store(SHARED.SYNC, 5, 1); // or directly set CPU-local nmiPending = true;

    Atomics.store(SHARED.SYNC, 4, 0); // clear the edge marker
  }
}

// offset handler takes care of prgRom being based @ 0x0000
function step() {
 checkInterrupts();
  // ---- handle interrupts ----
  if (nmiPending && (PPUCTRL & 0x80)){
    serviceNMI();   // adds +7 via addExtraCycles()
    nmiPending = false;
  } else if (!CPUregisters.P.I) {
    serviceIRQ();   // adds +7 via addExtraCycles()
  }

  // we can't catch rows where branches occurred without updating disasm data within every handler
  // if (debugLogging) console.debug("(pre)PC @ 0x" + CPUregisters.PC.toString(16).padStart(4, "0").toUpperCase());

  // disable CRT fuzz noise
  NoSignalAudio.setEnabled(false);

  // if we're paused, briefly let the PPU worker run this step
  const wasPaused = !cpuRunning;
  if (wasPaused) Atomics.or(SHARED.EVENTS, 0, 0b00000100); // set RUN bit

  // ---- frame blit ----
  if (PPU_FRAME_FLAGS == 0b00000001) {
    blitNESFramePaletteIndex(paletteIndexFrame, NES_W, NES_H);
    registerFrameUpdate(); // FPS counter screen overlay
    PPU_FRAME_FLAGS = 0x00;
  }

  // realigns with our prgRom base being 0x00 by being passed through offset handler
  const code   = checkReadOffset(CPUregisters.PC);

  // execute opcode handler
  const execFn = OPCODES[code].func;

  if (!execFn) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=$${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
    if (wasPaused) Atomics.and(SHARED.EVENTS, 0, ~0b00000100); // restore RUN bit if we set it
    return;
  }

  // disasm will use code above but we will also grab ops for it
  const _op   = checkReadOffset(CPUregisters.PC + 1);
  const __op  = checkReadOffset(CPUregisters.PC + 2);

  execFn();

  // store the data the disassembler needs in the SABs, passing it opcode/operands
  disasmData(code, _op, __op);
  
  // increment PC to point at next opcode, if PC modified in opcode handler, this adds zero
  CPUregisters.PC = CPUregisters.PC + OPCODES[code].pc;

  // we can't catch rows where branches occurred without updating disasm data within every handler
  // if (debugLogging) console.debug("(post)PC @ 0x" + CPUregisters.PC.toString(16).padStart(4, "0").toUpperCase());

  // Base cycles (CPU + PPU budget)
  // coerce a value into an integer | 0
  const cyc = OPCODES[code].cycles | 0;
  if (cyc) {
    Atomics.add(SHARED.CLOCKS, 0, cyc);
    Atomics.add(SHARED.CLOCKS, 1, 3 * cyc);
  }

  // if we temporarily enabled the worker, put it back to paused
  if (wasPaused) Atomics.and(SHARED.EVENTS, 0, ~0b00000100); // clear RUN bit

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

  // kick PPU worker via SAB bit
  Atomics.or(SHARED.EVENTS, 0, 0b00000100);

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

// so disassembler can access them
globalThis.DebugCtl = Object.assign(globalThis.DebugCtl || {}, {
  run, pause, step
});
