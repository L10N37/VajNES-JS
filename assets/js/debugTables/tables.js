function incrementAddress(address, endAddress) {
  let hexValue = parseInt(address.substring(1), 16);
  let hexValueEnd = parseInt(address.substring(1), 16);
  hexValue += 16;
  if (hexValue > 0xBFFF) {
    return null;
  }
  return "$" + hexValue.toString(16).toUpperCase().padStart(4, '0');
}

function createTable(startAddress, endAddress) {
  let rows = [];
  let currentAddress = startAddress;
  while (currentAddress !== endAddress) {
    rows.push(`
      <tr>
        <td class="addressClass">${currentAddress}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      </tr>
    `);
    currentAddress = incrementAddress(currentAddress, endAddress);
    if (currentAddress === null) {
      break;
    }
  }
  rows.push(`
    <tr>
      <td class="addressClass">${endAddress}</td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  `);

  return `<table>${rows.join('')}</table>`;
}

const WRAM_Table =
`
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
`
+ createTable( "$0000", "$07F0");
`
  </tbody>
  </table>
`;

let pgRom_Table = // $8000-$FFFF
`
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
`
+ createTable( "$8000", "$BFFF");
`
  </tbody>
  </table>
`;


        let instructionStepTable=`
        <table>
        <thead>
        <tr>
        <th class='addressClass'>Instruction</th>
        </tr>
        </thead>
        <tbody>
        <tr> 
        <td id= 'instruction'></td>
        </tr>
        <tr>
        <td><button class='stepButton' type="button" onclick="step()">STEP</button></td>
        </tr>
        </tbody>
        <thead>
        <tr>
        <th class='addressClass'>Operand/s</th>
        </tr>
        </thead>
        <tbody>
        <tr> 
        <td id= 'operand'></td>
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
        `;
        

      function updateDebugTables(){
        // populate the cells with the flag bits
        for (let i = 0; i < 8; i++) {
          document.getElementById(flagBitsIDArray[i]).innerText= CPUregisters.P[P_VARIABLES[i]];
          }
        
        // update RAM debug cells with new data
        for (let i= 0; i < 2304; i++) {
        document.getElementById(workRamIdArray[i]).innerText= memoryMap[i]+'h';
        }
      
      // the binary string always has a length of 8 characters, padded with zeroes if necessary. 
      let A_Binary = A.toString(2).padStart(8, '0').split('').map(bit => parseInt(bit));
      let X_Binary = X.toString(2).padStart(8, '0').split('').map(bit => parseInt(bit));
        let Y_Binary = Y.toString(2).padStart(8, '0').split('').map(bit => parseInt(bit));
          let S_Binary = S.toString(2).padStart(8, '0').split('').map(bit => parseInt(bit));
      
      // insert register bits into the corresponding cells
      for (let i = 0; i < 8; i++) {
      document.getElementById(regArrayA[i]).innerText= A_Binary[i];
        document.getElementById(regArrayX[i]).innerText= X_Binary[i];
          document.getElementById(regArrayY[i]).innerText= Y_Binary[i];
            document.getElementById(regArrayS[i]).innerText= S_Binary[i];
            }
      
      let PC_asBinary = PC.toString(2).padStart(16, '0').split('').map(bit => parseInt(bit));
        for (let i = 0; i < 16; i++) {
          document.getElementById(regArrayPC[i]).innerText= PC_asBinary[i];
          }
        }