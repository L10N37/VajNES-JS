
/*
// Usage:
const snap0345 = watchWRAMBase(0x0345);
// ...run an instruction...
snap0345("after ASL");
*/
function watchWRAMBase(base){
  const b = base & 0x1FFF;
  const isWRAM = b < 0x2000;
  console.log(`[WATCH] ${hex16(b)} (${isWRAM ? "WRAM" : "not WRAM"})`);
  const addrs = isWRAM ? [b & 0x07FF, (b&0x07FF)+0x0800, (b&0x07FF)+0x1000, (b&0x07FF)+0x1800] : [b];
  return function snapshot(tag=""){
    const vals = addrs.map(a => checkReadOffset(a) & 0xFF);
    console.log(`[WATCH ${tag}] ${addrs.map(hex16).join(",")} = ${vals.map(hex8).join(",")}`);
  };
}


// takes array variable as a parameter, logs to console with offsets in a table
// for debugging
function hexDump(array) {
  const hexPrefix = '0x';
  const bytesPerRow = 16;
  const totalRows = Math.ceil(array.length / bytesPerRow);

  const lines = [];
  for (let row = 0; row < totalRows; row++) {
    const offset = (row * bytesPerRow).toString(16).padStart(6, '0');
    const rowBytes = Array.from(
      array.slice(row * bytesPerRow, (row + 1) * bytesPerRow),
      b => hexPrefix + b.toString(16).padStart(2, '0')
    ).join(' ');
    lines.push(`${offset}: ${rowBytes}`);
  }
  // Join all rows with newlines and print as one table
  console.log(lines.join('\n'));
}

// test suite helpers
function flagsEqual(a, b) {
  return a.N === b.N && a.V === b.V && a.B === b.B && a.D === b.D &&
         a.I === b.I && a.Z === b.Z && a.C === b.C;
}

// hex output helpers, ToDO, combine into one, edit all calls to pass correct parameters for output
// Minimal fixed-width helpers
function hex8(n)  { return "0x" + ((n & 0xFF)    ).toString(16).toUpperCase().padStart(2, "0"); }
function hex16(n) { return "0x" + ((n & 0xFFFF)  ).toString(16).toUpperCase().padStart(4, "0"); }
function hex32(n) { return "0x" + ((n >>> 0)     ).toString(16).toUpperCase().padStart(8, "0"); }

function testSuiteHex(v, len = 2) {
  if (v == null || typeof v.toString !== "function") return "--";
  return "0x" + v.toString(16).toUpperCase().padStart(len, "0");
}

function hex(v) {
  if (v == null) return "--";
  let n = Number(v);
  return "0x" + n.toString(16).toUpperCase().padStart(4, '0');
}

// hex for 0x00 (PPU regs are 8-bit)
function hexTwo(val, len = 2) {
  return "$" + val.toString(16).toUpperCase().padStart(len, "0");
}

function flagsBin(f) {
  return [
    f.N ? "N" : ".",
    f.V ? "V" : ".",
    f.B ? "B" : ".",
    f.D ? "D" : ".",
    f.I ? "I" : ".",
    f.Z ? "Z" : ".",
    f.C ? "C" : "."
  ].join('');
}  
function dropdown(label, items) {
  return items.length > 1
    ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">`
      + items.map(i=>`<li>${i}</li>`).join("") + `</ul></details>`
    : label;
}

// ================== ADDRESS TABLE UTILS ==================

function incrementHexAddress(address, endAddress, step = 16) {
  let hexValue = parseInt(address.substring(1), 16);
  let hexValueEnd = parseInt(endAddress.substring(1), 16);
  hexValue += step;
  if (hexValue > hexValueEnd) return null;
  return "$" + hexValue.toString(16).toUpperCase().padStart(4, '0');
}

function opcodeTablePrint(){

  const BRANCH_OPS = {
  0x10: "BPL", 0x30: "BMI", 0x50: "BVC", 0x70: "BVS",
  0x90: "BCC", 0xB0: "BCS", 0xD0: "BNE", 0xF0: "BEQ"
};

let opcodeRows = [];
for(let i=0; i<256; ++i) {
  opcodeRows.push({
    OPC: "0x" + i.toString(16).padStart(2, "0").toUpperCase(),
    BR: BRANCH_OPS[i] || "",
    Handler: opcodeFuncs[i] ? opcodeFuncs[i].name : "(none)",
    "PC+": opcodePcIncs[i],
    Cycles: opcodeCyclesInc[i],
    //Len: opcodeLengths[i],
    //Hex: opcodeHex[i] || ""
  });
}

console.log("%c==== 6502 Opcode Table (Branch ops highlighted) ====", "color:#fff;background:#222;font-size:1.2em;padding:4px;");
console.table(opcodeRows);

}

function updateDebugTables() {
  wramPopulate();
  vramPopulate();
  prgRomPopulate();
  cpuRegisterBitsPopulate();
  cpuStatusRegisterPopulate();
  ppuRegisterBitsPopulate();
}
