/*


 ____    ______   ____     _____   __  __                          
/\  _`\ /\__  _\ /\  _`\  /\  __`\/\ \/\ \                         
\ \ \L\ \/_/\ \/ \ \ \/\_\\ \ \/\ \ \ \_\ \                        
 \ \ ,  /  \ \ \  \ \ \/_/_\ \ \ \ \ \  _  \                       
  \ \ \\ \  \_\ \__\ \ \L\ \\ \ \_\ \ \ \ \ \                      
   \ \_\ \_\/\_____\\ \____/ \ \_____\ \_\ \_\                     
    \/_/\/ /\/_____/ \/___/   \/_____/\/_/\/_/                     
                                                                   
                                                                   
  ____  ______     __      ___         ____     ____    __  __     
 /'___\/\  ___\  /'__`\  /'___`\      /\  _`\  /\  _`\ /\ \/\ \    
/\ \__/\ \ \__/ /\ \/\ \/\_\ /\ \     \ \ \/\_\\ \ \L\ \ \ \ \ \   
\ \  _``\ \___``\ \ \ \ \/_/// /__     \ \ \/_/_\ \ ,__/\ \ \ \ \  
 \ \ \L\ \/\ \L\ \ \ \_\ \ // /_\ \     \ \ \L\ \\ \ \/  \ \ \_\ \ 
  \ \____/\ \____/\ \____//\______/      \ \____/ \ \_\   \ \_____\
   \/___/  \/___/  \/___/ \/_____/        \/___/   \/_/    \/_____/



*/

let CPUregisters = {
  A: 0x00,
  X: 0x00,
  Y: 0x00,
  // initialized to 0xFF on power-up or reset?
  // https://www.nesdev.org/wiki/Stack
  S: 0xFD,
  PC: 0x8000, // got sick of loading a dummy rom/ setting in console/ setting in the GUI, lets just start with this
  P: {
      C: 0,    // Carry
      Z: 0,    // Zero
      I: 1,    // Interrupt Disable
      D: 0,    // Decimal Mode
      V: 0,    // Overflow
      N: 0     // Negative
  }
};
// These are used to access P register by INDEX! used for debug table
let P_VARIABLES = ['C', 'Z', 'I', 'D', 'V', 'N'];


