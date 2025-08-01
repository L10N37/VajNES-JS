// This adds 16 bytes after the addresses it receives, in address order!
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

// Expanded RAM/VRAM Table Generation
const WRAM_Table = `
  <table>
    <thead>
      <tr>
        <th class='addressClass sticky'>Offset(h)</th>
        <th class='addressClass sticky'>00</th>
        <th class='addressClass sticky'>01</th>
        <th class='addressClass sticky'>02</th>
        <th class='addressClass sticky'>03</th>
        <th class='addressClass sticky'>04</th>
        <th class='addressClass sticky'>05</th>
        <th class='addressClass sticky'>06</th>
        <th class='addressClass sticky'>07</th>
        <th class='addressClass sticky'>08</th>
        <th class='addressClass sticky'>09</th>
        <th class='addressClass sticky'>0A</th>
        <th class='addressClass sticky'>0B</th>
        <th class='addressClass sticky'>0C</th>
        <th class='addressClass sticky'>0D</th>
        <th class='addressClass sticky'>0E</th>
        <th class='addressClass sticky'>0F</th>
      </tr>
    </thead>
<tbody>
  <!-- Work RAM $0000–$07FF -->
  <tr><td colspan="17" class="subheading">Work RAM $0000–$07FF</td></tr>
  ${createTable("$0000", "$07F0", 'wramCells')}

  <!-- PPU VRAM & Palette RAM $0800–$3FFF -->
  <tr><td colspan="17" class="subheading">PPU VRAM & Palette RAM $0800–$3FFF</td></tr>
  ${createTable("$0800", "$3FF0", 'wramCells')}
</tbody>
  </table>
`;

let pgRom_Table = `
  <table>
    <thead>
      <tr>
        <th class='addressClass sticky'>Offset (h)</th>
        <th class='addressClass sticky'>00</th>
        <th class='addressClass sticky'>01</th>
        <th class='addressClass sticky'>02</th>
        <th class='addressClass sticky'>03</th>
        <th class='addressClass sticky'>04</th>
        <th class='addressClass sticky'>05</th>
        <th class='addressClass sticky'>06</th>
        <th class='addressClass sticky'>07</th>
        <th class='addressClass sticky'>08</th>
        <th class='addressClass sticky'>09</th>
        <th class='addressClass sticky'>0A</th>
        <th class='addressClass sticky'>0B</th>
        <th class='addressClass sticky'>0C</th>
        <th class='addressClass sticky'>0D</th>
        <th class='addressClass sticky'>0E</th>
        <th class='addressClass sticky'>0F</th>
      </tr>
    </thead>
    <tbody>
      ${createTable("$8000", "$BFF0", "cartspace1")}
      ${createTable("$C000", "$FFF0", "cartspace2")}
    </tbody>
  </table>
  <table>
`;

let instructionStepTable = `
<div class="crt-panel">
  <div class="crt-display">
    <div class="crt-label">Instruction</div>
    <div id="instruction" class="crt-line"></div>
    <div class="crt-label">Operand/s</div>
    <div id="operand" class="crt-line"></div>
  </div>
  <div class="crt-controls">
    <button class="crt-btn" onclick="step()">STEP/ test suite</button>
    <button class="crt-btn" onclick="run()">RUN</button>
    <button class="crt-btn" onclick="pause()">PAUSE</button>
  </div>
</div>
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
      <td id='P0'></td>
      <td id='P1'></td>
      <td id='P2'></td>
      <td id='P3'></td>
      <td id='P4'></td>
      <td id='P5'></td>
      <td id='P6'></td>
      <td id='P7'></td>
    </tr>
  </tbody>
</table>
`;

