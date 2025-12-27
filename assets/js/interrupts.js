// ======== Interrupts ======== 
// https://www.nesdev.org/wiki/CPU_interrupts
function serviceNMI() {

const sl    = SHARED.SYNC[2] | 0;
const dot   = SHARED.SYNC[3] | 0;
const frame = SHARED.SYNC[4] | 0;

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
  if (!nmiSuppression && (frame !== nmiPending + 1)){ // pointless frame check guard? 
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

  if (debugVideoTiming){
  console.debug(
    `%c[NMI VECTOR LOADED → PC=$${CPUregisters.PC.toString(16).padStart(4,"0")}] cpu=${cpuCycles} ppu=${ppuCycles} frame=${frame} sl=${sl} dot=${dot}`,
    "color:black;background:yellow;font-weight:bold;font-size:14px;"
  );
 }
}

}

function serviceIRQ() {

    const pc = CPUregisters.PC & 0xFFFF;

    // -------------------------
    // IRQ Debugging output
    // -------------------------
    /*
    console.log("[IRQ] --- IRQ SERVICED ---");
    console.log(`[IRQ] Current PC: 0x${pc.toString(16).padStart(4,'0')}`);
    console.log(`[IRQ] Stack pointer before push: 0x${CPUregisters.S.toString(16).padStart(2,'0')}`);
    console.log(`[IRQ] Flags before push: N=${CPUregisters.P.N} V=${CPUregisters.P.V} D=${CPUregisters.P.D} I=${CPUregisters.P.I} Z=${CPUregisters.P.Z} C=${CPUregisters.P.C}`);
    */
   
    // Push PCH
    checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), (pc >> 8) & 0xFF);
    CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
    addCycles(1);

    // Push PCL
    checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), pc & 0xFF);
    CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
    addCycles(1);

    // Build status byte (U=1, B=0)
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

    // Set Interrupt Disable
    CPUregisters.P.I = 1;
    addCycles(1);

    // -------------------------
    // Fetch IRQ vector (PRG ROM mapping)
    // -------------------------
    let lo, hi;

        lo = checkReadOffset(0xFFFE);
        addCycles(1); // vector fetch
        hi = checkReadOffset(0xFFFF);
        addCycles(1); // vector fetch

    // Set PC to IRQ vector
    CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;

    addCycles(1);

    // -------------------------
    // IRQ Debugging output end
    // -------------------------
    /*
    console.log(`[IRQ] Vector memory: 0xFFFE=0x${lo.toString(16).padStart(2,'0')}, 0xFFFF=0x${hi.toString(16).padStart(2,'0')}`);
    console.log(`[IRQ] Target PC after vector fetch: 0x${CPUregisters.PC.toString(16).padStart(4,'0')}`);
    console.log(`[IRQ] Stack pointer after push: 0x${CPUregisters.S.toString(16).padStart(2,'0')}`);
    console.log("[IRQ] -------------------------\n");
    */
}

// not an interrupt, get it TF out of the way for now #relocate
// handle inline directly in 4014 case + calls in cpu-loop?

// ===== OAM DMA ($4014) =====
// Copies 256 bytes from CPU RAM page (value << 8) into PPU OAM.
// Adds 513 cycles if CPU starts on odd cycle, 514 if even.
// Microstepped: 1 CPU cycle per call (PPU +3 each).
function dmaTransfer(value) {
  const cur = SHARED.CLOCKS[0] ?? 0;

  DMA.active = true;
  DMA.page   = value & 0xFF;
  DMA.addr   = (DMA.page << 8) | 0;
  DMA.index  = 0;
  DMA.tmp    = 0;
  DMA.phase  = 0;

  // If current CPU cycle is odd -> 1-cycle pad (total 513), else 2-cycle pad (total 514)
  DMA.pad = (cur & 1) ? 1 : 2;
}