function readResetVectorAndDelay() {
  const lo = checkReadOffset(0xFFFC);
  const hi = checkReadOffset(0xFFFD);
  CPUregisters.PC = lo | (hi << 8);

  // RESET performs a 7-cycle interrupt-like sequence. The three stack
  // accesses are reads, not writes; S is adjusted separately on warm reset.
  for (let index = 0; index < 7; index++) consumeCycle();

  globalThis.NES_DEBUG_LOGGING && console.debug(`[Mapper] Reset Vector: $${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
  globalThis.NES_DEBUG_LOGGING && console.debug("PC @ 0x" + CPUregisters.PC.toString(16).padStart(4, "0").toUpperCase());
}

function resetCommonInterruptState() {
  DMA.active=false;
  clearNmiEdge();
  nmiPending=0;
  irqPollCurrent=irqPollPrevious=false;
  nmiPollCurrent=nmiPollPrevious=nmiSignalSeen=false;
}

// Full power-on/cartridge-load state. Mapper initialization calls this path so
// existing deterministic startup behavior remains unchanged.
function powerOnCPU() {
  resetSharedState();
  apuResetTiming();
  resetDMC();
  irqAssert.mmc3=false;
  if(mapperNumber===4) mmc3Reset();
  joypadStrobe=joypadStrobeOutput=joypad1State=joypad2State=0;
  resetCommonInterruptState();

  writeToggle=0;
  systemMemory.fill(0x00);

  CPUregisters.A=0x00;
  CPUregisters.X=0x00;
  CPUregisters.Y=0x00;
  CPUregisters.S=0xFD;
  CPUregisters.P={
    C:0,
    Z:0,
    I:1,
    D:0,
    V:0,
    N:0
  };

  readResetVectorAndDelay();

  ppumaskPrev=0;
  ppumaskRenderHoldBits=0;
  ppumaskRenderApplyAt=-1;
  renderingPrev=false;
  spriteXForceZeroNextFrame=false;
  sprite0FetchComplete=true;
  ppuExternalLatchLow=0;
  ppuExternalData=0;
  ppuCpu2007ReadUntil=-1;
  ppuCpu2006HybridUntil=-1;
  ppuCpu2006HybridLow=0;

  secOAMAddr=0;
  secondaryOAM.fill(0xFF);
  secOAMPrimaryAddr=0;
  secOAMPrimaryOverflow=false;
  secOAMAddrOverflow=false;
  secOAMOverflowDetection=false;
  secOAMCopyBytes=0;
  ppuOAMDataBus=0xFF;
  oamCorruptPending=false;
  oamCorruptSeedRow=0;

  openBus.internal=0;
  openBus.PPU=0;
  openBus.ppuDecayTimer=0;
}

// Hardware-style warm CPU reset. Internal RAM and A/X/Y/C/Z/D/V/N survive;
// RESET sets I, subtracts three from S without writing stack bytes, and reloads
// PC from $FFFC/$FFFD. APU reset details are refined separately.
function resetCPU() {
  resetCommonInterruptState();
  apuWarmResetTiming();

  CPUregisters.S=(CPUregisters.S-3)&0xFF;
  CPUregisters.P.I=1;

  readResetVectorAndDelay();
}

// actually we can get a script down the track to scrap every variable in existence and reset them all / move the function to a separate file
// it will scrape worker local vars but that shouldn't matter, NO NOT RESET MAPPER NUMBER VARIABLE
resetButton.onclick = resetCPU;

////////////////////////// CPU Functions //////////////////////////
// http://www.6502.org/tutorials/6502opcodes.html#ADC
// https://en.wikipedia.org/wiki/MOS_Technology_6502#Registers
// https://www.masswerk.at/6502/6502_instruction_set.html
// https://www.pagetable.com/c64ref/6502/?tab=2#LDA 
// https://www.nesdev.org/obelisk-6502-guide/addressessing.html


function consumeCycle() {

  cpuCycles++;
  apuClock();
  nmiPollPrevious=nmiPollCurrent;
  const nmiSignal=doesNmiEdgeExist();
  if(nmiSignal && !nmiSignalSeen)nmiPollCurrent=true;
  nmiSignalSeen=nmiSignal;
  irqPollPrevious=irqPollCurrent;
  irqPollCurrent=(irqAssert.frame || irqAssert.mmc3 || irqAssert.dmcDma) && !CPUregisters.P.I;
  clockJoypadStrobe();

  clockDMC();

  if (openBus.ppuDecayTimer > 0) {
    openBus.ppuDecayTimer--;
    if (openBus.ppuDecayTimer === 0) {
      openBus.PPU = 0;
    }
  } else {
    openBus.ppuDecayTimer = 1789772;
  }

  startPPULoop();

  // console technically produces odds, then even lines one PPU cycle later
  // not worth doing (previously did try it, unrequired logic)
  const NTSC_cpu_cycles_per_frame = 29780;
  if (cpuCycles % NTSC_cpu_cycles_per_frame === 0) { 
  presentFrame();
  if (step.frame) pause();
  }


}

// --------- Branches (REL) — per-cycle ----------
function BRANCH_REL() {

  // 🔥 -------- IRQ POLL (BEFORE CYCLE 2) --------
  irqBranch.pending =
    Object.values(irqAssert).some(Boolean) && !CPUregisters.P.I;

  // -------- CYCLE 2 --------
  const offset = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;

  const nextPC = (CPUregisters.PC + 2) & 0xFFFF;

  let flag;

  switch ((code >> 6) & 3) {
    case 0: flag = CPUregisters.P.N; break;
    case 1: flag = CPUregisters.P.V; break;
    case 2: flag = CPUregisters.P.C; break;
    case 3: flag = CPUregisters.P.Z; break;
  }

  const take = ((code & 0x20) === 0) ? (flag === 0) : (flag === 1);

  consumeCycle(); // completes cycle 2

  // -------- NOT TAKEN --------
  if (!take) {
    CPUregisters.PC = nextPC;
    return;
  }

  // -------- CYCLE 3 --------
  checkReadOffset(nextPC);
  consumeCycle();

  const rel = (offset & 0x80) ? offset - 0x100 : offset;
  const target = (nextPC + rel) & 0xFFFF;

  // -------- NO PAGE CROSS --------
  if ((nextPC & 0xFF00) === (target & 0xFF00)) {

    irqPollPrevious = irqBranch.pending;

    CPUregisters.PC = target;
    return;
  }

  // -------- CYCLE 4 --------
  checkReadOffset((nextPC & 0xFF00) | (target & 0x00FF));
  consumeCycle();

  irqPollPrevious = irqBranch.pending || irqPollPrevious;

  CPUregisters.PC = target;
}

/*
  NES Mappers That Use IRQs (Interrupt Requests):

  Mapper # | Name / Alias      | IRQ Use Case
  ---------|-------------------|-------------------------------
  4        | MMC3              | Scanline IRQ for mid-frame effects
  5        | MMC5              | Scanline IRQ, advanced features
  6        | VNROM             | Uses IRQs
  7        | AxROM             | IRQs used
  9        | MMC2              | Scanline IRQ
  10       | MMC4              | Scanline IRQ
  11       | Color Dreams      | IRQ support
  15       | Pirate MMC5       | IRQs
  18       | Taito TC0190      | IRQ support
  21       | Konami VRC4       | IRQ for scanline counting
  22       | VRC6              | IRQs used
  23       | VRC7              | IRQs used
  24       | Namco 163         | IRQ support
  25       | Sunsoft 5B        | IRQ support
  26       | VRC2              | IRQ support
  32       | Irem G-101        | IRQ support
  33       | Jaleco JF-13      | IRQ support
  34       | Namco 106         | IRQ support
  66       | GNROM             | IRQ support
  68       | Sunsoft FME-7     | IRQ support
  71       | Camerica BC        | IRQ support

  Notes:
  - IRQs mainly used for scanline counting and mid-frame graphical effects.
  - Simpler mappers like NROM (0) and UxROM (2) do NOT use IRQs.
  - Some mappers have partial or undocumented IRQ features.

  Prioritise implementing IRQ support for popular mappers like MMC3 (4), MMC5 (5), and VRC6 (22).
*/
function BRK_IMP() {
  const pc = CPUregisters.PC & 0xFFFF;
  const ret = (pc + 2) & 0xFFFF;
  const retHi = (ret >> 8) & 0xFF;
  const retLo = ret & 0xFF;

  let lo, hi;

  // Cycle 2: dummy fetch (padding byte)
  checkReadOffset((pc + 1) & 0xFFFF);
  consumeCycle();

  // Cycle 3: push PCH
  cpuWrite(0x100 | CPUregisters.S, retHi);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  consumeCycle();

  // Cycle 4: push PCL
  cpuWrite(0x100 | CPUregisters.S, retLo);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  consumeCycle();

  // Cycle 5: push status (B=1, unused bit=1)
  let statusByte = 0b00110000; // B=1, unused bit=1
  statusByte |= (CPUregisters.P.C & 1) << 0;
  statusByte |= (CPUregisters.P.Z & 1) << 1;
  statusByte |= (CPUregisters.P.I & 1) << 2;
  statusByte |= (CPUregisters.P.D & 1) << 3;
  statusByte |= (CPUregisters.P.V & 1) << 6;
  statusByte |= (CPUregisters.P.N & 1) << 7;

  cpuWrite(0x100 | CPUregisters.S, statusByte);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  CPUregisters.P.I = 1; // Set I after pushing
  consumeCycle();

  // Cycle 6: select the vector using the NMI latch from cycle 4.
  // A takeover preserves BRK's return address and stacked B=1.
  const vector = nmiPollPrevious ? 0xFFFA : 0xFFFE;
  if(vector===0xFFFA) {
    clearNmiEdge();
    nmiPollCurrent=nmiPollPrevious=false;
    nmiSignalSeen=false;
  }
  lo = checkReadOffset(vector) & 0xFF;
  consumeCycle();

  // Cycle 7: fetch vector high
  hi = checkReadOffset(vector+1) & 0xFF;
  consumeCycle();

  // The vector fetch completes BRK; there is no eighth cycle.
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;
}

function LDA_IMM() {
  // C1: opcode fetch (represented as a non-bus cycle here)
  // C2: read immediate
  CPUregisters.A = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDA_ZP() {
  // C1: opcode fetch
  // C2: fetch zero page address
  const addr = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle();

  // C3: read from zero page
  CPUregisters.A = checkReadOffset(addr);
  consumeCycle();

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDA_ZPX() {
  // C1: opcode fetch
  // C2: fetch base zp address
  const base = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // Effective address wraps in zero page
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFF;

  // C3: dummy read from unindexed zero-page base.
  checkReadOffset(base);
  consumeCycle();

  // C4: final read
  CPUregisters.A = checkReadOffset(addr);
  consumeCycle();

  // Set flags
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDA_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const low  = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // C3: fetch high
  const high = checkReadOffset(CPUregisters.PC + 2);
  
  consumeCycle();

  // C4: read from absolute
  const addr = (high << 8) | low;
  CPUregisters.A = checkReadOffset(addr);
  consumeCycle();

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function LDA_ABSY() {
  // C1: opcode fetch
  // C2: fetch low operand byte (drives bus)
  const lowAddr = (CPUregisters.PC + 1) & 0xFFFF;
  const low     = checkReadOffset(lowAddr);
  consumeCycle();

  // C3: fetch high operand byte (MUST drive bus)
  const highAddr = (CPUregisters.PC + 2) & 0xFFFF;
  const high     = checkReadOffset(highAddr);
  consumeCycle();

  // Base and effective
  const base = ((high & 0xFF) << 8) | (low & 0xFF);
  const y    = CPUregisters.Y & 0xFF;
  const addr = (base + y) & 0xFFFF;

  // Page-cross extra cycle (dummy read at old page + new low)
  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);

    // C4: dummy read (bus updates with whatever is read; on open-bus it returns busBefore)
    checkReadOffset(dummy);
    consumeCycle();

    // C5: final read
    CPUregisters.A = checkReadOffset(addr);
    consumeCycle();
  } else {
    // C4: final read (no extra cycle)
    CPUregisters.A = checkReadOffset(addr);
    consumeCycle();
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function LDA_ABSX() {
  // C1: opcode fetch
  // C2: fetch low operand byte
  const lowAddr = (CPUregisters.PC + 1) & 0xFFFF;
  const low     = checkReadOffset(lowAddr);
  consumeCycle();

  // C3: fetch high operand byte
  const highAddr = (CPUregisters.PC + 2) & 0xFFFF;
  const high     = checkReadOffset(highAddr);
  consumeCycle();

  const base = ((high & 0xFF) << 8) | (low & 0xFF);
  const x    = CPUregisters.X & 0xFF;
  const addr = (base + x) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    // C4: dummy read at old page + new low
    const dummy = (base & 0xFF00) | (addr & 0x00FF);

    checkReadOffset(dummy);
    consumeCycle();

    // C5: final read
    CPUregisters.A = checkReadOffset(addr);
    consumeCycle();
  } else {
    // C4: final read
    CPUregisters.A = checkReadOffset(addr);
    consumeCycle();
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}


function LDA_INDX() {  // (zp,X)
  // C1: opcode fetch
  // C2: fetch zp operand
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // Effective pointer address (wrap in zero page)
  const ptr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;

  // C3: dummy read from the unindexed zero-page operand. The X add
  // happens internally during this cycle; the external bus still sees zp.
  checkReadOffset(zp);
  consumeCycle();

  // C4: fetch low pointer byte
  const low = checkReadOffset(ptr);
  consumeCycle();

  // C5: fetch high pointer byte
  const high = checkReadOffset((ptr + 1) & 0xFF);
  consumeCycle();

  // C6: read final effective address
  const addr = (high << 8) | low;
  CPUregisters.A = checkReadOffset(addr);
  consumeCycle();

  // Set flags
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDA_INDY() {  // (zp),Y
  // C1: opcode fetch
  // C2: fetch zp pointer
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // C3: read low from zp
  const low = checkReadOffset(zp);
  consumeCycle();

  // C4: read high from zp+1
  const high = checkReadOffset((zp + 1) & 0xFF);
  consumeCycle();

  // C5: add Y (may cross page)
  const base = (high << 8) | low;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    // C5 (actual bus): dummy read at old page + new low
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    // C6: final read at effective address
    CPUregisters.A = checkReadOffset(addr);
    consumeCycle();
  } else {
    // C5: final read at effective address (no crossing)
    CPUregisters.A = checkReadOffset(addr);
    consumeCycle();
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function STA_ZP() {
  // C1: opcode fetch
  // C2: fetch zp addr
  const addr = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle();

  // C3: write A -> zp
  checkWriteOffset(addr, CPUregisters.A & 0xFF);
  consumeCycle(); // total 3
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function STA_ZPX() {
  // C1: opcode fetch
  // C2: fetch zp base
  const base = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // Effective zero-page address
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFF;

  // C3: dummy read from unindexed zero-page base.
  checkReadOffset(base);
  consumeCycle();

  // C4: final write
  checkWriteOffset(addr, CPUregisters.A & 0xFF);
  consumeCycle(); // total 4 cycles
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function STA_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const low  = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // C3: fetch high
  const high = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle();

  // C4: write A -> abs
  const addr = ((high << 8) | low) & 0xFFFF;
  checkWriteOffset(addr, CPUregisters.A & 0xFF);
  consumeCycle(); // total 4
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function STA_ABSX() {
  // C1: opcode fetch
  // C2: fetch low
  const low = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // C3: fetch high
  const high = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle();

  const base = (high << 8) | low;
  const X    = CPUregisters.X & 0xFF;
  const addr = (base + X) & 0xFFFF;

  // If page crossed, set flag
  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    
  }

  // C4: dummy read at (old high << 8) | (addr low)
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  
  checkReadOffset(dummy);
  
  consumeCycle();

  // C5: actual write
  checkWriteOffset(addr, CPUregisters.A & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function STA_ABSY() {
  // C1

  const low = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const high = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (high << 8) | low;
  const Y    = CPUregisters.Y & 0xFF;
  const addr = (base + Y) & 0xFFFF;

  // If page crossed, set flag
  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    
  }

  // C4: dummy read at (old high << 8) | (addr low)
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  
  checkReadOffset(dummy);
  
  consumeCycle();

  // C5: actual write
  checkWriteOffset(addr, CPUregisters.A & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function STA_INDX() {
  // C1: opcode fetch
  // C2: fetch zp operand
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // C3: add X internally; external bus reads original zp.
  const zpaddr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(zp);
  consumeCycle();

  // C4: fetch low pointer byte
  const low = checkReadOffset(zpaddr);
  consumeCycle();

  // C5: fetch high pointer byte
  const high = checkReadOffset((zpaddr + 1) & 0xFF);
  consumeCycle();

  // C6: final write
  const addr = (high << 8) | low;
  checkWriteOffset(addr, CPUregisters.A & 0xFF);
  consumeCycle(); // total 6
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function STA_INDY() { // ($nn),Y
  // C1: opcode fetch
  // C2: fetch zp pointer
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // C3: read low from zp
  const low = checkReadOffset(zp & 0xFF);
  consumeCycle();

  // C4: read high from zp+1 (wraps in zero page)
  const high = checkReadOffset((zp + 1) & 0xFF);
  consumeCycle();

  const base = ((high << 8) | low) & 0xFFFF;
  const Y    = CPUregisters.Y & 0xFF;
  const addr = (base + Y) & 0xFFFF;

  // If page crossed, set flag
  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    
  }

  // C5: dummy read at (old high << 8) | (new low)
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  
  checkReadOffset(dummy);
  
  consumeCycle();

  // C6: final write at effective address
  checkWriteOffset(addr, CPUregisters.A & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function CLC_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff); // Clear Carry
  // C1: opcode fetch
  // C2: execute
  CPUregisters.P.C = 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

function SEC_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff); // Set Carry
  CPUregisters.P.C = 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

function CLI_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff); // Clear Interrupt Disable
  CPUregisters.P.I = 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

function SEI_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff); // Set Interrupt Disable
  CPUregisters.P.I = 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;
}

function CLD_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff); // Clear Decimal
  CPUregisters.P.D = 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

function SED_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff); // Set Decimal
  CPUregisters.P.D = 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

function CLV_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff); // Clear Overflow
  CPUregisters.P.V = 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

function INC_ZP() { // 5 cycles (RMW)
  // C1
  const addr = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2

  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C3 (read)
  checkWriteOffset(addr, old);                       consumeCycle(); // C4 (dummy write)

  const val = (old + 1) & 0xFF;
  checkWriteOffset(addr, val);                       consumeCycle(); // C5 (final write)

  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function INC_ZPX() { // 6 cycles (RMW)
  // C1
  const zp   = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF; checkReadOffset(zp); consumeCycle(); // C3 dummy read/index add

  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C4 (read)
  checkWriteOffset(addr, old);                       consumeCycle(); // C5 (dummy write)

  const val = (old + 1) & 0xFF;
  checkWriteOffset(addr, val);                       consumeCycle(); // C6 (final write)

  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ROL_ZP() { // 5 cycles (RMW)
  // C1
  const addr = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2

  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C3 (read)
  checkWriteOffset(addr, old);                       consumeCycle(); // C4 (dummy write)

  const carryIn  = CPUregisters.P.C & 1;
  const result   = ((old << 1) | carryIn) & 0xFF;

  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;

  checkWriteOffset(addr, result);                    consumeCycle(); // C5 (final write)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ROL_ZPX() { // 6 cycles (RMW)
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);   consumeCycle(); // C2
  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF; checkReadOffset(zp); consumeCycle(); // C3 dummy read/index add

  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C4 (read)
  checkWriteOffset(addr, old);                       consumeCycle(); // C5 (dummy write)

  const carryIn  = CPUregisters.P.C & 1;
  const result   = ((old << 1) | carryIn) & 0xFF;

  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;

  checkWriteOffset(addr, result);                    consumeCycle(); // C6 (final write)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ---------- LSR $nn (ZP) — 5 cycles ----------
function LSR_ZP() { // 5 cycles (RMW)
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2

  const old = checkReadOffset(zp) & 0xFF;          consumeCycle(); // C3 (read)
  checkWriteOffset(zp, old);                       consumeCycle(); // C4 (dummy write)

  const res = (old >>> 1) & 0xFF;
  CPUregisters.P.C = old & 0x01;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = 0;

  checkWriteOffset(zp, res);                       consumeCycle(); // C5 (final write)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LSR_ZPX() { // 6 cycles (RMW)
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);  consumeCycle(); // C2
  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF; checkReadOffset(zp); consumeCycle(); // C3 dummy read/index add

  const old = checkReadOffset(addr) & 0xFF;         consumeCycle(); // C4 (read)
  checkWriteOffset(addr, old);                      consumeCycle(); // C5 (dummy write)

  const res = (old >>> 1) & 0xFF;
  CPUregisters.P.C = old & 0x01;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = 0;

  checkWriteOffset(addr, res);                      consumeCycle(); // C6 (final write)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function INC_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const lo   = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // C3: fetch high
  const hi   = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle();

  // C4: read original
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const old  = checkReadOffset(addr);
  consumeCycle();

  // C5: dummy write (you already do this)
  checkWriteOffset(addr, old);
  consumeCycle();

  // C6: final write
  let value = (old + 1) & 0xFF;
  checkWriteOffset(addr, value);
  consumeCycle(); // total 6

  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ---------- INC abs,X — 7 cycles ----------
function INC_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  checkReadOffset(dummy);                           consumeCycle(); // C4 dummy read
  const old = checkReadOffset(addr) & 0xFF;         consumeCycle(); // C5 real read
  checkWriteOffset(addr, old);                      consumeCycle(); // C6 old write
  const value = (old + 1) & 0xFF;
  CPUregisters.P.Z = value === 0 ? 1 : 0;
  CPUregisters.P.N = (value >>> 7) & 1;
  checkWriteOffset(addr, value);                    consumeCycle(); // C7 new write
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}

function JMP_ABS() {
  // C1
  const pc0 = CPUregisters.PC & 0xFFFF;

  const lo  = checkReadOffset((pc0 + 1) & 0xFFFF) & 0xFF; consumeCycle(); // C2
  const hi  = checkReadOffset((pc0 + 2) & 0xFFFF) & 0xFF; consumeCycle(); // C3
  const tgt = ((hi << 8) | lo) & 0xFFFF;

  CPUregisters.PC = tgt;
}

function JMP_IND() {
  const pc0 = CPUregisters.PC & 0xFFFF;

  // C1 opcode fetch is performed by window.step().
  const ptrLo = checkReadOffset((pc0 + 1) & 0xFFFF) & 0xFF;  consumeCycle(); // C2
  const ptrHi = checkReadOffset((pc0 + 2) & 0xFFFF) & 0xFF;  consumeCycle(); // C3
  const ptr   = (ptrHi << 8) | ptrLo;

  const bugAddr = (ptr & 0xFF00) | ((ptr + 1) & 0x00FF);

  const lo = checkReadOffset(ptr)     & 0xFF;                consumeCycle(); // C4
  const hi = checkReadOffset(bugAddr) & 0xFF;                consumeCycle(); // C5
  const tgt = ((hi << 8) | lo) & 0xFFFF;

  CPUregisters.PC = tgt;
}

function ROL_ACC() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1
  let value = CPUregisters.A;
  const carryIn = CPUregisters.P.C;
  const newCarry = (value >> 7) & 1;

  value = ((value << 1) & 0xFF) | carryIn;

  CPUregisters.A = value;
  CPUregisters.P.C = newCarry;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value >> 7) & 1;
  consumeCycle(); // C2
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// ---------- ROL abs — 6 cycles ----------
function ROL_ABS() {
  // C1
  const lo   = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi   = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const addr = (hi << 8) | lo;

  const old = checkReadOffset(addr);                 consumeCycle(); // C4

  // Dummy write of the old value (bus sees unmodified)
  checkWriteOffset(addr, old);                       consumeCycle(); // C5

  const carryIn  = CPUregisters.P.C & 1;
  const carryOut = (old & 0x80) ? 1 : 0;
  const result   = ((old << 1) | carryIn) & 0xFF;

  checkWriteOffset(addr, result);                    consumeCycle(); // C6

  CPUregisters.P.C = carryOut;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ---------- ROL abs,X — 7 cycles ----------
function ROL_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  checkReadOffset(dummy);                           consumeCycle(); // C4 dummy read
  const old = checkReadOffset(addr) & 0xFF;         consumeCycle(); // C5 real read
  checkWriteOffset(addr, old);                      consumeCycle(); // C6 old write
  const carryIn = CPUregisters.P.C & 1;
  const result = ((old << 1) | carryIn) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;
  checkWriteOffset(addr, result);                   consumeCycle(); // C7 new write
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}

function TXS_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1
  CPUregisters.S = CPUregisters.X;
  consumeCycle(); // C2
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

function TSX_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1
  CPUregisters.X = CPUregisters.S;
  CPUregisters.P.Z = +(CPUregisters.X === 0);
  CPUregisters.P.N = (CPUregisters.X >> 7) & 1;
  consumeCycle(); // C2
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

function LDX_IMM() {
  // C1
  CPUregisters.X = checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) ? 1 : 0;
  consumeCycle(); // C2
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDX_ZP() {
  // C1
  const zpAddr = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  CPUregisters.X = checkReadOffset(zpAddr & 0xFF);     consumeCycle(); // C3
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDX_ZPY() {
  // C1

  // C2: fetch zp base address
  const base = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // Effective zero-page address
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFF;

  // C3: dummy read from the unindexed zero-page base.
  checkReadOffset(base);
  consumeCycle();

  // C4: final read
  CPUregisters.X = checkReadOffset(addr);
  consumeCycle();

  // Set flags
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDX_ABS() {
  // C1
  const low  = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const high = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const address = (high << 8) | low;
  CPUregisters.X = checkReadOffset(address); consumeCycle(); // C4

  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function LDX_ABSY() {
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const base = (hi << 8) | lo;
  const address = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (address & 0xFF00)) {
    const dummy = (base & 0xFF00) | (address & 0x00FF);
    
    checkReadOffset(dummy); consumeCycle(); // C4 (dummy on cross)
    
    CPUregisters.X = checkReadOffset(address); consumeCycle(); // C5
  } else {
    CPUregisters.X = checkReadOffset(address); consumeCycle(); // C4
  }

  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function ADC_IMM() { // 2 cycles
  // C1
  const val = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle(); // C2

  const a = CPUregisters.A & 0xFF;
  const c = CPUregisters.P.C & 1;
  const sum = a + val + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

  CPUregisters.A = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ADC_ZP() { // 3 cycles
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const val = checkReadOffset(zp & 0xFF) & 0xFF;
  consumeCycle(); // C3

  const a = CPUregisters.A & 0xFF;
  const c = CPUregisters.P.C & 1;
  const sum = a + val + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

  CPUregisters.A = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ADC_ZPX() { // 4 cycles
  // C1
  const base = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle(); // C3 dummy read/index add (internal index)
  const val = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  const a = CPUregisters.A & 0xFF;
  const c = CPUregisters.P.C & 1;
  const sum = a + val + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

  CPUregisters.A = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ADC_ABS() { // 4 cycles
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3
  const addr = (hi << 8) | lo;
  const val = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  const a = CPUregisters.A & 0xFF;
  const c = CPUregisters.P.C & 1;
  const sum = a + val + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

  CPUregisters.A = res;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function ADC_ABSX() { // 4 (+1 if cross)
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const c = CPUregisters.P.C & 1;
    const sum = a + val + c;
    const res = sum & 0xFF;

    CPUregisters.P.C = (sum >> 8) & 1;
    CPUregisters.P.Z = (res === 0) ? 1 : 0;
    CPUregisters.P.N = (res >> 7) & 1;
    CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

    CPUregisters.A = res;
  } else {
    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const c = CPUregisters.P.C & 1;
    const sum = a + val + c;
    const res = sum & 0xFF;

    CPUregisters.P.C = (sum >> 8) & 1;
    CPUregisters.P.Z = (res === 0) ? 1 : 0;
    CPUregisters.P.N = (res >> 7) & 1;
    CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

    CPUregisters.A = res;
  }
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function ADC_ABSY() { // 4 (+1 if cross)
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const c = CPUregisters.P.C & 1;
    const sum = a + val + c;
    const res = sum & 0xFF;

    CPUregisters.P.C = (sum >> 8) & 1;
    CPUregisters.P.Z = (res === 0) ? 1 : 0;
    CPUregisters.P.N = (res >> 7) & 1;
    CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

    CPUregisters.A = res;
  } else {
    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const c = CPUregisters.P.C & 1;
    const sum = a + val + c;
    const res = sum & 0xFF;

    CPUregisters.P.C = (sum >> 8) & 1;
    CPUregisters.P.Z = (res === 0) ? 1 : 0;
    CPUregisters.P.N = (res >> 7) & 1;
    CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

    CPUregisters.A = res;
  }
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function ADC_INDX() { // 6 cycles
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const ptr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(zp);
  consumeCycle(); // C3 dummy read/index add

  const lo = checkReadOffset(ptr) & 0xFF;
  consumeCycle(); // C4
  const hi = checkReadOffset((ptr + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C5

  const addr = (hi << 8) | lo;
  const val = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C6

  const a = CPUregisters.A & 0xFF;
  const c = CPUregisters.P.C & 1;
  const sum = a + val + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

  CPUregisters.A = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ADC_INDY() { // 5 (+1 if cross)
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const lo = checkReadOffset(zp) & 0xFF;
  consumeCycle(); // C3
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C4

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const c = CPUregisters.P.C & 1;
    const sum = a + val + c;
    const res = sum & 0xFF;

    CPUregisters.P.C = (sum >> 8) & 1;
    CPUregisters.P.Z = (res === 0) ? 1 : 0;
    CPUregisters.P.N = (res >> 7) & 1;
    CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

    CPUregisters.A = res;
  } else {
    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const c = CPUregisters.P.C & 1;
    const sum = a + val + c;
    const res = sum & 0xFF;

    CPUregisters.P.C = (sum >> 8) & 1;
    CPUregisters.P.Z = (res === 0) ? 1 : 0;
    CPUregisters.P.N = (res >> 7) & 1;
    CPUregisters.P.V = ((~(a ^ val) & (a ^ res)) >> 7) & 1;

    CPUregisters.A = res;
  }
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function AND_IMM() {
  // C1
  const immVal = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle(); // C2

  const res = (CPUregisters.A & immVal) & 0xFF;
  CPUregisters.A = res;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function AND_ZP() {
  // C1
  const operand = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle(); // C2
  const val = checkReadOffset(operand) & 0xFF;
  consumeCycle(); // C3

  const res = (CPUregisters.A & val) & 0xFF;
  CPUregisters.A = res;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function AND_ZPX() {
  // C1
  const addr = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const effAddr = (addr + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(addr);
  consumeCycle(); // C3 dummy read/index add
  const val = checkReadOffset(effAddr) & 0xFF;
  consumeCycle(); // C4

  const res = (CPUregisters.A & val) & 0xFF;
  CPUregisters.A = res;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function AND_ABS() {
  // C1
  const low = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const high = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3
  const addr = (high << 8) | low;
  const val = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  const res = (CPUregisters.A & val) & 0xFF;
  CPUregisters.A = res;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function AND_ABSX() {
  // C1
  const low = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const high = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (high << 8) | low;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A & val) & 0xFF;
  } else {
    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A & val) & 0xFF;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function AND_ABSY() {
  // C1
  const low = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const high = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (high << 8) | low;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A & val) & 0xFF;
  } else {
    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A & val) & 0xFF;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function AND_INDX() {
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const ptr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(zp);
  consumeCycle(); // C3 dummy read/index add

  const lo = checkReadOffset(ptr) & 0xFF;
  consumeCycle(); // C4
  const hi = checkReadOffset((ptr + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C5

  const addr = (hi << 8) | lo;
  const val = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C6

  const res = (CPUregisters.A & val) & 0xFF;
  CPUregisters.A = res;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function AND_INDY() {
  // C1
  const nn = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const lo = checkReadOffset(nn & 0xFF);
  consumeCycle(); // C3
  const hi = checkReadOffset((nn + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C4

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    const res = (CPUregisters.A & val) & 0xFF;
    CPUregisters.A = res;
  } else {
    const val = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    const res = (CPUregisters.A & val) & 0xFF;
    CPUregisters.A = res;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ---------- ASL (Accumulator) — 2 cycles ----------
function ASL_ACC() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1
  const old    = CPUregisters.A & 0xFF;
  const result = (old << 1) & 0xFF;

  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.A   = result;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;
  consumeCycle(); // C2
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// ---------- ASL $nn (ZP) — 5 cycles ----------
function ASL_ZP() { // 5 cycles
  // C1
  const op = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const addr = op & 0xFF;

  const old = checkReadOffset(addr) & 0xFF;        consumeCycle(); // C3 (read)
  checkWriteOffset(addr, old);                     consumeCycle(); // C4 (dummy write)

  const res = (old << 1) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;

  checkWriteOffset(addr, res);                     consumeCycle(); // C5 (final write)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ASL_ZPX() { // 6 cycles
  // C1
  const op = checkReadOffset(CPUregisters.PC + 1);  consumeCycle(); // C2
  const addr = (op + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(op);                              consumeCycle(); // C3 dummy read/index add

  const old = checkReadOffset(addr) & 0xFF;        consumeCycle(); // C4 (read)
  checkWriteOffset(addr, old);                     consumeCycle(); // C5 (dummy write)

  const res = (old << 1) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;

  checkWriteOffset(addr, res);                     consumeCycle(); // C6 (final write)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ---------- ASL $nnnn (ABS) — 6 cycles ----------
function ASL_ABS() {
  const basePC = CPUregisters.PC;

  // C1
  const lo = checkReadOffset(basePC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(basePC + 2); consumeCycle(); // C3
  const ea = ((hi << 8) | lo) & 0xFFFF;

  const old = checkReadOffset(ea) & 0xFF; consumeCycle(); // C4
  checkWriteOffset(ea, old);              consumeCycle(); // C5 (dummy)

  const result = (old << 1) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;

  checkWriteOffset(ea, result);           consumeCycle(); // C6
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ---------- ASL $nnnn,X (ABS,X) — 7 cycles ----------
function ASL_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const ea = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (ea & 0x00FF);
  checkReadOffset(dummy);                           consumeCycle(); // C4 dummy read
  const old = checkReadOffset(ea) & 0xFF;           consumeCycle(); // C5 real read
  checkWriteOffset(ea, old);                        consumeCycle(); // C6 old write
  const result = (old << 1) & 0xFF;
  CPUregisters.P.C = (old >>> 7) & 1;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;
  checkWriteOffset(ea, result);                     consumeCycle(); // C7 new write
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}

// ---------- BIT $nn (ZP) — 3 cycles ----------
function BIT_ZP() {
  // C1
  const zpAddr = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const m = checkReadOffset(zpAddr) & 0xFF;            consumeCycle(); // C3
  const res = CPUregisters.A & m;

  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.V = (m >> 6) & 1;
  CPUregisters.P.N = (m >> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ---------- BIT $nnnn (ABS) — 4 cycles ----------
function BIT_ABS() {
  // C1
  const pc = CPUregisters.PC;
  const lo = checkReadOffset((pc + 1) & 0xFFFF); consumeCycle(); // C2
  const hi = checkReadOffset((pc + 2) & 0xFFFF); consumeCycle(); // C3
  const address = ((hi << 8) | lo) & 0xFFFF;
  const m = checkReadOffset(address) & 0xFF;     consumeCycle(); // C4
  const res = CPUregisters.A & m;

  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.V = (m >> 6) & 1;
  CPUregisters.P.N = (m >> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ---------- LSR (Accumulator) — 2 cycles ----------
function LSR_ACC() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1
  const oldA  = CPUregisters.A & 0xFF;
  const result = (oldA >>> 1) & 0xFF;

  CPUregisters.P.C = (oldA & 0x01) ? 1 : 0;
  CPUregisters.A   = result;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = 0;
  consumeCycle(); // C2
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// ---------- LSR $nnnn (ABS) — 6 cycles ----------
function LSR_ABS() {
  // C1
  const lo   = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi   = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const addr = ((hi << 8) | lo) & 0xFFFF;

  const old  = checkReadOffset(addr) & 0xFF;         consumeCycle(); // C4
  checkWriteOffset(addr, old);                       consumeCycle(); // C5 (dummy)

  const res  = (old >>> 1) & 0xFF;
  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = 0;

  checkWriteOffset(addr, res);                       consumeCycle(); // C6
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ---------- LSR $nnnn,X (ABS,X) — 7 cycles ----------
function LSR_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  checkReadOffset(dummy);                           consumeCycle(); // C4 dummy read
  const old = checkReadOffset(addr) & 0xFF;         consumeCycle(); // C5 real read
  checkWriteOffset(addr, old);                      consumeCycle(); // C6 old write
  const result = (old >>> 1) & 0xFF;
  CPUregisters.P.C = old & 1;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = 0;
  checkWriteOffset(addr, result);                   consumeCycle(); // C7 new write
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}
// ORA #imm — 2 cycles
function ORA_IMM() {
  // C1
  let value = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle(); // C2

  CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ORA $nn — 3 cycles
function ORA_ZP() {
  // C1
  const zpAddr = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle(); // C2
  let value = checkReadOffset(zpAddr) & 0xFF;
  consumeCycle(); // C3

  CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ORA $nn,X — 4 cycles
function ORA_ZPX() {
  // C1
  const base = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle(); // C3 dummy read/index add
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ORA $nnnn — 4 cycles
function ORA_ABS() {
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3
  const addr = (hi << 8) | lo;
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ORA $nnnn,X — 4 (+1 if page cross)
function ORA_ABSX() {
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ORA $nnnn,Y — 4 (+1 if page cross)
function ORA_ABSY() {
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ORA ($nn,X) — 6 cycles
function ORA_INDX() {
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const ptr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(zp);
  consumeCycle(); // C3 dummy read/index add

  const lo = checkReadOffset(ptr) & 0xFF;
  consumeCycle(); // C4
  const hi = checkReadOffset((ptr + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C5

  const addr = (hi << 8) | lo;
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C6

  CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ORA ($nn),Y — 5 (+1 if page cross)
function ORA_INDY() {
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const lo = checkReadOffset(zp & 0xFF);
  consumeCycle(); // C3
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C4

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A | value) & 0xFF;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// CMP #imm — 2 cycles
function CMP_IMM() {
  // C1
  const m = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const a = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function CMP_ZP() { // 3 cycles
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const m = checkReadOffset(zp & 0xFF);
  consumeCycle(); // C3

  const a = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function CMP_ZPX() { // 4 cycles
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;

  // C3: dummy read from unindexed zero-page base.
  checkReadOffset(zp);
  consumeCycle();

  // C4: final read
  const m = checkReadOffset(addr);
  consumeCycle();

  const a = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function CMP_ABS() { // 4 cycles
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const addr = ((hi << 8) | lo) & 0xFFFF;
  const m = checkReadOffset(addr);
  consumeCycle(); // C4

  const a = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function CMP_ABSX() { // 4 (+1 if page cross)
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    // C4: dummy read at old page + new low
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    // C5: final read
    const m = checkReadOffset(addr);
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const diff = (a - m) & 0xFF;
    CPUregisters.P.C = (a >= m) ? 1 : 0;
    CPUregisters.P.Z = (diff === 0) ? 1 : 0;
    CPUregisters.P.N = (diff >>> 7) & 1;
  } else {
    // C4: final read
    const m = checkReadOffset(addr);
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const diff = (a - m) & 0xFF;
    CPUregisters.P.C = (a >= m) ? 1 : 0;
    CPUregisters.P.Z = (diff === 0) ? 1 : 0;
    CPUregisters.P.N = (diff >>> 7) & 1;
  }
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function CMP_ABSY() { // 4 (+1 if page cross)
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    // C4: dummy read at old page + new low
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    // C5: final read
    const m = checkReadOffset(addr);
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const diff = (a - m) & 0xFF;
    CPUregisters.P.C = (a >= m) ? 1 : 0;
    CPUregisters.P.Z = (diff === 0) ? 1 : 0;
    CPUregisters.P.N = (diff >>> 7) & 1;
  } else {
    // C4: final read
    const m = checkReadOffset(addr);
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const diff = (a - m) & 0xFF;
    CPUregisters.P.C = (a >= m) ? 1 : 0;
    CPUregisters.P.Z = (diff === 0) ? 1 : 0;
    CPUregisters.P.N = (diff >>> 7) & 1;
  }
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function CMP_INDX() { // 6 cycles
  // C1
  const nn = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const ptr = (nn + (CPUregisters.X & 0xFF)) & 0xFF;

  // C3: dummy read from original zero-page operand.
  checkReadOffset(nn);
  consumeCycle();

  // C4: fetch low pointer byte
  const lo = checkReadOffset(ptr);
  consumeCycle();

  // C5: fetch high pointer byte
  const hi = checkReadOffset((ptr + 1) & 0xFF);
  consumeCycle();

  // C6: final read
  const addr = ((hi << 8) | lo) & 0xFFFF;
  const m = checkReadOffset(addr);
  consumeCycle();

  const a = CPUregisters.A & 0xFF;
  const diff = (a - m) & 0xFF;
  CPUregisters.P.C = (a >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function CMP_INDY() { // 5 (+1 if page cross)
  // C1
  const nn = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const lo = checkReadOffset(nn & 0xFF);
  consumeCycle(); // C3
  const hi = checkReadOffset((nn + 1) & 0xFF);
  consumeCycle(); // C4

  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    // C5: dummy read
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    // C6: final read
    const m = checkReadOffset(addr);
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const diff = (a - m) & 0xFF;
    CPUregisters.P.C = (a >= m) ? 1 : 0;
    CPUregisters.P.Z = (diff === 0) ? 1 : 0;
    CPUregisters.P.N = (diff >>> 7) & 1;
  } else {
    // C5: final read
    const m = checkReadOffset(addr);
    consumeCycle();

    const a = CPUregisters.A & 0xFF;
    const diff = (a - m) & 0xFF;
    CPUregisters.P.C = (a >= m) ? 1 : 0;
    CPUregisters.P.Z = (diff === 0) ? 1 : 0;
    CPUregisters.P.N = (diff >>> 7) & 1;
  }
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function CPY_IMM() { // 2 cycles
  // C1
  const m = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const y = CPUregisters.Y & 0xFF;
  const diff = (y - m) & 0xFF;
  CPUregisters.P.C = (y >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function CPY_ZP() { // 3 cycles
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const m = checkReadOffset(zp & 0xFF);
  consumeCycle(); // C3

  const y = CPUregisters.Y & 0xFF;
  const diff = (y - m) & 0xFF;
  CPUregisters.P.C = (y >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function CPY_ABS() { // 4 cycles
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const addr = ((hi << 8) | lo) & 0xFFFF;
  const m = checkReadOffset(addr);
  consumeCycle(); // C4

  const y = CPUregisters.Y & 0xFF;
  const diff = (y - m) & 0xFF;
  CPUregisters.P.C = (y >= m) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// ---------- DEC ----------
function DEC_ZP() { // 5 cycles (RMW)
  // C1
  const addr = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2

  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C3 (read)
  checkWriteOffset(addr, old);                       consumeCycle(); // C4 (dummy write)

  const val = (old - 1) & 0xFF;
  checkWriteOffset(addr, val);                       consumeCycle(); // C5 (final write)

  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function DEC_ZPX() { // 6 cycles (RMW)
  // C1
  const zp   = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF; checkReadOffset(zp); consumeCycle(); // C3 dummy read/index add

  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C4 (read)
  checkWriteOffset(addr, old);                       consumeCycle(); // C5 (dummy write)

  const val = (old - 1) & 0xFF;
  checkWriteOffset(addr, val);                       consumeCycle(); // C6 (final write)

  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function DEC_ABS() { // 6 cycles (RMW)
  // C1
  const lo   = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi   = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const addr = ((hi << 8) | lo) & 0xFFFF;

  const old = checkReadOffset(addr);                 consumeCycle(); // C4 (read)
  checkWriteOffset(addr, old);                       consumeCycle(); // C5 (dummy write)
  const val = (old - 1) & 0xFF;
  checkWriteOffset(addr, val);                       consumeCycle(); // C6 (final write)

  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function DEC_ABSX() {
  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const ea = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (ea & 0x00FF);
  checkReadOffset(dummy);                           consumeCycle(); // C4 dummy read
  const old = checkReadOffset(ea) & 0xFF;           consumeCycle(); // C5 real read
  checkWriteOffset(ea, old);                        consumeCycle(); // C6 old write
  const val = (old - 1) & 0xFF;
  CPUregisters.P.Z = val === 0 ? 1 : 0;
  CPUregisters.P.N = (val >>> 7) & 1;
  checkWriteOffset(ea, val);                        consumeCycle(); // C7 new write
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}

// -------- ROR zp — 5 cycles (read, dummy write, final write) --------
function ROR_ZP() { // 5 cycles (RMW)
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2

  const old = checkReadOffset(zp) & 0xFF;          consumeCycle(); // C3 (read)
  checkWriteOffset(zp, old);                       consumeCycle(); // C4 (dummy write)

  const carryIn  = CPUregisters.P.C & 1;
  const result   = ((old >>> 1) | (carryIn << 7)) & 0xFF;

  CPUregisters.P.C = old & 0x01;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;

  checkWriteOffset(zp, result);                    consumeCycle(); // C5 (final write)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ROR_ZPX() { // 6 cycles (RMW)
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);   consumeCycle(); // C2
  const addr = (zp + (CPUregisters.X & 0xFF)) & 0xFF; checkReadOffset(zp); consumeCycle(); // C3 dummy read/index add

  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C4 (read)
  checkWriteOffset(addr, old);                       consumeCycle(); // C5 (dummy write)

  const carryIn  = CPUregisters.P.C & 1;
  const result   = ((old >>> 1) | (carryIn << 7)) & 0xFF;

  CPUregisters.P.C = old & 0x01;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;

  checkWriteOffset(addr, result);                    consumeCycle(); // C6 (final write)
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// RRA (zp),Y — 8 cycles (no extra page-cross penalty for RMW)
function RRA_INDY() {
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF; consumeCycle(); // C2
  const lo = checkReadOffset(zp) & 0xFF; consumeCycle(); // C3
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF; consumeCycle(); // C4
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  checkReadOffset(dummy);                            consumeCycle(); // C5 indexed dummy
  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C6 real read
  checkWriteOffset(addr, old);                       consumeCycle(); // C7 old write
  const oldC = CPUregisters.P.C & 1;
  const rotated = ((old >>> 1) | (oldC << 7)) & 0xFF;
  CPUregisters.P.C = old & 1;
  checkWriteOffset(addr, rotated);                   consumeCycle(); // C8 new write
  const a=CPUregisters.A&0xFF,c=CPUregisters.P.C&1,sum=a+rotated+c,res=sum&0xFF;
  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.Z = res === 0 ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  CPUregisters.P.V = ((~(a ^ rotated) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;
}

function DCP_ZP() {
  // C1: opcode fetch
  // C2: fetch zp address
  const address = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read old
  let value = checkReadOffset(address) & 0xFF;
  consumeCycle();

  // C4: dummy write original value for RMW bus behavior.
  checkWriteOffset(address, value);
  consumeCycle();

  // Decrement and write
  value = (value - 1) & 0xFF;

  // C5: final write new
  checkWriteOffset(address, value);
  consumeCycle();

  // CMP (A - value)
  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function DCP_ZPX() {
  // C1: opcode fetch
  // C2: fetch zp base
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from unindexed base while X is added.
  const addressess = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: read old
  let value = checkReadOffset(addressess) & 0xFF;
  consumeCycle();

  // C5: dummy write old for RMW bus behavior.
  checkWriteOffset(addressess, value);
  consumeCycle();

  // Decrement and final write
  value = (value - 1) & 0xFF;

  // C6: final write
  checkWriteOffset(addressess, value);
  consumeCycle();

  // CMP (A - value)
  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ISC_ABSX() {
  // C1: opcode fetch
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: EA = base + X
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: write incremented
  const inc = (old + 1) & 0xFF;
  checkWriteOffset(addr, inc);
  consumeCycle();

  // SBC (internal; no extra beyond 7 total for ABS,X RMW)
  const a   = CPUregisters.A & 0xFF;
  const b   = (~inc) & 0xFF;
  const c   = CPUregisters.P.C & 1;
  const sum = a + b + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ b) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function ISC_ZPX() {
  // C1: opcode fetch
  // C2: fetch zp base
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from unindexed base while X is added.
  const pointer = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: read old
  const old = checkReadOffset(pointer) & 0xFF;
  consumeCycle();

  // C4: dummy write old (RMW bus pattern)
  checkWriteOffset(pointer, old);
  consumeCycle();

  // C5: write incremented
  const incv = (old + 1) & 0xFF;
  checkWriteOffset(pointer, incv);
  consumeCycle();

  // C6: internal SBC (A + ~M + C)
  const a   = CPUregisters.A & 0xFF;
  const b   = (~incv) & 0xFF;
  const c   = CPUregisters.P.C & 1;
  const sum = a + b + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = ((res === 0) & 1);
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ b) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// ---------- EOR ----------
// -------- EOR #imm — 2 cycles --------
function EOR_IMM() {
  // C1
  let value = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle(); // C2

  CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// -------- EOR zp — 3 cycles --------
function EOR_ZP() {
  // C1
  const zpAddr = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle(); // C2
  let value = checkReadOffset(zpAddr) & 0xFF;
  consumeCycle(); // C3

  CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// -------- EOR zp,X — 4 cycles --------
function EOR_ZPX() {
  // C1
  const base = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle(); // C3 dummy read/index add
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// -------- EOR abs — 4 cycles --------
function EOR_ABS() {
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3
  const addr = (hi << 8) | lo;
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// -------- EOR abs,X — 4 (+1 if page cross) --------
function EOR_ABSX() {
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// -------- EOR abs,Y — 4 (+1 if page cross) --------
function EOR_ABSY() {
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// -------- EOR (zp,X) — 6 cycles --------
function EOR_INDX() {
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const ptr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(zp);
  consumeCycle(); // C3 dummy read/index add

  const lo = checkReadOffset(ptr) & 0xFF;
  consumeCycle(); // C4
  const hi = checkReadOffset((ptr + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C5

  const addr = (hi << 8) | lo;
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C6

  CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// -------- EOR (zp),Y — 5 (+1 if page cross) --------
function EOR_INDY() {
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const lo = checkReadOffset(zp & 0xFF);
  consumeCycle(); // C3
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C4

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  }

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function JSR_ABS() { // 6 cycles total
  // C1 (opcode fetch already happened by dispatcher)

  // C2: read low operand
  const low = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF);
  consumeCycle();

  // C3: dummy read from stack (bus activity matters)
  // Use current S (no decrement) — it's a read on the stack page.
  checkReadOffset((0x0100 + CPUregisters.S) & 0xFFFF);
  consumeCycle();

  // return address = PC+2 (points to last operand byte)
  const returnAddr = (CPUregisters.PC + 2) & 0xFFFF;

  // C4: push return high
  checkWriteOffset((0x0100 + CPUregisters.S) & 0xFFFF, (returnAddr >>> 8) & 0xFF);
  consumeCycle();
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // C5: push return low
  checkWriteOffset((0x0100 + CPUregisters.S) & 0xFFFF, returnAddr & 0xFF);
  consumeCycle();
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;

  // C6: read high operand LAST (this is the key for open-bus priming)
  const high = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF);
  consumeCycle();

  CPUregisters.PC = ((high << 8) | low) & 0xFFFF;

}

function STY_ZP() { // 3 cycles
  // C1
  const address = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  checkWriteOffset(address, CPUregisters.Y);            consumeCycle(); // C3
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function STY_ZPX() { // 4 cycles
  // C1
  const base = checkReadOffset(CPUregisters.PC + 1) & 0xFF; consumeCycle(); // C2
  const address = (base + CPUregisters.X) & 0xFF;
  checkReadOffset(base); consumeCycle(); // C3 dummy read/index add
  checkWriteOffset(address, CPUregisters.Y);                                   consumeCycle(); // C4
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function STY_ABS() { // 4 cycles
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const address = (hi << 8) | lo;
  checkWriteOffset(address, CPUregisters.Y);       consumeCycle(); // C4
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function LDY_IMM() { // 2 cycles
  // C1
  const val        = checkReadOffset(CPUregisters.PC + 1);
  CPUregisters.Y   = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  consumeCycle(); // C2
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDY_ZP() { // 3 cycles
  // C1
  const zpAddr = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  let value  = checkReadOffset(zpAddr & 0xFF);       consumeCycle(); // C3
  CPUregisters.Y = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDY_ZPX() { // 4 cycles
  // C1

  // C2: fetch base zp
  const base = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle();

  // Effective zero-page address
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFF;

  // C3: dummy read from unindexed zero-page base.
  checkReadOffset(base);
  consumeCycle();

  // C4: final read
  const val = checkReadOffset(addr);
  consumeCycle();

  CPUregisters.Y = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LDY_ABS() { // 4 cycles
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const address = (hi << 8) | lo;
  let value   = checkReadOffset(address);        consumeCycle(); // C4
  CPUregisters.Y = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function LDY_ABSX() { // 4 (+1 if page cross)
  // C1

  const lo = checkReadOffset(CPUregisters.PC + 1); consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2); consumeCycle(); // C3
  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    // C4: dummy read at old page + new low
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    // C5: final read
    CPUregisters.Y = checkReadOffset(addr);
    consumeCycle();
  } else {
    // C4: final read (no cross)
    CPUregisters.Y = checkReadOffset(addr);
    consumeCycle();
  }

  CPUregisters.P.Z = (CPUregisters.Y === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.Y & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function sbc_core(a, m, c) {
  // Invert memory for subtraction (SBC = A + ~M + C)
  let value  = (~m) & 0xFF;
  const carry  = c & 1;
  const sum    = a + value + carry;
  const result = sum & 0xFF;

  // Carry out (bit 8 of sum)
  if ((sum >> 8) & 1) CPUregisters.P.C = 1;
  else CPUregisters.P.C = 0;

  // Overflow flag
  const overflow = (~(a ^ value) & (a ^ result) & 0x80);
  if (overflow !== 0) CPUregisters.P.V = 1;
  else CPUregisters.P.V = 0;

  // Zero flag
  if (result === 0) CPUregisters.P.Z = 1;
  else CPUregisters.P.Z = 0;

  // Negative flag
  if ((result & 0x80) !== 0) CPUregisters.P.N = 1;
  else CPUregisters.P.N = 0;

  return result;
}

function SBC_IMM() { // 2 cycles
  // C1
  let value = checkReadOffset(CPUregisters.PC + 1) & 0xFF;
  consumeCycle(); // C2

  CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;
}

function SBC_ZP() { // 3 cycles
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  let value = checkReadOffset(zp & 0xFF) & 0xFF;
  consumeCycle(); // C3

  CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SBC_ZPX() { // 4 cycles
  // C1
  const base = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle(); // C3 dummy read/index add (internal index)
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SBC_ABS() { // 4 cycles
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3
  const addr = (hi << 8) | lo;
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C4

  CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SBC_ABSX() { // 4 (+1 if page cross)
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  }
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SBC_ABSY() { // 4 (+1 if page cross)
  // C1
  const lo = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const hi = checkReadOffset(CPUregisters.PC + 2);
  consumeCycle(); // C3

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  }
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SBC_INDX() { // 6 cycles
  // C1
  const zpbase = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2
  const zpaddr = (zpbase + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(zpbase);
  consumeCycle(); // C3 dummy read/index add

  const lo = checkReadOffset(zpaddr) & 0xFF;
  consumeCycle(); // C4
  const hi = checkReadOffset((zpaddr + 1) & 0xFF) & 0xFF;
  consumeCycle(); // C5

  const addr = (hi << 8) | lo;
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle(); // C6

  CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SBC_INDY() { // 5 (+1 if page cross)
  // C1
  const zp = checkReadOffset(CPUregisters.PC + 1);
  consumeCycle(); // C2

  const lo = checkReadOffset(zp & 0xFF);
  consumeCycle(); // C3
  const hi = checkReadOffset((zp + 1) & 0xFF);
  consumeCycle(); // C4

  const base = (hi << 8) | lo;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  if ((base & 0xFF00) !== (addr & 0xFF00)) {
    const dummy = (base & 0xFF00) | (addr & 0x00FF);
    
    checkReadOffset(dummy);
    
    consumeCycle();

    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  } else {
    let value = checkReadOffset(addr) & 0xFF;
    consumeCycle();

    CPUregisters.A = sbc_core(CPUregisters.A, value, CPUregisters.P.C);
  }
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// TYA — implied (2 cycles: fetch, execute)
function TYA_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: transfer + flags
  CPUregisters.A = CPUregisters.Y & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// TXA — implied (2 cycles: fetch, execute)
function TXA_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: transfer + flags
  CPUregisters.A = CPUregisters.X & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// PHP — implied (3 cycles: fetch, write P, dec S)
// Pushes P with B=1 and U=1 in the pushed byte.
function PHP_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  consumeCycle();
  // Build status byte (with B=1, U=1)
  let p =
      ((CPUregisters.P.C & 1) << 0) |
      ((CPUregisters.P.Z & 1) << 1) |
      ((CPUregisters.P.I & 1) << 2) |
      ((CPUregisters.P.D & 1) << 3) |
      (1 << 4) |                 // B set when pushing
      (1 << 5) |                 // U always 1
      ((CPUregisters.P.V & 1) << 6) |
      ((CPUregisters.P.N & 1) << 7);

  // C3: write P to stack
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), p & 0xFF);
  consumeCycle();

  // Stack pointer changes after the write.
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// PLP — fetch, PC dummy read, stack dummy read, status pull (4 cycles).
// Restores C,Z,I,D,V,N from pulled byte; ignores B; forces U=1.
function PLP_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  consumeCycle();
  checkReadOffset(0x100|CPUregisters.S);
  consumeCycle();
  CPUregisters.S=(CPUregisters.S+1)&255;
  const pv = checkReadOffset(0x0100 | (CPUregisters.S & 0xFF)) & 0xFF;

  // C4: apply flags (B ignored, U forced)
  CPUregisters.P.C =  pv        & 1;
  CPUregisters.P.Z = (pv >> 1)  & 1;
  CPUregisters.P.I = (pv >> 2)  & 1;
  CPUregisters.P.D = (pv >> 3)  & 1;
  CPUregisters.P.V = (pv >> 6)  & 1;
  CPUregisters.P.N = (pv >> 7)  & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// PHA — fetch, dummy read, stack write (3 cycles).
function PHA_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  consumeCycle();
  // C3: write A to stack
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), CPUregisters.A & 0xFF);
  consumeCycle();

  // Stack pointer changes after the write.
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// PLA — fetch, PC dummy read, stack dummy read, stack pull (4 cycles).
function PLA_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  consumeCycle();
  checkReadOffset(0x100|CPUregisters.S);
  consumeCycle();
  CPUregisters.S=(CPUregisters.S+1)&255;
  const val = checkReadOffset(0x0100 | (CPUregisters.S & 0xFF)) & 0xFF;

  // C4: transfer to A + flags
  CPUregisters.A   = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// RTI — fetch, two dummy reads, then pull P, PCL and PCH (6 cycles).
// B ignored, U forced to 1 when restoring P.
function RTI_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  consumeCycle();
  checkReadOffset(0x100|CPUregisters.S);
  consumeCycle();
  CPUregisters.S=(CPUregisters.S+1)&255;
  const pv = checkReadOffset(0x0100 | (CPUregisters.S & 0xFF)) & 0xFF;
  CPUregisters.P.C =  pv        & 1;
  CPUregisters.P.Z = (pv >> 1)  & 1;
  CPUregisters.P.I = (pv >> 2)  & 1;
  CPUregisters.P.D = (pv >> 3)  & 1;
  CPUregisters.P.V = (pv >> 6)  & 1;
  CPUregisters.P.N = (pv >> 7)  & 1;
  consumeCycle();

  // C4: pre-increment S (for PCL)
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;

  // C5: read PCL
  const pcl = checkReadOffset(0x0100 | (CPUregisters.S & 0xFF)) & 0xFF;
  consumeCycle();

  // C6: pre-increment S, read PCH, set PC
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;
  const pch = checkReadOffset(0x0100 | (CPUregisters.S & 0xFF)) & 0xFF;
  CPUregisters.PC = ((pch << 8) | pcl) & 0xFFFF;
  consumeCycle();
}

// ---------------- RTS (implied) — 6 cycles ----------------
function RTS_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  consumeCycle();
  checkReadOffset(0x100|CPUregisters.S);
  consumeCycle();
  CPUregisters.S=(CPUregisters.S+1)&255;
  const pcl = checkReadOffset(0x0100 | (CPUregisters.S & 0xFF)) & 0xFF;
  consumeCycle();

  // C4: pre-increment S
  CPUregisters.S = (CPUregisters.S + 1) & 0xFF;

  // C5: read PCH
  const pch = checkReadOffset(0x0100 | (CPUregisters.S & 0xFF)) & 0xFF;
  consumeCycle();

  // C6: set PC = (PCH:PCL)+1
  checkReadOffset((pch<<8)|pcl);
  CPUregisters.PC = (((pch << 8) | pcl) + 1) & 0xFFFF;
  consumeCycle();
}

function NOP_HANDLER() {

  const opcode = code;

  switch (opcode) {

    // ------------------------------------------------
    // 1-byte NOPs (2 cycles)
    // EA, 1A, 3A, 5A, 7A, DA, FA
    // ------------------------------------------------
    case 0xEA:
    case 0x1A:
    case 0x3A:
    case 0x5A:
    case 0x7A:
    case 0xDA:
    case 0xFA:
      checkReadOffset((CPUregisters.PC+1)&0xffff);
      consumeCycle();
      CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;
      return;


    // ------------------------------------------------
    // Immediate NOP (2 bytes, 2 cycles)
    // 80, 82, 89, C2, E2
    // ------------------------------------------------
    case 0x80:
    case 0x82:
    case 0x89:
    case 0xC2:
    case 0xE2:
      checkReadOffset((CPUregisters.PC + 1) & 0xFFFF);
      consumeCycle();
      CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;
      return;


    // ------------------------------------------------
    // Zero page NOP (2 bytes, 3 cycles)
    // 04, 44, 64
    // ------------------------------------------------
    case 0x04:
    case 0x44:
    case 0x64: {
      const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
      consumeCycle();

      checkReadOffset(zp);
      consumeCycle();

      CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;
      return;
    }


    // ------------------------------------------------
    // Zero page,X NOP (2 bytes, 4 cycles)
    // 14, 34, 54, 74, D4, F4
    // ------------------------------------------------
    case 0x14:
    case 0x34:
    case 0x54:
    case 0x74:
    case 0xD4:
    case 0xF4: {
      const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
      consumeCycle();

      checkReadOffset(zp);
      consumeCycle();

      checkReadOffset((zp + CPUregisters.X) & 0xFF);
      consumeCycle();
      CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;
      return;
    }


    // ------------------------------------------------
    // Absolute NOP (3 bytes, 4 cycles)
    // 0C
    // ------------------------------------------------
    case 0x0C: {
      const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF);
      consumeCycle();

      const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF);
      consumeCycle();

      const addr = (hi << 8) | lo;

      checkReadOffset(addr);
      consumeCycle();

      CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
      return;
    }


    // ------------------------------------------------
    // Absolute,X NOP (3 bytes, 4–5 cycles)
    // 1C, 3C, 5C, 7C, DC, FC
    // ------------------------------------------------
    case 0x1C:
    case 0x3C:
    case 0x5C:
    case 0x7C:
    case 0xDC:
    case 0xFC: {
      const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF);
      consumeCycle();

      const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF);
      consumeCycle();

      const base = (hi << 8) | lo;
      const addr = (base + CPUregisters.X) & 0xFFFF;
      const dummy = (base & 0xFF00) | (addr & 0x00FF);

      // C4 always reads the uncorrected indexed address.
      checkReadOffset(dummy);
      consumeCycle();

      // A page cross performs the corrected read on C5.
      if ((base & 0xFF00) !== (addr & 0xFF00)) {
        checkReadOffset(addr);
        consumeCycle();
      }

      CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
      return;
    }

  }

}

// -------- SKB (imm) — 2 cycles --------
function SKB_IMM() {
  // C1: opcode fetch
  consumeCycle();
  // C2: fetch immediate (dummy)
  checkReadOffset((CPUregisters.PC + 1) & 0xFFFF);
  consumeCycle();
}

// -------- CPX #imm — 2 cycles --------
function CPX_IMM() {
  // C1: opcode fetch
  // C2: fetch immediate and compute
  let value  = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  const diff = (CPUregisters.X - value) & 0xFF;
  CPUregisters.P.C = ((CPUregisters.X & 0xFF) >= value) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// -------- CPX zp — 3 cycles --------
function CPX_ZP() {
  // C1: opcode fetch
  // C2: fetch zp address
  const address = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read value
  let value = checkReadOffset(address) & 0xFF;
  consumeCycle();

  const diff = (CPUregisters.X - value) & 0xFF;
  CPUregisters.P.C = ((CPUregisters.X & 0xFF) >= value) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// -------- CPX abs — 4 cycles --------
function CPX_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: read operand
  const address = ((hi << 8) | lo) & 0xFFFF;
  let value   = checkReadOffset(address) & 0xFF;
  consumeCycle();

  const diff = (CPUregisters.X - value) & 0xFF;
  CPUregisters.P.C = ((CPUregisters.X & 0xFF) >= value) ? 1 : 0;
  CPUregisters.P.Z = (diff === 0) ? 1 : 0;
  CPUregisters.P.N = (diff & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// -------- DEX — 2 cycles --------
function DEX_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: execute
  CPUregisters.X = (CPUregisters.X - 1) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X >> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// -------- DEY — 2 cycles --------
function DEY_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: execute
  CPUregisters.Y = (CPUregisters.Y - 1) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.Y === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.Y >> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// -------- INX — 2 cycles --------
function INX_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: execute
  CPUregisters.X = (CPUregisters.X + 1) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X >> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// -------- INY — 2 cycles --------
function INY_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: execute
  CPUregisters.Y = (CPUregisters.Y + 1) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.Y === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.Y >> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}
// -------- ROR A (accumulator) — 2 cycles --------
function ROR_ACC() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: execute (read/modify A)
  const carryIn = CPUregisters.P.C & 1;
  CPUregisters.P.C = (CPUregisters.A & 0x01) ? 1 : 0;
  CPUregisters.A   = ((CPUregisters.A >>> 1) | (carryIn << 7)) & 0xFF;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// -------- ROR abs — 6 cycles --------
function ROR_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C4: read operand
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C5: dummy write (old)
  checkWriteOffset(addr, old);
  consumeCycle();

  // C6: final write (new)
  const carryIn  = CPUregisters.P.C & 1;
  const carryOut = old & 0x01;
  const result   = ((old >>> 1) | (carryIn << 7)) & 0xFF;
  checkWriteOffset(addr, result);
  consumeCycle();

  CPUregisters.P.C = carryOut ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// -------- ROR abs,X — 7 cycles --------
function ROR_ABSX() {
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF; consumeCycle(); // C2
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF; consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  checkReadOffset(dummy);                           consumeCycle(); // C4 dummy read
  const old = checkReadOffset(addr) & 0xFF;         consumeCycle(); // C5 real read
  checkWriteOffset(addr, old);                      consumeCycle(); // C6 old write
  const carryIn = CPUregisters.P.C & 1;
  const result = ((old >>> 1) | (carryIn << 7)) & 0xFF;
  CPUregisters.P.C = old & 1;
  CPUregisters.P.Z = result === 0 ? 1 : 0;
  CPUregisters.P.N = (result >>> 7) & 1;
  checkWriteOffset(addr, result);                   consumeCycle(); // C7 new write
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}
// -------- TAX (implied) — 2 cycles --------
function TAX_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: execute transfer + flags
  CPUregisters.X = CPUregisters.A & 0xFF;
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// -------- TAY (implied) — 2 cycles --------
function TAY_IMP() {
  checkReadOffset((CPUregisters.PC+1)&0xffff);
  // C1: opcode fetch
  // C2: execute transfer + flags
  CPUregisters.Y = CPUregisters.A & 0xFF;
  CPUregisters.P.Z = (CPUregisters.Y === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.Y >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 1) & 0xFFFF;

}

// -------- STX zp — 3 cycles --------
function STX_ZP() {
  // C1: opcode fetch
  // C2: fetch zp address
  const addr = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: write X to zp
  checkWriteOffset(addr, CPUregisters.X & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// -------- STX zp,Y — 4 cycles --------
function STX_ZPY() {
  // C1: opcode fetch
  // C2: fetch zp base
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: index add; external bus reads the unindexed base.
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: write X
  checkWriteOffset(addr, CPUregisters.X & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// -------- STX abs — 4 cycles --------
function STX_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const address = ((hi << 8) | lo) & 0xFFFF;

  // C4: write X
  checkWriteOffset(address, CPUregisters.X & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

  //          ................. illegalOpcode functions ................. 

// LAX #imm — 2 cycles
function LAX_IMM() {
  // C1: opcode fetch
  // C2: unstable LAX/LXA immediate on RP2A03. Like XAA, this profile
  // combines the old accumulator with the $EE internal-bus mask.
  const imm = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const val = ((CPUregisters.A | 0xEE) & imm) & 0xFF;
  CPUregisters.A = CPUregisters.X = val;
  CPUregisters.P.Z = (val === 0) ? 1 : 0;
  CPUregisters.P.N = (val >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// RRA (zp,X) — 8 cycles
function RRA_INDX() {
  // C1: opcode fetch
  // C2: fetch zp operand
  const op = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from original zero-page operand while X is added.
  checkReadOffset(op);
  consumeCycle();

  // C4: read pointer low (zp+X)
  const ptr = (op + (CPUregisters.X & 0xFF)) & 0xFF;
  const lo  = checkReadOffset(ptr) & 0xFF;
  consumeCycle();

  // C5: read pointer high (zp+X+1)
  const hi  = checkReadOffset((ptr + 1) & 0xFF) & 0xFF; // ZP wrap
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C5: read old value @EA
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old value
  checkWriteOffset(addr, old);
  consumeCycle();

  // ROR through carry (internal ALU)
  const oldC = CPUregisters.P.C & 1;
  CPUregisters.P.C = old & 1;
  const rotated = ((old >> 1) | (oldC << 7)) & 0xFF;

  // C7: final write rotated value
  checkWriteOffset(addr, rotated);
  consumeCycle();

  // C8: ADC A + rotated + C (internal)
  const a   = CPUregisters.A & 0xFF;
  const c   = CPUregisters.P.C & 1;
  const sum = a + rotated + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ rotated) & (a ^ res) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// RRA zp — 5 cycles
function RRA_ZP() {
  // C1: opcode fetch
  // C2: fetch zp addr
  const addr = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read value
  let val = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C4: dummy write original value.
  checkWriteOffset(addr, val);
  consumeCycle();

  // C5: rotate and write back
  const oldCarry = CPUregisters.P.C & 1;
  CPUregisters.P.C = val & 0x01;
  val = ((val >>> 1) | (oldCarry << 7)) & 0xFF;
  checkWriteOffset(addr, val);
  consumeCycle();

  // ADC (internal, no extra bus)
  const acc     = CPUregisters.A & 0xFF;
  const carryIn = CPUregisters.P.C & 1;
  const sum     = acc + val + carryIn;
  const res     = sum & 0xFF;

  CPUregisters.P.C = (sum > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  CPUregisters.P.V = ((~(acc ^ val) & (acc ^ res) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// RRA zp,X — 6 cycles
function RRA_ZPX() {
  // C1: opcode fetch
  // C2: fetch zp base
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from unindexed base while X is added.
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: read value
  let val = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C5: dummy write original value.
  const oldCarry = CPUregisters.P.C & 1;
  checkWriteOffset(addr, val);
  consumeCycle();

  // C6: rotate, final write, and ADC on the same cycle.
  CPUregisters.P.C = val & 0x01;
  val = ((val >>> 1) | (oldCarry << 7)) & 0xFF;
  checkWriteOffset(addr, val);
  consumeCycle();
  const acc     = CPUregisters.A & 0xFF;
  const carryIn = CPUregisters.P.C & 1;
  const sum     = acc + val + carryIn;
  const res     = sum & 0xFF;

  CPUregisters.P.C = (sum > 0xFF) ? 1 : 0;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  CPUregisters.P.V = ((~(acc ^ val) & (acc ^ res) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// RRA abs — 6 cycles
function RRA_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C4: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C5: dummy write old, compute rotate
  checkWriteOffset(addr, old);
  const oldCarry = CPUregisters.P.C & 1;
  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  const rotated = ((old >>> 1) | (oldCarry << 7)) & 0xFF;
  consumeCycle();

  // C6: final write rotated, then ADC (internal)
  checkWriteOffset(addr, rotated);
  const acc     = CPUregisters.A & 0xFF;
  const carryIn = CPUregisters.P.C & 1;
  const result  = acc + rotated + carryIn;

  CPUregisters.P.N = (result >>> 7) & 1;
  CPUregisters.P.Z = ((result & 0xFF) === 0) ? 1 : 0;
  CPUregisters.P.V = (((~(acc ^ rotated) & (acc ^ result)) & 0x80) !== 0) ? 1 : 0;
  CPUregisters.P.C = (result > 0xFF) ? 1 : 0;
  CPUregisters.A   = result & 0xFF;

  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}
// RRA $nnnn,X — 7 cycles
function RRA_ABSX() {
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF; consumeCycle(); // C2
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF; consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  checkReadOffset(dummy);                            consumeCycle(); // C4 indexed dummy
  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C5 real read
  checkWriteOffset(addr, old);                       consumeCycle(); // C6 old write
  const oldC = CPUregisters.P.C & 1;
  const rotated = ((old >>> 1) | (oldC << 7)) & 0xFF;
  CPUregisters.P.C = old & 1;
  checkWriteOffset(addr, rotated);                   consumeCycle(); // C7 new write
  const a=CPUregisters.A&0xFF,c=CPUregisters.P.C&1,sum=a+rotated+c,res=sum&0xFF;
  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.Z = res === 0 ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  CPUregisters.P.V = ((~(a ^ rotated) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A = res;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}

// RRA $nnnn,Y — 7 cycles
function RRA_ABSY() {
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF; consumeCycle(); // C2
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF; consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  checkReadOffset(dummy);                            consumeCycle(); // C4 indexed dummy
  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C5 real read
  checkWriteOffset(addr, old);                       consumeCycle(); // C6 old write
  const oldC = CPUregisters.P.C & 1;
  const rotated = ((old >>> 1) | (oldC << 7)) & 0xFF;
  CPUregisters.P.C = old & 1;
  checkWriteOffset(addr, rotated);                   consumeCycle(); // C7 new write
  const a=CPUregisters.A&0xFF,c=CPUregisters.P.C&1,sum=a+rotated+c,res=sum&0xFF;
  CPUregisters.P.C = sum > 0xFF ? 1 : 0;
  CPUregisters.P.Z = res === 0 ? 1 : 0;
  CPUregisters.P.N = (res >>> 7) & 1;
  CPUregisters.P.V = ((~(a ^ rotated) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A = res;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}

// LAX $nn — 3 cycles
function LAX_ZP() {
  // C1: opcode fetch
  // C2: fetch zp address
  const address = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read from zp, load A/X, set flags
  let value = checkReadOffset(address) & 0xFF;
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// LAX $nnnn — 4 cycles
function LAX_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const address = ((hi << 8) | lo) & 0xFFFF;

  // C4: read @abs, load A/X, set flags
  let value = checkReadOffset(address) & 0xFF;
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

// LAX $nn,Y — 4 cycles
function LAX_ZPY() {
  // C1: opcode fetch
  // C2: fetch zp base
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from unindexed base while Y is added.
  const address = (base + (CPUregisters.Y & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: read, load A/X, set flags
  let value = checkReadOffset(address) & 0xFF;
  consumeCycle();
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// LAX $nnnn,Y — 4 (+1 if page cross) cycles
function LAX_ABSY() {
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF; consumeCycle(); // C2
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF; consumeCycle(); // C3
  const base = ((hi << 8) | lo) & 0xFFFF;
  const address = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  if ((base & 0xFF00) !== (address & 0xFF00)) {
    checkReadOffset((base & 0xFF00) | (address & 0x00FF));
    consumeCycle();                                 // C4 page-cross dummy
  }
  const value = checkReadOffset(address) & 0xFF;     consumeCycle(); // C4/C5 real read
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = value === 0 ? 1 : 0;
  CPUregisters.P.N = (value >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;
}

// LAX (zp,X) — 6 cycles
function LAX_INDX() {
  // C1: opcode fetch
  // C2: fetch zp operand
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from original zero-page operand while X is added.
  checkReadOffset(zp);
  consumeCycle();

  // C4: read pointer low at (zp+X)
  const ptr = (zp + (CPUregisters.X & 0xFF)) & 0xFF;
  const lo  = checkReadOffset(ptr) & 0xFF;
  consumeCycle();

  // C5: read pointer high at (zp+X+1) (wrap)
  const hi  = checkReadOffset((ptr + 1) & 0xFF) & 0xFF;
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C6: read @EA and load A/X
  let value = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// LAX (zp),Y — 5 (+1 if page cross) cycles
function LAX_INDY() {
  // C1: opcode fetch
  // C2: fetch zp operand
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read pointer low @zp
  const lo = checkReadOffset(zp) & 0xFF;
  consumeCycle();

  // C4: read pointer high @(zp+1)
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle();

  const base = ((hi << 8) | lo) & 0xFFFF;
  const effective = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;

  // page cross (+1)
  if (((base ^ effective) & 0xFF00) !== 0) {
    checkReadOffset((base&0xff00)|(effective&255));
    consumeCycle();
  }

  // C5: read @EA
  let value = checkReadOffset(effective) & 0xFF;
  consumeCycle();

  // Load A/X and flags without an additional bus cycle
  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}
function SAX_ZP() {
  // C1: opcode fetch
  // C2: fetch zp addr
  const address = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: write (A & X)
  checkWriteOffset(address, (CPUregisters.A & CPUregisters.X) & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SAX_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const address = ((hi << 8) | lo) & 0xFFFF;

  // C4: write (A & X)
  checkWriteOffset(address, (CPUregisters.A & CPUregisters.X) & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SAX_INDX() {
  // C1: opcode fetch
  // C2: fetch zp base
  const zpBase = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from original zero-page operand while X is added.
  checkReadOffset(zpBase);
  consumeCycle();

  // C4: read pointer low at (zpBase+X)
  const zpAddr = (zpBase + (CPUregisters.X & 0xFF)) & 0xFF;
  const low = checkReadOffset(zpAddr) & 0xFF;
  consumeCycle();

  // C5: read pointer high at (zpBase+X+1) (wrap)
  const high = checkReadOffset((zpAddr + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C6: write (A & X)
  const addr = ((high << 8) | low) & 0xFFFF;
  checkWriteOffset(addr, (CPUregisters.A & CPUregisters.X) & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SAX_ZPY() {
  // C1: opcode fetch
  // C2: fetch zp base
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from unindexed base while Y is added.
  const pointer = (base + (CPUregisters.Y & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: write (A & X)
  checkWriteOffset(pointer, (CPUregisters.A & CPUregisters.X) & 0xFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function DCP_ABS() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C4: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C5: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // Decrement
  let value = (old - 1) & 0xFF;

  // C6: final write new
  checkWriteOffset(addr, value);
  consumeCycle();

  // CMP (A - value)
  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function DCP_ABSX() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const base = ((hi << 8) | lo) & 0xFFFF;

  // C4: internal address calc (base+X)
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // Decrement and final write
  let value = (old - 1) & 0xFF;

  // C7: final write new
  checkWriteOffset(addr, value);
  consumeCycle();

  // CMP (A - value)
  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function DCP_ABSY() {
  // C1: opcode fetch
  // C2: fetch low
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const base = ((hi << 8) | lo) & 0xFFFF;

  // C4: internal address calc (base+Y)
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // Decrement and final write
  let value = (old - 1) & 0xFF;

  // C7: final write new
  checkWriteOffset(addr, value);
  consumeCycle();

  // CMP (A - value)
  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function DCP_INDX() {
  // C1: opcode fetch
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from original zero-page operand while X is added.
  checkReadOffset(zp);
  consumeCycle();

  // C4: read pointer low @ (zp+X)
  const ptrl = checkReadOffset((zp + (CPUregisters.X & 0xFF)) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read pointer high @ (zp+X+1)
  const ptrh = checkReadOffset((zp + (CPUregisters.X & 0xFF) + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read old @EA
  const addr = ((ptrh << 8) | ptrl) & 0xFFFF;
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: final write (decremented)
  let value = (old - 1) & 0xFF;
  checkWriteOffset(addr, value);
  consumeCycle();

  // C8: internal CMP
  const result = (CPUregisters.A - value) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= value) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function DCP_INDY() {
  // C1: opcode fetch
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read pointer low @zp
  const lo = checkReadOffset(zp) & 0xFF;
  consumeCycle();

  // C4: read pointer high @(zp+1)
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: internal address calc (base+Y)
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C6: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C7: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C8: final write (decremented)
  const dec = (old - 1) & 0xFF;
  checkWriteOffset(addr, dec);
  consumeCycle();

  // CMP (A - dec) (internal, no extra cycle beyond the 8 already modeled)
  const result = (CPUregisters.A - dec) & 0xFF;
  CPUregisters.P.C = (CPUregisters.A >= dec) ? 1 : 0;
  CPUregisters.P.Z = (result === 0) ? 1 : 0;
  CPUregisters.P.N = (result & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ISC_ABSY() {
  // C1: opcode fetch
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: EA = base + Y
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: write incremented
  const inc = (old + 1) & 0xFF;
  checkWriteOffset(addr, inc);
  consumeCycle();

  // SBC internal
  const a   = CPUregisters.A & 0xFF;
  const b   = (~inc) & 0xFF;
  const c   = CPUregisters.P.C & 1;
  const sum = a + b + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ b) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function ISC_INDX() {
  // C1: opcode fetch
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from original zero-page operand while X is added.
  checkReadOffset(zp);
  consumeCycle();

  // C4: read ptr low @(zp+X)
  const ptrl = checkReadOffset((zp + (CPUregisters.X & 0xFF)) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read ptr high @(zp+X+1)
  const ptrh = checkReadOffset((zp + (CPUregisters.X & 0xFF) + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read old @EA
  const addr = ((ptrh << 8) | ptrl) & 0xFFFF;
  const old  = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: write incremented
  const inc = (old + 1) & 0xFF;
  checkWriteOffset(addr, inc);
  consumeCycle();

  // C8: internal SBC
  const a   = CPUregisters.A & 0xFF;
  const b   = (~inc) & 0xFF;
  const c   = CPUregisters.P.C & 1;
  const sum = a + b + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = ((res === 0) & 1);
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ b) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ISC_INDY() {
  // C1: opcode fetch
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read lo @zp
  const lo = checkReadOffset(zp) & 0xFF;
  consumeCycle();

  // C4: read hi @(zp+1)
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: EA = base + Y
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C6: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C7: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C8: write incremented
  const inc = (old + 1) & 0xFF;
  checkWriteOffset(addr, inc);
  consumeCycle();

  // SBC internal
  const a   = CPUregisters.A & 0xFF;
  const b   = (~inc) & 0xFF;
  const c   = CPUregisters.P.C & 1;
  const sum = a + b + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ b) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SLO_ZP() {
  // C1: opcode fetch
  // C2: fetch zp
  const address = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read old
  const old = checkReadOffset(address) & 0xFF;
  consumeCycle();

  // C4: dummy write old
  checkWriteOffset(address, old);
  consumeCycle();

  // C5: write shifted, then ORA
  let value = ((old << 1) & 0xFF);
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  checkWriteOffset(address, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SLO_ABS() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C4: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C5: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C6: write shifted & ORA
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = (old << 1) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SLO_ABSX() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: EA = base+X
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: write shifted & ORA
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = (old << 1) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SLO_ABSY() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: EA = base+Y
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: write shifted & ORA
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = (old << 1) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SLO_INDX() {
  // C1: opcode
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from original zero-page operand while X is added.
  checkReadOffset(zp);
  consumeCycle();

  // C4: read low @(zp+X)
  const low = checkReadOffset((zp + (CPUregisters.X & 0xFF)) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read high @(zp+X+1)
  const high = checkReadOffset((zp + (CPUregisters.X & 0xFF) + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read old @EA
  const addr = ((high << 8) | low) & 0xFFFF;
  const old  = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: write shifted
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = (old << 1) & 0xFF;
  checkWriteOffset(addr, value);
  consumeCycle();

  // C8: ORA into A
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SLO_INDY() {
  // C1: opcode
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read lo @zp
  const lo = checkReadOffset(zp) & 0xFF;
  consumeCycle();

  // C4: read hi @(zp+1)
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: EA = base+Y
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C6: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C7: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C8: write shifted & ORA
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = (old << 1) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SLO_ZPX() {
  // C1: opcode
  // C2: fetch zp
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from unindexed base while X is added.
  const pointer = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: read old
  const old = checkReadOffset(pointer) & 0xFF;
  consumeCycle();

  // C4: dummy write old
  checkWriteOffset(pointer, old);
  consumeCycle();

  // C5: write shifted
  let value = (old << 1) & 0xFF;
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  checkWriteOffset(pointer, value);
  consumeCycle();

  // C6: ORA into A
  CPUregisters.A |= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ISC_ZP() {
  // C1: opcode fetch
  // C2: fetch zp
  const addr = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read old
  const m0 = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C4: dummy write old
  checkWriteOffset(addr, m0);
  consumeCycle();

  // C5: write incremented
  const m1 = (m0 + 1) & 0xFF;
  checkWriteOffset(addr, m1);
  consumeCycle();

  // SBC internal
  const a   = CPUregisters.A & 0xFF;
  const b   = (~m1) & 0xFF;
  const c   = (CPUregisters.P.C & 1);
  const sum = a + b + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = ((res === 0) & 1);
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ b) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}
function ISC_ABS() {
  // C1: opcode fetch
  // C2: fetch low byte
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: fetch high byte
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C4: read old value
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C5: dummy write of old value
  checkWriteOffset(addr, old);
  consumeCycle();

  // C6: write incremented value
  const inc = (old + 1) & 0xFF;
  checkWriteOffset(addr, inc);
  consumeCycle();

  // SBC via A + (~inc) + C  (internal ALU work fits in prior timing)
  const a   = CPUregisters.A & 0xFF;
  const b   = (~inc) & 0xFF;
  const c   = CPUregisters.P.C & 1;
  const sum = a + b + c;
  const res = sum & 0xFF;

  CPUregisters.P.C = (sum >> 8) & 1;
  CPUregisters.P.Z = (res === 0) ? 1 : 0;
  CPUregisters.P.N = (res >> 7) & 1;
  CPUregisters.P.V = ((~(a ^ b) & (a ^ res) & 0x80) >>> 7);
  CPUregisters.A   = res;
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function RLA_ZP() {
  // C1: opcode fetch
  // C2: fetch zp addr
  const address = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read old
  let value = checkReadOffset(address) & 0xFF;
  consumeCycle();

  // C4: dummy write old
  checkWriteOffset(address, value);
  consumeCycle();

  // C5: ROL then store
  const carryIn = CPUregisters.P.C & 1;
  CPUregisters.P.C = (value & 0x80) ? 1 : 0;
  value = ((value << 1) | carryIn) & 0xFF;
  checkWriteOffset(address, value);
  // AND with A and set flags
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function RLA_ABS() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C4: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C5: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C6: ROL then final write & AND
  const carryIn = CPUregisters.P.C & 1;
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = ((old << 1) | carryIn) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function RLA_ABSX() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: EA = base+X
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: ROL then final write & AND
  const carryIn = CPUregisters.P.C & 1;
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = ((old << 1) | carryIn) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function RLA_ABSY() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: EA = base+Y
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: ROL then final write & AND
  const carryIn = CPUregisters.P.C & 1;
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = ((old << 1) | carryIn) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function RLA_INDX() {
  // C1: opcode
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  checkReadOffset(zp);
  consumeCycle();

  // C3: read low @(zp+X)
  const low = checkReadOffset((zp + (CPUregisters.X & 0xFF)) & 0xFF) & 0xFF;
  consumeCycle();

  // C4: read high @(zp+X+1)
  const high = checkReadOffset((zp + (CPUregisters.X & 0xFF) + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read old @EA
  const addr = ((high << 8) | low) & 0xFFFF;
  const old  = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: ROL then final write & AND
  const carryIn = CPUregisters.P.C & 1;
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = ((old << 1) | carryIn) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function RLA_INDY() {
  // C1: opcode
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read lo @zp
  const lo = checkReadOffset(zp) & 0xFF;
  consumeCycle();

  // C4: read hi @(zp+1)
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: EA = base+Y, then read old
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  checkReadOffset((base&0xff00)|(addr&255));
  consumeCycle();
  const old  = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: ROL then final write & AND
  const carryIn = CPUregisters.P.C & 1;
  CPUregisters.P.C = (old & 0x80) ? 1 : 0;
  let value = ((old << 1) | carryIn) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function RLA_ZPX() {
  // C1: opcode
  // C2: fetch zp
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from unindexed base while X is added.
  const pointer = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: read old
  let value = checkReadOffset(pointer) & 0xFF;
  consumeCycle();

  // C4: dummy write old
  checkWriteOffset(pointer, value);
  consumeCycle();

  // C5: ROL then write & AND
  const carryIn = CPUregisters.P.C & 1;
  CPUregisters.P.C = (value & 0x80) ? 1 : 0;
  value = ((value << 1) | carryIn) & 0xFF;
  checkWriteOffset(pointer, value);
  CPUregisters.A &= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SRE_ZP() {
  // C1: opcode
  // C2: fetch zp
  const address = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read old
  let value = checkReadOffset(address) & 0xFF;
  consumeCycle();

  // C4: dummy write old
  checkWriteOffset(address, value);
  consumeCycle();

  // C5: LSR, write, then EOR A
  CPUregisters.P.C = (value & 0x01) ? 1 : 0;
  value = (value >> 1) & 0xFF;
  checkWriteOffset(address, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SRE_ABS() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  const addr = ((hi << 8) | lo) & 0xFFFF;

  // C4: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C5: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C6: LSR, final write, EOR A
  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  let value = (old >> 1) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SRE_ABSX() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: EA = base+X
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.X & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: LSR, final write, EOR A
  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  let value = (old >> 1) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SRE_ABSY() {
  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: EA = base+Y
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  // Indexed RMW always reads the uncorrected-page address before the real read.
  checkReadOffset((base & 0xFF00) | (addr & 0x00FF));
  consumeCycle();

  // C5: read old
  const old = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: LSR, final write, EOR A
  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  let value = (old >> 1) & 0xFF;
  checkWriteOffset(addr, value);
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

function SRE_INDX() {
  // C1: opcode
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from original zero-page operand while X is added.
  checkReadOffset(zp);
  consumeCycle();

  // C4: read low @(zp+X)
  const low = checkReadOffset((zp + (CPUregisters.X & 0xFF)) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read high @(zp+X+1)
  const high = checkReadOffset((zp + (CPUregisters.X & 0xFF) + 1) & 0xFF) & 0xFF;
  consumeCycle();

  // C5: read old @EA
  const addr = ((high << 8) | low) & 0xFFFF;
  const old  = checkReadOffset(addr) & 0xFF;
  consumeCycle();

  // C6: dummy write old
  checkWriteOffset(addr, old);
  consumeCycle();

  // C7: LSR write
  let value = (old >> 1) & 0xFF;
  CPUregisters.P.C = (old & 0x01) ? 1 : 0;
  checkWriteOffset(addr, value);
  consumeCycle();

  // C8: EOR into A
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function SRE_INDY() {
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF; consumeCycle(); // C2
  const lo = checkReadOffset(zp) & 0xFF; consumeCycle(); // C3
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF; consumeCycle(); // C4
  const base = ((hi << 8) | lo) & 0xFFFF;
  const addr = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  const dummy = (base & 0xFF00) | (addr & 0x00FF);
  checkReadOffset(dummy);                            consumeCycle(); // C5 indexed dummy
  const old = checkReadOffset(addr) & 0xFF;          consumeCycle(); // C6 real read
  checkWriteOffset(addr, old);                       consumeCycle(); // C7 old write
  const value = (old >>> 1) & 0xFF;
  CPUregisters.P.C = old & 1;
  checkWriteOffset(addr, value);                     consumeCycle(); // C8 new write
  CPUregisters.A = (CPUregisters.A ^ value) & 0xFF;
  CPUregisters.P.Z = CPUregisters.A === 0 ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;
}

function SRE_ZPX() {
  // C1: opcode
  // C2: fetch base zp
  const base = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: dummy read from unindexed base while X is added.
  const pointer = (base + (CPUregisters.X & 0xFF)) & 0xFF;
  checkReadOffset(base);
  consumeCycle();

  // C4: read old
  let value = checkReadOffset(pointer) & 0xFF;
  consumeCycle();

  // C4: dummy write old
  checkWriteOffset(pointer, value);
  consumeCycle();

  // C5: LSR write
  CPUregisters.P.C = (value & 0x01) ? 1 : 0;
  value = (value >> 1) & 0xFF;
  checkWriteOffset(pointer, value);
  consumeCycle();

  // C6: EOR into A
  CPUregisters.A ^= value;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = ((CPUregisters.A & 0x80) !== 0) ? 1 : 0;
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ANC_IMM() {
  // C1: opcode
  // C2: fetch imm and execute
  let value = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  CPUregisters.A &= value;
  CPUregisters.P.C = (CPUregisters.A & 0x80) ? 1 : 0;
  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;
}

function ALR_IMM() {
  // C1: opcode
  // C2: fetch imm; AND then LSR A
  const val = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const tmp = (CPUregisters.A & val) & 0xFF;

  CPUregisters.P.C = tmp & 0x01;
  const res = (tmp >> 1) & 0xFF;
  CPUregisters.A = res;

  CPUregisters.P.Z = ((res === 0) & 1);
  CPUregisters.P.N = (res >> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function ARR_IMM() {
  // C1: opcode
  // C2: fetch imm; AND then ROR through carry
  const val = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  let tmp   = (CPUregisters.A & val) & 0xFF;

  const carryIn = (CPUregisters.P.C & 1) << 7;
  tmp = ((tmp >> 1) | carryIn) & 0xFF;

  CPUregisters.A = tmp;

  CPUregisters.P.Z = ((tmp === 0) & 1);
  CPUregisters.P.N = ((tmp & 0x80) !== 0) & 1;
  CPUregisters.P.C = ((tmp & 0x40) !== 0) & 1;     // bit 6
  CPUregisters.P.V = ((tmp >> 6) ^ (tmp >> 5)) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function XAA_IMM() {
  // C1: opcode
  // C2: RP2A03 unstable XAA profile used by hardware test vectors.
  // The internal data-bus "magic" term is $EE on this CPU profile.
  const value = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  CPUregisters.A = ((CPUregisters.A | 0xEE) & CPUregisters.X & value) & 0xFF;

  CPUregisters.P.Z = (CPUregisters.A === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.A >>> 7) & 1;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// Unstable indexed stores use base high+1 for the data mask. On page
// crossing the masked data replaces the address high byte (RP2A03 profile).
// RDY halting the final dummy read suppresses the high-byte data mask.
function unstableStoreAbsolute(index,registerValue,setStack=false) {
  const lo=checkReadOffset((CPUregisters.PC+1)&0xFFFF);consumeCycle();
  const hi=checkReadOffset((CPUregisters.PC+2)&0xFFFF);consumeCycle();
  const sum=lo+index,low=sum&255;
  const dummyCycle=cpuCycles;
  checkReadOffset((hi<<8)|low);
  const halted=cpuCycles!==dummyCycle;
  consumeCycle();
  if(setStack)CPUregisters.S=registerValue&255;
  const value=registerValue&(halted?255:((hi+1)&255));
  const high=sum>255?value:hi;
  checkWriteOffset((high<<8)|low,value);consumeCycle();
  CPUregisters.PC=(CPUregisters.PC+3)&0xFFFF;
}
function SHA_ABSY() {unstableStoreAbsolute(CPUregisters.Y,CPUregisters.A&CPUregisters.X);}

// RP2A03G quirk profile (Variant A):
// - Data written = (A & X) & (H_plus_1)
// - If (lo + Y) crosses a page, the WRITE ADDRESS HIGH BYTE is corrupted:
//     finalHigh = (effectiveHigh) & (A & X)
// Here H_plus_1 = (base pointer high + 1). For a page-cross case, H_plus_1 == effectiveHigh.

function SHA_INDY() { // $93
  // C1: opcode
  // C2: fetch zp
  const zp = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: read low (zp)
  const lo = checkReadOffset(zp) & 0xFF;
  consumeCycle();

  // C4: read high (zp+1)
  const hi = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
  consumeCycle();

  const y     = CPUregisters.Y & 0xFF;
  const sum   = (lo + y) >>> 0;
  const effLo = sum & 0xFF;
  const carry = (sum >> 8) & 1;

  // C5: dummy read at uncarried page (hi : effLo)
  
  const dummyCycle=cpuCycles;
  checkReadOffset(((hi << 8) | effLo) & 0xFFFF);
  const halted=cpuCycles!==dummyCycle;
  
  consumeCycle();

  // Effective (uncorrupted) high after carry:
  const effHi     = (hi + carry) & 0xFF;
  const ax        = (CPUregisters.A & CPUregisters.X) & 0xFF;
  const H_plus_1  = (hi + 1) & 0xFF;      // equals effHi when carry=1 (the intentional test case)

  // Variant A: data mask
  let value = ax & (halted ? 255 : H_plus_1);

  // Page crossing puts the actual stored value on the address high pins.
  const finalHi = carry ? value : effHi;
  const addr    = ((finalHi << 8) | effLo) & 0xFFFF;

  // C6: write
  checkWriteOffset(addr, value);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

function LAS_ABSY() {
  // Four cycles, plus one on page crossing.

  // C1: opcode
  // C2: lo
  const lo = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C3: hi
  const hi = checkReadOffset((CPUregisters.PC + 2) & 0xFFFF) & 0xFF;
  consumeCycle();

  // C4: read from EA = base+Y, then update regs/flags
  const base    = ((hi << 8) | lo) & 0xFFFF;
  const address = (base + (CPUregisters.Y & 0xFF)) & 0xFFFF;
  if((base^address)&0xff00) {
    checkReadOffset((base&0xff00)|(address&255));
    consumeCycle();
  }
  let value   = checkReadOffset(address) & CPUregisters.S;

  CPUregisters.A = value;
  CPUregisters.X = value;
  CPUregisters.S = value;
  CPUregisters.P.Z = (value === 0) ? 1 : 0;
  CPUregisters.P.N = (value & 0x80) ? 1 : 0;
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 3) & 0xFFFF;

}

/* C65C02 addition
// --- BRA (0x80): Unofficial "Branch Always" ---
function BRA_REL() {
  const offset = checkReadOffset(CPUregisters.PC + 1);
  const signed = offset < 0x80 ? offset : offset - 0x100;
  const oldPC = CPUregisters.PC;
  const newPC = (CPUregisters.PC + 2 + signed) & 0xFFFF;
  // Page boundary cross penalty (+1 cycle)
  if (((oldPC + 2) & 0xFF00) !== (newPC & 0xFF00)) consumeCycle();//cpuCycles = (cpuCycles + 1) & 0xFFFF;
  CPUregisters.PC = newPC;
}
*/

// 0x80 — DOP (SKB) — 2 cycles (opcode + operand fetch)
function DOP_IMM() {
  // C1: opcode
  // C2: consume the operand to mimic bus behavior
  checkReadOffset((CPUregisters.PC + 1) & 0xFFFF);
  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// 0x9C — SHY (SAY) abs,X — 5 cycles, no page-penalty
function SHY_ABSX() {unstableStoreAbsolute(CPUregisters.X,CPUregisters.Y);}

function SHX_ABSY() {unstableStoreAbsolute(CPUregisters.Y,CPUregisters.X);}

function TAS_ABSY() {unstableStoreAbsolute(CPUregisters.Y,CPUregisters.A&CPUregisters.X,true);}

function SBX_IMM() {
  // C1: opcode
  // C2: fetch imm and compute
  let value  = checkReadOffset((CPUregisters.PC + 1) & 0xFFFF) & 0xFF;
  const tmp    = (CPUregisters.A & CPUregisters.X) & 0xFF;
  const result = (tmp - value) & 0x1FF; // widen for carry test

  CPUregisters.P.C = (tmp >= value) ? 1 : 0;
  CPUregisters.X   = result & 0xFF;
  CPUregisters.P.Z = (CPUregisters.X === 0) ? 1 : 0;
  CPUregisters.P.N = (CPUregisters.X & 0x80) ? 1 : 0;

  consumeCycle();
  CPUregisters.PC = (CPUregisters.PC + 2) & 0xFFFF;

}

// 0x02/0x12/… — KIL/JAM — CPU jam.
// C1 opcode fetch is performed by window.step(). Hardware then performs two
// reads from PC+1, leaves architectural state/PC unchanged, and stops executing.
function KIL_IMP(){
  const jamAddress=(CPUregisters.PC+1)&0xFFFF;
  checkReadOffset(jamAddress); consumeCycle(); // C2
  checkReadOffset(jamAddress); consumeCycle(); // C3
  cpuRunning=false;
}

/*
//////////////////////// 6502 CPU opcode object ////////////////////////
// legacy, handy for opcode hex reference
const opcodes = {

  // ==================== BRANCH/CONTROL FLOW (pcIncrement: 0) ==================== //
  BCC: { relative: { code: 0x90, length: 2, pcIncrement: 0, func: BCC_REL } },
  BCS: { relative: { code: 0xB0, length: 2, pcIncrement: 0, func: BCS_REL } },
  BEQ: { relative: { code: 0xF0, length: 2, pcIncrement: 0, func: BEQ_REL } },
  BMI: { relative: { code: 0x30, length: 2, pcIncrement: 0, func: BMI_REL } },
  BNE: { relative: { code: 0xD0, length: 2, pcIncrement: 0, func: BNE_REL } },
  BPL: { relative: { code: 0x10, length: 2, pcIncrement: 0, func: BPL_REL } },
  BVC: { relative: { code: 0x50, length: 2, pcIncrement: 0, func: BVC_REL } },
  BVS: { relative: { code: 0x70, length: 2, pcIncrement: 0, func: BVS_REL } },
  // Unofficial: BRA - Branch Always (0x80)
  BRA: { relative: { code: 0x80, length: 2, pcIncrement: 0, func: BRA_REL } },

  JMP: {
    absolute:   { code: 0x4C, length: 0, pcIncrement: 0, func: JMP_ABS }, // 3 or set directly
    indirect:   { code: 0x6C, length: 0, pcIncrement: 0, func: JMP_IND }  // 3 or set directly
  },
  JSR: { absolute: { code: 0x20, length: 3, pcIncrement: 0, func: JSR_ABS } }, // PC handled by opc. handler
  RTS: { implied: { code: 0x60, length: 1, pcIncrement: 0, func: RTS_IMP } }, // PC from stack
  RTI: { implied: { code: 0x40, length: 1, pcIncrement: 0, func: RTI_IMP } }, // PC from stack
  BRK: { implied: { code: 0x00, length: 1, pcIncrement: 2, func: BRK_IMP } }, // quirk, single byte opcode / increment PC +2

  // ======================= LOAD/STORE ======================= //
  LDA: {
    immediate:  { code: 0xA9, length: 2, pcIncrement: 2, func: LDA_IMM },
    zeroPage:   { code: 0xA5, length: 2, pcIncrement: 2, func: LDA_ZP },
    zeroPageX:  { code: 0xB5, length: 2, pcIncrement: 2, func: LDA_ZPX },
    absolute:   { code: 0xAD, length: 3, pcIncrement: 3, func: LDA_ABS },
    absoluteX:  { code: 0xBD, length: 3, pcIncrement: 3, func: LDA_ABSX },
    absoluteY:  { code: 0xB9, length: 3, pcIncrement: 3, func: LDA_ABSY },
    indirectX:  { code: 0xA1, length: 2, pcIncrement: 2, func: LDA_INDX },
    indirectY:  { code: 0xB1, length: 2, pcIncrement: 2, func: LDA_INDY }
  },
  LDX: {
    immediate:  { code: 0xA2, length: 2, pcIncrement: 2, func: LDX_IMM },
    zeroPage:   { code: 0xA6, length: 2, pcIncrement: 2, func: LDX_ZP },
    zeroPageY:  { code: 0xB6, length: 2, pcIncrement: 2, func: LDX_ZPY },
    absolute:   { code: 0xAE, length: 3, pcIncrement: 3, func: LDX_ABS },
    absoluteY:  { code: 0xBE, length: 3, pcIncrement: 3, func: LDX_ABSY }
  },
  LDY: {
    immediate:  { code: 0xA0, length: 2, pcIncrement: 2, func: LDY_IMM },
    zeroPage:   { code: 0xA4, length: 2, pcIncrement: 2, func: LDY_ZP },
    zeroPageX:  { code: 0xB4, length: 2, pcIncrement: 2, func: LDY_ZPX },
    absolute:   { code: 0xAC, length: 3, pcIncrement: 3, func: LDY_ABS },
    absoluteX:  { code: 0xBC, length: 3, pcIncrement: 3, func: LDY_ABSX }
  },
  STA: {
    zeroPage:   { code: 0x85, length: 2, pcIncrement: 2, func: STA_ZP },
    zeroPageX:  { code: 0x95, length: 2, pcIncrement: 2, func: STA_ZPX },
    absolute:   { code: 0x8D, length: 3, pcIncrement: 3, func: STA_ABS },
    absoluteX:  { code: 0x9D, length: 3, pcIncrement: 3, func: STA_ABSX },
    absoluteY:  { code: 0x99, length: 3, pcIncrement: 3, func: STA_ABSY },
    indirectX:  { code: 0x81, length: 2, pcIncrement: 2, func: STA_INDX },
    indirectY:  { code: 0x91, length: 2, pcIncrement: 2, func: STA_INDY }
  },
  STX: {
    zeroPage:   { code: 0x86, length: 2, pcIncrement: 2, func: STX_ZP },
    zeroPageY:  { code: 0x96, length: 2, pcIncrement: 2, func: STX_ZPY },
    absolute:   { code: 0x8E, length: 3, pcIncrement: 3, func: STX_ABS }
  },
  STY: {
    zeroPage:   { code: 0x84, length: 2, pcIncrement: 2, func: STY_ZP },
    zeroPageX:  { code: 0x94, length: 2, pcIncrement: 2, func: STY_ZPX },
    absolute:   { code: 0x8C, length: 3, pcIncrement: 3, func: STY_ABS }
  },

  // ======================= ALU / LOGIC ======================= //
  ADC: {
    immediate:  { code: 0x69, length: 2, pcIncrement: 2, func: ADC_IMM },
    zeroPage:   { code: 0x65, length: 2, pcIncrement: 2, func: ADC_ZP },
    zeroPageX:  { code: 0x75, length: 2, pcIncrement: 2, func: ADC_ZPX },
    absolute:   { code: 0x6D, length: 3, pcIncrement: 3, func: ADC_ABS },
    absoluteX:  { code: 0x7D, length: 3, pcIncrement: 3, func: ADC_ABSX },
    absoluteY:  { code: 0x79, length: 3, pcIncrement: 3, func: ADC_ABSY },
    indirectX:  { code: 0x61, length: 2, pcIncrement: 2, func: ADC_INDX },
    indirectY:  { code: 0x71, length: 2, pcIncrement: 2, func: ADC_INDY }
  },
  SBC: {
    immediate:  { code: 0xE9, length: 2, pcIncrement: 2, func: SBC_IMM },
    zeroPage:   { code: 0xE5, length: 2, pcIncrement: 2, func: SBC_ZP },
    zeroPageX:  { code: 0xF5, length: 2, pcIncrement: 2, func: SBC_ZPX },
    absolute:   { code: 0xED, length: 3, pcIncrement: 3, func: SBC_ABS },
    absoluteX:  { code: 0xFD, length: 3, pcIncrement: 3, func: SBC_ABSX },
    absoluteY:  { code: 0xF9, length: 3, pcIncrement: 3, func: SBC_ABSY },
    indirectX:  { code: 0xE1, length: 2, pcIncrement: 2, func: SBC_INDX },
    indirectY:  { code: 0xF1, length: 2, pcIncrement: 2, func: SBC_INDY }
  },
  AND: {
    immediate:  { code: 0x29, length: 2, pcIncrement: 2, func: AND_IMM },
    zeroPage:   { code: 0x25, length: 2, pcIncrement: 2, func: AND_ZP },
    zeroPageX:  { code: 0x35, length: 2, pcIncrement: 2, func: AND_ZPX },
    absolute:   { code: 0x2D, length: 3, pcIncrement: 3, func: AND_ABS },
    absoluteX:  { code: 0x3D, length: 3, pcIncrement: 3, func: AND_ABSX },
    absoluteY:  { code: 0x39, length: 3, pcIncrement: 3, func: AND_ABSY },
    indirectX:  { code: 0x21, length: 2, pcIncrement: 2, func: AND_INDX },
    indirectY:  { code: 0x31, length: 2, pcIncrement: 2, func: AND_INDY }
  },
  ORA: {
    immediate:  { code: 0x09, length: 2, pcIncrement: 2, func: ORA_IMM },
    zeroPage:   { code: 0x05, length: 2, pcIncrement: 2, func: ORA_ZP },
    zeroPageX:  { code: 0x15, length: 2, pcIncrement: 2, func: ORA_ZPX },
    absolute:   { code: 0x0D, length: 3, pcIncrement: 3, func: ORA_ABS },
    absoluteX:  { code: 0x1D, length: 3, pcIncrement: 3, func: ORA_ABSX },
    absoluteY:  { code: 0x19, length: 3, pcIncrement: 3, func: ORA_ABSY },
    indirectX:  { code: 0x01, length: 2, pcIncrement: 2, func: ORA_INDX },
    indirectY:  { code: 0x11, length: 2, pcIncrement: 2, func: ORA_INDY }
  },
  EOR: {
    immediate:  { code: 0x49, length: 2, pcIncrement: 2, func: EOR_IMM },
    zeroPage:   { code: 0x45, length: 2, pcIncrement: 2, func: EOR_ZP },
    zeroPageX:  { code: 0x55, length: 2, pcIncrement: 2, func: EOR_ZPX },
    absolute:   { code: 0x4D, length: 3, pcIncrement: 3, func: EOR_ABS },
    absoluteX:  { code: 0x5D, length: 3, pcIncrement: 3, func: EOR_ABX },
    absoluteY:  { code: 0x59, length: 3, pcIncrement: 3, func: EOR_ABY },
    indirectX:  { code: 0x41, length: 2, pcIncrement: 2, func: EOR_INDX },
    indirectY:  { code: 0x51, length: 2, pcIncrement: 2, func: EOR_INDY }
  },

  // ======================= SHIFT/ROTATE ======================= //
  ASL: {
    accumulator: { code: 0x0A, length: 1, pcIncrement: 1, func: ASL_ACC },
    zeroPage:    { code: 0x06, length: 2, pcIncrement: 2, func: ASL_ZP },
    zeroPageX:   { code: 0x16, length: 2, pcIncrement: 2, func: ASL_ZPX },
    absolute:    { code: 0x0E, length: 3, pcIncrement: 3, func: ASL_ABS },
    absoluteX:   { code: 0x1E, length: 3, pcIncrement: 3, func: ASL_ABSX }
  },
  LSR: {
    accumulator: { code: 0x4A, length: 1, pcIncrement: 1, func: LSR_ACC },
    zeroPage:    { code: 0x46, length: 2, pcIncrement: 2, func: LSR_ZP },
    zeroPageX:   { code: 0x56, length: 2, pcIncrement: 2, func: LSR_ZPX },
    absolute:    { code: 0x4E, length: 3, pcIncrement: 3, func: LSR_ABS },
    absoluteX:   { code: 0x5E, length: 3, pcIncrement: 3, func: LSR_ABSX }
  },
  ROL: {
    accumulator: { code: 0x2A, length: 1, pcIncrement: 1, func: ROL_ACC },
    zeroPage:    { code: 0x26, length: 2, pcIncrement: 2, func: ROL_ZP },
    zeroPageX:   { code: 0x36, length: 2, pcIncrement: 2, func: ROL_ZPX },
    absolute:    { code: 0x2E, length: 3, pcIncrement: 3, func: ROL_ABS },
    absoluteX:   { code: 0x3E, length: 3, pcIncrement: 3, func: ROL_ABSX }
  },
  ROR: {
    accumulator: { code: 0x6A, length: 1, pcIncrement: 1, func: ROR_ACC },
    zeroPage:    { code: 0x66, length: 2, pcIncrement: 2, func: ROR_ZP },
    zeroPageX:   { code: 0x76, length: 2, pcIncrement: 2, func: ROR_ZPX },
    absolute:    { code: 0x6E, length: 3, pcIncrement: 3, func: ROR_ABS },
    absoluteX:   { code: 0x7E, length: 3, pcIncrement: 3, func: ROR_ABSX }
  },

  // ======================= REGISTER TRANSFERS ======================= //
  TAX: { implied: { code: 0xAA, length: 1, pcIncrement: 1, func: TAX_IMP } },
  TXA: { implied: { code: 0x8A, length: 1, pcIncrement: 1, func: TXA_IMP } },
  DEX: { implied: { code: 0xCA, length: 1, pcIncrement: 1, func: DEX_IMP } },
  INX: { implied: { code: 0xE8, length: 1, pcIncrement: 1, func: INX_IMP } },
  TAY: { implied: { code: 0xA8, length: 1, pcIncrement: 1, func: TAY_IMP } },
  TYA: { implied: { code: 0x98, length: 1, pcIncrement: 1, func: TYA_IMP } },
  DEY: { implied: { code: 0x88, length: 1, pcIncrement: 1, func: DEY_IMP } },
  INY: { implied: { code: 0xC8, length: 1, pcIncrement: 1, func: INY_IMP } },
  TSX: { implied: { code: 0xBA, length: 1, pcIncrement: 1, func: TSX_IMP } },
  TXS: { implied: { code: 0x9A, length: 1, pcIncrement: 1, func: TXS_IMP } },

  // ======================= STACK OPS ======================= //
  PHA: { implied: { code: 0x48, length: 1, pcIncrement: 1, func: PHA_IMP } },
  PLA: { implied: { code: 0x68, length: 1, pcIncrement: 1, func: PLA_IMP } },
  PHP: { implied: { code: 0x08, length: 1, pcIncrement: 1, func: PHP_IMP } },
  PLP: { implied: { code: 0x28, length: 1, pcIncrement: 1, func: PLP_IMP } },

    // ======================= FLAG OPS ======================= //
  CLC: { implied: { code: 0x18, length: 1, pcIncrement: 1, func: CLC_IMP } },
  CLD: { implied: { code: 0xD8, length: 1, pcIncrement: 1, func: CLD_IMP } },
  CLI: { implied: { code: 0x58, length: 1, pcIncrement: 1, func: CLI_IMP } },
  CLV: { implied: { code: 0xB8, length: 1, pcIncrement: 1, func: CLV_IMP } },
  SEC: { implied: { code: 0x38, length: 1, pcIncrement: 1, func: SEC_IMP } },
  SED: { implied: { code: 0xF8, length: 1, pcIncrement: 1, func: SED_IMP } },
  SEI: { implied: { code: 0x78, length: 1, pcIncrement: 1, func: SEI_IMP } },

  // ======================= COMPARE ======================= //
  CMP: {
    immediate:  { code: 0xC9, length: 2, pcIncrement: 2, func: CMP_IMM },
    zeroPage:   { code: 0xC5, length: 2, pcIncrement: 2, func: CMP_ZP },
    zeroPageX:  { code: 0xD5, length: 2, pcIncrement: 2, func: CMP_ZPX },
    absolute:   { code: 0xCD, length: 3, pcIncrement: 3, func: CMP_ABS },
    absoluteX:  { code: 0xDD, length: 3, pcIncrement: 3, func: CMP_ABSX },
    absoluteY:  { code: 0xD9, length: 3, pcIncrement: 3, func: CMP_ABSY },
    indirectX:  { code: 0xC1, length: 2, pcIncrement: 2, func: CMP_INDX },
    indirectY:  { code: 0xD1, length: 2, pcIncrement: 2, func: CMP_INDY }
  },
  CPX: {
    immediate:  { code: 0xE0, length: 2, pcIncrement: 2, func: CPX_IMM },
    zeroPage:   { code: 0xE4, length: 2, pcIncrement: 2, func: CPX_ZP },
    absolute:   { code: 0xEC, length: 3, pcIncrement: 3, func: CPX_ABS }
  },
  CPY: {
    immediate:  { code: 0xC0, length: 2, pcIncrement: 2, func: CPY_IMM },
    zeroPage:   { code: 0xC4, length: 2, pcIncrement: 2, func: CPY_ZP },
    absolute:   { code: 0xCC, length: 3, pcIncrement: 3, func: CPY_ABS }
  },

  // ======================= INCREMENT / DECREMENT ======================= //
  INC: {
    zeroPage:   { code: 0xE6, length: 2, pcIncrement: 2, func: INC_ZP },
    zeroPageX:  { code: 0xF6, length: 2, pcIncrement: 2, func: INC_ZPX },
    absolute:   { code: 0xEE, length: 3, pcIncrement: 3, func: INC_ABS },
    absoluteX:  { code: 0xFE, length: 3, pcIncrement: 3, func: INC_ABSX }
  },
  DEC: {
    zeroPage:   { code: 0xC6, length: 2, pcIncrement: 2, func: DEC_ZP },
    zeroPageX:  { code: 0xD6, length: 2, pcIncrement: 2, func: DEC_ZPX },
    absolute:   { code: 0xCE, length: 3, pcIncrement: 3, func: DEC_ABS },
    absoluteX:  { code: 0xDE, length: 3, pcIncrement: 3, func: DEC_ABSX }
  },

  // ======================= BIT TEST ======================= //
  BIT: {
    zeroPage:  { code: 0x24, length: 2, pcIncrement: 2, func: BIT_ZP },
    absolute:  { code: 0x2C, length: 3, pcIncrement: 3, func: BIT_ABS }
  },

  // ======================= NOPs (OFFICIAL AND UNOFFICIAL) ======================= //
  NOP: {
    // Official and implied (1-byte, just do nothing, let pcIncrement advance)
    implied:   { code: 0xEA, length: 1, pcIncrement: 1, func: NOP },
    implied1:  { code: 0x1A, length: 1, pcIncrement: 1, func: NOP },
    implied2:  { code: 0x3A, length: 1, pcIncrement: 1, func: NOP },
    implied3:  { code: 0x5A, length: 1, pcIncrement: 1, func: NOP },
    implied4:  { code: 0x7A, length: 1, pcIncrement: 1, func: NOP },
    implied5:  { code: 0xDA, length: 1, pcIncrement: 1, func: NOP },
    implied6:  { code: 0xFA, length: 1, pcIncrement: 1, func: NOP },

    // "SKB"/"DOP" NOPs - 2-byte, just skip operand (NO memory access), so plain NOP and pcIncrement=2 is fine
    // imm1:      { code: 0x80, length: 2, pcIncrement: 0, func: BRA_REL }, // (alias for BRA, quirk, in branches group)
    immediate:      { code:, length: 2, pcIncrement: 2, func: NOP_0x82 },    // plain NOP upate  WRONG: illegal NOP expecting one byte of data following, then PC jumps over
    immediate1:      { code: 0x89, length: 2, pcIncrement: 2, func: NOP },    // plain NOP
    immmediate2:      { code: 0xC2, length: 2, pcIncrement: 2, func: NOP },    // plain NOP
    immediate3:      { code: 0xE2, length: 2, pcIncrement: 2, func: NOP },    // plain NOP

    // Zero page NOPs: read from ZP (quirk!)
    zeroPage:       { code: 0x04, length: 2, pcIncrement: 2, func: NOP_ZP },    // quirk: does memory read
    zeroPage1:       { code: 0x44, length: 2, pcIncrement: 2, func: NOP_ZP },    // "
    zeroPage2:       { code: 0x64, length: 2, pcIncrement: 2, func: NOP_ZP },    // "

    // Zero page,X NOPs: read from ZP+X (quirk!)
    zeroPageX:      { code: 0x14, length: 2, pcIncrement: 2, func: NOP_ZPX },   // quirk: does memory read
    zeroPageX1:      { code: 0x34, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "
    zeroPageX2:      { code: 0x54, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "
    zeroPageX3:      { code: 0x74, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "
    zeroPageX4:      { code: 0xD4, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "
    zeroPageX5:      { code: 0xF4, length: 2, pcIncrement: 2, func: NOP_ZPX },   // "

    // Absolute NOP: read from $nnnn (quirk!)
    absolute:      { code: 0x0C, length: 3, pcIncrement: 3, func: NOP_ABS },   // quirk: does memory read

    // Absolute,X NOPs: read from $nnnn+X
    absoluteX:     { code: 0x1C, length: 3, pcIncrement: 3, func: NOP_ABSX }, // quirk: memory read + possible extra cycle
    absoluteX1:     { code: 0x3C, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "
    absoluteX2:     { code: 0x5C, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "
    absoluteX3:     { code: 0x7C, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "
    absoluteX4:     { code: 0xDC, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "
    absoluteX5:     { code: 0xFC, length: 3, pcIncrement: 3, func: NOP_ABSX }, // "

    // Zero page,Y NOP: rare (quirk)
    zeroPageY:       { code: 0x92, length: 2, pcIncrement: 2, func: NOP_ZPY },  // quirk: does memory read
    // this is wrong, another KIL?
  },

  // ======================== UNOFFICIAL/ILLEGAL OPCODES ======================== //
  LAX: {
    immediate:  { code: 0xAB, length: 2, pcIncrement: 2, func: LAX_IMM },
    zeroPage:   { code: 0xA7, length: 2, pcIncrement: 2, func: LAX_ZP },
    zeroPageY:  { code: 0xB7, length: 2, pcIncrement: 2, func: LAX_ZPY },
    absolute:   { code: 0xAF, length: 3, pcIncrement: 3, func: LAX_ABS },
    absoluteY:  { code: 0xBF, length: 3, pcIncrement: 3, func: LAX_ABSY },
    indirectX:  { code: 0xA3, length: 2, pcIncrement: 2, func: LAX_INDX },
    indirectY:  { code: 0xB3, length: 2, pcIncrement: 2, func: LAX_INDY }
  },
  SAX: {
    zeroPage:   { code: 0x87, length: 2, pcIncrement: 2, func: SAX_ZP },
    zeroPageY:  { code: 0x97, length: 2, pcIncrement: 2, func: SAX_ZPY },
    absolute:   { code: 0x8F, length: 3, pcIncrement: 3, func: SAX_ABS },
    indirectX:  { code: 0x83, length: 2, pcIncrement: 2, func: SAX_INDX }
  },
  DCP: {
    zeroPage:   { code: 0xC7, length: 2, pcIncrement: 2, func: DCP_ZP },
    zeroPageX:  { code: 0xD7, length: 2, pcIncrement: 2, func: DCP_ZPX },
    absolute:   { code: 0xCF, length: 3, pcIncrement: 3, func: DCP_ABS },
    absoluteX:  { code: 0xDF, length: 3, pcIncrement: 3, func: DCP_ABSX },
    absoluteY:  { code: 0xDB, length: 3, pcIncrement: 3, func: DCP_ABSY },
    indirectX:  { code: 0xC3, length: 2, pcIncrement: 2, func: DCP_INDX },
    indirectY:  { code: 0xD3, length: 2, pcIncrement: 2, func: DCP_INDY }
  },
  ISC: {
    zeroPage:   { code: 0xE7, length: 2, pcIncrement: 2, func: ISC_ZP },
    zeroPageX:  { code: 0xF7, length: 2, pcIncrement: 2, func: ISC_ZPX },
    absolute:   { code: 0xEF, length: 3, pcIncrement: 3, func: ISC_ABS },
    absoluteX:  { code: 0xFF, length: 3, pcIncrement: 3, func: ISC_ABSX },
    absoluteY:  { code: 0xFB, length: 3, pcIncrement: 3, func: ISC_ABSY },
    indirectX:  { code: 0xE3, length: 2, pcIncrement: 2, func: ISC_INDX },
    indirectY:  { code: 0xF3, length: 2, pcIncrement: 2, func: ISC_INDY }
  },
  SLO: {
    zeroPage:   { code: 0x07, length: 2, pcIncrement: 2, func: SLO_ZP },
    zeroPageX:  { code: 0x17, length: 2, pcIncrement: 2, func: SLO_ZPX },
    absolute:   { code: 0x0F, length: 3, pcIncrement: 3, func: SLO_ABS },
    absoluteX:  { code: 0x1F, length: 3, pcIncrement: 3, func: SLO_ABSX },
    absoluteY:  { code: 0x1B, length: 3, pcIncrement: 3, func: SLO_ABSY },
    indirectX:  { code: 0x03, length: 2, pcIncrement: 2, func: SLO_INDX },
    indirectY:  { code: 0x13, length: 2, pcIncrement: 2, func: SLO_INDY }
  },
  RLA: {
    zeroPage:   { code: 0x27, length: 2, pcIncrement: 2, func: RLA_ZP },
    zeroPageX:  { code: 0x37, length: 2, pcIncrement: 2, func: RLA_ZPX },
    absolute:   { code: 0x2F, length: 3, pcIncrement: 3, func: RLA_ABS },
    absoluteX:  { code: 0x3F, length: 3, pcIncrement: 3, func: RLA_ABSX },
    absoluteY:  { code: 0x3B, length: 3, pcIncrement: 3, func: RLA_ABSY },
    indirectX:  { code: 0x23, length: 2, pcIncrement: 2, func: RLA_INDX },
    indirectY:  { code: 0x33, length: 2, pcIncrement: 2, func: RLA_INDY }
  },
  SRE: {
    zeroPage:   { code: 0x47, length: 2, pcIncrement: 2, func: SRE_ZP },
    zeroPageX:  { code: 0x57, length: 2, pcIncrement: 2, func: SRE_ZPX },
    absolute:   { code: 0x4F, length: 3, pcIncrement: 3, func: SRE_ABS },
    absoluteX:  { code: 0x5F, length: 3, pcIncrement: 3, func: SRE_ABSX },
    absoluteY:  { code: 0x5B, length: 3, pcIncrement: 3, func: SRE_ABSY },
    indirectX:  { code: 0x43, length: 2, pcIncrement: 2, func: SRE_INDX },
    indirectY:  { code: 0x53, length: 2, pcIncrement: 2, func: SRE_INDY }
  },
  RRA: {
    zeroPage:   { code: 0x67, length: 2, pcIncrement: 2, func: RRA_ZP },
    zeroPageX:  { code: 0x77, length: 2, pcIncrement: 2, func: RRA_ZPX },
    absolute:   { code: 0x6F, length: 3, pcIncrement: 3, func: RRA_ABS },
    absoluteX:  { code: 0x7F, length: 3, pcIncrement: 3, func: RRA_ABSX },
    absoluteY:  { code: 0x7B, length: 3, pcIncrement: 3, func: RRA_ABSY },
    indirectX:  { code: 0x63, length: 2, pcIncrement: 2, func: RRA_INDX },
    indirectY:  { code: 0x73, length: 2, pcIncrement: 2, func: RRA_INDY }
  },
  ANC: {
    immediate:  { code: 0x0B, length: 2, pcIncrement: 2, func: ANC_IMM },
    immediate2: { code: 0x2B, length: 2, pcIncrement: 2, func: ANC_IMM }
  },
  ALR: { immediate: { code: 0x4B, length: 2, pcIncrement: 2, func: ALR_IMM } },
  ARR: { immediate: { code: 0x6B, length: 2, pcIncrement: 2, func: ARR_IMM } },
  SHA: {
    absoluteY:  { code: 0x9F, length: 3, pcIncrement: 3, func: SHA_ABSY },  // 0x9F, 0x93 -- (SHA/AHX/AXA)
    indirectY:  { code: 0x93, length: 2, pcIncrement: 2, func: SHA_INDY }
  },
  XAA: { immediate: { code: 0x8B, length: 2, pcIncrement: 2, func: XAA_IMM } },
  LAS: { absoluteY: { code: 0xBB, length: 3, pcIncrement: 3, func: LAS_ABSY } },

  // ---- Additional unoffficials for full NESDev test compatibility ----
  SHY: { absoluteX: { code: 0x9C, length: 3, pcIncrement: 3, func: SHY_ABSX } },  // aka SAY
  SHX: { absoluteY: { code: 0x9E, length: 3, pcIncrement: 3, func: SHX_ABSY } },  // aka SXA
  TAS: { absoluteY: { code: 0x9B, length: 3, pcIncrement: 3, func: TAS_ABSY } },  // aka SHS
  SBX: { immediate: { code: 0xCB, length: 2, pcIncrement: 2, func: SBX_IMM } },  // aka AXS

  // ======================= TEST HOOK OPCODE ======================= //
  Test_Trigger: { implied: { code: 0x02, length: 1, pcIncrement: 0, func: opCodeTest } }
};

// Base timings per addressing mode
const baseCycles = {
  immediate:   2,
  zeroPage:    3,
  zeroPageX:   4,
  zeroPageY:   4,
  absolute:    4,
  absoluteX:   4,  // +1 if page crossed
  absoluteY:   4,  // +1 if page crossed
  indirectX:   6,
  indirectY:   5,  // +1 if page crossed
  accumulator: 2,
  implied:     2,
  relative:    2,
  indirect:    5   // JMP ($hhhh)
};

// patch in cycle counts for modes
for (const opname in opcodes) for (const variant in opcodes[opname]) {
  let mode = variant.replace(/[0-9]+$/, '');
  opcodes[opname][variant].cycles = baseCycles[mode] || 2;
}

// 6502/NES Addressing Mode Cycle Table + Known Quirks
//
// * "RMW" = Read-Modify-Write (ASL, LSR, ROL, ROR, INC, DEC, SLO, RLA, etc.)
// * "Branch" = Bxx (BNE, BEQ, BPL, BMI, BVC, BVS, BCC, BCS)
// * "Unofficial" = see nesdev.org for oddities
//
// +1 = Add one cycle for page boundary cross (see quirk notes)
//
// ┌──────────────────┬────────┬─────────────┬───────────────────────────────────────────────────────────────┐
// │ Addressing Mode  │ Cycles │ Page Cross? │           Quirk Notes (for accurate emulation)                │
// ├──────────────────┼────────┼─────────────┼───────────────────────────────────────────────────────────────┤
// │ immediate        │   2    │    No       │                                                               │
// │ zeroPage         │   3    │    No       │                                                               │
// │ zeroPage,X       │   4    │    No       │                                                               │
// │ zeroPage,Y       │   4    │    No       │                                                               │
// │ absolute         │   4    │    No       │                                                               │
// │ absolute,X       │   4    │  Yes (+1)   │ *For RMW: always +1, regardless of page cross                 │
// │ absolute,Y       │   4    │  Yes (+1)   │                                                               │
// │ indirect,X       │   6    │    No       │                                                               │
// │ indirect,Y       │   5    │  Yes (+1)   │                                                               │
// │ accumulator      │   2    │    No       │                                                               │
// │ implied          │   2    │    No       │                                                               │
// │ relative (branch)│   2    │ +1 if branch│ +1 if branch taken, +2 if branch taken AND page crossed       │
// │ indirect (JMP)   │   5    │    No       │                                                               │
// └──────────────────┴────────┴─────────────┴───────────────────────────────────────────────────────────────┘
//
// === QUIRKS EXPLAINED ===
//  - RMW (Read-Modify-Write) opcodes with absolute,X addressing (ASL $nnnn,X etc):
//      * ALWAYS add 1 cycle, regardless of whether a page boundary is crossed!
//      * i.e., 7 cycles, not 6 or 7
//
//  - Branch (Bxx) instructions:
//      * If branch not taken: 2 cycles
//      * If branch taken:     3 cycles
//      * If branch taken AND page crossed: 4 cycles (add 2)
//
//  - Unofficial opcodes:
//      * Some have cycle counts and page-cross behaviors that differ from above!
//      * See: https://www.nesdev.org/wiki/CPU_unofficial_opcodes
//
//  - STA/STX/STY/SHY/SHX/SAX do NOT add cycles for page cross (quirk vs. LDA etc)
//
//  - JMP (indirect) is always 5 cycles, never adds a cycle for page wrap bug
*/