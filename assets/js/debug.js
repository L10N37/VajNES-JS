const hexPrefix=['0x'];

// WRAM table area
let insertDebugTable= document.createElement('table');
  insertDebugTable.className= 'GeneratedTable';
    let debugSection = document.querySelector('.debug');
      debugSection.appendChild(insertDebugTable);

insertDebugTable.innerHTML = WRAM_Table;

// cartridge memory area
insertDebugTable= document.createElement('table');
  insertDebugTable.className= 'GeneratedTable';
     debugSection = document.querySelector('.debug2');
        debugSection.appendChild(insertDebugTable);

insertDebugTable.innerHTML = pgRom_Table;

 // count up our displayed WRAM cells 
 let allWramCells= document.querySelectorAll('.wramCells');
 // Log Check - 2048 == 2Kb of cells == total WRAM size
 console.log(`WRAM cells = ${allWramCells.length} bytes`);
 console.log(`WRAM cells = ${(allWramCells.length / 1024).toFixed(2)} KB`);


// count up our displayed cartridge space cells 
 let allCartSpaceBytes1= document.querySelectorAll('.cartspace1'); 
 let allCartSpaceBytes2= document.querySelectorAll('.cartspace2');
 
 let allCartSpaceBytes = [...allCartSpaceBytes1, ...allCartSpaceBytes2];

// Log Checks 16Kb of cells * 2 == 32768 total bytes PRG-ROM space (2nd half often a mirror of first)
 console.log(`Cartridge1 space cells = ${allCartSpaceBytes1.length} bytes`);
 console.log(`Cartridge2 space cells = ${allCartSpaceBytes2.length} bytes`);
 console.log(`Total Cartridge space = ${(allCartSpaceBytes1.length+allCartSpaceBytes2.length) / 1024} KB`);

 
 // work ram area, set classes and ID + click events in this loop
 for (let i = 0; i < 2048; i++) {
  if (i < 256) {
    allWramCells[i].classList.add('zpg-cells');
  } else if (i < 512) {
    allWramCells[i].classList.add('stack-cells');
  }
  allWramCells[i].setAttribute('id', `wram-${i}`);
  allWramCells[i].addEventListener('click', function() {
    let indexHex = i.toString(16).toUpperCase().padStart(4, '0');
    document.querySelector('locContainer').innerHTML = `&nbsp ${hexPrefix}${indexHex}`;
  });
}

