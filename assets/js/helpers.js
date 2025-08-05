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

function hex(v) {
  if (v == null) return "--";
  let n = Number(v);
  return "0x" + n.toString(16).toUpperCase().padStart(4, '0');
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