/* 
old debugging, as done its job, can't use as these aren't global vars and will log every step with UI refresh
console.debug(`WRAM cells = ${allWramCells.length} bytes`);
console.debug(`WRAM cells = ${(allWramCells.length / 1024).toFixed(2)} KB`);
console.debug(`VRAM cells = ${allVramCells.length} bytes`);
console.debug(`VRAM cells = ${(allVramCells.length / 1024).toFixed(2)} KB`);
console.debug(`Cartridge1 space cells = ${allCartSpaceBytes1.length} bytes`);
console.debug(`Cartridge2 space cells = ${allCartSpaceBytes2.length} bytes`);
console.debug(`Total Cartridge space = ${(allCartSpaceBytes1.length + allCartSpaceBytes2.length) / 1024} KB`);
*/

// Chrome has an issue with scroll to view that isn't present on other browsers, only since having 3 separate 
// tables

// ================== WRAM TABLE (FULL, WITH MIRRORS) ==================

function createWRAMTable() {
  // Mirrors: $0000-$07FF, $0800-$0FFF, $1000-$17FF, $1800-$1FFF
  const regions = [
    { label: "Work RAM $0000–$07FF - Actual RAM space, not a mirror", start: "$0000", end: "$07F0" },
    { label: "Work RAM Mirror $0800–$0FFF", start: "$0800", end: "$0FF0" },
    { label: "Work RAM Mirror $1000–$17FF", start: "$1000", end: "$17F0" },
    { label: "Work RAM Mirror $1800–$1FFF", start: "$1800", end: "$1FF0" }
  ];
  let html = `
    <table>
      <thead>
        <tr>
          <th class='addressClass sticky'>Offset(h)</th>
          ${[...Array(16).keys()].map(x => `<th class='addressClass sticky'>${x.toString(16).toUpperCase().padStart(2, '0')}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
  `;
  for (const {label, start, end} of regions) {
    html += `<tr><td colspan="17" class="subheading">${label}</td></tr>`;
    let current = start;
    while (true) {
      const rowAddr = parseInt(current.substring(1), 16);
      html += `<tr>
        <td class="addressClass">${current}</td>
        ${[...Array(16).keys()].map(col => {
          const cellAddr = rowAddr + col;
          return `<td class="wramCells" id="WRAM-CELL-${cellAddr.toString(16).toUpperCase().padStart(4, '0')}"></td>`;
        }).join('')}
      </tr>`;
      if (current === end) break;
      current = incrementHexAddress(current, end, 16);
      if (!current) break;
    }
  }
  html += `</tbody></table>`;
  return html;
}
const WRAM_Table = createWRAMTable();

// ================== VRAM TABLE (FULL, WITH MIRRORS) ==================

function createVRAMTable() {
  let html = `
    <table>
      <thead>
        <tr>
          <th class='addressClass sticky'>Offset(h)</th>
          ${[...Array(16).keys()].map(x => `<th class='addressClass sticky'>${x.toString(16).toUpperCase().padStart(2,'0')}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
  `;
  for (let row = 0x0000; row <= 0x3FF0; row += 0x10) {
    html += `<tr><td class="addressClass">${'$'+row.toString(16).toUpperCase().padStart(4,'0')}</td>`;
    for (let col = 0; col < 16; ++col) {
      let addr = row + col;
      html += `<td class="vramCells" id="VRAM-CELL-${addr.toString(16).toUpperCase().padStart(4,'0')}"></td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

const VRAM_Table = createVRAMTable();

// ================== HANDY JUMP DROPDOWNS (WRAM/VRAM) ==================

// WRAM dropdown
function createWRAMJumpDropdown() {
  // label, start, length
const options = [
  { label: "Jump to...",                             addr: null,   len: 0 },
  { label: "Zero Page ($0000–$00FF)",                addr: 0x0000, len: 0x0100 },
  { label: "Stack Page ($0100–$01FF)",               addr: 0x0100, len: 0x0100 },
  { label: "OAM-DMA Buffer (convention) ($0200–$02FF)", addr: 0x0200, len: 0x0100 },
  { label: "General Purpose RAM ($0300–$07FF)",      addr: 0x0300, len: 0x0500 },
  { label: "WRAM Mirror #1 ($0800–$0FFF)",           addr: 0x0800, len: 0x0800 },
  { label: "WRAM Mirror #2 ($1000–$17FF)",           addr: 0x1000, len: 0x0800 },
  { label: "WRAM Mirror #3 ($1800–$1FFF)",           addr: 0x1800, len: 0x0800 }
];

  const dropdown = document.createElement("select");
  dropdown.id = "wramJumpSelect";
  dropdown.style.fontSize = "12px";
  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt.addr !== null ? `${opt.addr}-${opt.len}` : "";
    option.textContent = opt.label;
    dropdown.appendChild(option);
  });
  dropdown.addEventListener("change", function() {
    if (!this.value) return;
    const [start, len] = this.value.split('-').map(x => parseInt(x, 10));
    if (isNaN(start)) return;
    // Highlight region
    let highlighted = [];
    for (let i = 0; i < (len || 1); ++i) {
      const id = `WRAM-CELL-${(start + i).toString(16).toUpperCase().padStart(4, '0')}`;
      const cell = document.getElementById(id);
      if (cell) {
        cell.classList.add('highlighted-cell');
        highlighted.push(cell);
      }
      if (i === 0 && cell) {
        // Only scroll to first cell
        cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    setTimeout(() => highlighted.forEach(c => c.classList.remove('highlighted-cell')), 900);
    this.value = "";
  });
  return dropdown;
}

function createVRAMJumpDropdown() {
  const options = [
    { label: "Jump to...", addr: null, len: 0 },
    { label: "Pattern Table 0 ($0000)", addr: 0x0000, len: 0x1000 },
    { label: "Pattern Table 1 ($1000)", addr: 0x1000, len: 0x1000 },
    { label: "Nametable 0 ($2000)", addr: 0x2000, len: 0x400 },
    { label: "Nametable 1 ($2400)", addr: 0x2400, len: 0x400 },
    { label: "Nametable 2 ($2800)", addr: 0x2800, len: 0x400 },
    { label: "Nametable 3 ($2C00)", addr: 0x2C00, len: 0x400 },
    { label: "Palette RAM ($3F00)", addr: 0x3F00, len: 0x20 }
  ];
  const dropdown = document.createElement("select");
  dropdown.id = "vramJumpSelect";
  dropdown.style.fontSize = "12px";

  // Make sure options are appended!
  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt.addr !== null ? `${opt.addr}-${opt.len}` : "";
    option.textContent = opt.label;
    dropdown.appendChild(option);
  });

  dropdown.addEventListener("change", function() {
    if (!this.value) return;
    const [start, len] = this.value.split('-').map(x => parseInt(x, 10));
    if (isNaN(start)) return;
    let highlighted = [];
    for (let i = 0; i < (len || 1); ++i) {
      const id = `VRAM-CELL-${(start + i).toString(16).toUpperCase().padStart(4, '0')}`;
      const cell = document.getElementById(id);
      if (cell) {
        cell.classList.add('highlighted-cell');
        highlighted.push(cell);
        // Optional: Scroll into view
        if (i === 0 && cell) cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    setTimeout(() => highlighted.forEach(c => c.classList.remove('highlighted-cell')), 900);
    this.value = "";
  });

  return dropdown;
}

// PRGROM quick jump drop down
function createPRGROMJumpDropdown() {
  const options = [
    { label: "Jump to...", addr: null, len: 0 },
    { label: "PRG-ROM Bank 1 Start ($8000)", addr: 0x8000, len: 0x4000 },
    { label: "PRG-ROM Bank 1 Mid ($A000)", addr: 0xA000, len: 0x1000 },
    { label: "PRG-ROM Bank 2 Start ($C000)", addr: 0xC000, len: 0x4000 },
    { label: "PRG-ROM Bank 2 Mid ($E000)", addr: 0xE000, len: 0x1000 },
    { label: "NMI Vector ($FFFA)", addr: 0xFFFA, len: 2 },
    { label: "Reset Vector ($FFFC)", addr: 0xFFFC, len: 2 },
    { label: "IRQ/BRK Vector ($FFFE)", addr: 0xFFFE, len: 2 },
    { label: "Last Byte ($FFFF)", addr: 0xFFFF, len: 1 }
  ];
  const dropdown = document.createElement("select");
  dropdown.id = "prgromJumpSelect";
  dropdown.style.fontSize = "12px";
  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt.addr !== null ? `${opt.addr}-${opt.len}` : "";
    option.textContent = opt.label;
    dropdown.appendChild(option);
  });
  dropdown.addEventListener("change", function() {
    if (!this.value) return;
    const [start, len] = this.value.split('-').map(x => parseInt(x, 10));
    if (isNaN(start)) return;
    let highlighted = [];
    for (let i = 0; i < (len || 1); ++i) {
      // Figure out which bank this is (bank 2 for $C000 and up)
      let cellID;
      if (start + i >= 0xC000) {
        cellID = `cartSpaceTwoID-${(start + i).toString(16).toUpperCase().padStart(4, '0')}`;
      } else {
        cellID = `cartSpaceOneID-${(start + i).toString(16).toUpperCase().padStart(4, '0')}`;
      }
      const cell = document.getElementById(cellID);
      if (cell) {
        cell.classList.add('highlighted-cell');
        highlighted.push(cell);
      }
      if (i === 0 && cell) {
        cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    setTimeout(() => highlighted.forEach(c => c.classList.remove('highlighted-cell')), 900);
    this.value = "";
  });
  return dropdown;
}

// PRG-ROM TABLE ROW GENERATOR 

function incrementAddress(address, endAddress) {
  let hexValue = parseInt(address.substring(1), 16);
  let hexValueEnd = parseInt(endAddress.substring(1), 16);
  hexValue += 16;
  if (hexValue > hexValueEnd) {
    return null;
  }
  return "$" + hexValue.toString(16).toUpperCase().padStart(4, '0');
}

function createTable(startAddress, endAddress, addClass) {
  const rows = [];
  let currentAddress = startAddress;
  while (currentAddress !== endAddress) {
    rows.push(`<tr>
      <td class="addressClass">${currentAddress}</td>
      ${`<td class="${addClass}"></td>`.repeat(15)}
      <td class="${addClass}"></td>
    </tr>`);
    currentAddress = incrementAddress(currentAddress, endAddress);
    if (currentAddress === null) {
      break;
    }
  }
  rows.push(`<tr>
    <td class="addressClass">${endAddress}</td>
    ${`<td class="${addClass}"></td>`.repeat(15)}
    <td class="${addClass}"></td>
  </tr>`);
  return `${rows.join('')}`;
}


// ================== PRG-ROM TABLE ==================
function createPRGROMTable() {
  let html = `
    <table>
      <thead>
        <tr>
          <th class='addressClass sticky'>Offset (h)</th>
          ${[...Array(16).keys()].map(x => `<th class='addressClass sticky'>${x.toString(16).toUpperCase().padStart(2, '0')}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
  `;
  // Bank 1: $8000–$BFFF
  for (let row = 0x8000; row <= 0xBFF0; row += 0x10) {
    html += `<tr><td class="addressClass">${'$'+row.toString(16).toUpperCase().padStart(4,'0')}</td>`;
    for (let col = 0; col < 16; ++col) {
      let addr = row + col;
      html += `<td class="cartspace1" id="cartSpaceOneID-${addr.toString(16).toUpperCase().padStart(4,'0')}"></td>`;
    }
    html += `</tr>`;
  }
  // Bank 2: $C000–$FFF0
  for (let row = 0xC000; row <= 0xFFF0; row += 0x10) {
    html += `<tr><td class="addressClass">${'$'+row.toString(16).toUpperCase().padStart(4,'0')}</td>`;
    for (let col = 0; col < 16; ++col) {
      let addr = row + col;
      html += `<td class="cartspace2" id="cartSpaceTwoID-${addr.toString(16).toUpperCase().padStart(4,'0')}"></td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

let pgRom_Table = createPRGROMTable();

// ============= TABLE RENDER + POPULATE ========================

// WRAM Table insertion
const container1 = document.querySelector('.debug');
container1.insertAdjacentHTML('beforeend', WRAM_Table);
container1.lastElementChild.classList.add('GeneratedTable');

// VRAM Table insertion
const container2 = document.querySelector('.debug2');
container2.insertAdjacentHTML('beforeend', VRAM_Table);
container2.lastElementChild.classList.add('GeneratedTable');

// PRG-ROM Table insertion
const container3 = document.querySelector('.debug3');
container3.insertAdjacentHTML('beforeend', pgRom_Table);
container3.lastElementChild.classList.add('GeneratedTable');


// WRAM populate
function wramPopulate(){
const allWramCells = document.querySelectorAll('.wramCells');

allWramCells.forEach(cell => {
  const match = cell.id.match(/WRAM-CELL-([0-9A-F]{4})/);
  const addr = match ? parseInt(match[1], 16) : 0;
  if (addr < 0x0800) cell.classList.add('workRAM-cell');
  else cell.classList.add('wram-mirror-cell');
  // Use direct systemMemory access with mirroring!
  const val = systemMemory[addr & 0x7FF];
  cell.innerText = val.toString(16).padStart(2, '0') + 'h';
  cell.title = `$${addr.toString(16).toUpperCase().padStart(4, '0')}`;

  // Click: toggle highlight for this cell only, update offset display if present
  cell.addEventListener('click', () => {
    cell.classList.toggle('highlighted-cell');
    const hex = addr.toString(16).toUpperCase().padStart(4, '0');
    const offsetContainer = document.getElementById('locContainer');
    if (offsetContainer) offsetContainer.innerHTML = `&nbsp;$${hex}`;
  });

  // Double-click: edit value in cell
  cell.addEventListener('dblclick', (e) => {
    // Prevent normal click from toggling highlight when editing
    e.stopPropagation();

    let curValue = cell.innerText.replace('h','');
    let input = document.createElement('input');
    input.type = 'text';
    input.value = curValue;
    input.maxLength = 2;
    input.style.width = '2.2em';
    cell.innerText = '';
    cell.appendChild(input);
    input.focus();

    // Commit value on blur or Enter
    function commit() {
      let v = parseInt(input.value, 16);
      if (isNaN(v) || v < 0x00 || v > 0xFF) v = 0; // Clamp to byte
      systemMemory[addr & 0x7FF] = v; // Store to actual RAM
      cell.innerText = v.toString(16).padStart(2, '0').toUpperCase() + 'h';
      cell.classList.add('edited-cell'); // mark as edited
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        cell.innerText = curValue.padStart(2, '0').toUpperCase() + 'h';
      }
    });
  });
});
}

// VRAM populate
function vramPopulate(){
  const allVramCells = document.querySelectorAll('.vramCells');
  allVramCells.forEach(cell => {
    const match = cell.id.match(/VRAM-CELL-([0-9A-F]{4})/);
    const addr = match ? parseInt(match[1], 16) : 0;
    let val;

    if (addr < 0x2000) {
      // Pattern tables (CHR) → not really in VRAM, show 00 for now
      val = 0;
    } else if (addr < 0x3F00) {
      // Nametables (mirror into 2KB VRAM)
      val = VRAM[mapNT(addr)];
    } else if (addr < 0x4000) {
      // Palette RAM ($3F00–$3F1F mirrored every 0x20)
      val = PALETTE_RAM[paletteIndex(addr)];
    } else {
      // Out of range → blank
      val = 0;
    }

    cell.innerText = val.toString(16).padStart(2, '0').toUpperCase() + 'h';
    cell.title = `$${addr.toString(16).toUpperCase().padStart(4, '0')}`;

    // Click highlight
    cell.addEventListener('click', () => {
      cell.classList.toggle('highlighted-cell');
      const hex = addr.toString(16).toUpperCase().padStart(4, '0');
      const offsetContainer = document.getElementById('locContainer2');
      if (offsetContainer) offsetContainer.innerHTML = `&nbsp;$${hex}`;
    });

    // Double-click edit
    cell.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      let curValue = cell.innerText.replace('h','');
      let input = document.createElement('input');
      input.type = 'text';
      input.value = curValue;
      input.maxLength = 2;
      input.style.width = '2.2em';
      cell.innerText = '';
      cell.appendChild(input);
      input.focus();

      function commit() {
        let v = parseInt(input.value, 16);
        if (isNaN(v) || v < 0x00 || v > 0xFF) v = 0;

        if (addr >= 0x2000 && addr < 0x3F00) {
          VRAM[mapNT(addr)] = v;
        } else if (addr >= 0x3F00 && addr < 0x4000) {
          PALETTE_RAM[paletteIndex(addr)] = v & 0x3F;
        }

        cell.innerText = v.toString(16).padStart(2, '0').toUpperCase() + 'h';
        cell.classList.add('edited-cell');
      }

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') {
          cell.innerText = curValue.padStart(2, '0').toUpperCase() + 'h';
        }
      });
    });
  });
}

function prgRomPopulate(){
// PRG-ROM populate
let allCartSpaceBytes1 = document.querySelectorAll('.cartspace1');
let allCartSpaceBytes2 = document.querySelectorAll('.cartspace2');
let allCartSpaceBytes = [...allCartSpaceBytes1, ...allCartSpaceBytes2];

allCartSpaceBytes.forEach((cell, idx) => {
  const addr = 0x8000 + idx;
  let prgRomOffset;

  // Mirroring: 16KB ROM maps twice
  if (prgRom.length === 0x4000 && addr >= 0xC000) {
    prgRomOffset = (addr - 0x8000) % 0x4000; // 0x0000–0x3FFF
  } else {
    prgRomOffset = addr - 0x8000;
  }

  // Show value (if loaded)
  const val = prgRom[prgRomOffset];
  cell.innerText = (val !== undefined)
    ? val.toString(16).padStart(2, '0').toUpperCase() + 'h'
    : '--';
  cell.title = `$${addr.toString(16).toUpperCase().padStart(4, '0')}`;

  // Click: toggle highlight
  cell.addEventListener('click', () => {
    cell.classList.toggle('highlighted-cell');
    const hex = addr.toString(16).toUpperCase().padStart(4, '0');
    const offsetContainer = document.getElementById('locContainer3');
    if (offsetContainer) offsetContainer.innerHTML = `&nbsp;$${hex}`;
  });

  // Double-click: edit
  cell.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    let curValue = cell.innerText.replace('h','');
    let input = document.createElement('input');
    input.type = 'text';
    input.value = curValue;
    input.maxLength = 2;
    input.style.width = '2.2em';
    cell.innerText = '';
    cell.appendChild(input);
    input.focus();

    function commit() {
      let v = parseInt(input.value, 16);
      if (isNaN(v) || v < 0x00 || v > 0xFF) v = 0;
      prgRom[prgRomOffset] = v; // Write to the correct physical byte!
      cell.innerText = v.toString(16).padStart(2, '0').toUpperCase() + 'h';
      cell.classList.add('edited-cell');
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') cell.innerText = curValue.padStart(2, '0').toUpperCase() + 'h';
    });
  });
});

for (let i = 0; i < allCartSpaceBytes.length; i++) {
  let cartSpaceByte = allCartSpaceBytes[i];
  if (i < 16 * 1024) {
    cartSpaceByte.setAttribute('id', `cartSpaceOneID-${i + 0x8000}`);
    cartSpaceByte.addEventListener('click', function () {
      let indexHex1 = (i + 0x8000).toString(16).toUpperCase().padStart(4, '0');
      document.getElementById('locContainer3').innerHTML = `&nbsp $${indexHex1}`;
    });
  } else {
    cartSpaceByte.setAttribute('id', `cartSpaceTwoID-${(i - (16 * 1024)) + 0xC000}`);
    cartSpaceByte.addEventListener('click', function () {
      let indexHex2 = ((i - (16 * 1024)) + 0xC000).toString(16).toUpperCase().padStart(4, '0');
      document.getElementById('locContainer3').innerHTML = `&nbsp $${indexHex2}`;
    });
  }
}
}

// populate cpu register bits
function cpuRegisterBitsPopulate() {
  // Helper for 8-bit registers
  function setBits(regVal, prefix) {
    for (let i = 7; i >= 0; --i) {
      const cell = document.getElementById(prefix + i);
      if (cell) cell.innerText = (regVal >> i) & 1;
    }
  }

  setBits(CPUregisters.A, 'A');
  setBits(CPUregisters.X, 'X');
  setBits(CPUregisters.Y, 'Y');
  setBits(CPUregisters.S, 'S');

  // PC is 16-bit: high byte (PCH) -> PC0–PC7, low byte (PCL) -> PC8–PC15
  let PC = CPUregisters.PC || 0;
  let PCH = (PC >> 8) & 0xFF;
  let PCL = PC & 0xFF;

  // Fill PC0..PC7 (high byte)
  for (let i = 0; i < 8; ++i) {
    const cell = document.getElementById('PC' + i);
    if (cell) cell.innerText = (PCH >> (7 - i)) & 1;
  }
  // Fill PC8..PC15 (low byte)
  for (let i = 0; i < 8; ++i) {
    const cell = document.getElementById('PC' + (8 + i));
    if (cell) cell.innerText = (PCL >> (7 - i)) & 1;
  }
}

// populate cpu register bits
function cpuStatusRegisterPopulate() {
  // P0–P7 = C Z I D B U V N
  const flagOrder = ['C', 'Z', 'I', 'D', 'B', 'U', 'V', 'N'];
  for (let i = 0; i < 8; i++) {
    const cell = document.getElementById('P' + i);
    if (cell) cell.innerText = CPUregisters.P[flagOrder[i]];
  }
}

// populate ppu register bits
function ppuRegisterBitsPopulate() {
  // Helper for 8-bit PPU registers
  function setBitsPPU(regVal, prefix) {
    for (let i = 7; i >= 0; --i) {
      const cell = document.getElementById(prefix + i);
      if (cell) cell.innerText = (regVal >> i) & 1;
    }
  }
  setBitsPPU(PPUCTRL,      "PPUCTRL");
  setBitsPPU(PPUMASK,      "PPUMASK");
  setBitsPPU(PPUSTATUS,    "PPUSTATUS");
  setBitsPPU(OAMADDR,   "OAMADDR");
  setBitsPPU(OAMDATA,   "OAMDATA");
  setBitsPPU(ADDR_HIGH, "PPUADDR_HIGH");
  setBitsPPU(ADDR_LOW,  "PPUADDR_LOW");
  setBitsPPU(VRAM_DATA, "PPUDATA");
}

// =================== CPU/PPU REGISTERS + FLAGS TABLES ===================

const registersTable = `
<table>
  <thead>
    <tr>
      <th class='addressClass'>Register</th>
      <th class='addressClass'>07</th>
      <th class='addressClass'>06</th>
      <th class='addressClass'>05</th>
      <th class='addressClass'>04</th>
      <th class='addressClass'>03</th>
      <th class='addressClass'>02</th>
      <th class='addressClass'>01</th>
      <th class='addressClass'>00</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class='addressClass'>A</td>
      <td id='A7'></td><td id='A6'></td><td id='A5'></td><td id='A4'></td>
      <td id='A3'></td><td id='A2'></td><td id='A1'></td><td id='A0'></td>
    </tr>
    <tr>
      <td class='addressClass'>X</td>
      <td id='X7'></td><td id='X6'></td><td id='X5'></td><td id='X4'></td>
      <td id='X3'></td><td id='X2'></td><td id='X1'></td><td id='X0'></td>
    </tr>
    <tr>
      <td class='addressClass'>Y</td>
      <td id='Y7'></td><td id='Y6'></td><td id='Y5'></td><td id='Y4'></td>
      <td id='Y3'></td><td id='Y2'></td><td id='Y1'></td><td id='Y0'></td>
    </tr>
    <tr>
      <td class='addressClass'>S</td>
      <td id='S7'></td><td id='S6'></td><td id='S5'></td><td id='S4'></td>
      <td id='S3'></td><td id='S2'></td><td id='S1'></td><td id='S0'></td>
    </tr>
    <tr>
      <td class='addressClass'>PCH</td>
      <td id='PC0'></td><td id='PC1'></td><td id='PC2'></td><td id='PC3'></td>
      <td id='PC4'></td><td id='PC5'></td><td id='PC6'></td><td id='PC7'></td>
    </tr>
    <tr>
      <td class='addressClass'>PCL</td>
      <td id='PC8'></td><td id='PC9'></td><td id='PC10'></td><td id='PC11'></td>
      <td id='PC12'></td><td id='PC13'></td><td id='PC14'></td><td id='PC15'></td>
    </tr>
  </tbody>
</table>
`;

const PPUregistersTable = `
<table>
  <thead>
    <tr>
      <th class='addressClass'>Register</th>
      <th class='addressClass'>07</th>
      <th class='addressClass'>06</th>
      <th class='addressClass'>05</th>
      <th class='addressClass'>04</th>
      <th class='addressClass'>03</th>
      <th class='addressClass'>02</th>
      <th class='addressClass'>01</th>
      <th class='addressClass'>00</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class='addressClass'>PPU [CTRL1]</td>
      <td id="PPUCTRL7"></td><td id="PPUCTRL6"></td><td id="PPUCTRL5"></td><td id="PPUCTRL4"></td>
      <td id="PPUCTRL3"></td><td id="PPUCTRL2"></td><td id="PPUCTRL1"></td><td id="PPUCTRL0"></td>
    </tr>
    <tr>
      <td class='addressClass'>PPU [CTRL2]</td>
      <td id="PPUMASK7"></td><td id="PPUMASK6"></td><td id="PPUMASK5"></td><td id="PPUMASK4"></td>
      <td id="PPUMASK3"></td><td id="PPUMASK2"></td><td id="PPUMASK1"></td><td id="PPUMASK0"></td>
    </tr>
    <tr>
      <td class='addressClass'>PPU [SR]</td>
      <td id="PPUSTATUS7"></td><td id="PPUSTATUS6"></td><td id="PPUSTATUS5"></td><td id="PPUSTATUS4"></td>
      <td id="PPUSTATUS3"></td><td id="PPUSTATUS2"></td><td id="PPUSTATUS1"></td><td id="PPUSTATUS0"></td>
    </tr>
    <tr>
      <td class='addressClass'>SPR-RAM [ADDR]</td>
      <td id="OAMADDR7"></td><td id="OAMADDR6"></td><td id="OAMADDR5"></td><td id="OAMADDR4"></td>
      <td id="OAMADDR3"></td><td id="OAMADDR2"></td><td id="OAMADDR1"></td><td id="OAMADDR0"></td>
    </tr>
    <tr>
      <td class='addressClass'>SPR-RAM [I/O]</td>
      <td id="OAMDATA7"></td><td id="OAMDATA6"></td><td id="OAMDATA5"></td><td id="OAMDATA4"></td>
      <td id="OAMDATA3"></td><td id="OAMDATA2"></td><td id="OAMDATA1"></td><td id="OAMDATA0"></td>
    </tr>
    <tr>
      <td class='addressClass'>VRAM [ADDR1]</td>
      <td id="PPUADDR_HIGH7"></td><td id="PPUADDR_HIGH6"></td><td id="PPUADDR_HIGH5"></td><td id="PPUADDR_HIGH4"></td>
      <td id="PPUADDR_HIGH3"></td><td id="PPUADDR_HIGH2"></td><td id="PPUADDR_HIGH1"></td><td id="PPUADDR_HIGH0"></td>
    </tr>
    <tr>
      <td class='addressClass'>VRAM [ADDR2]</td>
      <td id="PPUADDR_LOW7"></td><td id="PPUADDR_LOW6"></td><td id="PPUADDR_LOW5"></td><td id="PPUADDR_LOW4"></td>
      <td id="PPUADDR_LOW3"></td><td id="PPUADDR_LOW2"></td><td id="PPUADDR_LOW1"></td><td id="PPUADDR_LOW0"></td>
    </tr>
    <tr>
      <td class='addressClass'>VRAM [I/O]</td>
      <td id="PPUDATA7"></td><td id="PPUDATA6"></td><td id="PPUDATA5"></td><td id="PPUDATA4"></td>
      <td id="PPUDATA3"></td><td id="PPUDATA2"></td><td id="PPUDATA1"></td><td id="PPUDATA0"></td>
    </tr>
  </tbody>
</table>
`;

let FlagRegisterTable =  
`
<table>
  <thead>
    <tr>
      <th class='addressClass'>00 (Carry)</th>
      <th class='addressClass'>01 (Zero)</th>
      <th class='addressClass'>02 (Int. Disable)</th>
      <th class='addressClass'>03 (Decimal)</th>
      <th class='addressClass'>04 (B Flag)</th>
      <th class='addressClass'>05 (Unused)</th>
      <th class='addressClass'>06 (Overflow)</th>
      <th class='addressClass'>07 (negative)</th>
    </tr>
  </thead>
  <tbody>
  <tr>
    <td id="P0">0</td>
    <td id="P1">0</td>
    <td id="P2">0</td>
    <td id="P3">0</td>
    <td id="P4">0</td>
    <td id="P5">1</td>
    <td id="P6">0</td>
    <td id="P7">0</td>
  </tr>
  </tbody>
</table>
`;

let instructionStepTable = `
<div class="crt-panel">
  <div class="crt-display">
  </div>
  <div class="crt-controls">
    <button class="crt-btn" onclick="step()">STEP / Test Suite</button>
    <button class="crt-btn" onclick="run()">RUN</button>
    <button class="crt-btn" onclick="pause()">PAUSE / Refresh UI</button>
  </div>
</div>
`;

// dynamic table insertions
let insertRegistersTable = document.createElement('table');
insertRegistersTable.className = 'GeneratedTable';
let registerSection = document.querySelector('.CPU-registers');
registerSection.appendChild(insertRegistersTable);
insertRegistersTable.innerHTML = registersTable;

insertRegistersTable = document.createElement('table');
insertRegistersTable.className = 'GeneratedTable';
registerSection = document.querySelector('.PPU-registers');
registerSection.appendChild(insertRegistersTable);
insertRegistersTable.innerHTML = PPUregistersTable;

let insertFlagRegisterTable = document.createElement('table');
insertFlagRegisterTable.className = 'GeneratedTable';
let flagRegisterSection = document.querySelector('.flag-register');
flagRegisterSection.appendChild(insertFlagRegisterTable);
insertFlagRegisterTable.innerHTML = FlagRegisterTable;

  // dynamic insertion, step box
  let instructionSection = document.querySelector('.instruction-step');
  instructionSection.innerHTML = ``;
  let insertInstructionArea = document.createElement('table');
  insertInstructionArea.className = 'GeneratedTable';
  instructionSection.appendChild(insertInstructionArea);
  insertInstructionArea.innerHTML = instructionStepTable; 

// ========== HANDY DROPDOWNS ==========

// WRAM Drop-down:
const wramHeader = document.querySelector('.wram-header');
if (wramHeader) wramHeader.insertBefore(createWRAMJumpDropdown(), wramHeader.firstChild);

// VRAM Drop-down:
const vramHeader = document.querySelector('.vram-header');
if (vramHeader) vramHeader.insertBefore(createVRAMJumpDropdown(), vramHeader.firstChild);

// PRG-ROM Drop-down:
const prgromHeader = document.querySelector('.prgrom-header');
if (prgromHeader) {
  prgromHeader.insertBefore(createPRGROMJumpDropdown(), prgromHeader.firstChild);

  // --- Add "Set PC" elements ---
  const container = document.createElement("span");
  container.style.display = "inline-flex";
  container.style.alignItems = "center";
  container.style.gap = "4px";
  container.style.marginLeft = "12px";

  // 0x prefix cell
  const prefix = document.createElement("span");
  prefix.textContent = "0x";
  prefix.style.fontFamily = "monospace";
  prefix.style.fontSize = "1em";
  container.appendChild(prefix);

  // Input (default 8000)
  const input = document.createElement("input");
  input.type = "text";
  input.value = "8000";
  input.style.width = "76px";
  input.style.fontFamily = "monospace";
  input.style.fontSize = "1em";
  input.style.padding = "2px 4px";
  input.style.border = "1px solid #888";
  input.style.borderRadius = "4px";
  input.style.background = "#222";
  input.style.color = "#fff";
  container.appendChild(input);

  // "Set PC" button
  const btn = document.createElement("button");
  btn.textContent = "Set PC";
  btn.style.fontSize = "0.95em";
  btn.style.padding = "2px 10px";
  btn.style.border = "1px solid #888";
  btn.style.borderRadius = "4px";
  btn.style.background = "#444";
  btn.style.color = "#fff";
  btn.style.marginLeft = "2px";
  btn.style.cursor = "pointer";
  btn.onmouseenter = () => btn.style.background = "#666";
  btn.onmouseleave = () => btn.style.background = "#444";

  btn.onclick = () => {
    let val = input.value.trim();
    if (val.startsWith("0x")) val = val.slice(2);
    const parsed = parseInt(val, 16);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xFFFF) {
      CPUregisters.PC = parsed;
      input.style.borderColor = "#1f7";
      setTimeout(() => { input.style.borderColor = "#888"; }, 600);
    } else {
      input.style.borderColor = "#f44";
      setTimeout(() => { input.style.borderColor = "#888"; }, 800);
    }
  cpuRegisterBitsPopulate();
  };
  container.appendChild(btn);

  prgromHeader.appendChild(container);
}