// cart space area, classes already set when table created, IDs and click events assigned here
for (let i = 0; i < allCartSpaceBytes.length; i++) {
  let cartSpaceByte = allCartSpaceBytes[i];
  
  if (i < 16 * 1024) {
    // first 16KB ID assignment
    cartSpaceByte.setAttribute('id', `cartSpaceOneID-${ i + 0x8000 }`);

    // 1st 16KB click event
    cartSpaceByte.addEventListener('click', function() {
      let indexHex1 = ( i + 0x8000 ).toString(16).toUpperCase().padStart(4, '0');
      document.querySelector('locContainer2').innerHTML = `&nbsp ${hexPrefix}${indexHex1}`; 
    });
  } else {
    // second 16KB assignment
    cartSpaceByte.setAttribute('id', `cartSpaceTwoID-${ (i - (16 * 1024)) + 0xC000 }`);

    // 2nd 16KB click event
    cartSpaceByte.addEventListener('click', function() {
      let indexHex2 = ((i - (16 * 1024)) + 0xC000).toString(16).toUpperCase().padStart(4, '0');
      document.querySelector('locContainer2').innerHTML = `&nbsp ${hexPrefix}${indexHex2}`; 
    });
  }
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

  ////////////// READ FILE SECTION //////////////
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
                      
      // Store NES header
      let nesHeader = new Uint8Array(gameROM.slice(0, 16));
      // Check NES header
      if (nesHeader[0] !== 0x4E || nesHeader[1] !== 0x45 || nesHeader[2] !== 0x53 || nesHeader[3] !== 0x1A) {
        console.warn('ROM file does not contain a valid NES header.');
      }
      // Remove the NES header from the loaded ROM
      loadedROM = loadedROM.slice(16);

      function headerInfo(nesHeader) {
        let system = String.fromCharCode(nesHeader[0], nesHeader[1], nesHeader[2]) === 'NES' && nesHeader[3] === 0x1A ? 'NES' : 'Unknown';
        let prgRomSize = nesHeader[4];
        let chrRomSize = nesHeader[5];
        let miscFlags = [nesHeader[6]];
        let mapperNumber = ((nesHeader[6] >> 4) | (nesHeader[7] & 0xF0));
        let mirroring = ((nesHeader[6] & 0x01) ? 'Vertical' : 'Horizontal');
        let batteryBacked = ((nesHeader[6] & 0x02) ? 'Yes' : 'No');
        let trainer = ((nesHeader[6] & 0x04) ? 'Yes' : 'No');
        let fourScreenVram = ((nesHeader[6] & 0x08) ? 'Yes' : 'No');
        let vsPlaychoice = ((nesHeader[10] & 0x01) ? 'Yes' : 'No');
        let nes2 = ((nesHeader[7] & 0x0C) ? 'Yes' : 'No');
        
        if (miscFlags[0] & 0x01) miscFlags.push('VS Unisystem');
        if (miscFlags[0] & 0x02) miscFlags.push('Playchoice-10');
        
        let prgRomSizeKB = (prgRomSize * 16) + ' KB';
        let chrRomSizeKB = (chrRomSize * 8) + ' KB';
        
        let info = 'System: ' + system + '\n' +
                   'PRG ROM Size: ' + prgRomSizeKB + '\n' +
                   'CHR ROM Size: ' + chrRomSizeKB + ' - ' + (chrRomSize === 0 ? 'Uses CHR RAM' : 'Uses CHR ROM') + '\n' +
                   'Mapper Number: ' + mapperNumber + '\n' +
                   'Mirroring: ' + mirroring + '\n' +
                   'Battery-Backed: ' + batteryBacked + '\n' +
                   'Trainer: ' + trainer + '\n' +
                   'Four Screen VRAM: ' + fourScreenVram + '\n' +
                   'VS/Unisystem: ' + vsPlaychoice + '\n' +
                   'NES 2.0: ' + nes2 + '\n' +
                   'Misc Flags: ' + miscFlags.join(' ') + '\n';
        
        window.alert(info);
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
          headerInfo(nesHeader);
      }
          // Display the ROM as HEX values
          console.log(`${file.name }${` data:`} ${Array.from(loadedROM, asHex => hexPrefix + asHex.toString(16).padStart(2, '0')).join(' ')}`);

        // Move necessary ROM data to cart space area, mirror if necessary (Will need updating per Mapper suppported)
        for (let i = 0; i < memoryMap.prgRomLower.size; i++) {
          systemMemory[memoryMap.prgRomLower.addr + i] = loadedROM[i];
          }
          updateDebugTables(allWramCells, allCartSpaceBytes);

      

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

      function updateDebugTables(allWramCells, allCartSpaceBytes){
      // populate the cells with the flag bits
      for (let i = 0; i < 8; i++) {
        document.getElementById(flagBitsIDArray[i]).innerText= CPUregisters.P[P_VARIABLES[i]];
        }

      // update RAM debug cells with new data
      for (let i = 0; i < allWramCells.length; i++) {
        allWramCells[i].innerText = `${systemMemory[i].toString(16).padStart(2, '0')}h`;
      }

      // update cart space area
      for (let i = memoryMap.prgRomLower.addr; i < memoryMap.prgRomLower.size + memoryMap.prgRomLower.addr; i++) {
        allCartSpaceBytes[i - memoryMap.prgRomLower.addr].innerText = `${systemMemory[i].toString(16).padStart(2, '0')}h`;
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

      function step() {

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