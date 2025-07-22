const hexPrefix = ['0x'];

//-------- run and pause ---------//
let runInterval = null;

function run() {
  if (!runInterval) {
    runInterval = setInterval(step, 16); // ~60Hz
  }
}

function pause() {
  if (runInterval) {
    clearInterval(runInterval);
    runInterval = null;
  }
}
// -------------------------------//

// WRAM table area
let insertDebugTable = document.createElement('table');
insertDebugTable.className = 'GeneratedTable';
let debugSection = document.querySelector('.debug');
debugSection.appendChild(insertDebugTable);

insertDebugTable.innerHTML = WRAM_Table;

// cartridge memory area
insertDebugTable = document.createElement('table');
insertDebugTable.className = 'GeneratedTable';
debugSection = document.querySelector('.debug2');
debugSection.appendChild(insertDebugTable);

insertDebugTable.innerHTML = pgRom_Table;

// count up our displayed WRAM cells 
let allWramCells = document.querySelectorAll('.wramCells');
// Log Check - 2048 == 2Kb of cells == total WRAM size
console.log(`WRAM cells = ${allWramCells.length} bytes`);
console.log(`WRAM cells = ${(allWramCells.length / 1024).toFixed(2)} KB`);

// count up our displayed cartridge space cells 
let allCartSpaceBytes1 = document.querySelectorAll('.cartspace1');
let allCartSpaceBytes2 = document.querySelectorAll('.cartspace2');

let allCartSpaceBytes = [...allCartSpaceBytes1, ...allCartSpaceBytes2];

// Log Checks 16Kb of cells * 2 == 32768 total bytes PRG-ROM space (2nd half often a mirror of first)
console.log(`Cartridge1 space cells = ${allCartSpaceBytes1.length} bytes`);
console.log(`Cartridge2 space cells = ${allCartSpaceBytes2.length} bytes`);
console.log(`Total Cartridge space = ${(allCartSpaceBytes1.length + allCartSpaceBytes2.length) / 1024} KB`);

// work ram area, set classes and ID + click events in this loop
for (let i = 0; i < 2048; i++) {
  if (i < 256) {
    allWramCells[i].classList.add('zpg-cells');
  } else if (i < 512) {
    allWramCells[i].classList.add('stack-cells');
  }
  allWramCells[i].setAttribute('id', `wram-${i}`);
  allWramCells[i].addEventListener('click', function () {
    let indexHex = i.toString(16).toUpperCase().padStart(4, '0');
    document.querySelector('locContainer').innerHTML = `&nbsp ${hexPrefix}${indexHex}`;
  });
}

// cart space area, classes already set when table created, IDs and click events assigned here
for (let i = 0; i < allCartSpaceBytes.length; i++) {
  let cartSpaceByte = allCartSpaceBytes[i];

  if (i < 16 * 1024) {
    // first 16KB ID assignment
    cartSpaceByte.setAttribute('id', `cartSpaceOneID-${i + 0x8000}`);

    // 1st 16KB click event
    cartSpaceByte.addEventListener('click', function () {
      let indexHex1 = (i + 0x8000).toString(16).toUpperCase().padStart(4, '0');
      document.querySelector('locContainer2').innerHTML = `&nbsp ${hexPrefix}${indexHex1}`;
    });
  } else {
    // second 16KB assignment
    cartSpaceByte.setAttribute('id', `cartSpaceTwoID-${(i - (16 * 1024)) + 0xC000}`);

    // 2nd 16KB click event
    cartSpaceByte.addEventListener('click', function () {
      let indexHex2 = ((i - (16 * 1024)) + 0xC000).toString(16).toUpperCase().padStart(4, '0');
      document.querySelector('locContainer2').innerHTML = `&nbsp ${hexPrefix}${indexHex2}`;
    });
  }
}

// CPU Registers Section, manual ID allocation
let insertRegistersTable = document.createElement('table');
insertRegistersTable.className = 'GeneratedTable';
let registerSection = document.querySelector('.CPU-registers');
registerSection.appendChild(insertRegistersTable);

