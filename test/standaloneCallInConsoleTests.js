// tick tests will be off, we don't count them for some cases and instead service the ppu ticks straight away
// NMI for one, DMA transfer as well.

function testOamDmaTransfer(page = 0x02) {
  
  
  // Fill CPU RAM page with predictable pattern
  for (let i = 0; i < 256; i++) {
    systemMemory[(page << 8) + i] = i & 0xFF;
  }

  // Run DMA transfer
  dmaTransfer(page);

  // Build expected and actual string outputs
  const expected = Array.from({length: 16}, (_, i) => i.toString(16).padStart(2, '0')).join(' ');
  const actual   = Array.from(OAM.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');

  // Log results
  console.debug(
    "%cExpected OAM[0..15]: %c" + expected,
    "color: orange; font-weight: bold;", "color: green; font-weight: bold;"
  );
  console.debug(
    "%cActual   OAM[0..15]: %c" + actual,
    "color: orange; font-weight: bold;", "color: cyan; font-weight: bold;"
  );

  // Check a specific value
  console.debug(
    "%cCheck OAM[0x10]: %c" + OAM[0x10].toString(16) +
    " %c(expected: %c10)",
    "color: orange; font-weight: bold;",
    "color: cyan; font-weight: bold;",
    "color: orange; font-weight: bold;",
    "color: green; font-weight: bold;"
  );
}

function testPpuMemorySuite() {
  console.debug("%c=== PPU MEMORY TEST SUITE ===", "color: yellow; font-weight: bold;");

  // Utility: log pass/fail
  function logTest(name, expected, actual) {
    const pass = (expected === actual);
    console.debug(
      `%c${name}: expected %c${expected.toString(16).padStart(2, '0')} %c(actual: %c${actual.toString(16).padStart(2, '0')})`,
      "color: orange; font-weight: bold;",
      pass ? "color: green; font-weight: bold;" : "color: red; font-weight: bold;",
      "color: orange; font-weight: bold;",
      pass ? "color: green; font-weight: bold;" : "color: red; font-weight: bold;"
    );
  }

  // ------------------------
  // Pattern Table Test ($0000)
  // ------------------------
  if (typeof chrIsRAM !== "undefined" && chrIsRAM) {
    const addr = 0x0000;
    const testVal = 0xAA;
    const orig = SHARED.CHR_ROM[addr];
    SHARED.CHR_ROM[addr] = testVal;
    logTest("Pattern [$0000]", testVal, SHARED.CHR_ROM[addr]);
    SHARED.CHR_ROM[addr] = orig; // restore
  } else {
    console.debug("%cPattern [$0000]: SKIPPED (CHR-ROM read-only)", "color: gray;");
  }

  // ------------------------
  // Nametable Test ($2000)
  // ------------------------
  const ntAddr = 0x2000;
  const ntVal = 0xAB;
  PPUregister.writeToggle = false;
  ppuWrite(0x2006, (ntAddr >> 8) & 0xFF);
  ppuWrite(0x2006, ntAddr & 0xFF);
  ppuWrite(0x2007, ntVal);
  PPUregister.writeToggle = false;
  ppuWrite(0x2006, (ntAddr >> 8) & 0xFF);
  ppuWrite(0x2006, ntAddr & 0xFF);
  ppuRead(0x2007); // dummy read
  logTest("Nametable [$2000]", ntVal, ppuRead(0x2007));

  // ------------------------
  // Palette Test ($3F00)
  // ------------------------
  const palAddr = 0x3F00;
  const palVal = 0x0F;
  PPUregister.writeToggle = false;
  ppuWrite(0x2006, (palAddr >> 8) & 0xFF);
  ppuWrite(0x2006, palAddr & 0xFF);
  ppuWrite(0x2007, palVal);
  PPUregister.writeToggle = false;
  ppuWrite(0x2006, (palAddr >> 8) & 0xFF);
  ppuWrite(0x2006, palAddr & 0xFF);
  logTest("Palette [$3F00]", palVal, ppuRead(0x2007));

  // ------------------------
  // OAM Test (via DMA $4014)
  // ------------------------
  const page = 0x02;
  for (let i = 0; i < 256; i++) {
    systemMemory[(page << 8) + i] = i & 0xFF;
  }
  dmaTransfer(page);
  let oamPass = true;
  for (let i = 0; i < 16; i++) {
    if (OAM[i] !== (i & 0xFF)) oamPass = false;
  }
  console.debug(
    `%cOAM [0..15] via DMA: %c${oamPass ? "PASS" : "FAIL"}`,
    "color: orange; font-weight: bold;",
    oamPass ? "color: green; font-weight: bold;" : "color: red; font-weight: bold;"
  );

  console.debug("%c=== PPU MEMORY TEST END ===", "color: yellow; font-weight: bold;");
}


function testTiming() {
  // Local counters to avoid touching emulator state
  let testCpuCycles = 0;
  let testPpuTicks  = 0;

  function testPpuTick() { testPpuTicks++; }

  // Advance CPU+PPU for N cycles (like your delta * 3 loop)
  function addCpuCycles(n) {
    const last = testCpuCycles & 0xFFFF;
    testCpuCycles  = (testCpuCycles + n) & 0xFFFF;
    const delta = (testCpuCycles - last) & 0xFFFF;
    for (let i = 0; i < delta * 3; i++) testPpuTick();
  }

  // Simulated "instruction" — base cycles only
  function step(opCycles, { nmi = false, dma = false } = {}) {
    addCpuCycles(opCycles);

    if (nmi) {
      // NMI latency: 7 CPU cycles
      for (let i = 0; i < 7 * 3; i++) testPpuTick();
      testCpuCycles = (testCpuCycles + 7) & 0xFFFF;
    }

    if (dma) {
      // NES DMA timing: 256 bytes * 2 cycles each + possible alignment
      const even = (testCpuCycles % 2 === 0);
      const penalty = even ? 513 : 514;
      for (let i = 0; i < penalty * 3; i++) testPpuTick();
      testCpuCycles = (testCpuCycles + penalty) & 0xFFFF;
    }
  }

  // =============================
  // Begin test sequence
  // =============================
  let expectedTicks = 0;

  console.debug("=== Branch timing test ===");
  step(2); expectedTicks += 2 * 3;
  step(3); expectedTicks += 3 * 3;
  console.debug(`PPU ticks=${testPpuTicks} Expected=${expectedTicks}`);

  console.debug("=== NMI timing test ===");
  step(2, { nmi: true });
  expectedTicks += (2 + 7) * 3;
  console.debug(`PPU ticks=${testPpuTicks} Expected=${expectedTicks}`);

  console.debug("=== DMA even-cycle test ===");
  // Align to even cycle
  if (testCpuCycles % 2 !== 0) { step(1); expectedTicks += 1 * 3; }
  const penaltyEven = 513;
  step(0, { dma: true }); // DMA from even cycle start
  expectedTicks += penaltyEven * 3;
  console.debug(`PPU ticks=${testPpuTicks} Expected=${expectedTicks}`);

  console.debug("=== DMA odd-cycle test ===");
  // Align to odd cycle
  if (testCpuCycles % 2 === 0) { step(1); expectedTicks += 1 * 3; }
  const penaltyOdd = 514;
  step(0, { dma: true }); // DMA from odd cycle start
  expectedTicks += penaltyOdd * 3;
  console.debug(`PPU ticks=${testPpuTicks} Expected=${expectedTicks}`);

  console.debug("=== Final totals ===");
  console.debug(`CPU cycles=${testCpuCycles}`);
  console.debug(`PPU ticks=${testPpuTicks} Expected total=${expectedTicks}`);
}


function testTimingReal() {
  // Save original state
  const savedCpuCycles = cpuCycles;
  const savedPPUclock  = { ...PPUclock };
  const savedPC        = CPUregisters.PC;
  const savedPrg       = new Uint8Array(prgRom);

  let localPPUTicks = 0;
  const originalPpuTick = ppuTick;
  window.ppuTick = function() {
    localPPUTicks++;
    return originalPpuTick.apply(this, arguments);
  };

  // === Build deterministic test ROM ===
  const prog = [];
  function emit(...bytes) { prog.push(...bytes); }

  // 0: NOP (2 cycles)
  emit(0xEA);

  // 1: LDA abs $1234 (3 cycles)
  emit(0xAD, 0x34, 0x12);

  // 4: BNE forward taken (+1 cycle)
  emit(0xD0, 0x02); // skip next NOP
  emit(0xEA);       // skipped
  emit(0xEA);       // landed here

  // 8: BNE not taken (no extra)
  emit(0xF0, 0x02); // BEQ forward not taken (Z=0 expected in test)
  emit(0xEA);       // executes
  emit(0xEA);       // executes

  // 12: Force page-crossing branch (+2 cycles)
  const branchStart = 0x8000 + prog.length;
  emit(0xD0, 0x7F); // BNE forward over boundary
  // Fill to end of page with NOPs
  while ((0x8000 + prog.length) & 0xFF) emit(0xEA);
  emit(0xEA); // branch target

  // Pad with NOPs so DMA/NMI are safe to run here
  while (prog.length < 64) emit(0xEA);

  // === Write into PRG ROM ===
  prgRom.fill(0xEA);
  for (let i = 0; i < prog.length; i++) {
    prgRom[i] = prog[i];
  }

  // Reset CPU/PPU
  cpuCycles = 0;
  PPUclock.scanline = 0;
  PPUclock.dot = 0;
  PPUclock.frame = 0;
  CPUregisters.PC = 0x8000;

  let expectedTicks = 0;
  localPPUTicks = 0;

  function runAndCheck(name, cyclesExpected) {
    step();
    expectedTicks += cyclesExpected * 3;
    console.debug(`${name}: PPU ticks=${localPPUTicks} Expected=${expectedTicks}`);
  }

  console.debug("=== Opcode timing tests ===");
  runAndCheck("NOP (2)", 2);
  runAndCheck("LDA abs (3)", 3);
  runAndCheck("BNE taken (+1)", 3); // base 2 + 1 taken
  runAndCheck("NOP after branch", 2);
  runAndCheck("BEQ not taken (2)", 2);
  runAndCheck("NOP after BEQ", 2);
  runAndCheck("BNE + page cross (+2)", 4); // base 2 + 2 page cross

  console.debug("=== DMA even-cycle ===");
  cpuCycles &= ~1;
  dmaTransfer(0);
  expectedTicks += 513 * 3;
  console.debug(`PPU ticks=${localPPUTicks} Expected=${expectedTicks}`);

  console.debug("=== DMA odd-cycle ===");
  cpuCycles |= 1;
  dmaTransfer(0);
  expectedTicks += 514 * 3;
  console.debug(`PPU ticks=${localPPUTicks} Expected=${expectedTicks}`);

  console.debug("=== NMI latency ===");
  nmiPending = true;
  runAndCheck("NOP + NMI (2+7)", 2 + 7);

  console.debug("=== Final totals ===");
  console.debug(`cpuCycles=${cpuCycles}`);
  console.debug(`PPU ticks=${localPPUTicks} Expected total=${expectedTicks}`);

  // Restore original state
  window.ppuTick = originalPpuTick;
  cpuCycles = savedCpuCycles;
  Object.assign(PPUclock, savedPPUclock);
  CPUregisters.PC = savedPC;
  prgRom.set(savedPrg);
}



