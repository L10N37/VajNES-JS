
// test suite helpers - test suite will probably not be used again, flag for #delete
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

// stick this back where it belongs #refactor
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

// ================== ADDRESS TABLE UTILS ==================
// likely stick this back where it belongs #refactor

function incrementHexAddress(address, endAddress, step = 16) {
  let hexValue = parseInt(address.substring(1), 16);
  let hexValueEnd = parseInt(endAddress.substring(1), 16);
  hexValue += step;
  if (hexValue > hexValueEnd) return null;
  return "$" + hexValue.toString(16).toUpperCase().padStart(4, '0');
}

function updateDebugTables() {
  wramPopulate();
  vramPopulate();
  prgRomPopulate();
  cpuRegisterBitsPopulate();
  cpuStatusRegisterPopulate();
  ppuRegisterBitsPopulate();
}

function resetSystem(){resetCPU(), ppuResetCounters();}