insertRegistersTable.innerHTML = registersTable;

// PPU Registers Section
insertRegistersTable = document.createElement('table');
insertRegistersTable.className = 'GeneratedTable';
registerSection = document.querySelector('.PPU-registers');
registerSection.appendChild(insertRegistersTable);

insertRegistersTable.innerHTML = PPUregistersTable;


// create array of ID's for each CPU register
const regArrayA = ['A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0'];
const regArrayX = ['X7', 'X6', 'X5', 'X4', 'X3', 'X2', 'X1', 'X0'];
const regArrayY = ['Y7', 'Y6', 'Y5', 'Y4', 'Y3', 'Y2', 'Y1', 'Y0'];
const regArrayS = ['S7', 'S6', 'S5', 'S4', 'S3', 'S2', 'S1', 'S0'];
const regArrayPC = Array.from({ length: 16 }, (_, i) => `PC${i}`);

// create array of ID's for each PPU register
const regArrayPPUCTRL     = ['PPUCTRL7','PPUCTRL6','PPUCTRL5','PPUCTRL4','PPUCTRL3','PPUCTRL2','PPUCTRL1','PPUCTRL0'];
const regArrayPPUMASK     = ['PPUMASK7','PPUMASK6','PPUMASK5','PPUMASK4','PPUMASK3','PPUMASK2','PPUMASK1','PPUMASK0'];
const regArrayPPUSTATUS   = ['PPUSTATUS7','PPUSTATUS6','PPUSTATUS5','PPUSTATUS4','PPUSTATUS3','PPUSTATUS2','PPUSTATUS1','PPUSTATUS0'];
const regArrayOAMADDR     = ['OAMADDR7','OAMADDR6','OAMADDR5','OAMADDR4','OAMADDR3','OAMADDR2','OAMADDR1','OAMADDR0'];
const regArrayOAMDATA     = ['OAMDATA7','OAMDATA6','OAMDATA5','OAMDATA4','OAMDATA3','OAMDATA2','OAMDATA1','OAMDATA0'];
const regArrayPPUSCROLL_X = ['PPUSCROLL_X7','PPUSCROLL_X6','PPUSCROLL_X5','PPUSCROLL_X4','PPUSCROLL_X3','PPUSCROLL_X2','PPUSCROLL_X1','PPUSCROLL_X0'];
const regArrayPPUSCROLL_Y = ['PPUSCROLL_Y7','PPUSCROLL_Y6','PPUSCROLL_Y5','PPUSCROLL_Y4','PPUSCROLL_Y3','PPUSCROLL_Y2','PPUSCROLL_Y1','PPUSCROLL_Y0'];
const regArrayPPUADDR_HIGH= ['PPUADDR_HIGH7','PPUADDR_HIGH6','PPUADDR_HIGH5','PPUADDR_HIGH4','PPUADDR_HIGH3','PPUADDR_HIGH2','PPUADDR_HIGH1','PPUADDR_HIGH0'];
const regArrayPPUADDR_LOW = ['PPUADDR_LOW7','PPUADDR_LOW6','PPUADDR_LOW5','PPUADDR_LOW4','PPUADDR_LOW3','PPUADDR_LOW2','PPUADDR_LOW1','PPUADDR_LOW0'];
const regArrayPPUDATA     = ['PPUDATA7','PPUDATA6','PPUDATA5','PPUDATA4','PPUDATA3','PPUDATA2','PPUDATA1','PPUDATA0'];

// flag registers section
let insertFlagRegisterTable = document.createElement('table');
insertFlagRegisterTable.className = 'GeneratedTable';
let flagRegisterSection = document.querySelector('.flag-register');
flagRegisterSection.appendChild(insertFlagRegisterTable);

insertFlagRegisterTable.innerHTML = FlagRegisterTable;

// create ID array of flag bits (P0 to P7)
let flagBitsIDArray = [];
for (let i = 0; i < 8; i++) {
  flagBitsIDArray.push('P' + i);
}