const registersTable = 
`
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
            <td id='A0'></td>
            <td id='A1'></td>
            <td id='A2'></td>
            <td id='A3'></td>
            <td id='A4'></td>
            <td id='A5'></td>
            <td id='A6'></td>
            <td id='A7'></td>
        </tr>
        <tr> 
            <td class='addressClass'>X</td>
            <td id='X0'></td>
            <td id='X1'></td>
            <td id='X2'></td>
            <td id='X3'></td>
            <td id='X4'></td>
            <td id='X5'></td>
            <td id='X6'></td>
            <td id='X7'></td>
        </tr>
        <tr> 
            <td class='addressClass'>Y</td>
            <td id='Y0'></td>
            <td id='Y1'></td>
            <td id='Y2'></td>
            <td id='Y3'></td>
            <td id='Y4'></td>
            <td id='Y5'></td>
            <td id='Y6'></td>
            <td id='Y7'></td>
        </tr>
        <tr> 
            <td class='addressClass'>S</td>
            <td id='S0'></td>
            <td id='S1'></td>
            <td id='S2'></td>
            <td id='S3'></td>
            <td id='S4'></td>
            <td id='S5'></td>
            <td id='S6'></td>
            <td id='S7'></td>
        </tr>
        <tr> 
            <td class='addressClass'>PCH</td>
            <td id='PC0'></td>
            <td id='PC1'></td>
            <td id='PC2'></td>
            <td id='PC3'></td>
            <td id='PC4'></td>
            <td id='PC5'></td>
            <td id='PC6'></td>
            <td id='PC7'></td>
        </tr>
        <tr> 
            <td class='addressClass'>PCL</td>
            <td id='PC8'></td>
            <td id='PC9'></td>
            <td id='PC10'></td>
            <td id='PC11'></td>
            <td id='PC12'></td>
            <td id='PC13'></td>
            <td id='PC14'></td>
            <td id='PC15'></td>
        </tr>
    </tbody>
</table>
`
const PPUregistersTable = 
`
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
            <td id="PPUCTRL7"></td>
            <td id="PPUCTRL6"></td>
            <td id="PPUCTRL5"></td>
            <td id="PPUCTRL4"></td>
            <td id="PPUCTRL3"></td>
            <td id="PPUCTRL2"></td>
            <td id="PPUCTRL1"></td>
            <td id="PPUCTRL0"></td>
        </tr>
        <tr> 
            <td class='addressClass'>PPU [CTRL2]</td>
            <td id="PPUMASK7"></td>
            <td id="PPUMASK6"></td>
            <td id="PPUMASK5"></td>
            <td id="PPUMASK4"></td>
            <td id="PPUMASK3"></td>
            <td id="PPUMASK2"></td>
            <td id="PPUMASK1"></td>
            <td id="PPUMASK0"></td>
        </tr>
        <tr> 
            <td class='addressClass'>PPU [SR]</td>
            <td id="PPUSTATUS7"></td>
            <td id="PPUSTATUS6"></td>
            <td id="PPUSTATUS5"></td>
            <td id="PPUSTATUS4"></td>
            <td id="PPUSTATUS3"></td>
            <td id="PPUSTATUS2"></td>
            <td id="PPUSTATUS1"></td>
            <td id="PPUSTATUS0"></td>
        </tr>
        <tr> 
            <td class='addressClass'>SPR-RAM [ADDR]</td>
            <td id="OAMADDR7"></td>
            <td id="OAMADDR6"></td>
            <td id="OAMADDR5"></td>
            <td id="OAMADDR4"></td>
            <td id="OAMADDR3"></td>
            <td id="OAMADDR2"></td>
            <td id="OAMADDR1"></td>
            <td id="OAMADDR0"></td>
        </tr>
        <tr> 
            <td class='addressClass'>SPR-RAM [I/O]</td>
            <td id="OAMDATA7"></td>
            <td id="OAMDATA6"></td>
            <td id="OAMDATA5"></td>
            <td id="OAMDATA4"></td>
            <td id="OAMDATA3"></td>
            <td id="OAMDATA2"></td>
            <td id="OAMDATA1"></td>
            <td id="OAMDATA0"></td>
        </tr>
        <tr> 
            <td class='addressClass'>VRAM [ADDR1]</td>
            <td id="PPUADDR_HIGH7"></td>
            <td id="PPUADDR_HIGH6"></td>
            <td id="PPUADDR_HIGH5"></td>
            <td id="PPUADDR_HIGH4"></td>
            <td id="PPUADDR_HIGH3"></td>
            <td id="PPUADDR_HIGH2"></td>
            <td id="PPUADDR_HIGH1"></td>
            <td id="PPUADDR_HIGH0"></td>
        </tr>
        <tr> 
            <td class='addressClass'>VRAM [ADDR2]</td>
            <td id="PPUADDR_LOW7"></td>
            <td id="PPUADDR_LOW6"></td>
            <td id="PPUADDR_LOW5"></td>
            <td id="PPUADDR_LOW4"></td>
            <td id="PPUADDR_LOW3"></td>
            <td id="PPUADDR_LOW2"></td>
            <td id="PPUADDR_LOW1"></td>
            <td id="PPUADDR_LOW0"></td>
        </tr>
        <tr> 
            <td class='addressClass'>VRAM [I/O]</td>
            <td id="PPUDATA7"></td>
            <td id="PPUDATA6"></td>
            <td id="PPUDATA5"></td>
            <td id="PPUDATA4"></td>
            <td id="PPUDATA3"></td>
            <td id="PPUDATA2"></td>
            <td id="PPUDATA1"></td>
            <td id="PPUDATA0"></td>
        </tr>
    </tbody>
</table>
`
const label = document.querySelector('a');
if (label) {
  const dropdown = document.createElement("select");
  dropdown.id = "ramJumpSelect";
  dropdown.style.fontSize = "12px";
  dropdown.style.marginRight = "10px";

  // Expanded to include all meaningful intercepted NES offsets
  const jumpTargets = [
    { label: "Jump to...", offset: null, range: 0 },
    { label: "Zero Page ($0000)", offset: 0x0000, range: 0x80 },
    { label: "Temp Vars ($0004)", offset: 0x0004, range: 0x10 },
    { label: "Stack ($0100)", offset: 0x0100, range: 0x100 },
    { label: "Input ($0200)", offset: 0x0200, range: 0x20 },
    { label: "General Use ($0300)", offset: 0x0300, range: 0x100 },
    { label: "VRAM Buffers ($0400)", offset: 0x0400, range: 0x100 },
    { label: "Sprite Buffers ($0500)", offset: 0x0500, range: 0x100 },
    { label: "Scroll Vars ($0600)", offset: 0x0600, range: 0x20 },
    { label: "RAM End ($07F0)", offset: 0x07F0, range: 0x10 },
    { label: "NMI Vector ($07FA–$07FF)", offset: 0x07FA, range: 0x06 },

    // NES PPU registers (primary and mirrors)
    { label: "PPU Registers ($2000–$2007)", offset: 0x2000, range: 8 },
    { label: "PPU Reg Mirror ($2008–$200F)", offset: 0x2008, range: 8 },
    { label: "PPU Reg Mirror ($2010–$2017)", offset: 0x2010, range: 8 },
    { label: "PPU Reg Mirror ($3FF8–$3FFF)", offset: 0x3FF8, range: 8 },

    // Palette RAM
    { label: "Palette RAM ($3F00–$3F1F)", offset: 0x3F00, range: 0x20 },
    { label: "Palette Mirror ($3F20–$3FFF)", offset: 0x3F20, range: 0xFE0 }, // mirrors for palette RAM
    // Individual handy palette strips, as before
    { label: "Palette 1 ($3F01–$3F03)", offset: 0x3F01, range: 0x03 },
    { label: "Palette 2 ($3F05–$3F07)", offset: 0x3F05, range: 0x03 },
    { label: "Palette 3 ($3F09–$3F0B)", offset: 0x3F09, range: 0x03 },
  ];

  // Build dropdown options
  for (const { label: text, offset, range } of jumpTargets) {
    const option = document.createElement("option");
    option.value = offset !== null ? `${offset}|${range}` : "";
    option.textContent = text;
    dropdown.appendChild(option);
  }

  // On dropdown change
  dropdown.addEventListener("change", function () {
    const val = this.value;
    if (!val) return;

    const [baseOffsetStr, rangeStr] = val.split("|");
    const baseOffset = parseInt(baseOffsetStr);
    const range = parseInt(rangeStr);

    // Otherwise scroll & highlight RAM cells
    for (let i = 0; i < range; i++) {
      const id = `wram-${baseOffset + i}`;
      const cell = document.getElementById(id);
      if (cell) {
        if (i === 0) cell.scrollIntoView({ behavior: "smooth", block: "center" });
        cell.style.backgroundColor = "#ffd700";
        setTimeout(() => (cell.style.backgroundColor = ""), 1000);
      }
    }
    this.value = "";
  });

  // Prepend dropdown to Work RAM label
  label.prepend(dropdown);
}

