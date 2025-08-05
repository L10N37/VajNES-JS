const test = false; // only true to run console benchmarks
let lastFetched = null;

let running = false;

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

function updateDebugTables() {
  wramPopulate();
  vramPopulate();
  prgRomPopulate();
  cpuRegisterBitsPopulate();
  cpuStatusRegisterPopulate();
  ppuRegisterBitsPopulate();
}

// ── Flattened opcode metadata arrays ──
const opcodeFuncs     = new Array(256);
const opcodePcIncs    = new Uint8Array(256);
const opcodeCyclesInc = new Uint8Array(256);
const opcodeLengths   = new Uint8Array(256);
const opcodeHex       = new Array(256);

// Build arrays once at startup
for (const [mnemonic, modes] of Object.entries(opcodes)) {
  for (const [mode, info] of Object.entries(modes)) {
    const c = info.code;
    opcodeFuncs[c]     = info.func;
    opcodePcIncs[c]    = info.pcIncrement;
    opcodeCyclesInc[c] = info.cycles;
    opcodeLengths[c]   = info.length;
    opcodeHex[c]       = "0x" + c.toString(16).toUpperCase().padStart(2, "0");
  }
}

if (test) {
  // Patch 0x02 to be a NOP during benchmarks
  opcodeFuncs[0x02] = () => { /* no-op */ };
}

// ── Single‐step executor ──
function step() {

  const pc     = CPUregisters.PC;
  const idx    = pc - 0x8000;        // PRG-ROM base
  const code   = prgRom[idx];
  const execFn = opcodeFuncs[code];

  if (!execFn) {
    console.warn(`Unknown opcode ${code.toString(16)} at PC=0x${pc.toString(16)}`);
    return;
  }



    // ===== block now only used for test suite/ stripped down console logging =====
    /*                 NEEDS TO BE COMMENTED OUT FOR BENCHMARKING                 */
    // or the conditional test boolean
    if (!test) {
    // Snapshot raw bytes & UI state
    const len = opcodeLengths[code];
    const raw = new Uint8Array(len);
    for (let i = 0; i < len; i++) raw[i] = cpuRead(pc + i);

    lastFetched = {
      pc,
      raw,
      hex:            opcodeHex[code],
    };
    console.log(
      `Step ▶ PC=0x${pc.toString(16).padStart(4,'0')} ` +
      `Opcode=${lastFetched.hex}`
    );
  }
    // =============================================================================
    
   //updateDebugTables(); // ok for stepping only
   
  // Execute instruction
  execFn();

  // Advance cycles & PC
  cpuCycles = (cpuCycles + opcodeCyclesInc[code]) & 0xFFFF;
  CPUregisters.PC = (pc + opcodePcIncs[code]) & 0xFFFF;
}