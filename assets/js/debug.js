let insertDebugTable= document.createElement('table');
  insertDebugTable.className= 'GeneratedTable';
    let debugSection = document.querySelector('.debug');
      debugSection.appendChild(insertDebugTable);

insertDebugTable.innerHTML = WRAM_Table;

  // all 2048 bytes in work RAM have an ID from ramBytes1 to ramBytes2048 after this section
  let ramBytes = document.querySelectorAll('td');
    let y = 17;
      let deduct = 1;

  for (i = 0; i < ramBytes.length; i++) {
    // dont assign the first cell or every vertical hex location cell after that an ID
    if (i!=0 && i<17) ramBytes[i].id='ramByte'+i;
    if (i>y && i<y+17) ramBytes[i].id='ramByte'+(i-deduct);
    if(i%17==0 && i > 17){
      deduct++;
      y+=17;
    } 
  }
// create array of ID's for the RAM byte cells
  let workRamIdArray = [];
    for (let i= 1; i < 2049; i++) {
      workRamIdArray.push('ramByte'+i)
      }
// populate the cells with RAM contents, add click event to memory locations
for (let i= 0; i < 2048; i++) {
  document.getElementById(workRamIdArray[i]).innerText= systemWorkRam[i]+'h';
  document.getElementById(workRamIdArray[i]).addEventListener("click", function(event) {
  // index in hex!
  document.querySelector('byteContainer').innerHTML= '&nbsp'+ '0x'+ i.toString(16);
  })
  }

  // Registers Section, manual ID allocation
  let insertRegistersTable= document.createElement('table');
    insertRegistersTable.className= 'GeneratedTable';
      let registerSection = document.querySelector('.CPU-registers');
        registerSection.appendChild(insertRegistersTable);

        insertRegistersTable.innerHTML = registersTable;
        
// create array of ID's for each CPU register
const regArrayA = ['A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0'];
  const regArrayX = ['X7', 'X6', 'X5', 'X4', 'X3', 'X2', 'X1', 'X0'];
    const regArrayY = ['Y7', 'Y6', 'Y5', 'Y4', 'Y3', 'Y2', 'Y1', 'Y0'];
      const regArrayS = ['S7', 'S6', 'S5', 'S4', 'S3', 'S2', 'S1', 'S0'];
        const regArrayPC = Array.from({ length: 16 }, (_, i) => `PC${i}`);

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

  // flag registers section
  let insertFlagRegisterTable= document.createElement('table');
    insertFlagRegisterTable.className= 'GeneratedTable';
      let flagRegisterSection = document.querySelector('.flag-register');
        flagRegisterSection.appendChild(insertFlagRegisterTable);

        insertFlagRegisterTable.innerHTML = FlagRegisterTable;
  
  // create ID array of flag bits (P0 to P7)
  let flagBitsIDArray = [];
  for (let i = 0; i < 8; i++) {
    flagBitsIDArray.push('P'+i);
  }
  console.log(CPUregisters.P[4]);
  // populate the cells with the flag bits
  for (let i = 0; i < 8; i++) {
    document.getElementById(flagBitsIDArray[i]).innerText= CPUregisters.P[P_VARIABLES[i]];
  }

  let ROM=[];

// read in a ROM file
// TO DO: add file extension check, throw an error if not ending with '.nes'
function readFile(input) {
  let file = input.files[0];

  let reader = new FileReader();
  reader.readAsArrayBuffer(file);
  reader.onload = function() {
  
  const gameROM = (reader.result);
  console.log(file.name + " loaded");
  console.log(gameROM);

  let dataview = new DataView(gameROM);
  
  for (let i = 0; i < dataview.byteLength; i++) {
    loadedROM[i]=dataview.getUint8(i);
  }
  console.log(loadedROM);

  // create instruction / step section now that a ROM is loaded
  let insertInstructionArea= document.createElement('table');
    insertInstructionArea.className= 'GeneratedTable';
      let instructionSection = document.querySelector('.instruction-step');
        instructionSection.appendChild(insertInstructionArea);

        insertInstructionArea.innerHTML = `
        <thead>
        <tr>
        <th class='addressClass'>Instruction</th>
        </tr>
        </thead>
        <tbody>
        <tr> 
        <td id= 'byte'> ${hexPrefix}${loadedROM[0]} </td>
        </td> 
        </tr>
        <button class='stepButton' type="button" onclick="step()">STEP</button>
        `
  };

  reader.onerror = function() {
    console.log(reader.error);
  };
}

function step(){
  
  let hexValue = document.getElementById('byte').innerText;
  let numericValue = parseInt(hexValue, 16); // convert hex string to number
  console.log(numericValue);
  cycle(getOpcodeAndAddressingMode(numericValue));
  
  
  function getOpcodeAndAddressingMode(numericValue) {
    for (const opcode in opcodes) {
      const addressingModes = opcodes[opcode];
      for (const addressingMode in addressingModes) {
        const opcodeInfo = addressingModes[addressingMode];
        if (opcodeInfo.code === numericValue) {
          return { opcode, addressingMode, length: opcodeInfo.length, pcIncrement: opcodeInfo.pcIncrement };
        }
      }
    }
    return null;
  }

  function cycle(opcodeObject){
  // destructure received opcode object
  const { addressingMode, length, opcode, pcIncrement } = opcodeObject;
  PC+=pcIncrement;
  console.log(PC);


  }
}