// === Handy Offset Dropdown for PRG-ROM cells ===
const romLabel = Array.from(document.querySelectorAll("b"))
  .find(el => el.textContent.includes("PRG-ROM"));

if (romLabel) {
  const romDropdown = document.createElement("select");
  romDropdown.id = "romJumpSelect";
  romDropdown.style.fontSize = "12px";
  romDropdown.style.marginRight = "10px";

  // Handy PRG-ROM locations for homebrew and hacking
  const romOptions = [
    { label: "Jump to...", offset: null },
    { label: "Reset Vector ($FFFC–$FFFD)", offset: 0xFFFC, range: 2, prefix: "cartSpaceTwoID-" },
    { label: "NMI Vector ($FFFA–$FFFB)", offset: 0xFFFA, range: 2, prefix: "cartSpaceTwoID-" },
    { label: "IRQ/BRK Vector ($FFFE–$FFFF)", offset: 0xFFFE, range: 2, prefix: "cartSpaceTwoID-" },
    { label: "PRG-ROM Bank 1: $8000–$BFFF (16KB)", offset: 0x8000, range: 0x4000, prefix: "cartSpaceOneID-" },
    { label: "PRG-ROM Bank 2: $C000–$FFFF (16KB)", offset: 0xC000, range: 0x4000, prefix: "cartSpaceTwoID-" }
  ];

  romOptions.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt.offset !== null ? JSON.stringify(opt) : "";
    option.textContent = opt.label;
    romDropdown.appendChild(option);
  });

  romDropdown.addEventListener("change", function () {
    if (!this.value) return;
    const { offset, range, prefix } = JSON.parse(this.value);
    for (let i = 0; i < range; i++) {
      const id = `${prefix}${offset + i}`;
      const target = document.getElementById(id);
      if (target) {
        if (i === 0) target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.style.backgroundColor = "#90EE90";
      }
    }
    setTimeout(() => {
      for (let i = 0; i < range; i++) {
        const id = `${prefix}${offset + i}`;
        const t = document.getElementById(id);
        if (t) t.style.backgroundColor = "";
      }
    }, 1000);
    this.value = "";
  });

  // Insert the dropdown before the PRG-ROM label
  romLabel.prepend(romDropdown);
}
