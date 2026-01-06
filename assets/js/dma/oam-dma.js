let DMA = {
  active: false,
  page:   0x00,
  addr:   0x0000,
  index:  0,     // 0..255
  tmp:    0x00,
  phase:  0,     // 0 = read, 1 = write
  pad:    0      // 1 or 2 cycles
};

// ===== OAM DMA ($4014) =====
// Copies 256 bytes from CPU RAM page (value << 8) into PPU OAM.
// Adds 513 cycles if CPU starts on odd cycle, 514 if even.
// Microstepped: 1 CPU cycle per call (PPU +3 each).
function dmaTransfer(value) {
  const cur = cpuCycles ?? 0;

  DMA.active = true;
  DMA.page   = value & 0xFF;
  DMA.addr   = DMA.page << 8;
  DMA.index  = 0;
  DMA.tmp    = 0;
  DMA.phase  = "get";

const startCycle = (cpuCycles + 1) & 1;   // first cycle after the write
DMA.pad = startCycle ? 2 : 1;             // odd start => 2, even start => 1

}

function dmaMicroStep() {

  // ---- alignment pad (1 or 2 cycles) ----
  if (DMA.pad > 0) {
    let cycles = DMA.pad;

    for (let i = 0; i < cycles; i++) {
      addCycles(1);
    }

    DMA.pad = 0;
    return cycles; // returns 1 or 2
  }

  // ---- finished ----
  if (DMA.index === 256) {
    DMA.active = false;
    return 0;
  }

  // ---- transfer ----
  if (DMA.phase === "get") {
    // READ cycle
    DMA.tmp = checkReadOffset(DMA.addr) & 0xFF;
    DMA.phase = "put";
    addCycles(1);
    return 1;
  }
  
  if (DMA.phase === "put" ) {
    // WRITE cycle
    checkWriteOffset(0x2004, DMA.tmp);
    DMA.addr = (DMA.addr + 1) & 0xFFFF;
    DMA.index++;
    DMA.phase = "get";
    addCycles(1);
    //console.log( "  cpuCycles:", cpuCycles);
    return 1;
  }
}