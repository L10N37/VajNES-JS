const hexPrefix=['0x'];

// WRAM table area
let insertDebugTable= document.createElement('table');
  insertDebugTable.className= 'GeneratedTable';
    let debugSection = document.querySelector('.debug');
      debugSection.appendChild(insertDebugTable);

insertDebugTable.innerHTML = WRAM_Table;

// Memory Page 8 area
insertDebugTable= document.createElement('table');
  insertDebugTable.className= 'GeneratedTable';
     debugSection = document.querySelector('.debug2');
        debugSection.appendChild(insertDebugTable);

insertDebugTable.innerHTML = pgRom_Table;

// all cells for memory bytes have an ID (and PG-ROM) after this section
let ramBytes = document.querySelectorAll('td');
let y = 17;
let deduct = 1;

for (let i = 0; i < ramBytes.length; i++) {
  // add background color class to cells within $0000-$00FF (zpg WRAM area)
  if (i < 256 && i % 17 == 0 ) {
    ramBytes[i].classList.add('zpg-cells');
  }
  if (i >= 256 && i < 512 && i % 17 == 0 ) {
    // add background color class to the next 256 cells (stack WRAM area)
    ramBytes[i].classList.add('stack-cells');
  }
  // assign IDs to cells based on their position in the RAMBytes array
  if (i != 0 && i < 17) {
    ramBytes[i].id = 'ramByte' + i;
  }
  if (i > y && i < y + 17) {
    ramBytes[i].id = 'ramByte' + (i - deduct);
  }
  if (i % 17 == 0 && i > 17) {
    deduct++;
    y += 17;
  }
}
// create array of ID's for the RAM byte cells
  let workRamIdArray = [];
    for (let i= 1; i < 2305; i++) {
      workRamIdArray.push('ramByte'+i)
      }

      // populate the cells with RAM contents, add click event to memory locations
      for (let i= 0; i < 2304; i++) {
        document.getElementById(workRamIdArray[i]).innerText= memoryMap[i]+'h';
          document.getElementById(workRamIdArray[i]).addEventListener("click", function(event) {
            // index in hex!
              document.querySelector('locContainer').innerHTML='&nbsp'+hexPrefix+i.toString(16);
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
  
  // populate the cells with the flag bits
  for (let i = 0; i < 8; i++) {
    document.getElementById(flagBitsIDArray[i]).innerText= CPUregisters.P[P_VARIABLES[i]];
  }

  function readFile(input) {
    let file = input.files[0];
    let extension = file.name.split('.').pop().toLowerCase();
    
    if (extension !== 'nes') {
      console.error('Invalid file type. Please select a NES ROM file.');
      return;
    }
    
    let reader = new FileReader();
      reader.readAsArrayBuffer(file);
        reader.onload = function() {
          const gameROM = reader.result;
            console.log(file.name + " loaded");
                loadedROM = new Uint8Array(gameROM);
      // Check for NES header
      let nesHeader = new Uint8Array(gameROM.slice(0, 16));
      if (nesHeader[0] !== 0x4E || nesHeader[1] !== 0x45 || nesHeader[2] !== 0x53 || nesHeader[3] !== 0x1A) {
        console.warn('ROM file does not contain a valid NES header.');
      }
      
      console.log(nesHeader);

      let header = {};
      
      if (nesHeader[0] !== 0x4E || nesHeader[1] !== 0x45 || nesHeader[2] !== 0x53 || nesHeader[3] !== 0x1A) {
        console.warn('ROM file does not contain a valid NES header.');
      } else {
        header = {
          1: nesHeader[0].toString(),
          2: nesHeader[1].toString(),
          3: nesHeader[2].toString(),
          4: nesHeader[3].toString(),
          5: nesHeader[4].toString(),
          6: nesHeader[5].toString(),
          7: nesHeader[6].toString(),
          8: nesHeader[7].toString(),
          9: nesHeader[8].toString(),
          10: nesHeader[9].toString(),
          11: nesHeader[10].toString(),
          12: nesHeader[11].toString(),
          13: nesHeader[12].toString(),
          14: nesHeader[13].toString(),
          15: nesHeader[14].toString(),
          16: nesHeader[15].toString()
        };
      }
      
  // Header information click event, extra code to ensure amount of files loaded != amount of times the alert pops up on a click
  const headerButton = document.getElementById('header-button');
  // check if click event handler has already been added
  if (!headerButton.dataset.clickEventAdded) {
  // add a new click event listener
  headerButton.addEventListener('click', headerButtonClickHandler);
  // set the data attribute to indicate that the event listener has been added
  headerButton.dataset.clickEventAdded = true;
  }

// define the click event handler function
function headerButtonClickHandler() {
    headerInfo(header);
}

function headerInfo(header) {
  let system = String.fromCharCode(header[0], header[1], header[2]) === 'NES' && header[3] === 0x1A ? 'Unknown' : 'NES';

  let prgRomSize = header[4];
  let chrRomSize = header[5];
  let miscFlags = [header[11], header[12], header[13], header[15], header[15]];

  let prgRomSize16KB = (prgRomSize * 16) + ' KB';
  let chrRomSize8KB = (chrRomSize * 8) + ' KB';
  let mapperNumber = ((header[6] >> 4) | (header[7] & 0xF0));
  let mirroring = ((header[6] & 1) ? 'Vertical' : 'Horizontal');
  let batteryBacked = ((header[6] & 2) ? 'Yes' : 'No');
  let trainer = ((header[6] & 4) ? 'Yes' : 'No');
  let vsPlaychoice = ((header[10] & 1) ? 'Yes' : 'No');
  let nes2 = ((header[10] & 0x0C) ? 'Yes' : 'No');

  let info = 'System: ' + system + '\n' +
             'PRG ROM Size: ' + prgRomSize16KB + '\n' +
             'CHR ROM Size: ' + chrRomSize8KB + ' - ' + (chrRomSize === 0 ? 'Uses CHR RAM' : 'Uses CHR ROM') + '\n' +
             'Mapper Number: ' + mapperNumber + '\n' +
             'Mirroring: ' + mirroring + '\n' +
             'Battery-Backed: ' + batteryBacked + '\n' +
             'Trainer: ' + trainer + '\n' +
             'VS/Playchoice: ' + vsPlaychoice + '\n' +
             'NES 2.0: ' + nes2 + '\n' +
             'Misc Flags: ' + miscFlags.join(' ') + '\n';

  window.alert(info);
}

      // Display the ROM as HEX values
      console.log(file.name + " data: ");
      console.log(Array.from(loadedROM, byte => hexPrefix + byte.toString(16).padStart(2, '0')).join(' '));

      // Create instruction / step section now that a ROM is loaded
      let instructionSection = document.querySelector('.instruction-step');
      // Erase the container in case of reloads of ROMS
      instructionSection.innerHTML = ``;
      let insertInstructionArea = document.createElement('table');
      insertInstructionArea.className = 'GeneratedTable';
      instructionSection.appendChild(insertInstructionArea);
  
      insertInstructionArea.innerHTML = instructionStepTable;

    };
  
    reader.onerror = function() {
      console.log(reader.error);
    };
  }

function getOpcodeAndAddressingMode(numericValue) {
  for (const opcode in opcodes) {
    const addressingModes = opcodes[opcode];
    for (const addressingMode in addressingModes) {
      const opcodeInfo = addressingModes[addressingMode];
      if (opcodeInfo.code === numericValue) {
        return { 
          opcode, 
          addressingMode, 
          length: opcodeInfo.length, 
          pcIncrement: opcodeInfo.pcIncrement,
          hex: "0x" + opcodeInfo.code.toString(16).toUpperCase().padStart(2, '0')
        };
      }
    }
  }
  return null;
}

function step(){

  console.log(`memoryMap 0x8000 byte: ${memoryMap[0x8000]}`);
  // fetch instructions object
  const currentInstruction = getOpcodeAndAddressingMode(parseInt(loadedROM[PC],16));
  // destructure
  const {opcode, addressingMode, length, pcIncrement, hex } = currentInstruction;

  // debug info
  console.log(currentInstruction);

  // fill the instruction cell with the necessary object data
  document.getElementById('instruction').innerText=`${hex}${':'} ${opcode} ${'/'} ${addressingMode}`;

  // fill operand cell with operand/s if any
  let operand1;
  let operand2;
  if (length==1) {
   operand1= ' ';
   document.getElementById('operand').innerText=`${length-1}${':'} ${operand1}`;
  }
  else if (length==2){
   operand1= hexPrefix+loadedROM[PC+1];
   document.getElementById('operand').innerText=`${length-1}${':'} ${operand1}`;
  }
  else if (length==3) {
    operand1= hexPrefix+loadedROM[PC+1];
    operand2= hexPrefix+loadedROM[PC+2];
    document.getElementById('operand').innerText=`${length-1}${':'} ${operand1}${','}${operand2}`;
  }

  //check current opcode
  const instructionCell = document.getElementById("instruction");
    const instructionText = instructionCell.textContent.trim();
    // Extract the hex value from the instruction text
      const hexValue = instructionText.split(":")[0];
        // opcodes either store as text '0x00' in switch or convert to hex, probably best to convert for future
        console.log(`Processed 6502 instruction: ${hexValue}`);
          opcodeSwitch(parseInt(hexValue,16), opcode);

        // update PC counter
        PC+=pcIncrement;

        // move to next instruction (handled by PC above)
        // for debug , add missing opcodes when return 'null'
        // add missing functions, write new ones - C++ ones used macros
        console.log(`Next instruction ${loadedROM[PC]}`);

          // update the debug table
          updateDebugTables();
  }