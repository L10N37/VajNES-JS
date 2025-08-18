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

function disasmData(disasmCode, disasmOp_, disasmOp__){
  // PC16
  DISASM.RING_U16[0] = CPUregisters.PC & 0xFFFF;
  // opcode + operands
  DISASM.RING_U8[2] = disasmCode;
  DISASM.RING_U8[3] = disasmOp_;
  DISASM.RING_U8[4] = disasmOp__;
  // registers
  DISASM.RING_U8[5] = CPUregisters.A;
  DISASM.RING_U8[6] = CPUregisters.X;
  DISASM.RING_U8[7] = CPUregisters.Y;
  DISASM.RING_U8[8] = CPUregisters.S;
  DISASM.RING_U8[9] = CPUregisters.P.C;
  DISASM.RING_U8[10] = CPUregisters.P.Z;
  DISASM.RING_U8[11] = CPUregisters.P.I;
  DISASM.RING_U8[12] = CPUregisters.P.D;
  DISASM.RING_U8[13] = CPUregisters.P.B;
  DISASM.RING_U8[14] = CPUregisters.P.U;
  DISASM.RING_U8[15] = CPUregisters.P.V;
  DISASM.RING_U8[16] = CPUregisters.P.N;
}

function step() {
  // if we're paused, briefly let the PPU worker run this step
  const wasPaused = !cpuRunning;
  if (wasPaused) Atomics.or(SHARED.EVENTS, 0, 0b00000100); // set RUN bit

  // ---- interrupts ----
  if (nmiPending) {
    serviceNMI();   // adds +7 via addExtraCycles()
    nmiPending = false;
  } else if (irqPending && (CPUregisters.P & 0x04) === 0) {
    serviceIRQ();   // adds +7 via addExtraCycles()
    irqPending = false;
  }

  // ---- frame blit ----
  if (PPU_FRAME_FLAGS == 0b00000001) {
    // console.log("FRAME BLIT");
    blitNESFramePaletteIndex(paletteIndexFrame, NES_W, NES_H);
    PPU_FRAME_FLAGS = 0x00;
  }

  // ---- execute one instruction ----
  NoSignalAudio.setEnabled(false);

  const code   = prgRom[(CPUregisters.PC - 0x8000) & 0x7FFF];

  // disasm will use code above but we will also grab ops for it
  const _op   = prgRom[(CPUregisters.PC - 0x8000 + 1) & 0x7FFF];
  const __op  = prgRom[(CPUregisters.PC - 0x8000 + 2) & 0x7FFF];

  // store the data the disassembler needs in the SABs, passing it opcode/operands
  // the flags/ regs it can do in func
  disasmData(code, _op, __op);

  const execFn = opcodeFuncs[code];
  if (!execFn) {
    const codeHex = (code == null) ? "??" : code.toString(16).toUpperCase().padStart(2, "0");
    console.warn(`Unknown opcode 0x${codeHex}`);
    console.warn(`at PC=$${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
    if (wasPaused) Atomics.and(SHARED.EVENTS, 0, ~0b00000100); // restore RUN bit if we set it
    return;
  }

  execFn();
  CPUregisters.PC = (CPUregisters.PC + opcodePcIncs[code]) & 0xFFFF;

  // Base cycles (CPU + PPU budget)
  const cyc = opcodeCyclesInc[code] | 0;
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
    console.log(
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

    console.log(
      `[SUMMARY] elapsed=${elapsed.toFixed(1)} ms\n` +
      `[SUMMARY] CPU cycles produced=${produced}\n` +
      `[SUMMARY] cycles/sec=${Math.round(cps)}  (NES ${NES_CPU_HZ} → x${ratio})`
    );
  }, msTotal);
}


// =============================== OPCODE LUTS ======================================================
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

// ======================== OPCODE DISPATCH TABLE ========================
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

// so disassembler can access them
globalThis.DebugCtl = Object.assign(globalThis.DebugCtl || {}, {
  run, pause, step
});
