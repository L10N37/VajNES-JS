const test = false; // only true to run console benchmarks

//easier to patch up my cycles for the test suite, then adjust test suite (some suites now false failing due to cycles)
let ppuTicksToRun;
//let lastCpuCycleCount;

let running = false;
let debugLogging = true;

// pending NMI tracker
let nmiPending = false;

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

// interrupt is called once per full frame
function serviceNMI() {
  const pc = CPUregisters.PC & 0xFFFF;

  console.log(`%c[CPU: NMI taken] frame=${PPUclock.frame} PC=$${pc.toString(16).padStart(4, "0").toUpperCase()}`,
              "background:#004; color:#0ff; font-weight:bold");

  // push PCH
  cpuWrite(0x0100 + (CPUregisters.S & 0xFF), (pc >>> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // push PCL
  cpuWrite(0x0100 + (CPUregisters.S & 0xFF), pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // push P with B=0, bit5=1
  const pushedP = ((CPUregisters.P & ~0x10) | 0x20) & 0xFF;
  cpuWrite(0x0100 + (CPUregisters.S & 0xFF), pushedP);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // set I flag
  CPUregisters.P = (CPUregisters.P | 0x04) & 0xFF;

  // fetch vector
  const lo = checkReadOffset(0xFFFA) & 0xFF;
  const hi = checkReadOffset(0xFFFB) & 0xFF;
  const newPC = ((hi << 8) | lo) & 0xFFFF;

  console.log(`%c[CPU: NMI vector → $${newPC.toString(16).padStart(4, "0").toUpperCase()}] frame=${PPUclock.frame}`,
              "background:#004; color:#0ff; font-weight:bold");

  CPUregisters.PC = newPC;
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

  if (debugLogging){
  console.log("instr:", `0x${code.toString(16).toUpperCase()}`);
  console.log(`PC=> 0x${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
  }

  // Execute instruction
  execFn();

  // Advance cycles & PC
  CPUregisters.PC = (CPUregisters.PC + opcodePcIncs[code]);

  // pseudo 3:1 PPU with cycles
  //lastCpuCycleCount = cpuCycles & 0xFFFF;
  cpuCycles = (cpuCycles + opcodeCyclesInc[code]) & 0xFFFF;
  // ppuTicksToRun = (cpuCycles - lastCpuCycleCount) * 3;



  // run 3 ppuTicks per cpu Cycle, but only at 700+ CPU cycles (~21000 PPU ticks in batch!)

  // ppuTick will take the cpuCycles count, multiply by 3, and tick over that amount, on return
  // cpuCycles will be reset to zero
  if (cpuCycles >= 700) ppuTick(); // tweaked the batch value , nothing helps, we cant afford "per tick" accurate PPU. 


    if (nmiPending) {
    nmiPending = false;
    serviceNMI();
    cpuCycles += 7;// 7 CPU cycles spent for NMI servicing
  }
}
  