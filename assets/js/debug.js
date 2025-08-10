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

// ── Flattened opcode metadata arrays ──
const opcodeFuncs     = new Array(256);         // ==slight optimsation==
const opcodePcIncs    = new Uint8Array(256);  // move to functions directly (ughh)
const opcodeCyclesInc = new Uint8Array(256);  // move to functions directly (oof)
//const opcodeLengths   = new Uint8Array(256);
const opcodeHex       = new Array(256);

// Build arrays once at startup
for (const [mnemonic, modes] of Object.entries(opcodes)) {
  for (const [mode, info] of Object.entries(modes)) {
    const c = info.code;
    opcodeFuncs[c]     = info.func;
    opcodePcIncs[c]    = info.pcIncrement;
    opcodeCyclesInc[c] = info.cycles;
    //opcodeLengths[c]   = info.length;
    opcodeHex[c]       = "0x" + c.toString(16).toUpperCase().padStart(2, "0");
  }
}

if (test) {
  // Patch 0x02 to be a NOP during benchmarks
  opcodeFuncs[0x02] = () => { /* no-op */ };
}


// dummy function for 3:1 pseudo
function ppuStep(){
  
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

  console.log("instr:", `0x${code.toString(16).toUpperCase()}`);
  console.log(`PC=> 0x${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);

  // Execute instruction
  execFn();

  // Advance cycles & PC
  CPUregisters.PC = (CPUregisters.PC + opcodePcIncs[code]);

  
  // pseudo 3:1 PPU with cycles
  cpuCycles = (cpuCycles + opcodeCyclesInc[code]) & 0xFFFF; // &'ing unncessary, reset per step

  for (let i = 0; i < cpuCycles * 3; i++) {
    ppuStep();
    console.log("PPU Steps:",i+1);
    console.log("of:",cpuCycles * 3);
  }
  cpuCycles = 0;
}

