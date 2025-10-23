// ======== Interrupts ======== 
// https://www.nesdev.org/wiki/CPU_interrupts
function serviceNMI() {

  const sl    = Atomics.load(SHARED.SYNC, 2);
  const dot   = Atomics.load(SHARED.SYNC, 3);
  const frame = Atomics.load(SHARED.SYNC, 4);

  if (debugLogging) console.debug("%cNMI fired", "color:white;background:red;font-weight:bold;padding:2px 6px;border-radius:3px");
  
// nmiPending (NMI timing latch) now contains the frame it was generated
// if the frame doesn't match the current frame, don't fire the NMI, it was generated on vblank boundaries <- this guard not required
// i.e a test ROM created an NMI edge at 260/338, this armed at dot 0 of 261 ..but that's a new frame!
// also exposed a frame counter bug, fixed.

// extra guard,  needed?
const inVBlank = 
  (sl === 241 && dot >= 1) ||   // VBlank starts on scanline 241, dot 1
  (sl >= 242 && sl <= 260);     // All of scanlines 242–260
// temp logging , like most of it
  if (nmiPending !== frame) {
    console.log(
      `[NMI DEBUG] ppu=${ppuCycles} cpu=${cpuCycles} ` +
      `sl=${sl} dot=${dot} frame=${frame}`
    );
  }
/*
Had this NMI sneak through, past the suppression flag (do not set), so added nmiSuppression
here as a final guard

[NMI and VBL set cancelled] frame=92 cpu=2767329 ppu=8301987 sl=241 dot=0 offsetsHandler.js:83:21
[NMI ARMED] cpu=2767330 ppu=8301990 frame=92 sl=241 dot=3 debug.js:37:15
[NMI FIRED → handler entered] cpu=2767332 ppu=8301996 frame=92 sl=241 dot=9 debug.js:111:13
[NMI VECTOR LOADED → PC=$e308] cpu=2767339 ppu=8302017 frame=92 sl=241 dot=9 interrupts.js:69:11
Vblank Clear: ppuTicks=8308807 frame=92 Δ=89342 PASS [exp 89342] (even+no render) ppu-worker.js:99:11
*/
  if (!nmiSuppression && (frame !== nmiPending + 1 )){
  const pc = CPUregisters.PC & 0xFFFF;

  // Push PCH
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), (pc >> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addCycles(1);

  // Push PCL
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addCycles(1);

  // Build status byte: U=1, B=0 → 0b00100000
  let p = 0b00100000;
  p |= (CPUregisters.P.N & 1) << 7;
  p |= (CPUregisters.P.V & 1) << 6;
  p |= (CPUregisters.P.D & 1) << 3;
  p |= (CPUregisters.P.I & 1) << 2;
  p |= (CPUregisters.P.Z & 1) << 1;
  p |= (CPUregisters.P.C & 1);

  // Push P
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), p & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addCycles(1);

  // Set I
  CPUregisters.P.I = 1;
  addCycles(1);

  // Vector fetch
  const lo = checkReadOffset(0xFFFA);
  addCycles(1);
  const hi = checkReadOffset(0xFFFB);
  addCycles(1);

  // Set PC to NMI vector
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;
  addCycles(1);

  console.debug(
    `%c[NMI VECTOR LOADED → PC=$${CPUregisters.PC.toString(16).padStart(4,"0")}] cpu=${cpuCycles} ppu=${ppuCycles} frame=${frame} sl=${sl} dot=${dot}`,
    "color:black;background:yellow;font-weight:bold;font-size:14px;"

  );
}

}

function serviceIRQ() {
  const pc = CPUregisters.PC & 0xFFFF;

  // Push PCH
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), (pc >> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addCycles(1);

  // Push PCL
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addCycles(1);

  // U=1, B=0
  let p = 0b00100000;
  p |= (CPUregisters.P.N & 1) << 7;
  p |= (CPUregisters.P.V & 1) << 6;
  p |= (CPUregisters.P.D & 1) << 3;
  p |= (CPUregisters.P.I & 1) << 2;
  p |= (CPUregisters.P.Z & 1) << 1;
  p |= (CPUregisters.P.C & 1);

  // Push P
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), p & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  addCycles(1);

  // Set I
  CPUregisters.P.I = 1;
  addCycles(1);

  // Vector fetch
  const lo = checkReadOffset(0xFFFE);
  addCycles(1);
  const hi = checkReadOffset(0xFFFF);
  addCycles(1);

  // Set PC
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;
  addCycles(1);
}

// not an interrupt, get it TF out of the way for now #relocate

// ===== OAM DMA ($4014) =====
// Copies 256 bytes from CPU RAM page (value << 8) into PPU OAM.
// Adds 513 cycles if CPU starts on odd cycle, 514 if even.
// Microstepped: 1 CPU cycle per call (PPU +3 each).

const DMA = {
  active: false,
  page:   0x00,    // high byte written to $4014
  addr:   0x0000,  // page<<8 | index
  index:  0,       // 0..255
  tmp:    0,       // latched byte (read phase)
  phase:  0,       // 0=read phase, 1=write phase
  pad:    0        // 1 or 2 initial alignment cycles
};

function dmaTransfer(value) {
  const cur = Atomics.load(SHARED.CLOCKS, 0) | 0;

  DMA.active = true;
  DMA.page   = value & 0xFF;
  DMA.addr   = (DMA.page << 8) | 0;
  DMA.index  = 0;
  DMA.tmp    = 0;
  DMA.phase  = 0;

  // If current CPU cycle is odd -> 1-cycle pad (total 513), else 2-cycle pad (total 514)
  DMA.pad = (cur & 1) ? 1 : 2;
}

// Call at TOP of step(); returns cycles spent this microstep (0 or 1)
function dmaMicroStep() {
  if (!DMA.active) return 0;

  // Initial alignment pad
  if (DMA.pad > 0) {
    addCycles(1);
    DMA.pad -= 1;
    return 1;
  }

  // Transfer: one byte = 2 microsteps (read then write), each 1 CPU cycle
  if (DMA.index < 256) {
    if (DMA.phase === 0) {
      // READ phase (1 cycle)
      addCycles(1);
      DMA.tmp   = cpuRead(DMA.addr);
      DMA.phase = 1;
      return 1;
    } else {
      // WRITE phase (1 cycle)
      addCycles(1);
      cpuOpenBus = DMA.tmp & 0xFF;
      cpuWrite(0x2004, DMA.tmp);

      DMA.addr  = (DMA.addr + 1) & 0xFFFF;
      DMA.index += 1;
      DMA.phase  = 0;
      return 1;
    }
  }

  // Done
  DMA.active = false;
  return 0;
}
