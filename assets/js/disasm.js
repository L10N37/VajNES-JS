"use strict";

let disasmRunning = false;

const operand = {
  1: 0x00,
  2: 0x00,
};

// Keep recent trace data in fixed typed arrays so enabling the disassembler does
// not allocate a new object/string for every 6502 instruction.
const DISASM_TRACE_SIZE = 4096;
const DISASM_LIVE_SAMPLE_INTERVAL = 32768;
const disasmTrace = {
  pc: new Uint16Array(DISASM_TRACE_SIZE),
  code: new Uint8Array(DISASM_TRACE_SIZE),
  op1: new Uint16Array(DISASM_TRACE_SIZE),
  op2: new Uint16Array(DISASM_TRACE_SIZE),
  a: new Uint8Array(DISASM_TRACE_SIZE),
  x: new Uint8Array(DISASM_TRACE_SIZE),
  y: new Uint8Array(DISASM_TRACE_SIZE),
  sp: new Uint8Array(DISASM_TRACE_SIZE),
  p: new Uint8Array(DISASM_TRACE_SIZE),
  write: 0,
  count: 0,
  instructions: 0,
};

function disasmPackFlags(P) {
  return ((P.N?1:0)<<7) |
         ((P.V?1:0)<<6) |
         ((P.B?1:0)<<4) |
         ((P.D?1:0)<<3) |
         ((P.I?1:0)<<2) |
         ((P.Z?1:0)<<1) |
         (P.C?1:0);
}

function disasmFormatFlags(p) {
  return `${p&0x80?"N":"n"}${p&0x40?"V":"v"}-${p&0x10?"B":"b"}${p&0x08?"D":"d"}${p&0x04?"I":"i"}${p&0x02?"Z":"z"}${p&0x01?"C":"c"}`;
}

function disasmHex2(v) {
  return v===0x100 ? "--" : (v&0xff).toString(16).toUpperCase().padStart(2,"0");
}
function disasmHex4(v) {
  return (v&0xffff).toString(16).toUpperCase().padStart(4,"0");
}

function disasmFormatTraceSlot(i) {
  const opcode=disasmTrace.code[i]&0xff;
  const mnemonic=OPCODES[opcode]?.func?.name || "UNKNOWN";
  return `${disasmHex4(disasmTrace.pc[i])}  ` +
         `${disasmHex2(opcode)} ${disasmHex2(disasmTrace.op1[i])} ${disasmHex2(disasmTrace.op2[i])}  ` +
         `${mnemonic.padEnd(12)}  ` +
         `A:${disasmHex2(disasmTrace.a[i])} X:${disasmHex2(disasmTrace.x[i])} ` +
         `Y:${disasmHex2(disasmTrace.y[i])} SP:${disasmHex2(disasmTrace.sp[i])} ` +
         `P:${disasmFormatFlags(disasmTrace.p[i])}`;
}

function resetDisasmTrace() {
  disasmTrace.write=0;
  disasmTrace.count=0;
  disasmTrace.instructions=0;
}

function dumpDisasmTrace(limit=DISASM_TRACE_SIZE) {
  const count=Math.min(disasmTrace.count,Math.max(1,limit|0));
  if(!count)return;
  const lines=new Array(count);
  const start=(disasmTrace.write-count+DISASM_TRACE_SIZE)%DISASM_TRACE_SIZE;
  for(let n=0;n<count;n++) lines[n]=disasmFormatTraceSlot((start+n)%DISASM_TRACE_SIZE);
  console.log(`[VajNES disassembly: last ${count} instructions]\n${lines.join("\n")}`);
}

window.dumpDisasmTrace=dumpDisasmTrace;

openDisasm.onclick = () => {
  if(disasmRunning) {
    dumpDisasmTrace();
    disasmRunning=false;
    window.alert("Disassembler disabled (recent trace dumped to console)");
  } else {
    resetDisasmTrace();
    disasmRunning=true;
    window.alert("Disassembler enabled (fast buffered console trace)");
  }
};

function disasm(){
  if(!disasmRunning)return;

  const i=disasmTrace.write;
  const len=OPCODES[code]?.pc|0;
  disasmTrace.pc[i]=CPUregisters.PC&0xffff;
  disasmTrace.code[i]=code&0xff;
  disasmTrace.op1[i]=len>=2 && typeof operand[1]==="number" ? operand[1]&0xff : 0x100;
  disasmTrace.op2[i]=len>=3 && typeof operand[2]==="number" ? operand[2]&0xff : 0x100;
  disasmTrace.a[i]=CPUregisters.A&0xff;
  disasmTrace.x[i]=CPUregisters.X&0xff;
  disasmTrace.y[i]=CPUregisters.Y&0xff;
  disasmTrace.sp[i]=CPUregisters.S&0xff;
  disasmTrace.p[i]=disasmPackFlags(CPUregisters.P);

  disasmTrace.write=(i+1)%DISASM_TRACE_SIZE;
  if(disasmTrace.count<DISASM_TRACE_SIZE)disasmTrace.count++;
  disasmTrace.instructions++;

  // A tiny live heartbeat proves tracing is active without trying to make the
  // browser render ~500k console rows per second. The complete recent trace is
  // always retained and dumped on Pause, on disable, or via dumpDisasmTrace().
  if((disasmTrace.instructions%DISASM_LIVE_SAMPLE_INTERVAL)===0)
    console.log(disasmFormatTraceSlot(i));
}
