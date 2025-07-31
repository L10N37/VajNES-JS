// fix the offset double up on click in PRG ROM, updates the RAM offset with the same
const hexPrefix = ['0x'];

// boolean tracker to stop some code execution running at launch, only execute post ROM load
let isRomLoaded = false;
let lastFetched = null;


//-------- run and pause ---------//
let runInterval = null;

function run() {
  if (!runInterval) {
    runInterval = setInterval(step, 4); // ~60Hz (apparently an interval of 16 between opcode, debug heavy/ WIP so no)
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

// Initialize and ID all cells across full CPU & PPU space ($0000–$3FFF)
const allWramCells = document.querySelectorAll('.wramCells');
console.log(`Memory cells = ${allWramCells.length} bytes`);
console.log(`Memory cells = ${(allWramCells.length / 1024).toFixed(2)} KB`);

// count up our displayed cartridge space cells 
let allCartSpaceBytes1 = document.querySelectorAll('.cartspace1');
let allCartSpaceBytes2 = document.querySelectorAll('.cartspace2');

let allCartSpaceBytes = [...allCartSpaceBytes1, ...allCartSpaceBytes2];

// Log Checks 16Kb of cells * 2 == 32768 total bytes PRG-ROM space (2nd half often a mirror of first)
console.log(`Cartridge1 space cells = ${allCartSpaceBytes1.length} bytes`);
console.log(`Cartridge2 space cells = ${allCartSpaceBytes2.length} bytes`);
console.log(`Total Cartridge space = ${(allCartSpaceBytes1.length + allCartSpaceBytes2.length) / 1024} KB`);

// === WRAM/VRAM Memory Cells ===
allWramCells.forEach((cell, idx) => {
  cell.id = `wram-${idx}`;
  if (idx < 0x0800) {
    cell.classList.add('workRAM-cell');
  } else {
    cell.classList.add('vram-cell');
  }

  const val = memoryRead(idx);
  cell.innerText = val.toString(16).padStart(2, '0') + 'h';
  cell.title = `$${idx.toString(16).toUpperCase().padStart(4, '0')}`;

  cell.addEventListener('click', () => {
    const hex = idx.toString(16).toUpperCase().padStart(4, '0');
    document.querySelector('locContainer').innerHTML = `&nbsp;$${hex}`;
    cell.classList.toggle('highlighted-cell');
  });
});


// === PRG-ROM Memory Cells ===
allCartSpaceBytes.forEach((cell, idx) => {
  const addr = 0x8000 + idx;
  const val = systemMemory[addr];

  cell.innerText = (val !== undefined)
    ? val.toString(16).padStart(2, '0') + 'h'
    : '--';

  cell.title = `$${addr.toString(16).toUpperCase().padStart(4, '0')}`;

  cell.addEventListener('click', () => {
    const hex = addr.toString(16).toUpperCase().padStart(4, '0');
    document.querySelector('locContainer2').innerHTML = `&nbsp;$${hex}`;
    cell.classList.toggle('highlighted-cell');
  });
});

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
  if (!lastFetched) return;
  const { pc, hex, raw, length, pcIncrement, opcode, addressingMode } = lastFetched;

  // --- Console Debugging ---
  let ops = raw.slice(1)
    .map(b => hexPrefix + b.toString(16).padStart(2,'0'))
    .join(', ');
  console.log(
    `Current Instruction: ${hex}` +
    (ops ? `  Operands <${ops}>` : `  (no operands)`)
  );
  // preview next opcode byte
  let nextAddr = (pc + pcIncrement) & 0xFFFF;
  let nextByte = memoryRead(nextAddr);
  console.log(
    `Next Instruction: ${hexPrefix}${nextByte.toString(16).padStart(2,'0')} ` +
    `(at $${nextAddr.toString(16).padStart(4,'0')})`
  );

  // --- UI Refresh ---
  // 1) Instruction display
  document.getElementById('instruction').innerText =
    `${hex}: ${opcode} / ${addressingMode}`;

  // 2) Operand display
  let opText = 'NA';
  if (length === 2) {
    opText = `1: ${hexPrefix + raw[1].toString(16).padStart(2,'0')}`;
  } else if (length === 3) {
    opText = [
      `1: ${hexPrefix + raw[1].toString(16).padStart(2,'0')}`,
      `2: ${hexPrefix + raw[2].toString(16).padStart(2,'0')}`
    ].join('\n');
  }
  document.getElementById('operand').innerText = opText;

  // 3) CPU flags
  flagBitsIDArray.forEach((id, idx) => {
    document.getElementById(id).innerText = CPUregisters.P[P_VARIABLES[idx]];
  });

      
  // --- WRAM & VRAM Cells ---
  allWramCells.forEach((cell, i) => {
    let val;
    if (i < 0x2000) {
      // CPU work RAM and mirrors ($0000–$1FFF)
      val = memoryRead(i);
    } else {
      // PPU VRAM & palette RAM ($2000–$3FFF)
      val = systemMemory[i];
    }
    cell.innerText = val.toString(16).padStart(2, '0') + 'h';
  });  

  // 5) PRG-ROM view
  const prgBase = memoryMap.prgRomLower.addr;
  allCartSpaceBytes.forEach((cell, idx) => {
    const addr = prgBase + idx;
    const v = systemMemory[addr];
    cell.innerText = v != null
      ? v.toString(16).padStart(2,'0') + 'h'
      : '--';
  });

  // 6) CPU bit-grids (A, X, Y, S)
  ['A','X','Y','S'].forEach((r, ri) => {
    CPUregisters[r].toString(2).padStart(8,'0').split('').forEach((bitChar, bi) => {
      document.getElementById([regArrayA,regArrayX,regArrayY,regArrayS][ri][bi])
        .innerText = bitChar;
    });
  });
  // PC bits
  CPUregisters.PC.toString(2).padStart(16,'0').split('').forEach((b, i) => {
    document.getElementById(regArrayPC[i]).innerText = b;
  });

  // 7) PPU register bits
  const PPU_UI_BITMAP = {
    PPUCTRL:      'CTRL',
    PPUMASK:      'MASK',
    PPUSTATUS:    'STATUS',
    OAMADDR:      'OAMADDR',
    OAMDATA:      'OAMDATA',
    PPUADDR_HIGH: 'ADDR_HIGH',
    PPUADDR_LOW:  'ADDR_LOW',
    PPUDATA:      'VRAM_DATA'
  };
  Object.entries(PPU_UI_BITMAP).forEach(([prefix, key]) => {
    const val = PPUregister[key];
    for (let bit = 0; bit < 8; bit++) {
      const el = document.getElementById(`${prefix}${bit}`);
      if (el) el.innerText = (typeof val === 'number')
        ? ((val >> bit) & 1).toString()
        : '';
    }
  });
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
          cyclesIncrement: opcodeInfo.cycles,
          hex: "0x" + opcodeInfo.code.toString(16).toUpperCase().padStart(2, '0'),
          func: opcodeInfo.func
        };
      }
    }
  }
  console.warn(`Opcode 0x${numericValue.toString(16).toUpperCase().padStart(2, '0')} not found in opcode table!`);
  return null;
}

  // process current opcode from PC register address