// populate the cells with the flag bits
for (let i = 0; i < 8; i++) {
  document.getElementById(flagBitsIDArray[i]).innerText = CPUregisters.P[P_VARIABLES[i]];
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
  reader.onload = function () {
    const gameROM = reader.result;
    console.log(file.name + " loaded");
    loadedROM = new Uint8Array(gameROM);

    // Store NES header
    let nesHeader = new Uint8Array(gameROM.slice(0, 16));
    // Check NES header
    if (
      nesHeader[0] !== 0x4E ||
      nesHeader[1] !== 0x45 ||
      nesHeader[2] !== 0x53 ||
      nesHeader[3] !== 0x1A
    ) {
      console.warn('ROM file does not contain a valid NES header.');
    }
    // Remove the NES header from the loaded ROM
    loadedROM = loadedROM.slice(16);
    console.log(`File size (header removed): ${(loadedROM.length / 1024).toFixed(2)} KB`);

    function headerInfo(nesHeader) {
      let system =
        String.fromCharCode(nesHeader[0], nesHeader[1], nesHeader[2]) === 'NES' &&
          nesHeader[3] === 0x1A
          ? 'NES'
          : 'Unknown';
      let prgRomSize = nesHeader[4];
      let chrRomSize = nesHeader[5];
      let miscFlags = [nesHeader[6]];
      let mapperNumber = (nesHeader[6] >> 4) | (nesHeader[7] & 0xf0);
      let mirroring = (nesHeader[6] & 0x01) ? 'Vertical' : 'Horizontal';
      let batteryBacked = (nesHeader[6] & 0x02) ? 'Yes' : 'No';
      let trainer = (nesHeader[6] & 0x04) ? 'Yes' : 'No';
      let fourScreenVram = (nesHeader[6] & 0x08) ? 'Yes' : 'No';
      let vsPlaychoice = (nesHeader[10] & 0x01) ? 'Yes' : 'No';
      let nes2 = (nesHeader[7] & 0x0c) ? 'Yes' : 'No';

      if (miscFlags[0] & 0x01) miscFlags.push('VS Unisystem');
      if (miscFlags[0] & 0x02) miscFlags.push('Playchoice-10');

      let prgRomSizeKB = prgRomSize * 16 + ' KB';
      let chrRomSizeKB = chrRomSize * 8 + ' KB';

      let info =
        'System: ' +
        system +
        '\n' +
        'PRG ROM Size: ' +
        prgRomSizeKB +
        '\n' +
        'CHR ROM Size: ' +
        chrRomSizeKB +
        ' - ' +
        (chrRomSize === 0 ? 'Uses CHR RAM' : 'Uses CHR ROM') +
        '\n' +
        'Mapper Number: ' +
        mapperNumber +
        '\n' +
        'Mirroring: ' +
        mirroring +
        '\n' +
        'Battery-Backed: ' +
        batteryBacked +
        '\n' +
        'Trainer: ' +
        trainer +
        '\n' +
        'Four Screen VRAM: ' +
        fourScreenVram +
        '\n' +
        'VS/Unisystem: ' +
        vsPlaychoice +
        '\n' +
        'NES 2.0: ' +
        nes2 +
        '\n' +
        'Misc Flags: ' +
        miscFlags.join(' ') +
        '\n';

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
    console.log(
      `${file.name}${` data:`} ${Array.from(
        loadedROM,
        (asHex) => hexPrefix + asHex.toString(16).padStart(2, '0')
      ).join(' ')}`
    );

    //  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! MAPPER CONDITIONALS !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //
    mapper(nesHeader);
    //  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! MAPPER CONDITIONALS !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //

    // Create instruction / step section now that a ROM is loaded
    let instructionSection = document.querySelector('.instruction-step');
    // Erase the container in case of reloads of ROMS
    instructionSection.innerHTML = ``;
    let insertInstructionArea = document.createElement('table');
    insertInstructionArea.className = 'GeneratedTable';
    instructionSection.appendChild(insertInstructionArea);

    insertInstructionArea.innerHTML = instructionStepTable;

    // finally update table with loaded roms first instruction and PC counter from the reset vector
    updateDebugTables();
  };

  reader.onerror = function () {
    console.log(reader.error);
  };
}

function updateDebugTables() {
  const PC = CPUregisters.PC;
  // Fetch opcode via cpuRead for memory-mapped mirroring logic
  const opcodeByte = cpuRead(PC);
  const fetched = getOpcodeAndAddressingMode(opcodeByte);
  if (!fetched) return;
  const { opcode, addressingMode, length, pcIncrement, hex } = fetched;

  // Read raw bytes via cpuRead
  const raw = [];
  for (let i = 0; i < length; i++) {
    raw.push(cpuRead(PC + i));
  }

  // Console debug: current and next instruction
  const currHex = hexPrefix + raw[0].toString(16).padStart(2, '0');
  const ops = raw.slice(1)
    .map(b => hexPrefix + b.toString(16).padStart(2, '0'))
    .join(', ');
  console.log(`Current Instruction: ${currHex}` + (ops ? `  Operands <${ops}>` : `  (no operands)`));
  const nextByte = cpuRead(PC + pcIncrement);
  const nextHex = hexPrefix + nextByte.toString(16).padStart(2, '0');
  console.log(`Next Instruction: ${nextHex}`);

  // Update instruction display
  document.getElementById('instruction').innerText = `${hex}: ${opcode} / ${addressingMode}`;
  // Update operand display
  let opText = 'NA';
  if (length === 2) {
    opText = `1: ${ops}`;
  } else if (length === 3) {
    const [o1, o2] = ops.split(', ');
    opText = `1: ${o1}\n2: ${o2}`;
  }
  document.getElementById('operand').innerText = opText;

  // CPU flags table
  flagBitsIDArray.forEach((id, idx) => {
    document.getElementById(id).innerText = CPUregisters.P[P_VARIABLES[idx]];
  });

  // PPU registers bit table (ID-driven)
  PPU_VARIABLES.forEach(reg => {
    for (let bit = 0; bit < 8; bit++) {
      const id = `${reg}${bit}`;
      const el = document.getElementById(id);
      if (el) {
        el.innerText = ((PPUregisters[reg] || 0) >> bit) & 1;
      }
    }
  });

  // WRAM view
  allWramCells.forEach((cell, i) => {
    const val = cpuRead(i);
    cell.innerText = val.toString(16).padStart(2, '0') + 'h';
  });

  // Cartridge PRG view
  allCartSpaceBytes.forEach((cell, idx) => {
    const addr = memoryMap.prgRomLower.addr + idx;
    const val = cpuRead(addr);
    cell.innerText = val.toString(16).padStart(2, '0') + 'h';
  });

  // CPU register bit grids
  ['A', 'X', 'Y', 'S'].forEach((r, ri) => {
    const bits = CPUregisters[r].toString(2).padStart(8, '0').split('').map(Number);
    const arr = [regArrayA, regArrayX, regArrayY, regArrayS][ri];
    bits.forEach((b, bi) => {
      document.getElementById(arr[bi]).innerText = b;
    });
  });

  // PC bit grid
  CPUregisters.PC.toString(2).padStart(16, '0').split('').map(Number)
    .forEach((b, i) => {
      document.getElementById(regArrayPC[i]).innerText = b;
    });

  // CPU register bit grids
  ['A', 'X', 'Y', 'S'].forEach((r, ri) => {
    const bits = CPUregisters[r].toString(2).padStart(8, '0').split('').map(Number);
    const arr = [regArrayA, regArrayX, regArrayY, regArrayS][ri];
    bits.forEach((b, bi) => {
      document.getElementById(arr[bi]).innerText = b;
    });
  });

  // PPU register bit grids
  PPU_VARIABLES.forEach((reg, rowIndex) => {
    const bits = PPUregisters[reg].toString(2).padStart(8, '0').split('').map(Number);

    const regArrays = {
      PPUCTRL:       regArrayPPUCTRL,
      PPUMASK:       regArrayPPUMASK,
      PPUSTATUS:     regArrayPPUSTATUS,
      OAMADDR:       regArrayOAMADDR,
      OAMDATA:       regArrayOAMDATA,
      PPUSCROLL_X:   regArrayPPUSCROLL_X,
      PPUSCROLL_Y:   regArrayPPUSCROLL_Y,
      PPUADDR_HIGH:  regArrayPPUADDR_HIGH,
      PPUADDR_LOW:   regArrayPPUADDR_LOW,
      PPUDATA:       regArrayPPUDATA
    };

    const arr = regArrays[reg];

    bits.forEach((b, bitIndex) => {
      const cell = document.getElementById(arr[bitIndex]);
      if (cell) cell.innerText = b;
    });
  });

  // PC bit grid
  CPUregisters.PC.toString(2).padStart(16, '0').split('').map(Number)
    .forEach((b, i) => {
      document.getElementById(regArrayPC[i]).innerText = b;
    });
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
                hex: "0x" + opcodeInfo.code.toString(16).toUpperCase().padStart(2, '0'),
                func: opcodeInfo.func
                };
            }
          }
        }
        return null;
      }

