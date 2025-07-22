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
      ${createTable("$0000", "$07F0", 'wramCells')}
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
    <button class="crt-btn" onclick="step()">STEP</button>
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
