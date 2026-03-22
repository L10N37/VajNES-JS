// ======== Interrupts ======== 
// https://www.nesdev.org/wiki/CPU_interrupts

// IRQ line, active low, idle high - we can track what requested the interrupt
const irqAssert = {
  mmc3: false,
  dmcDma: false,
};

// for cycle accurate IRQ timing in relation to branches
const irqBranch = {
  takenNoPageCross: false,
  takenPageCross: false,
  notTaken: false,
  cycleCounter: 0
};

// certain instructions (commented elsewhere) will or may set the interrupt flag
// but on the same cycle poll for interrupts, if the irq line was low and the I flag was clear the cycle it gets set
// we still proceed with an irq
let irqBypassI = false;

function serviceNMI(){

  clearNmiEdge();
  //if (debug.logging) console.debug("%cNMI fired", "color:white;background:red;font-weight:bold;padding:2px 6px;border-radius:3px");
  
// nmiPending (NMI timing latch) now contains the frame it was generated
// if the frame doesn't match the current frame, don't fire the NMI, it was generated on vblank boundaries <- this guard not required
// i.e a test ROM created an NMI edge at 260/338, this armed at dot 0 of 261 ..but that's a new frame!
// also exposed a frame counter bug, fixed.

// you would think this would be a sensible guard, but it breaks passing tests in both accuracy coin and 'ppu_vbl_nmi.nes'
const inVBlank = (currentScanline >= 241 && currentScanline <= 260);        // VBlank starts on scanline 241
  
  // temp logging , like most of it
  if (nmiPending !== currentFrame) {
    console.debug(
      `[NMI DEBUG] ` +
      `currentFrame=${currentFrame} ` +
      `nmiLatchedFrame=${nmiPending} ` +
      `cpu=${cpuCycles} ` +
      `ppu=${ppuCycles} ` +
      `sl=${currentScanline} ` +
      `dot=${currentDot}`
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

/*
-> notty notty
[NMI DEBUG] currentFrame=995 nmiLatchedFrame=994 cpu=29631760 ppu=88895280 sl=261 dot=4
[NMI DEBUG] currentFrame=1011 nmiLatchedFrame=1010 cpu=30108251 ppu=90324753 sl=261 dot=5
*/

  /*
  The 2nd guard here doesn't seem to matter for accuracy coin tests, but an NMI should definitely
  occur within the frame it was generated in, you can see the above log which is from 'ppu_vbl_nmi.nes'
  hence adding the guard back, the emulator at this stage gets to test 8 out of 10, failing test 8 which
  is 'NMI off timing', though originally i was anding these gates instead of or'ing... whoops

  The only video timing test which fails on accuracy coin is now nmi timing, which passes on the old suite mentioned above
  (or the rom singles, which are mapper 0 and can be run individually)
  */
  // removed guard for nmi suppression here on the NMI handler (i.e. makes to NMI handler, but then cancel)
  const pc = CPUregisters.PC & 0xFFFF;

  // Push PCH
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), (pc >> 8) & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  consumeCycle();

  // Push PCL
  checkWriteOffset(0x0100 | (CPUregisters.S & 0xFF), pc & 0xFF);
  CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
  consumeCycle();

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
  consumeCycle();

  // Set I
  CPUregisters.P.I = 1;
  consumeCycle();

  // Vector fetch
  const lo = checkReadOffset(0xFFFA);
  consumeCycle();
  const hi = checkReadOffset(0xFFFB);
  consumeCycle();

  // Set PC to NMI vector
  CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;
  consumeCycle();

  if (debug.videoTiming){
  console.debug(
    `%c[NMI VECTOR LOADED → PC=$${CPUregisters.PC.toString(16).padStart(4,"0")}] cpu=${cpuCycles} ppu=${ppuCycles} frame=${currentFrame} sl=${currentScanline} dot=${currentDot}`,
    "color:black;background:yellow;font-weight:bold;font-size:14px;"
  );
 }
}
// branch instruction IRQ timing next
// have been up to fault B in interrupt flag latency, and back tracked, cannot figure out what changes between that test and 
// the b flag test, b flag test will pass, then run interrupt latency test, fail with 9 / A / B and then go back to B flag
// test and it fails with #3
function irqTimingEngine(){

  // check if any source has pulled the IRQ line low / active state
  if (!Object.values(irqAssert).some(Boolean)) return;
  const isBranchInstruction = ((code & 0x1F) === 0x10);

  // === Edge Cases ===
  if (code === 0x58) return; // CLI, delay by 1 instruction
  if (code === 0x78 || code === 0x58 || code === 0x28) return; // no handling logic in here for these
  //if (isBranchInstruction) return;


  // fall through: general timing, service at the point this handler is called (post opcode handler)
  serviceIRQ();
}

function serviceIRQ(bypass_interrupt_flag = false) {
      irqBranch.notTaken = false;
    // always call for the servicing of IRQ if the timing is right, but bail out if the interrupt flag is set
    // dont bail out if we captured IRQ decision in advance (mid instruction prior to setting the interrupt flag in SEI, CLI, PLP)
    if(CPUregisters.P.I && !bypass_interrupt_flag) return;
     const isBranchInstruction = ((code & 0x1F) === 0x10);
     if (isBranchInstruction) return;

    console.log("opcode when IRQ serviced",code.toString(16));
  

    console.log("IRQ SERVICED, source-", 
    "mmc3:",  irqAssert.mmc3, 
    "DMC:",   irqAssert.dmcDma,
    );
    
    const pc = CPUregisters.PC & 0xFFFF;

    // Push PCH
    cpuWrite(0x0100 | (CPUregisters.S & 0xFF), (pc >> 8) & 0xFF);
    CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
    consumeCycle();

    // Push PCL
    cpuWrite(0x0100 | (CPUregisters.S & 0xFF), pc & 0xFF);
    CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
    consumeCycle();

    // Build status byte (U=1, B=0)
    let p = 0b00100000;
    p |= (CPUregisters.P.N & 1) << 7;
    p |= (CPUregisters.P.V & 1) << 6;
    p |= (CPUregisters.P.D & 1) << 3;
    p |= (CPUregisters.P.I & 1) << 2;
    p |= (CPUregisters.P.Z & 1) << 1;
    p |= (CPUregisters.P.C & 1);

    // Push P
    cpuWrite(0x0100 | (CPUregisters.S & 0xFF), p & 0xFF);
    CPUregisters.S = (CPUregisters.S - 1) & 0xFF;
    consumeCycle();

    // Set Interrupt Disable
    CPUregisters.P.I = 1;
    consumeCycle();

    // Fetch IRQ vector
    let lo = checkReadOffset(0xFFFE);
    consumeCycle();

    let hi = checkReadOffset(0xFFFF);
    consumeCycle();

    // Set PC to IRQ vector
    CPUregisters.PC = ((hi << 8) | lo) & 0xFFFF;

    consumeCycle();
}