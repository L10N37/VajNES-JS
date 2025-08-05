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

function printstuff(){
// List of 6502 branch opcodes
const BRANCH_OPS = {
  0x10: "BPL", 0x30: "BMI", 0x50: "BVC", 0x70: "BVS",
  0x90: "BCC", 0xB0: "BCS", 0xD0: "BNE", 0xF0: "BEQ"
};

console.log("%cBranch opcode table (with handlers, PC inc, cycles, lengths):", "color: #fff; background: #222; font-size: 1.2em; padding: 6px;");

let rows = [];
for(let i=0; i<256; ++i) {
  let isBranch = BRANCH_OPS.hasOwnProperty(i);
  let handler  = opcodeFuncs[i] ? opcodeFuncs[i].name : "(none)";
  let style    = isBranch
    ? "background:#222;color:#8ef;padding:2px;"
    : "background:#333;color:#fff;padding:2px;";
  rows.push([
    `%c${i.toString(16).padStart(2,"0").toUpperCase()}`,
    style,
    isBranch ? BRANCH_OPS[i] : "",
    handler,
    opcodePcIncs[i],
    opcodeCyclesInc[i],
    opcodeLengths[i],
    opcodeHex[i] || ""
  ]);
}

console.log(
  "%c OPC  %c BR  %c Handler         %c PC+  %c Cyc  %c Len  %c Hex",
  "background:#444;color:#fff;padding:3px;",
  "background:#444;color:#eee;padding:3px;",
  "background:#444;color:#8ef;padding:3px;",
  "background:#444;color:#fff;padding:3px;",
  "background:#444;color:#fff;padding:3px;",
  "background:#444;color:#fff;padding:3px;",
  "background:#444;color:#fff;padding:3px;"
);

for(const row of rows) {
  console.log(
    row[0], row[1],
    "%c"+row[2], "color:#0ff;font-weight:bold;padding:2px;",
    "%c"+row[3], "color:#ffd700;font-weight:bold;padding:2px;",
    "%c"+row[4], "color:#5f5;padding:2px;",
    "%c"+row[5], "color:#fc5;padding:2px;",
    "%c"+row[6], "color:#6af;padding:2px;",
    "%c"+row[7], "color:#fff;padding:2px;"
  );
}
}

if (test) {
  // Patch 0x02 to be a NOP during benchmarks
  opcodeFuncs[0x02] = () => { /* no-op */ };
}

// ── Single‐step executor ──
function step() {

  console.log("STEP @ PC:", hex(CPUregisters.PC), 
  "opcode:", hex(checkReadOffset(CPUregisters.PC)), 
  "next:", hex(checkReadOffset(CPUregisters.PC + 1)));


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