function step() {

  // reset page-cross detection for this instruction
  pageCrossed = false;
  _lastReadAddr = null;
  
  // 1) Fetch & decode

  const opcodeByte = memoryRead(CPUregisters.PC);
  const fetched    = getOpcodeAndAddressingMode(opcodeByte);

  // ─── marker for test table generation ───
  if (opcodeByte === 0x02) {
    console.log("unique test ROM byte");
    pause();
    runEvery6502Test();
    CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;
    return;
  }
  // safe to comment out after testing is complete

  if (!fetched) {
    console.warn(
      `Unknown opcode 0x${opcodeByte.toString(16).padStart(2,'0')} ` +
      `at PC=0x${CPUregisters.PC.toString(16).padStart(4,'0')}`
    );
    pause();
    return;
  }

  // 2) Grab raw bytes for UI
  const raw = [];
  for (let i = 0; i < fetched.length; i++) {
    raw.push(memoryRead(CPUregisters.PC + i));
  }

  // 3) Snapshot everything UI needs before execution
  const cyclesBefore = cpuCycles; // not currently logging cycles before/after, tested good though
  lastFetched = {
    pc:             CPUregisters.PC,
    opcode:         fetched.opcode,
    addressingMode: fetched.addressingMode,
    length:         fetched.length,
    pcIncrement:    fetched.pcIncrement,
    hex:            fetched.hex,
    raw,
    cyclesBefore
  };

  // 4) Execute instruction
  fetched.func();

  // 4a) Base cycle counting, logic for +1 if/when we detecting a page‐cross or taken‐branch in memory.js
  
  //cpuCycles += fetched.cyclesIncrement;
  cpuCycles = (cpuCycles + fetched.cyclesIncrement) & 0xFFFF;

  // 4b) Record after‐count and delta
  lastFetched.cyclesAfter  = cpuCycles;
  lastFetched.cyclesTaken  = cpuCycles - cyclesBefore;

  // 4c) Extra‐cycle on page cross (for the 3 indexed read modes)
  if (pageCrossed) {
  cpuCycles++;
  pageCrossed = false;
  }

  // 4d) Advance PC
  CPUregisters.PC = (CPUregisters.PC + fetched.pcIncrement) & 0xFFFF;

  // 5) Update the tables/UI
  updateDebugTables();
}