function getOpcodeAndAddressingMode(numericValue) {
  console.log(`Looking up opcode 0x${numericValue.toString(16).toUpperCase().padStart(2, '0')}`);
  for (const opcode in opcodes) {
    const addressingModes = opcodes[opcode];
    for (const addressingMode in addressingModes) {
      const opcodeInfo = addressingModes[addressingMode];
      if (opcodeInfo.code === numericValue) {
        console.log(`Found opcode: ${opcode} addressingMode: ${addressingMode}`);
        return {
          opcode,
          addressingMode,
          length: opcodeInfo.length,
          pcIncrement: opcodeInfo.pcIncrement,
          hex: "0x" + opcodeInfo.code.toString(16).toUpperCase().padStart(2, '0'),
          func: opcodeInfo.func
        };
      }
    }
  }
  console.warn(`Opcode 0x${numericValue.toString(16).toUpperCase().padStart(2, '0')} not found in opcode table!`);
  return null;
}

function debugLog(){
  console.log(`CPU Registers:`);
  console.log(`A:  0x${CPUregisters.A.toString(16).toUpperCase().padStart(2, '0')}`);
  console.log(`X:  0x${CPUregisters.X.toString(16).toUpperCase().padStart(2, '0')}`);
  console.log(`Y:  0x${CPUregisters.Y.toString(16).toUpperCase().padStart(2, '0')}`);
  console.log(`S:  0x${CPUregisters.S.toString(16).toUpperCase().padStart(2, '0')}`);
  console.log(`PC: 0x${CPUregisters.PC.toString(16).toUpperCase().padStart(4, '0')}`);

  const P = CPUregisters.P;
}

// process instruction in the instruction box
function step() {
  // 1) Fetch the raw opcode byte from the bus
  const pc = CPUregisters.PC;
  const opcodeByte = cpuRead(pc);
  
  // 2) Decode it (might be undefined for unimplemented/illegal opcodes)
  const fetchedInstruction = getOpcodeAndAddressingMode(opcodeByte);
  if (!fetchedInstruction) {
    console.warn(
      `Unknown opcode 0x${opcodeByte.toString(16).padStart(2,'0')} at PC=0x${pc.toString(16).padStart(4,'0')}`
    );
    // Skip it and refresh the tables
    CPUregisters.PC = pc + 1;
    updateDebugTables();
    return;
  }

  // 3) Safe to destructure now
  const { func, pcIncrement } = fetchedInstruction;

  // 4) Execute the instruction handler
  func();

  // 5) Advance PC by the declared increment
  CPUregisters.PC = pc + pcIncrement;

  // 6) Refresh all of your tables/UI
  updateDebugTables();
}


