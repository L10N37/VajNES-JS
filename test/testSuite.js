//TO DO: instead of constantly adjusting tests, add one to test all intercepted offsets modifying a variables data



// ─── GLOBAL TEST SETUP ─────────────────────────────────────────────────────────
function setupTests(tests) {
  // --- Reset CPU/PPU & clear WRAM/PPU space (preserve PRG-ROM) ---
  for (let a = 0; a < 0x4000; a++) checkWriteOffset(a, 0);
  CPUregisters.A = 0; CPUregisters.X = 0; CPUregisters.Y = 0; CPUregisters.S = 0xFF;
  CPUregisters.P = { C:0, Z:0, I:0, D:0, B:0, V:0, N:0 };
  if (typeof PPUregister === "object") {
    Object.keys(PPUregister).forEach(k => PPUregister[k] = 0);
  }

  // --- Set PC to reset vector ---
  CPUregisters.PC = 0x8000;

  // --- Lay out all test opcodes into PRG-ROM at $8000/$C000 ---
  let seqOffset = 0;
  tests.forEach(t => {
    t.code.forEach(b => {
      checkWriteOffset(0x8000 + seqOffset, b);
      checkWriteOffset(0xC000 + seqOffset, b);
      seqOffset++;
    });
  });
}
// ────────────────────────────────────────────────────────────────────────────────

function runEdgeCaseTests() {
  // ========= 6502 EDGE CASE TEST SUITE (fixed) =========

  // ---- Small helpers (scoped to the suite) ----
  const cross   = (desc, test) => Object.assign(test, { desc, cross: true  });
  const nocross = (desc, test) => Object.assign(test, { desc, cross: false });

  // Map test description → [mnemonic, addressing] so we can pull base cycles from your opcode table.
  const testLookup = {
  "JMP ($02FF) page-wrap bug": ["JMP", "indirect"],
  "STA $FF,X wraps": ["STA", "zeroPageX"],
  "BNE crosses page": ["BNE", "relative"],
  "ADC BCD half-carry": ["ADC", "immediate"],
  "SBC BCD borrow": ["SBC", "immediate"],
  "BIT $80 dummy-read": ["BIT", "zeroPage"],
  "ASL $10 dummy-read": ["ASL", "zeroPage"],
  "PHA wraps SP": ["PHA", "implied"],
  "PHP/PLP order": ["PHP", "implied"],
  "Self-mod IMM": ["LDA", "immediate"],
  "Self-mod IMM (console ops with full checks)": ["LDA", "immediate"], // <— add this line
  "BRK sets B": ["BRK", "implied"],
  "IRQ leaves B": [null, null],
};

  function getBaseCycles(testDesc) {
    if (testDesc === "IRQ leaves B") return 7;
    const lookup = testLookup[testDesc];
    if (!lookup) throw new Error(`No testLookup mapping for "${testDesc}"`);
    const [mnemonic, addressing] = lookup;
    // Use your already-built opcodes table
    return opcodes[mnemonic]?.[addressing]?.cycles ?? 0;
  }

  // DMA-safe memory clear for tests:
  // - Clear WRAM ($0000–$1FFF mirrors) and PRG-RAM ($6000–$7FFF)
  // - DO NOT touch $4000–$401F (APU/IO; $4014 triggers OAM DMA)
  // - Leave PRG-ROM alone; we will patch code bytes directly
  function clearForTest() {
    for (let a = 0x0000; a <= 0x1FFF; a++) checkWriteOffset(a, 0);
    if (typeof prgRam !== "undefined" && prgRam) {
      for (let a = 0x6000; a <= 0x7FFF; a++) checkWriteOffset(a, 0);
    }
  }

  // Directly write bytes into PRG-ROM window for test code (bypasses IO side-effects)
  function writeCodeToROM(cpuAddr, bytes) {
    for (let i = 0; i < bytes.length; i++) {
      const a = (cpuAddr + i) & 0xFFFF;
      if (a < 0x8000) {
        // If you ever want to test code < $8000, fall back to bus write:
        checkWriteOffset(a, bytes[i] & 0xFF);
      } else {
        // Mapper 0 / simple PRG windowing assumed: index from $8000
        prgRom[(a - 0x8000) & (prgRom.length - 1)] = bytes[i] & 0xFF;
      }
    }
  }

  // Page crossing detection (purely analytical; no side effects)
  function didPageCross(test) {
    if (!test.code || test.code.length === 0) return false;

    // Branches (relative)
    if (test.opcodeFn && test.opcodeFn.endsWith("_REL")) {
      const offset = test.code[1] & 0xFF;
      const signed = offset < 0x80 ? offset : offset - 0x100;
      const basePC = ( (test.pre?.PC ?? 0x8000) + 2 ) & 0xFFFF;

      // Determine if branch is taken from pre-flags
      const P = test.pre?.P ?? {};
      const taken =
        (/BNE/.test(test.opcodeFn) && (P.Z === 0)) ||
        (/BEQ/.test(test.opcodeFn) && (P.Z === 1)) ||
        (/BCC/.test(test.opcodeFn) && (P.C === 0)) ||
        (/BCS/.test(test.opcodeFn) && (P.C === 1)) ||
        (/BPL/.test(test.opcodeFn) && (P.N === 0)) ||
        (/BMI/.test(test.opcodeFn) && (P.N === 1)) ||
        (/BVC/.test(test.opcodeFn) && (P.V === 0)) ||
        (/BVS/.test(test.opcodeFn) && (P.V === 1));

      if (!taken) return false;

      const dest = (basePC + signed) & 0xFFFF;
      return (basePC & 0xFF00) !== (dest & 0xFF00);
    }

    // Absolute,X and Absolute,Y
    if (test.opcodeFn && /(ABSX|ABSY)/.test(test.opcodeFn)) {
      const base = (test.code[1] | (test.code[2] << 8)) & 0xFFFF;
      const index = /ABSX/.test(test.opcodeFn) ? (test.pre?.X ?? 0) : (test.pre?.Y ?? 0);
      const eff = (base + (index & 0xFF)) & 0xFFFF;
      return (base & 0xFF00) !== (eff & 0xFF00);
    }

    // Indirect,Y
    if (test.opcodeFn && /INDY/.test(test.opcodeFn)) {
      const zp = test.code[1] & 0xFF;
      // Read zp pointer bytes (no side effects)
      const low  = checkReadOffset(zp) & 0xFF;
      const high = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
      const ptr = (high << 8) | low;
      const y = test.pre?.Y ?? 0;
      const eff = (ptr + (y & 0xFF)) & 0xFFFF;
      return (ptr & 0xFF00) !== (eff & 0xFF00);
    }

    return false;
  }

  // ---- EDGE CASE TESTS ----
  const cases = [
    cross("JMP ($02FF) page-wrap bug", {
      code: [0x6C, 0xFF, 0x02],
      opcodeFn: "JMP_IND",
      setup: () => {
        checkWriteOffset(0x02FF, 0x00); // low target byte
        checkWriteOffset(0x0200, 0x80); // high target byte via wrap bug
      },
      expectPC: 0x8000,
      baseCycles: getBaseCycles("JMP ($02FF) page-wrap bug"),
      extra: 0
    }),

    nocross("STA $FF,X wraps", {
      code: [0x95, 0xFF],
      pre: { A: 0x42, X: 0x01 },
      opcodeFn: "STA_ZPX",
      expectMem: { addr: 0x0000, value: 0x42 }, // $00FF + X wraps to $0000
      baseCycles: getBaseCycles("STA $FF,X wraps"),
      extra: 0
    }),

    cross("BNE crosses page", {
      code: [0xD0, 0x03],
      pre: { P: { Z: 0 }, PC: 0x80FD }, // starting at $80FD (end of page)
      opcodeFn: "BNE_REL",
      expectPC: 0x8102,                 // ($80FD + 2) + 3 = $8102 (crossed)
      baseCycles: getBaseCycles("BNE crosses page"),
      extra: 2                          // taken + crossed page (+2 total)
    }),

    nocross("ADC BCD half-carry", {
      code: [0x69, 0x15],
      pre: { A: 0x27, P: { D: 1, C: 0 } }, // decimal mode set; NES ignores BCD but we test flags math edge
      opcodeFn: "ADC_IMM",
      expect: { A: 0x42, C: 0 },           // per the described expectation in your notes
      baseCycles: getBaseCycles("ADC BCD half-carry"),
      extra: 0
    }),

    /*
      verified @ https://skilldrick.github.io/easy6502/

      SED ; set decimal
      CLC ; clear carry (borrow)
      LDA #$42
      SBC #$15
      BRK

      result:
      A=$26, C=1 (per your corrected note)
    */
    nocross("SBC BCD borrow", {
      code: [0xE9, 0x15],
      pre: { A: 0x42, P: { D: 1, C: 0 } },
      opcodeFn: "SBC_IMM",
      expect: { A: 0x26, C: 1 },
      baseCycles: getBaseCycles("SBC BCD borrow"),
      extra: 0
    }),

    nocross("BIT $80 dummy-read", {
      code: [0x24, 0x80],
      setup: () => { checkWriteOffset(0x0080, 0xFF); },
      pre: { A: 0x00 },
      opcodeFn: "BIT_ZP",
      expectFlags: { Z: 1, V: 1, N: 1 },
      baseCycles: getBaseCycles("BIT $80 dummy-read"),
      extra: 0
    }),

    nocross("ASL $10 dummy-read", {
      code: [0x06, 0x10],
      setup: () => { checkWriteOffset(0x0010, 0x01); },
      opcodeFn: "ASL_ZP",
      expectMem: { addr: 0x0010, value: 0x02 },
      baseCycles: getBaseCycles("ASL $10 dummy-read"),
      extra: 2 // 5 cycles for this opcode, not 2 (3 is ZP base)
    }),

    nocross("PHA wraps SP", {
      code: [0x48],
      pre: { A: 0x99, S: 0x00 },            // pushing at S=$00 should wrap to $01FF, then S=$FF
      opcodeFn: "PHA_IMP",
      expectMem: { addr: 0x0100, value: 0x99 }, // write goes to $0100 + S after decrement sequence
      expect: { S: 0xFF },
      baseCycles: getBaseCycles("PHA wraps SP"),
      extra: 0
    }),

    nocross("PHP/PLP order", {
      code: [0x08, 0x28], // PHP then PLP
      pre: { P: { C: 1, D: 1, I: 0, Z: 1 }, S: 0xFF },
      opcodeFn: "PHP_IMP",                 // first op is PHP; PLP will pop the pushed flags
      setup: () => { checkWriteOffset(0x01FF, 0b00101101); }, // emulate existing top-of-stack content
      expectFlags: { C: 1, Z: 1, I: 0, D: 1, B: 0, V: 0, N: 0 },
      baseCycles: getBaseCycles("PHP/PLP order"),
      extra: 0
    }),

    // Self-mod immediate: ensure operand is read at runtime, not pre-fetched/cached.
    nocross("Self-mod IMM (console ops with full checks)", {
      code: [0xA9, 0x00],
      pre: { A: 0x00, PC: 0x8000 },
      opcodeFn: "LDA_IMM",
      // No baseCycles field here; we'll compute inside run() against "Self-mod IMM" lookup
      extra: 0,
      run: () => {
        // Install opcode+operand into PRG-ROM directly
        writeCodeToROM(0x8000, [0xA9, 0x00]);
        // Patch operand after write to simulate self-modification
        writeCodeToROM(0x8001, [0x77]);

        // Setup CPU state
        CPUregisters.A  = 0x00;
        CPUregisters.PC = 0x8000;

        const before = cpuCycles;
        step(); // run exactly one instruction

        const aOK  = (CPUregisters.A === 0x77);
        const pcOK = (CPUregisters.PC === 0x8002);
        const used = cpuCycles - before;
        const expect = getBaseCycles("Self-mod IMM") + 0;

        console.debug(`[Self-mod IMM] A=${hex8(CPUregisters.A)} PC=${hex16(CPUregisters.PC)} usedCycles=${used}`);

        return aOK && pcOK && (used === expect);
      }
    }),

    nocross("BRK sets B", {
      code: [0x00],
      pre: { P: { I: 0, B: 0 } },
      opcodeFn: "BRK_IMP",
      expectFlags: { B: 1, I: 1 },
      baseCycles: getBaseCycles("BRK sets B"),
      extra: 5 // expect extra 5 over base of 2 for this opcode
    }),

    nocross("IRQ leaves B", {
      code: [],
      pre: { P: { I: 0, B: 0 } },
      opcodeFn: "IRQ",
      expectFlags: { B: 0, I: 1 },
      baseCycles: 7,
      extra: 0
    }),
  ];

  // ---- Table UI header ----
  let html = `
    <div style="background:darkblue;color:white;padding:7px 6px 7px 6px;font-weight:bold;">
      6502 EDGE CASE TEST SUITE
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead>
        <tr style="background:#223366;">
          <th>Test</th>
          <th>Op</th>
          <th>Opcode Fn</th>
          <th>Flags<br>Before</th>
          <th>Flags<br>After</th>
          <th>CPU<br>Before</th>
          <th>CPU<br>After</th>
          <th>PC<br>Before</th>
          <th>PC<br>After</th>
          <th>Page<br>Crossed?</th>
          <th>Cycles<br>Before</th>
          <th>Cycles<br>After</th>
          <th>ΔCycles</th>
          <th>Status</th>
        </tr>
      </thead><tbody>`;

  // ---- Execute tests ----
  for (const test of cases) {
    // Fresh, DMA-safe memory init
    clearForTest();

    // CPU baseline
    CPUregisters.A = CPUregisters.X = CPUregisters.Y = 0;
    CPUregisters.S = 0xFF;
    CPUregisters.P = { C:0, Z:0, I:0, D:0, B:0, V:0, N:0 };
    CPUregisters.PC = test.pre?.PC ?? 0x8000;

    // Apply pre-state
    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A & 0xFF;
      if (test.pre.X != null) CPUregisters.X = test.pre.X & 0xFF;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y & 0xFF;
      if (test.pre.S != null) CPUregisters.S = test.pre.S & 0xFF;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }

    // Per-test setup (may write memory, but won’t hit DMA because we skipped IO)
    if (test.setup) test.setup();

    // Snapshots BEFORE
    const fb = { ...CPUregisters.P };
    const cb = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };
    const pcBefore = CPUregisters.PC & 0xFFFF;
    const beforeCycles = cpuCycles | 0;

    // Special IRQ test — call IRQ directly (no code injection)
    if (testLookup[test.desc] && testLookup[test.desc][0] === null) {
      IRQ();
    } else if (test.run) {
      // A self-contained runner (Self-mod IMM)
      test.run();
    } else if (test.code && test.code.length) {
      // Normal case: install test code at current PC and execute one instruction
      writeCodeToROM(CPUregisters.PC, test.code);
      step();
    }

    // Snapshots AFTER
    const fa = { ...CPUregisters.P };
    const ca = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };
    const pcAfter = CPUregisters.PC & 0xFFFF;
    const afterCycles = cpuCycles | 0;
    const usedCycles = (afterCycles - beforeCycles) | 0;

    // Page-cross display
    const pageCrossed = didPageCross(test)
      ? `<span style="color:orange;">Yes</span>`
      : `<span style="color:lightgreen;">No</span>`;

    // ---- Pass/fail checks ----
    let pass = true, reasons = [];

    if (test.expect) {
      for (const r in test.expect) {
        const actual = (r in ca) ? ca[r] : CPUregisters.P[r];
        if (actual !== test.expect[r]) {
          pass = false;
          reasons.push(`${r}=${actual}≠${test.expect[r]}`);
        }
      }
    }

    if (test.expectFlags) {
      for (const f in test.expectFlags) {
        if ((CPUregisters.P[f] | 0) !== (test.expectFlags[f] | 0)) {
          pass = false;
          reasons.push(`P.${f}=${CPUregisters.P[f]|0}≠${test.expectFlags[f]|0}`);
        }
      }
    }

    if (test.expectMem) {
      const memVal = checkReadOffset(test.expectMem.addr) & 0xFF;
      if (memVal !== (test.expectMem.value & 0xFF)) {
        pass = false;
        reasons.push(`M[0x${test.expectMem.addr.toString(16)}]=${memVal}≠${test.expectMem.value}`);
      }
    }

    if (test.expectPC !== undefined && pcAfter !== (test.expectPC & 0xFFFF)) {
      pass = false;
      reasons.push(`PC=0x${pcAfter.toString(16)}≠0x${(test.expectPC & 0xFFFF).toString(16)}`);
    }

    // cycles target: base + extra (from test vector)
    const cycleTarget = ((test.baseCycles ?? getBaseCycles(test.desc)) + (test.extra ?? 0)) | 0;
    if (usedCycles !== cycleTarget) {
      pass = false;
      reasons.push(`cycles=${usedCycles}≠${cycleTarget}`);
    }

    // ---- Render row ----
    const opLabel = (test.code || []).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const status = pass
      ? `<span style="color:#7fff7f;">✔️</span>`
      : `<details style="color:#ff4444;cursor:pointer;"><summary>❌ Show Details</summary><ul>` +
          reasons.map(r => `<li>${r}</li>`).join("") +
        `</ul></details>`;

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td>${test.desc || test.name}</td>
        <td>${opLabel}</td>
        <td>${test.opcodeFn || ""}</td>
        <td>${flagsBin(fb)}</td>
        <td>${flagsBin(fa)}</td>
        <td>A=${cb.A} X=${cb.X} Y=${cb.Y} S=${cb.S}</td>
        <td>A=${ca.A} X=${ca.X} Y=${ca.Y} S=${ca.S}</td>
        <td>0x${pcBefore.toString(16)}</td>
        <td>0x${pcAfter.toString(16)}</td>
        <td>${pageCrossed}</td>
        <td>${beforeCycles}</td>
        <td>${afterCycles}</td>
        <td>${usedCycles}</td>
        <td>${status}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);

  CPUregisters.PC = 0x8000;
  prgRom[0x00]= 0x02;
}

function flagsBin(P) {
  return ((P.N<<7)|(P.V<<6)|(1<<5)|(P.B<<4)|(P.D<<3)|(P.I<<2)|(P.Z<<1)|(P.C))
           .toString(2).padStart(8,"0");
}
function getMirrors(addr) {
  // Zero Page: $0000–$00FF (no mirrors)
  if (addr >= 0x0000 && addr <= 0x00FF) return [addr];

  // CPU RAM mirrors: $0100–$1FFF
  if (addr >= 0x0100 && addr <= 0x1FFF) {
    const base = addr & 0x07FF;
    if (addr === base) {
      return [base, base + 0x0800, base + 0x1000, base + 0x1800];
    } else {
      return [addr, base];
    }
  }

  // PPU registers: $2000–$3FFF (mirrored every 8 bytes)
  if (addr >= 0x2000 && addr <= 0x3FFF) {
    let base = 0x2000 + ((addr - 0x2000) % 8);
    let mirrors = [];
    for (let off = 0; off <= 0x1FF8; off += 8) {
      mirrors.push(base + off);
    }
    return mirrors;
  }

  // PPU Palette RAM: $3F00–$3FFF (mirrored every 32 bytes)
  if (addr >= 0x3F00 && addr <= 0x3FFF) {
    const base = 0x3F00 + ((addr - 0x3F00) % 0x20);
    let mirrors = [];
    for (let offset = 0; offset < 0x1000; offset += 0x20) {
      mirrors.push(base + offset);
    }
    return mirrors.filter(a => a < 0x4000);
  }

  // Default: only itself (not mirrored)
  return [addr];

  
}

function runLoadsTests() {
  const tests = [
    { name:"LDA #$42",         code:[0xA9,0x42],                    expect:{A:0x42,Z:0,N:0} },
    { name:"LDA zeroPage",     code:[0xA5,0x80], setup:()=>{ checkWriteOffset(0x80, 0x55); }, expect:{A:0x55,Z:0,N:0} },
    { name:"LDA zeroPage,X",   code:[0xB5,0x80], setup:()=>{ CPUregisters.X=2; checkWriteOffset(0x82, 0x77); }, expect:{A:0x77,Z:0,N:0} },
    { name:"LDA absolute",     code:[0xAD,0x00,0x02], setup:()=>{ checkWriteOffset(0x0200, 0x12); }, expect:{A:0x12,Z:0,N:0} },
    { name:"LDA absolute,X",   code:[0xBD,0x00,0x07], setup:()=>{ CPUregisters.X=1; checkWriteOffset(0x0701, 0x88); }, expect:{A:0x88,Z:0,N:1} },
    { name:"LDA absolute,Y",   code:[0xB9,0x00,0x07], setup:()=>{ CPUregisters.Y=2; checkWriteOffset(0x0702, 0x44); }, expect:{A:0x44,Z:0,N:0} },
    { name:"LDA (indirect,X)", code:[0xA1,0x80], setup:()=>{ CPUregisters.X=1; checkWriteOffset(0x81,0x10); checkWriteOffset(0x82,0x02); checkWriteOffset(0x0210,0xB5); }, expect:{A:0xB5,Z:0,N:1} },
    { name:"LDA (indirect),Y", code:[0xB1,0x80], setup:()=>{ checkWriteOffset(0x80,0x00); checkWriteOffset(0x81,0x20); CPUregisters.Y=2; }, expect:{A:0x00,Z:1,N:0} }, // expect updated for RAM
    { name:"LDA zero flag",    code:[0xA9,0x00],                    expect:{A:0x00,Z:1,N:0} },
    { name:"LDA negative flag",code:[0xA9,0xFF],                    expect:{A:0xFF,Z:0,N:1} },
    { name:"LDX #$34",         code:[0xA2,0x34],                    expect:{X:0x34,Z:0,N:0} },
    { name:"LDX zeroPage",     code:[0xA6,0x22], setup:()=>{ checkWriteOffset(0x22,0x80); }, expect:{X:0x80,Z:0,N:1} },
    { name:"LDX zeroPage,Y",   code:[0xB6,0x50], setup:()=>{ CPUregisters.Y=3; checkWriteOffset(0x53,0x01); }, expect:{X:0x01,Z:0,N:0} },
    { name:"LDX absolute,Y",   code:[0xBE,0x10,0x02], setup:()=>{ CPUregisters.Y=2; checkWriteOffset(0x0212,0xFF); }, expect:{X:0xFF,Z:0,N:1} },
    { name:"LDY #$99",         code:[0xA0,0x99],                    expect:{Y:0x99,Z:0,N:1} },
    { name:"LDY zeroPage",     code:[0xA4,0x40], setup:()=>{ checkWriteOffset(0x40,0x11); }, expect:{Y:0x11,Z:0,N:0} },
    { name:"LDY zeroPage,X",   code:[0xB4,0x10], setup:()=>{ CPUregisters.X=1; checkWriteOffset(0x11,0x80); }, expect:{Y:0x80,Z:0,N:1} },
    { name:"LDY absolute",     code:[0xAC,0x80,0x02], setup:()=>{ checkWriteOffset(0x0280,0x7F); }, expect:{Y:0x7F,Z:0,N:0} },
    { name:"LDY absolute,X",   code:[0xBC,0x00,0x03], setup:()=>{ CPUregisters.X=2; checkWriteOffset(0x0302,0xFF); }, expect:{Y:0xFF,Z:0,N:1} }
  ];

  setupTests(tests);

  let html = `<table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;font-size:1em;">
    <thead>
      <tr style="background:#222">
        <th style="border:1px solid #444;padding:6px;">Test</th>
        <th style="border:1px solid #444;padding:6px;">Op</th>
        <th style="border:1px solid #444;padding:6px;">Flags Before</th>
        <th style="border:1px solid #444;padding:6px;">CPU Before</th>
        <th style="border:1px solid #444;padding:6px;">CPU After</th>
        <th style="border:1px solid #444;padding:6px;">Cycles</th>
        <th style="border:1px solid #444;padding:6px;">Result</th>
      </tr>
    </thead><tbody>`;

  tests.forEach(test => {
    let cyclesBefore = cpuCycles || 0;
    let pass = true, reasons = [];
    const flags = r =>
      `${r.C ? 'C' : '.'}${r.Z ? 'Z' : '.'}${r.I ? 'I' : '.'}${r.D ? 'D' : '.'}${r.B ? 'B' : '.'}${r.U ? 'U' : '.'}${r.V ? 'V' : '.'}${r.N ? 'N' : '.'}`;
    const cpuStr = r => `A=${hex(r.A)} X=${hex(r.X)} Y=${hex(r.Y)} S=${hex(r.S)} PC=${hex(r.PC,4)}`;
    const before = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S, PC:CPUregisters.PC, ...CPUregisters.P};

    if (test.setup) test.setup();
    step();

    if (test.expect.A!==undefined && CPUregisters.A!==test.expect.A){ reasons.push(`A=${hex(CPUregisters.A)}≠${hex(test.expect.A)}`); pass=false; }
    if (test.expect.X!==undefined && CPUregisters.X!==test.expect.X){ reasons.push(`X=${hex(CPUregisters.X)}≠${hex(test.expect.X)}`); pass=false; }
    if (test.expect.Y!==undefined && CPUregisters.Y!==test.expect.Y){ reasons.push(`Y=${hex(CPUregisters.Y)}≠${hex(test.expect.Y)}`); pass=false; }
    if (test.expect.Z!==undefined && CPUregisters.P.Z!==test.expect.Z){ reasons.push(`Z=${CPUregisters.P.Z}≠${test.expect.Z}`); pass=false; }
    if (test.expect.N!==undefined && CPUregisters.P.N!==test.expect.N){ reasons.push(`N=${CPUregisters.P.N}≠${test.expect.N}`); pass=false; }

    let cyclesUsed = (cpuCycles||0) - cyclesBefore;
    let resultCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary><ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).toUpperCase().padStart(2,"0")).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flags(before)}</td>
        <td style="border:1px solid #444;padding:6px;">${cpuStr(before)}</td>
        <td style="border:1px solid #444;padding:6px;">${cpuStr(CPUregisters)}</td>
        <td style="border:1px solid #444;padding:6px;text-align:center;">${cyclesUsed}</td>
        <td style="border:1px solid #444;padding:6px;text-align:center;">${resultCell}</td>
      </tr>`;
  });

  html += "</tbody></table>";
  document.body.insertAdjacentHTML("beforeend", html);
  CPUregisters.PC = 0x8000;
  prgRom[0x00] = 0x02;
}

function runRegisterTransfersAndFlagsTest() { 
  // ===== REGISTER TRANSFERS & FLAGS =====
  const tests = [
    // Register transfers
    { name: "TAX", code: [0xAA], pre: { A: 0x66, X: 0x11 }, expect: { X: 0x66, Z: 0, N: 0 } },
    { name: "TAY", code: [0xA8], pre: { A: 0x80, Y: 0x33 }, expect: { Y: 0x80, Z: 0, N: 1 } },
    { name: "TXA", code: [0x8A], pre: { X: 0x00, A: 0x44 }, expect: { A: 0x00, Z: 1, N: 0 } },
    { name: "TYA", code: [0x98], pre: { Y: 0xFF, A: 0x22 }, expect: { A: 0xFF, Z: 0, N: 1 } },
    { name: "TSX", code: [0xBA], pre: { S: 0x55, X: 0x11 }, expect: { X: 0x55 } },
    { name: "TXS", code: [0x9A], pre: { X: 0xCD, S: 0x99 }, expect: { S: 0xCD } },
    // Flag operations
    { name: "CLC", code: [0x18], pre: { P: { C: 1 } }, expectP: { C: 0 } },
    { name: "SEC", code: [0x38], pre: { P: { C: 0 } }, expectP: { C: 1 } },
    { name: "CLI", code: [0x58], pre: { P: { I: 1 } }, expectP: { I: 0 } },
    { name: "SEI", code: [0x78], pre: { P: { I: 0 } }, expectP: { I: 1 } },
    { name: "CLV", code: [0xB8], pre: { P: { V: 1 } }, expectP: { V: 0 } },
    { name: "CLD", code: [0xD8], pre: { P: { D: 1 } }, expectP: { D: 0 } },
    { name: "SED", code: [0xF8], pre: { P: { D: 0 } }, expectP: { D: 1 } }
  ];

  setupTests(tests);

  let html = `
    <div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
      REGISTER TRANSFERS & FLAGS
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead><tr style="background:#222">
        <th>Test</th>
        <th>Op</th>
        <th>Flags<br>Before</th>
        <th>Flags<br>After</th>
        <th>CPU<br>Before</th>
        <th>CPU<br>After</th>
        <th>Status</th>
      </tr></thead><tbody>`;

  tests.forEach(test => {
    // record before-state
    const fb = { ...CPUregisters.P };
    const cb = { A: CPUregisters.A, X: CPUregisters.X, Y: CPUregisters.Y, S: CPUregisters.S };

    // pre-setup
    if (test.pre) {
      if (test.pre.A !== undefined) CPUregisters.A = test.pre.A;
      if (test.pre.X !== undefined) CPUregisters.X = test.pre.X;
      if (test.pre.Y !== undefined) CPUregisters.Y = test.pre.Y;
      if (test.pre.S !== undefined) CPUregisters.S = test.pre.S;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }

    step();

    // after-state
    const fa = { ...CPUregisters.P };
    const ca = { A: CPUregisters.A, X: CPUregisters.X, Y: CPUregisters.Y, S: CPUregisters.S };

    // check
    let reasons = [], pass = true;
    const exp = test.expect || {};
    ["A", "X", "Y", "S"].forEach(r => {
      if (exp[r] !== undefined && ca[r] !== exp[r]) {
        reasons.push(`${r}=${hex(ca[r])}≠${hex(exp[r])}`); pass = false;
      }
    });
    if (exp.Z !== undefined && CPUregisters.P.Z !== exp.Z) {
      reasons.push(`Z=${CPUregisters.P.Z}≠${exp.Z}`); pass = false;
    }
    if (exp.N !== undefined && CPUregisters.P.N !== exp.N) {
      reasons.push(`N=${CPUregisters.P.N}≠${exp.N}`); pass = false;
    }
    const expP = test.expectP || {};
    for (const k in expP) {
      if (CPUregisters.P[k] !== expP[k]) {
        reasons.push(`${k}=${CPUregisters.P[k]}≠${expP[k]}`); pass = false;
      }
    }

    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>` +
        `<ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(ca.A)} X=${hex(ca.X)} Y=${hex(ca.Y)} S=${hex(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
  CPUregisters.PC = 0x8000;    
  prgRom[CPUregisters.PC - 0x8000] = 0x02;
}

function runAluAndLogicOpsTests() {
  // ===== ALU & LOGIC OPS (ADC, SBC, INC, DEC, AND, ORA, EOR, BIT) =====
const tests = [
// ==== AND (8 variants) ====

// Z=1, N=0 — immediate forces zero
{ name:"AND #$00 -> Z", code:[0x29,0x00], pre:{A:0xFF}, expect:{A:0x00,Z:1,N:0} },

// N=1, Z=0 — immediate sets bit7
{ name:"AND #$80 -> N", code:[0x29,0x80], pre:{A:0xFF}, expect:{A:0x80,Z:0,N:1} },

// Z=0, N=0 — clears N from a negative A
{ name:"AND #$7F clears N", code:[0x29,0x7F], pre:{A:0x81}, expect:{A:0x01,Z:0,N:0} },

// Z=1, N=0 — zero page read
{ name:"AND $10 -> Z", code:[0x25,0x10], pre:{A:0x01},
  setup:()=>{ checkWriteOffset(0x0010,0x00); },
  expect:{A:0x00,Z:1,N:0} },

// Z=0, N=1 — zero page,X with wrap (0xFE + X=5 -> 0x03)
{ name:"AND $FE,X (wrap) -> N", code:[0x35,0xFE], pre:{A:0xF0,X:0x05},
  setup:()=>{ checkWriteOffset(0x0003,0xF0); },
  expect:{A:0xF0,Z:0,N:1} },

// Z=1, N=0 — absolute (moved from $2345 -> $0345)
{ name:"AND $0345 -> Z", code:[0x2D,0x45,0x03], pre:{A:0x80},
  setup:()=>{ checkWriteOffset(0x0345,0x7F); },
  expect:{A:0x00,Z:1,N:0} },

// Z=0, N=1 — absolute,X (base $0340 + X=5 -> $0345)
{ name:"AND $0340,X -> N", code:[0x3D,0x40,0x03], pre:{A:0xFF,X:0x05},
  setup:()=>{ checkWriteOffset(0x0345,0x80); },
  expect:{A:0x80,Z:0,N:1} },

// Z=0, N=1 — absolute,Y (base $0344 + Y=1 -> $0345)
{ name:"AND $0344,Y -> N", code:[0x39,0x44,0x03], pre:{A:0xF0,Y:0x01},
  setup:()=>{ checkWriteOffset(0x0345,0xAA); },
  expect:{A:0xA0,Z:0,N:1} },

// AND ($10,X)
{ name:"AND ($10,X) -> A=1",
  code:[0x21,0x10],
  pre:{A:0x01,X:0x04},
  setup:()=>{ checkWriteOffset(0x0014,0x30); checkWriteOffset(0x0015,0x12); checkWriteOffset(0x1230,0x01); },
  expect:{A:0x01,Z:0,N:0}
},

// AND ($80),Y -> Z  (base $0300 + Y=$10 -> $0310)
{ name:"AND ($80),Y -> Z", code:[0x31,0x80], pre:{A:0xFF,Y:0x10},
  setup:()=>{ checkWriteOffset(0x0080,0x00); checkWriteOffset(0x0081,0x03); checkWriteOffset(0x0310,0x00); },
  expect:{A:0x00,Z:1,N:0} },

// === AND ($nn),Y — varied results & edge cases ===

// Z=0, N=0  (simple non-zero)  base $0300 + Y=1 -> $0301
{ name:"AND ($20),Y -> 0x04",
  code:[0x31,0x20],
  pre:{A:0x3C,Y:0x01},
  setup:()=>{ checkWriteOffset(0x0020,0x00); checkWriteOffset(0x0021,0x03); checkWriteOffset(0x0301,0x05); },
  expect:{A:0x04,Z:0,N:0}
},

// Z=0, N=1  (bit 7 set)  base $1234 + Y=2 -> $1236  (already < $2000, safe)
{ name:"AND ($30),Y -> N",
  code:[0x31,0x30],
  pre:{A:0xF0,Y:0x02},
  setup:()=>{ checkWriteOffset(0x0030,0x34); checkWriteOffset(0x0031,0x12); checkWriteOffset(0x1236,0x80); },
  expect:{A:0x80,Z:0,N:1}
},

// Z=1, N=0  (zero)  base $00A0 + Y=$10 -> $00B0
{ name:"AND ($40),Y -> Z",
  code:[0x31,0x40],
  pre:{A:0x0F,Y:0x10},
  setup:()=>{ checkWriteOffset(0x0040,0xA0); checkWriteOffset(0x0041,0x00); checkWriteOffset(0x00B0,0xF0); },
  expect:{A:0x00,Z:1,N:0}
},

// ZP hi wrap: ($FF) uses hi from $0000 — base $01F0 (+Y=$0F) -> $01FF
{ name:"AND ($FF),Y with ZP wrap (hi) -> 0x01",
  code:[0x31,0xFF],
  pre:{A:0x03,Y:0x0F},
  setup:()=>{ checkWriteOffset(0x00FF,0xF0); checkWriteOffset(0x0000,0x01); checkWriteOffset(0x01FF,0x01); },
  expect:{A:0x01,Z:0,N:0}
},

// Page cross in RAM: base $01F0 + Y=$20 -> $0210
{ name:"AND ($10),Y page-cross -> N",
  code:[0x31,0x10],
  pre:{A:0xFF,Y:0x20},
  setup:()=>{ checkWriteOffset(0x0010,0xF0); checkWriteOffset(0x0011,0x01); checkWriteOffset(0x0210,0xC0); },
  expect:{A:0xC0,Z:0,N:1}
},

// Z=1 with A!=0  base $0300 + Y=$05 -> $0305
{ name:"AND ($60),Y -> Z (A!=0)",
  code:[0x31,0x60],
  pre:{A:0x55,Y:0x05},
  setup:()=>{ checkWriteOffset(0x0060,0x00); checkWriteOffset(0x0061,0x03); checkWriteOffset(0x0305,0xAA); },
  expect:{A:0x00,Z:1,N:0}
},

// Y=0 exact base: base $5678 (safe? 0x5678 > $1FFF — move to $0678)
{ name:"AND ($70),Y with Y=0 -> 0x05",
  code:[0x31,0x70],
  pre:{A:0xA5,Y:0x00},
  setup:()=>{ checkWriteOffset(0x0070,0x78); checkWriteOffset(0x0071,0x06); checkWriteOffset(0x0678,0x0F); },
  expect:{A:0x05,Z:0,N:0}
},

// Clear N from negative A (small positive)  base $4000 -> move to $0400; +Y=1 -> $0401
{ name:"AND ($22),Y clears N",
  code:[0x31,0x22],
  pre:{A:0x81,Y:0x01},
  setup:()=>{ checkWriteOffset(0x0022,0x00); checkWriteOffset(0x0023,0x04); checkWriteOffset(0x0401,0x7F); },
  expect:{A:0x01,Z:0,N:0}
},

// Page-cross + zero result  base $12FF -> move to $02FF; +Y=2 -> $0301
{ name:"AND ($50),Y page-cross -> Z",
  code:[0x31,0x50],
  pre:{A:0xFF,Y:0x02},
  setup:()=>{ checkWriteOffset(0x0050,0xFF); checkWriteOffset(0x0051,0x02); checkWriteOffset(0x0301,0x00); },
  expect:{A:0x00,Z:1,N:0}
},

{ name:"AND ($33),Y -> mid value",
  code:[0x31,0x33],
  pre:{A:0x7E, Y:0x10},
  setup:()=>{ 
    checkWriteOffset(0x0033,0x10); 
    checkWriteOffset(0x0034,0x04); 
    checkWriteOffset(0x0420,0x3C); // <-- base $0410 + Y $10 = $0420
  },
  expect:{A:0x3C, Z:0, N:0}
},


// ==== ORA (8 variants) ====
{ name:"ORA #$0F",       code:[0x09,0x0F],    pre:{A:0x10},                          expect:{A:0x1F,Z:0,N:0} },
{ name:"ORA $10",        code:[0x05,0x10],    pre:{A:0x80}, setup:()=>{checkWriteOffset(0x10,0x01);},      expect:{A:0x81,Z:0,N:1} },
{ name:"ORA $10,X",      code:[0x15,0x0E],    pre:{A:0x80,X:0x02}, setup:()=>{checkWriteOffset(0x10,0x70);}, expect:{A:0xF0,Z:0,N:1} },

// absolute moved from $2345 -> $0345
{ name:"ORA $0345",      code:[0x0D,0x45,0x03], pre:{A:0x00}, setup:()=>{checkWriteOffset(0x0345,0xC0);}, expect:{A:0xC0,Z:0,N:1} },

// absolute,X moved base $0340 + X=5 -> $0345
{ name:"ORA $0340,X",    code:[0x1D,0x40,0x03], pre:{A:0x01,X:0x05}, setup:()=>{checkWriteOffset(0x0345,0x10);}, expect:{A:0x11,Z:0,N:0} },

// absolute,Y moved base $0344 + Y=1 -> $0345
{ name:"ORA $0344,Y",    code:[0x19,0x44,0x03], pre:{A:0x0F,Y:0x01}, setup:()=>{checkWriteOffset(0x0345,0xF0);}, expect:{A:0xFF,Z:0,N:1} },

{ name:"ORA ($20,X)",    code:[0x01,0x10],   pre:{A:0xF0,X:0x05},
  setup:()=>{checkWriteOffset(0x0015,0x40);checkWriteOffset(0x0016,0x12);checkWriteOffset(0x1240,0x0C);},
  expect:{A:0xFC,Z:0,N:1} },

// ($20),Y now points to $0300 + Y=1 -> $0301
{ name:"ORA ($20),Y",    code:[0x11,0x12],   pre:{A:0x00,Y:0x01},
  setup:()=>{checkWriteOffset(0x0012,0x00);checkWriteOffset(0x0013,0x03);checkWriteOffset(0x0301,0x01);},
  expect:{A:0x01,Z:0,N:0} },

// ==== EOR (8 variants) ====
{ name:"EOR #$FF",       code:[0x49,0xFF],   pre:{A:0x55},                          expect:{A:0xAA,Z:0,N:1} },
{ name:"EOR $10",        code:[0x45,0x10],   pre:{A:0x0F}, setup:()=>{checkWriteOffset(0x10,0xF0);},      expect:{A:0xFF,Z:0,N:1} },
{ name:"EOR $10,X",      code:[0x55,0x0E],   pre:{A:0xF0,X:0x02}, setup:()=>{checkWriteOffset(0x10,0xF0);}, expect:{A:0x00,Z:1,N:0} },

// absolute moved to $0345
{ name:"EOR $0345",      code:[0x4D,0x45,0x03], pre:{A:0xA5}, setup:()=>{checkWriteOffset(0x0345,0x5A);}, expect:{A:0xFF,Z:0,N:1} },

// absolute,X base $0340 + X=5 -> $0345
{ name:"EOR $0340,X",    code:[0x5D,0x40,0x03], pre:{A:0xFF,X:0x05}, setup:()=>{checkWriteOffset(0x0345,0x55);}, expect:{A:0xAA,Z:0,N:1} },

// absolute,Y base $0344 + Y=1 -> $0345
{ name:"EOR $0344,Y",    code:[0x59,0x44,0x03], pre:{A:0x0F,Y:0x01}, setup:()=>{checkWriteOffset(0x0345,0xF0);}, expect:{A:0xFF,Z:0,N:1} },

{ name:"EOR ($20,X)",    code:[0x41,0x10],  pre:{A:0x0F,X:0x05},
  setup:()=>{checkWriteOffset(0x0015,0x30);checkWriteOffset(0x0016,0x12);checkWriteOffset(0x1230,0xF0);},
  expect:{A:0xFF,Z:0,N:1} },

// ($20),Y -> $0301
{ name:"EOR ($20),Y",    code:[0x51,0x12],  pre:{A:0xF0,Y:0x01},
  setup:()=>{checkWriteOffset(0x0012,0x00);checkWriteOffset(0x0013,0x03);checkWriteOffset(0x0301,0x0F);},
  expect:{A:0xFF,Z:0,N:1} },

// ==== BIT (2 variants) ====

{ name:"BIT $20",
  code:[0x24,0x20],
  setup:()=>{ CPUregisters.A = 0x0F; checkWriteOffset(0x20, 0xF0); },
  expectFlags:{ Z:1, V:1, N:1 } // <-- Z should be 1, not 0
},

// absolute moved to $0345
{ name:"BIT $0345",      code:[0x2C,0x45,0x03], setup:()=>{CPUregisters.A=0x00; checkWriteOffset(0x0345,0x00);}, expectFlags:{Z:1,V:0,N:0} },

// ==== ADC (8 variants) ====
{ name:"ADC #$01",       code:[0x69,0x01],   pre:{A:0x01,P:{C:0}},                 expect:{A:0x02,C:0,Z:0,N:0,V:0} },
{ name:"ADC $10",        code:[0x65,0x10],   pre:{A:0x80,P:{C:0}}, setup:()=>{checkWriteOffset(0x10,0x80);}, expect:{A:0x00,C:1,Z:1,N:0,V:1} },
{ name:"ADC $10,X",      code:[0x75,0x0E],   pre:{A:0x10,X:0x02,P:{C:1}}, setup:()=>{checkWriteOffset(0x10,0x10);}, expect:{A:0x21,C:0,Z:0,N:0,V:0} },

// absolute moved to $0345
{ name:"ADC $0345",      code:[0x6D,0x45,0x03], pre:{A:0x7F,P:{C:0}}, setup:()=>{checkWriteOffset(0x0345,0x01);}, expect:{A:0x80,C:0,Z:0,N:1,V:1} },

// absolute,X base $0340 + X=5 -> $0345
{ name:"ADC $0340,X",    code:[0x7D,0x40,0x03], pre:{A:0x01,X:0x05,P:{C:0}}, setup:()=>{checkWriteOffset(0x0345,0x02);}, expect:{A:0x03,C:0,Z:0,N:0,V:0} },

// absolute,Y base $0344 + Y=1 -> $0345
{ name:"ADC $0344,Y",    code:[0x79,0x44,0x03], pre:{A:0x80,Y:0x01,P:{C:1}}, setup:()=>{checkWriteOffset(0x0345,0x80);}, expect:{A:0x01,C:1,Z:0,N:0,V:1} },



{ name:"ADC ($20,X)",
  code:[0x61,0x10],
  pre:{A:0x20, X:0x05, P:{C:1}},
  setup:()=>{ checkWriteOffset(0x0015,0x30); checkWriteOffset(0x0016,0x12); checkWriteOffset(0x1230,0x10); },
  expect:{A:0x31, C:0, Z:0, N:0, V:0}
},




{ name:"ADC ($20),Y",
  code:[0x71,0x12],
  pre:{A:0x70,Y:0x01,P:{C:1}},
  setup:()=>{ checkWriteOffset(0x0012,0x00); checkWriteOffset(0x0013,0x03); checkWriteOffset(0x0301,0x90); },
  expect:{A:0x01,C:1,Z:0,N:0,V:0}
},




// ==== SBC (8 variants) ====
{ name:"SBC #$01",       code:[0xE9,0x01],   pre:{A:0x03,P:{C:1}},                 expect:{A:0x02,C:1,Z:0,N:0,V:0} },
{ name:"SBC $10",        code:[0xE5,0x10],   pre:{A:0x00,P:{C:0}}, setup:()=>{checkWriteOffset(0x10,0x01);}, expect:{A:0xFE,C:0,Z:0,N:1,V:0} },
{ name:"SBC $10,X",      code:[0xF5,0x0E],   pre:{A:0x0F,X:0x02,P:{C:1}}, setup:()=>{checkWriteOffset(0x10,0x01);}, expect:{A:0x0E,C:1,Z:0,N:0,V:0} },

// absolute -> $0345
{ name:"SBC $0345",      code:[0xED,0x45,0x03], pre:{A:0x80,P:{C:1}}, setup:()=>{checkWriteOffset(0x0345,0x01);}, expect:{A:0x7F,C:1,Z:0,N:0,V:1} },

// absolute,X base $0340 + X=5 -> $0345
{ name:"SBC $0340,X",    code:[0xFD,0x40,0x03], pre:{A:0x03,X:0x05,P:{C:1}}, setup:()=>{checkWriteOffset(0x0345,0x02);}, expect:{A:0x01,C:1,Z:0,N:0,V:0} },

// absolute,Y base $0344 + Y=1 -> $0345
{ name:"SBC $0344,Y",    code:[0xF9,0x44,0x03], pre:{A:0x01,Y:0x01,P:{C:1}}, setup:()=>{checkWriteOffset(0x0345,0x01);}, expect:{A:0x00,C:1,Z:1,N:0,V:0} },

{ name:"SBC ($20,X)",    code:[0xE1,0x10],  pre:{A:0x05,X:0x05,P:{C:1}},
  setup:()=>{checkWriteOffset(0x0015,0x30);checkWriteOffset(0x0016,0x12);checkWriteOffset(0x1230,0x02);},
  expect:{A:0x03,C:1,Z:0,N:0,V:0} },

// ($20),Y -> $0301
{ name:"SBC ($20),Y",    code:[0xF1,0x12],  pre:{A:0x20,Y:0x01,P:{C:1}},
  setup:()=>{checkWriteOffset(0x0012,0x00);checkWriteOffset(0x0013,0x03);checkWriteOffset(0x0301,0x10);},
  expect:{A:0x10,C:1,Z:0,N:0,V:0} },

// ==== CMP (8 variants) ====
{ name:"CMP #$10",       code:[0xC9,0x10],   pre:{A:0x10},                          expect:{C:1,Z:1,N:0} },
{ name:"CMP $10",        code:[0xC5,0x10],   pre:{A:0x0F}, setup:()=>{checkWriteOffset(0x10,0x01);},      expect:{C:1,Z:0,N:0} },
{ name:"CMP $10,X",      code:[0xD5,0x0E],   pre:{A:0x00,X:0x02}, setup:()=>{checkWriteOffset(0x10,0x01);}, expect:{C:0,Z:0,N:1} },

// absolute -> $0345
{ name:"CMP $0345",      code:[0xCD,0x45,0x03], pre:{A:0xFF}, setup:()=>{checkWriteOffset(0x0345,0x01);}, expect:{C:1,Z:0,N:1} },

// absolute,X base $0340 + X=5 -> $0345
{ name:"CMP $0340,X",    code:[0xDD,0x40,0x03], pre:{A:0x05,X:0x05}, setup:()=>{checkWriteOffset(0x0345,0x02);}, expect:{C:1,Z:0,N:0} },

// absolute,Y base $0344 + Y=1 -> $0345
{ name:"CMP $0344,Y",    code:[0xD9,0x44,0x03], pre:{A:0x01,Y:0x01}, setup:()=>{checkWriteOffset(0x0345,0x01);}, expect:{C:1,Z:1,N:0} },

{ name:"CMP ($20,X)",    code:[0xC1,0x10],  pre:{A:0x0F,X:0x05},
  setup:()=>{checkWriteOffset(0x0015,0x30);checkWriteOffset(0x0016,0x12);checkWriteOffset(0x1230,0x10);},
  expect:{C:0,Z:0,N:1} },

// ($20),Y -> $0301
{ name:"CMP ($20),Y",    code:[0xD1,0x12],  pre:{A:0x10,Y:0x01},
  setup:()=>{checkWriteOffset(0x0012,0x00);checkWriteOffset(0x0013,0x03);checkWriteOffset(0x0301,0x20);},
  expect:{C:0,Z:0,N:1} },

// ==== CPX (3 variants) ====
{ name:"CPX #$10",       code:[0xE0,0x10],   pre:{X:0x10},                          expect:{C:1,Z:1,N:0} },
{ name:"CPX $10",        code:[0xE4,0x10],   pre:{X:0x0F}, setup:()=>{checkWriteOffset(0x10,0x01);},      expect:{C:1,Z:0,N:0} },
{ name:"CPX $0345",      code:[0xEC,0x45,0x03], pre:{X:0xFF}, setup:()=>{checkWriteOffset(0x0345,0x01);}, expect:{C:1,Z:0,N:1} },

// ==== CPY (3 variants) ====
{ name:"CPY #$10",       code:[0xC0,0x10],   pre:{Y:0x10},                          expect:{C:1,Z:1,N:0} },
{ name:"CPY $10",        code:[0xC4,0x10],   pre:{Y:0x0F}, setup:()=>{checkWriteOffset(0x10,0x01);},      expect:{C:1,Z:0,N:0} },
{ name:"CPY $0345",      code:[0xCC,0x45,0x03], pre:{Y:0xFF}, setup:()=>{checkWriteOffset(0x0345,0x01);}, expect:{C:1,Z:0,N:1} },

// ==== INC (3 variants) ====
{ name:"INC $10",        code:[0xE6,0x10],   setup:()=>{checkWriteOffset(0x10,0x01);},      expectMem:{addr:0x10,value:0x02}, expectFlags:{Z:0,N:0} },
{ name:"INC $10,X",      code:[0xF6,0x0E],   pre:{X:0x02}, setup:()=>{checkWriteOffset(0x10,0xFF);}, expectMem:{addr:0x12,value:0x00}, expectFlags:{Z:1,N:0} },

// absolute -> $0345
{ name:"INC $0345",      code:[0xEE,0x45,0x03], setup:()=>{checkWriteOffset(0x0345,0x7F);}, expectMem:{addr:0x0345,value:0x80}, expectFlags:{Z:0,N:1} },

// ==== DEC (3 variants) ====
{ name:"DEC $10",        code:[0xC6,0x10],   setup:()=>{checkWriteOffset(0x10,0x01);},      expectMem:{addr:0x10,value:0x00}, expectFlags:{Z:1,N:0} },



{ name:"DEC $10,X",
  code:[0xD6,0x10],               // <-- operand 0x10
  pre:{X:0x02},
  setup:()=>{ checkWriteOffset(0x0012, 0x00); },  // $10 + X = $12
  expectMem:{addr:0x0012, value:0xFF},
  expectFlags:{Z:0,N:1}
},






// absolute -> $0345
{ name:"DEC $0345",      code:[0xCE,0x45,0x03], setup:()=>{checkWriteOffset(0x0345,0x01);}, expectMem:{addr:0x0345,value:0x00}, expectFlags:{Z:1,N:0} },

// ==== ASL (5 variants) ====
{ name:"ASL A",          code:[0x0A],        pre:{A:0x40},                          expect:{A:0x80,C:0,Z:0,N:1} },

{ name:"ASL $10,X",
  code:[0x16,0x10],
  pre:{X:0x02},
  setup:()=>{ checkWriteOffset(0x0012, 0x40); },
  expectMem:{addr:0x0012, value:0x80},
  expect:{C:0,Z:0,N:1}
},

{ name:"ASL $10,X",      code:[0x16,0x0E],   pre:{X:0x02}, setup:()=>{checkWriteOffset(0x10,0x40);}, expectMem:{addr:0x12,value:0x80}, expect:{C:0,Z:0,N:1} },

// absolute -> $0345 / $034A
{ name:"ASL $0345",      code:[0x0E,0x45,0x03], setup:()=>{checkWriteOffset(0x0345,0xFF);}, expectMem:{addr:0x0345,value:0xFE}, expect:{C:1,Z:0,N:1} },

{ name:"ASL $0340,X",    code:[0x1E,0x40,0x03], pre:{X:0x05}, setup:()=>{checkWriteOffset(0x0345,0x10);}, expectMem:{addr:0x0345,value:0x20}, expect:{C:0,Z:0,N:0} },

// ==== LSR (5 variants) ====
{ name:"LSR A",          code:[0x4A],        pre:{A:0x01},                          expect:{A:0x00,C:1,Z:1,N:0} },
{ name:"LSR $10",        code:[0x46,0x10],   setup:()=>{checkWriteOffset(0x10,0x03);},      expectMem:{addr:0x10,value:0x01}, expect:{C:1,Z:0,N:0} },


{ name:"LSR $10,X",
  code:[0x56,0x10],
  pre:{X:0x02},
  setup:()=>{ checkWriteOffset(0x0012, 0x03); },  // 0x03 >> 1 = 0x01
  expectMem:{addr:0x0012, value:0x01},
  expect:{C:1,Z:0,N:0}
},


// absolute -> $0345 / $034A
{ name:"LSR $0345",      code:[0x4E,0x45,0x03], setup:()=>{checkWriteOffset(0x0345,0x80);}, expectMem:{addr:0x0345,value:0x40}, expect:{C:0,Z:0,N:0} },
{ name:"LSR $0340,X",    code:[0x5E,0x40,0x03], pre:{X:0x05}, setup:()=>{checkWriteOffset(0x0345,0x01);}, expectMem:{addr:0x0345,value:0x00}, expect:{C:1,Z:1,N:0} },

// ==== ROL (5 variants) ====
{ name:"ROL A",          code:[0x2A],        pre:{A:0x40,P:{C:1}},                  expect:{A:0x81,C:0,Z:0,N:1} },
{ name:"ROL $10",        code:[0x26,0x10],   pre:{P:{C:1}}, setup:()=>{checkWriteOffset(0x10,0x80);},      expectMem:{addr:0x10,value:0x01}, expect:{C:1,Z:0,N:0} },


{ name:"ROL $10,X",
  code:[0x36,0x10],                 // operand must be 0x10
  pre:{X:0x02, P:{C:0}},            // ensure carry-in = 0
  setup:()=>{ checkWriteOffset(0x0012, 0x40); }, // $10 + X = $12
  expectMem:{addr:0x0012, value:0x80},
  expect:{C:0,Z:0,N:1}
},




// absolute -> $0345 / $034A
{ name:"ROL $0345",      code:[0x2E,0x45,0x03], pre:{P:{C:1}}, setup:()=>{checkWriteOffset(0x0345,0xFF);}, expectMem:{addr:0x0345,value:0xFF}, expect:{C:1,Z:0,N:1} },
{ name:"ROL $0340,X",    code:[0x3E,0x40,0x03], pre:{X:0x05,P:{C:1}}, setup:()=>{checkWriteOffset(0x0345,0x00);}, expectMem:{addr:0x0345,value:0x01}, expect:{C:0,Z:0,N:0} },

// ==== ROR (5 variants) ====
{ name:"ROR A",          code:[0x6A],        pre:{A:0x01,P:{C:1}},                  expect:{A:0x80,C:1,Z:0,N:1} },
{ name:"ROR $10",        code:[0x66,0x10],   pre:{P:{C:0}}, setup:()=>{checkWriteOffset(0x10,0x02);},      expectMem:{addr:0x10,value:0x01}, expect:{C:0,Z:0,N:0} },
{ name:"ROR $10,X",      code:[0x76,0x0E],   pre:{X:0x02,P:{C:1}}, setup:()=>{checkWriteOffset(0x10,0x01);}, expectMem:{addr:0x12,value:0x80}, expect:{C:1,Z:0,N:1} },

// absolute -> $0345 / $034A
{ name:"ROR $0345",      code:[0x6E,0x45,0x03], pre:{P:{C:1}}, setup:()=>{checkWriteOffset(0x0345,0x00);}, expectMem:{addr:0x0345,value:0x80}, expect:{C:0,Z:0,N:1} },
{ name:"ROR $0340,X",    code:[0x7E,0x40,0x03], pre:{X:0x05,P:{C:1}}, setup:()=>{checkWriteOffset(0x0345,0x02);}, expectMem:{addr:0x0345,value:0x81}, expect:{C:0,Z:0,N:1} },
];

  setupTests(tests);

  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       ALU & LOGIC OPS
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th>
         <th>Eff Addr</th><th>Expected</th><th>Result</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test => {
    // --------- PATCH: Reset ALL CPU status flags before each test ----------
    CPUregisters.P = {C:0,Z:0,I:0,D:0,B:0,U:1,V:0,N:0};

    // Registers
    CPUregisters.A = 0;
    CPUregisters.X = 0;
    CPUregisters.Y = 0;
    CPUregisters.S = 0xFF;

    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A;
      if (test.pre.X != null) CPUregisters.X = test.pre.X;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y;
      if (test.pre.S != null) CPUregisters.S = test.pre.S;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }
    if (test.setup) test.setup();

    const fb = {...CPUregisters.P},
          cb = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};

    // Store a snapshot of relevant memory before
    let memBefore = undefined;
    if (test.expectMem) memBefore = checkReadOffset(test.expectMem.addr);

    // Execute instruction
    step();

    // Check effective address (for memory ops)
    let ea = test.expectMem?.addr !== undefined ? test.expectMem.addr : null;
    const mirrors = ea !== null ? getMirrors(ea).filter(a=>a<0x10000) : [];

    const fa = {...CPUregisters.P},
          ca = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};

    let reasons = [], pass = true;

    if (test.expect) {
      ["A","X","Y","S"].forEach(r=>{
        if (test.expect[r] !== undefined && ca[r] !== test.expect[r]) {
          reasons.push(`${r}=${hexTwo(ca[r])}≠${hexTwo(test.expect[r])}`);
          pass = false;
        }
      });
      ["C","Z","N","V"].forEach(f=>{
        if (test.expect[f] !== undefined && CPUregisters.P[f] !== test.expect[f]) {
          reasons.push(`${f}=${CPUregisters.P[f]}≠${test.expect[f]}`);
          pass = false;
        }
      });
    }
    // Memory
    if (test.expectMem && ea !== null) {
      mirrors.forEach(addr => {
        const got = checkReadOffset(addr);
        if (got !== test.expectMem.value) {
          reasons.push(`$${addr.toString(16).padStart(4,"0")}=${hexTwo(got)}≠${hexTwo(test.expectMem.value)}`);
          pass = false;
        }
      });
    }
    // BIT flags
    if (test.expectFlags) {
      ["Z","V","N"].forEach(f=>{
        if (test.expectFlags[f] !== undefined && CPUregisters.P[f] !== test.expectFlags[f]) {
          reasons.push(`${f}=${CPUregisters.P[f]}≠${test.expectFlags[f]}`);
          pass = false;
        }
      });
    }

    const mirrorLabel = ea !== null ? `$${ea.toString(16).padStart(4,"0")}` : "";
    const dropdownMirrors = ea !== null
      ? dropdown(mirrorLabel, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "";

    // Expected/Result value
    let expectedLabel = "";
    let resultLabel = "";
    if (test.expect?.A !== undefined) {
      expectedLabel = hexTwo(test.expect.A); resultLabel = hexTwo(CPUregisters.A);
    } else if (test.expectMem) {
      expectedLabel = hexTwo(test.expectMem.value);
      resultLabel = ea !== null ? hexTwo(checkReadOffset(ea)) : "";
    } else if (test.expectFlags) {
      expectedLabel = Object.entries(test.expectFlags).map(([k,v])=>`${k}=${v}`).join(" ");
      resultLabel   = ["Z","V","N"].map(k=>`${k}=${CPUregisters.P[k]}`).join(" ");
    }

    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>`+
        `<ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,"0")).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hexTwo(cb.A)} X=${hexTwo(cb.X)} Y=${hexTwo(cb.Y)} S=${hexTwo(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hexTwo(ca.A)} X=${hexTwo(ca.X)} Y=${hexTwo(ca.Y)} S=${hexTwo(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdownMirrors}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
  CPUregisters.PC = 0x8000;    
  prgRom[CPUregisters.PC - 0x8000] = 0x02;
}

function runShiftOpsTests() {
  // ===== SHIFT OPS (ASL, LSR, ROL, ROR, all modes) =====
  const tests = [
    // ASL accumulator (carry/zero/negative)
    { name:"ASL A (no carry)",            code:[0x0A],                   pre:{A:0x41,P:{C:0}}, expect:{A:0x82,C:0,Z:0,N:1} },
    { name:"ASL A (carry & zero)",        code:[0x0A],                   pre:{A:0x80,P:{C:0}}, expect:{A:0x00,C:1,Z:1,N:0} },
    // ASL memory (ZP/ZPX/ABS/ABSX)
    { name:"ASL $20",                     code:[0x06,0x20],              setup:()=>{ checkWriteOffset(0x20, 0x03); }, expectMem:{addr:0x20,value:0x06}, expect:{C:0,Z:0,N:0} },
    { name:"ASL $20 (carry)",             code:[0x06,0x20],              setup:()=>{ checkWriteOffset(0x20, 0x80); }, expectMem:{addr:0x20,value:0x00}, expect:{C:1,Z:1,N:0} },
    { name:"ASL $10,X",                   code:[0x16,0x10],   pre:{X:0x10}, setup:()=>{ checkWriteOffset(0x20, 0x02); }, expectMem:{addr:0x20,value:0x04}, expect:{C:0,Z:0,N:0} },
{
  name: "ASL $1234 (ABS)",
  code: [0x0E, 0x34, 0x12],                 // ASL $1234
  setup: () => { checkWriteOffset(0x1234, 0x01); },
  expectMem: { addr: 0x1234, value: 0x02 },
  expect: { P: { C: 0, Z: 0, N: 0 } },      // flags from result 0x02
  expectedCycles: 6                          // RMW ABS = 6
},

{
  name: "ASL $1234,X (RMW abs,X)",
  code: [0x1E, 0x34, 0x12],
  pre: { X: 0x10 },
  setup: () => { checkWriteOffset(0x1244, 0x80); }, // 0x1234 + X = 0x1244
  expectMem: { addr: 0x1244, value: 0x00 },        // 0x80 << 1 = 0x00
  expect: { P: { C: 1, Z: 1, N: 0 } },             // carry from bit7, zero set, negative clear
  expectedCycles: 7
},
    // LSR accumulator
    { name:"LSR A (no carry)",            code:[0x4A],                   pre:{A:0x02,P:{C:0}}, expect:{A:0x01,C:0,Z:0,N:0} },
    { name:"LSR A (carry & zero)",        code:[0x4A],                   pre:{A:0x01,P:{C:0}}, expect:{A:0x00,C:1,Z:1,N:0} },
    // LSR memory (ZP/ZPX/ABS/ABSX)
    { name:"LSR $30",                     code:[0x46,0x30],              setup:()=>{ checkWriteOffset(0x30, 0x04); }, expectMem:{addr:0x30,value:0x02}, expect:{C:0,Z:0,N:0} },
    { name:"LSR $30 (carry)",             code:[0x46,0x30],              setup:()=>{ checkWriteOffset(0x30, 0x01); }, expectMem:{addr:0x30,value:0x00}, expect:{C:1,Z:1,N:0} },
    { name:"LSR $20,X",                   code:[0x56,0x1F],   pre:{X:0x01}, setup:()=>{ checkWriteOffset(0x20, 0x02); }, expectMem:{addr:0x20,value:0x01}, expect:{C:0,Z:0,N:0} },
    { name:"LSR $0C00",                   code:[0x4E,0x00,0x0C],         setup:()=>{ checkWriteOffset(0x0C00, 0x02); }, expectMem:{addr:0x0C00,value:0x01}, expect:{C:0,Z:0,N:0} },
    { name:"LSR $0C00,X",                 code:[0x5E,0xFF,0x0B], pre:{X:0x01}, setup:()=>{ checkWriteOffset(0x0C00, 0x01); }, expectMem:{addr:0x0C00,value:0x00}, expect:{C:1,Z:1,N:0} },

    // ROL accumulator
    { name:"ROL A (no carry)",            code:[0x2A],                   pre:{A:0x40,P:{C:0}}, expect:{A:0x80,C:0,Z:0,N:1} },
    { name:"ROL A (carry in & out)",      code:[0x2A],                   pre:{A:0x80,P:{C:1}}, expect:{A:0x01,C:1,Z:0,N:0} },
    // ROL memory (ZP/ZPX/ABS/ABSX)
    { name:"ROL $10",                     code:[0x26,0x10],   pre:{P:{C:0}}, setup:()=>{ checkWriteOffset(0x10, 0x01); }, expectMem:{addr:0x10,value:0x02}, expect:{C:0,Z:0,N:0} },
    { name:"ROL $10 (carry)",             code:[0x26,0x10],   pre:{P:{C:1}}, setup:()=>{ checkWriteOffset(0x10, 0x80); }, expectMem:{addr:0x10,value:0x01}, expect:{C:1,Z:0,N:0} },
    { name:"ROL $20,X",                   code:[0x36,0x10], pre:{X:0x10,P:{C:0}}, setup:()=>{ checkWriteOffset(0x20, 0x40); }, expectMem:{addr:0x20,value:0x80}, expect:{C:0,Z:0,N:1} },


   { name:"ROL $0200",
  code:[0x2E,0x00,0x02],
  pre:{P:{C:1}},
  setup:()=>{ checkWriteOffset(0x0200, 0x40); },
  expectMem:{addr:0x0200, value:0x81},
  expect:{C:0, Z:0, N:1}
},

{ name:"ROL $0200,X",
  code:[0x3E,0xFF,0x01], // base $01FF + X=1 -> $0200
  pre:{X:0x01, P:{C:1}},
  setup:()=>{ checkWriteOffset(0x0200, 0x80); },
  expectMem:{addr:0x0200, value:0x01},
  expect:{C:1, Z:0, N:0}
},

    // ROR accumulator
    { name:"ROR A (no carry)",            code:[0x6A],                   pre:{A:0x02,P:{C:0}}, expect:{A:0x01,C:0,Z:0,N:0} },
    { name:"ROR A (carry in & zero)",     code:[0x6A],                   pre:{A:0x00,P:{C:1}}, expect:{A:0x80,C:0,Z:0,N:1} },
    // ROR memory (ZP/ZPX/ABS/ABSX)
    { name:"ROR $15",                     code:[0x66,0x15],   pre:{P:{C:0}}, setup:()=>{ checkWriteOffset(0x15, 0x02); }, expectMem:{addr:0x15,value:0x01}, expect:{C:0,Z:0,N:0} },
    { name:"ROR $15 (carry)",             code:[0x66,0x15],   pre:{P:{C:1}}, setup:()=>{ checkWriteOffset(0x15, 0x01); }, expectMem:{addr:0x15,value:0x80}, expect:{C:1,Z:0,N:1} },
    { name:"ROR $20,X",                   code:[0x76,0x1F], pre:{X:0x01,P:{C:1}}, setup:()=>{ checkWriteOffset(0x20, 0x00); }, expectMem:{addr:0x20,value:0x80}, expect:{C:0,Z:0,N:1} },
    { name:"ROR $0D00",                   code:[0x6E,0x00,0x0D],         pre:{P:{C:1}}, setup:()=>{ checkWriteOffset(0x0D00, 0x02); }, expectMem:{addr:0x0D00,value:0x81}, expect:{C:0,Z:0,N:1} },
    { name:"ROR $0D00,X",                 code:[0x7E,0xFF,0x0C], pre:{X:0x01,P:{C:1}}, setup:()=>{ checkWriteOffset(0x0D00, 0x01); }, expectMem:{addr:0x0D00,value:0x80}, expect:{C:1,Z:0,N:1} },
  ];

  setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       SHIFT OPS (ASL, LSR, ROL, ROR)
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th>
         <th>Eff Addr</th><th>Expected</th><th>Result</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test => {
    // Capture before
    const fb = {...CPUregisters.P}, cb = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};
    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }
    if(test.setup) test.setup();

    // Memory snapshot before (optional)
    let memBefore;
    if(test.expectMem) memBefore = checkReadOffset(test.expectMem.addr);

    // Execute
    step();

    // Check effective address (for memory ops)
    let ea = test.expectMem?.addr !== undefined ? test.expectMem.addr : null;
    const mirrors = ea !== null ? getMirrors(ea).filter(a=>a<0x10000) : [];

    // After state
    const fa = {...CPUregisters.P}, ca = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};

    let reasons = [], pass = true;
    // Reg/flag checks
    if(test.expect){
      ["A","X","Y","S"].forEach(r=>{
        if(test.expect[r] !== undefined && ca[r] !== test.expect[r]){
          reasons.push(`${r}=${hex(ca[r])}≠${hex(test.expect[r])}`); pass = false;
        }
      });
      ["C","Z","N","V"].forEach(f=>{
        if(test.expect[f] !== undefined && CPUregisters.P[f] !== test.expect[f]){
          reasons.push(`${f}=${CPUregisters.P[f]}≠${test.expect[f]}`); pass = false;
        }
      });
    }
    // Memory
    if(test.expectMem && ea !== null){
      mirrors.forEach(addr=>{
        const got = checkReadOffset(addr);
        if(got !== test.expectMem.value){
          reasons.push(`$${addr.toString(16).padStart(4,"0")}=${hex(got)}≠${hex(test.expectMem.value)}`); pass = false;
        }
      });
    }

    // Table labels
    const mirrorLabel = ea !== null ? `$${ea.toString(16).padStart(4,"0")}` : "";
    const dropdownMirrors = ea !== null
      ? dropdown(mirrorLabel, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "";

    let expectedLabel = "";
    let resultLabel = "";
    if (test.expect?.A !== undefined) {
      expectedLabel = hex(test.expect.A); resultLabel = hex(CPUregisters.A);
    } else if (test.expectMem) {
      expectedLabel = hex(test.expectMem.value);
      resultLabel = ea !== null ? hex(checkReadOffset(ea)) : "";
    }

    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>`+
        `<ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,"0")).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(ca.A)} X=${hex(ca.X)} Y=${hex(ca.Y)} S=${hex(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdownMirrors}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);

  CPUregisters.PC = 0x8000;    
  prgRom[CPUregisters.PC - 0x8000] = 0x02;
}

function runLoadsOpsTests() {
  const tests = [
    { name:"LDA #$10",            code:[0xA9,0x10], expect:{A:0x10,Z:0,N:0} },
    { name:"LDA #$00 (zero)",     code:[0xA9,0x00], expect:{A:0x00,Z:1,N:0} },
    { name:"LDA #$80 (negative)", code:[0xA9,0x80], expect:{A:0x80,Z:0,N:1} },
    { name:"LDA zeroPage",        code:[0xA5,0x20], setup:()=>{ checkWriteOffset(0x20, 0x37); }, expect:{A:0x37,Z:0,N:0} },
    { name:"LDA zeroPage,X",      code:[0xB5,0x1F], pre:{X:0x01}, setup:()=>{ checkWriteOffset(0x20, 0x99); }, expect:{A:0x99,Z:0,N:1} },
    { name:"LDA absolute",        code:[0xAD,0x00,0x02], setup:()=>{ checkWriteOffset(0x0200, 0x55); }, expect:{A:0x55,Z:0,N:0} },
    { name:"LDA absolute,X",      code:[0xBD,0x00,0x02], pre:{X:0x01}, setup:()=>{ checkWriteOffset(0x0201, 0x44); }, expect:{A:0x44,Z:0,N:0} },
    { name:"LDA absolute,Y",      code:[0xB9,0x00,0x02], pre:{Y:0x02}, setup:()=>{ checkWriteOffset(0x0202, 0x88); }, expect:{A:0x88,Z:0,N:1} },
    { name:"LDA (indirect,X)",    code:[0xA1,0x0F], pre:{X:0x01}, setup:()=>{ checkWriteOffset(0x10,0x34); checkWriteOffset(0x11,0x12); checkWriteOffset(0x1234,0x77); }, expect:{A:0x77,Z:0,N:0} },

    { 
  name: "LDA (indirect),Y",
  code: [0xB1, 0x20],
  pre: { Y: 0x02 },
  setup: () => {
    checkWriteOffset(0x20, 0x00);  // low byte
    checkWriteOffset(0x21, 0x80);  // high byte
    checkWriteOffset(0x8002, 0x66); 
  },
  expect: { A: 0x66, Z: 0, N: 0 }
},   
    { name:"LDX #$03",            code:[0xA2,0x03], expect:{X:0x03,Z:0,N:0} },
    { name:"LDX #$00 (zero)",     code:[0xA2,0x00], expect:{X:0x00,Z:1,N:0} },
    { name:"LDX #$80 (negative)", code:[0xA2,0x80], expect:{X:0x80,Z:0,N:1} },
    { name:"LDX zeroPage",        code:[0xA6,0x30], setup:()=>{ checkWriteOffset(0x30, 0x12); }, expect:{X:0x12,Z:0,N:0} },
    { name:"LDX zeroPage,Y",      code:[0xB6,0x2F], pre:{Y:0x01}, setup:()=>{ checkWriteOffset(0x30, 0x34); }, expect:{X:0x34,Z:0,N:0} },
    { name:"LDX absolute",        code:[0xAE,0x00,0x02], setup:()=>{ checkWriteOffset(0x0200, 0x56); }, expect:{X:0x56,Z:0,N:0} },
    { name:"LDX absolute,Y",      code:[0xBE,0x00,0x02], pre:{Y:0x02}, setup:()=>{ checkWriteOffset(0x0202, 0x99); }, expect:{X:0x99,Z:0,N:1} },
    { name:"LDY #$04",            code:[0xA0,0x04], expect:{Y:0x04,Z:0,N:0} },
    { name:"LDY #$00 (zero)",     code:[0xA0,0x00], expect:{Y:0x00,Z:1,N:0} },
    { name:"LDY #$80 (negative)", code:[0xA0,0x80], expect:{Y:0x80,Z:0,N:1} },
    { name:"LDY zeroPage",        code:[0xA4,0x40], setup:()=>{ checkWriteOffset(0x40, 0x21); }, expect:{Y:0x21,Z:0,N:0} },
    { name:"LDY zeroPage,X",      code:[0xB4,0x3F], pre:{X:0x01}, setup:()=>{ checkWriteOffset(0x40, 0x22); }, expect:{Y:0x22,Z:0,N:0} },
    { name:"LDY absolute",        code:[0xAC,0x00,0x02], setup:()=>{ checkWriteOffset(0x0200, 0x33); }, expect:{Y:0x33,Z:0,N:0} },
    { name:"LDY absolute,X",      code:[0xBC,0x00,0x02], pre:{X:0x02}, setup:()=>{ checkWriteOffset(0x0202, 0x44); }, expect:{Y:0x44,Z:0,N:0} }
  ];

  setupTests(tests);

  let html = `<table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;font-size:1em;">
    <thead>
      <tr style="background:#222">
        <th style="border:1px solid #444;padding:6px;">Test</th>
        <th style="border:1px solid #444;padding:6px;">Op</th>
        <th style="border:1px solid #444;padding:6px;">CPU Before</th>
        <th style="border:1px solid #444;padding:6px;">CPU After</th>
        <th style="border:1px solid #444;padding:6px;">Cycles</th>
        <th style="border:1px solid #444;padding:6px;">Result</th>
      </tr>
    </thead><tbody>`;

  tests.forEach(test => {
    let cyclesBefore = cpuCycles || 0;
    let pass = true, reasons = [];

    const cpuStr = r => `A=${hex(r.A)} X=${hex(r.X)} Y=${hex(r.Y)} S=${hex(r.S)} PC=${hex(r.PC,4)}`;
    const before = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S, PC:CPUregisters.PC};

    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A;
      if (test.pre.X != null) CPUregisters.X = test.pre.X;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }
    if (test.setup) test.setup();
    step();

    if (test.expect.A !== undefined && CPUregisters.A !== test.expect.A) { reasons.push(`A=${hex(CPUregisters.A)}≠${hex(test.expect.A)}`); pass = false; }
    if (test.expect.X !== undefined && CPUregisters.X !== test.expect.X) { reasons.push(`X=${hex(CPUregisters.X)}≠${hex(test.expect.X)}`); pass = false; }
    if (test.expect.Y !== undefined && CPUregisters.Y !== test.expect.Y) { reasons.push(`Y=${hex(CPUregisters.Y)}≠${hex(test.expect.Y)}`); pass = false; }
    if (test.expect.Z !== undefined && CPUregisters.P.Z !== test.expect.Z) { reasons.push(`Z=${CPUregisters.P.Z}≠${test.expect.Z}`); pass = false; }
    if (test.expect.N !== undefined && CPUregisters.P.N !== test.expect.N) { reasons.push(`N=${CPUregisters.P.N}≠${test.expect.N}`); pass = false; }

    let cyclesUsed = (cpuCycles||0) - cyclesBefore;
    let resultCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary><ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).toUpperCase().padStart(2,"0")).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${cpuStr(before)}</td>
        <td style="border:1px solid #444;padding:6px;">${cpuStr(CPUregisters)}</td>
        <td style="border:1px solid #444;padding:6px;text-align:center;">${cyclesUsed}</td>
        <td style="border:1px solid #444;padding:6px;text-align:center;">${resultCell}</td>
      </tr>`;
  });

  html += "</tbody></table>";
  document.body.insertAdjacentHTML("beforeend", html);
  CPUregisters.PC = 0x8000;
  prgRom[0x00] = 0x02;
  CPUregisters.PC = 0x8000;
}

function runRegisterTransfersAndFlagsTestTwo() {
  const tests = [
    // TAX
    { name:"TAX A->X",    code:[0xAA], pre:{A:0x12},            expect:{X:0x12,Z:0,N:0} },
    { name:"TAX zero",    code:[0xAA], pre:{A:0x00},            expect:{X:0x00,Z:1,N:0} },
    { name:"TAX negative",code:[0xAA], pre:{A:0x80},            expect:{X:0x80,Z:0,N:1} },
    // TAY
    { name:"TAY A->Y",    code:[0xA8], pre:{A:0x34},            expect:{Y:0x34,Z:0,N:0} },
    { name:"TAY zero",    code:[0xA8], pre:{A:0x00},            expect:{Y:0x00,Z:1,N:0} },
    { name:"TAY negative",code:[0xA8], pre:{A:0xFF},            expect:{Y:0xFF,Z:0,N:1} },
    // TXA
    { name:"TXA X->A",    code:[0x8A], pre:{X:0x56},            expect:{A:0x56,Z:0,N:0} },
    { name:"TXA zero",    code:[0x8A], pre:{X:0x00},            expect:{A:0x00,Z:1,N:0} },
    { name:"TXA negative",code:[0x8A], pre:{X:0x80},            expect:{A:0x80,Z:0,N:1} },
    // TYA
    { name:"TYA Y->A",    code:[0x98], pre:{Y:0x77},            expect:{A:0x77,Z:0,N:0} },
    { name:"TYA zero",    code:[0x98], pre:{Y:0x00},            expect:{A:0x00,Z:1,N:0} },
    { name:"TYA negative",code:[0x98], pre:{Y:0xFF},            expect:{A:0xFF,Z:0,N:1} },
    // TSX
    { name:"TSX S->X",    code:[0xBA], pre:{S:0x80},            expect:{X:0x80,Z:0,N:1} },
    { name:"TSX zero",    code:[0xBA], pre:{S:0x00},            expect:{X:0x00,Z:1,N:0} },
    // TXS (no flags)
    { name:"TXS X->S",    code:[0x9A], pre:{X:0x12},            expect:{S:0x12} },
    { name:"TXS zero",    code:[0x9A], pre:{X:0x00},            expect:{S:0x00} },
    // Flag ops
    { name:"CLC",         code:[0x18], pre:{P:{C:1}},           expect:{C:0} },
    { name:"SEC",         code:[0x38], pre:{P:{C:0}},           expect:{C:1} },
    { name:"CLV",         code:[0xB8], pre:{P:{V:1}},           expect:{V:0} },
    { name:"CLI",         code:[0x58], pre:{P:{I:1}},           expect:{I:0} },
    { name:"SEI",         code:[0x78], pre:{P:{I:0}},           expect:{I:1} },
    { name:"CLD",         code:[0xD8], pre:{P:{D:1}},           expect:{D:0} },
    { name:"SED",         code:[0xF8], pre:{P:{D:0}},           expect:{D:1} }
  ];

  setupTests(tests);

  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       REGISTER TRANSFERS & FLAGS 2nd run!
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th>
         <th>Expected</th><th>Result</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test => {
    const fb = {...CPUregisters.P};
    const cb = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S};

    // Pre-state
    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A;
      if (test.pre.X != null) CPUregisters.X = test.pre.X;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y;
      if (test.pre.S != null) CPUregisters.S = test.pre.S;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }
    if (test.setup) test.setup();

    step();

    const fa = {...CPUregisters.P};
    const ca = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S};

    let reasons = [], pass = true, exp = test.expect || {};
    if (test.expect) {
      ["A","X","Y","S"].forEach(rn => {
        if (exp[rn]!=null && ca[rn]!==exp[rn]) {
          reasons.push(`${rn}=${hex(ca[rn])}≠${hex(exp[rn])}`); pass=false;
        }
      });
      // Flag bits (any in expect)
      ["C","Z","N","V","I","D"].forEach(fn => {
        if (exp[fn]!=null && CPUregisters.P[fn]!==exp[fn]) {
          reasons.push(`${fn}=${CPUregisters.P[fn]}≠${exp[fn]}`); pass=false;
        }
      });
    }

    const expectedLabel = test.expect
      ? Object.entries(test.expect).map(([k,v])=> k.length>1 ? `${k}=${testSuiteHex(v)}` : `${k}=${v}`).join(" ")
      : "";
    const resultLabel = test.expect
      ? Object.entries(test.expect).map(([k])=> {
          const val = (k in ca) ? ca[k] : CPUregisters.P[k];
          return k.length>1 ? `${k}=${hex(val)}` : `${k}=${val}`;
        }).join(" ")
      : "";
    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>`+
        `<ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(ca.A)} X=${hex(ca.X)} Y=${hex(ca.Y)} S=${hex(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
  CPUregisters.PC = 0x8000;
  prgRom[0x00] = 0x02;
}

function runCompareOpsTests() {
  // ===== COMPARE OPS (CMP, CPX, CPY) =====
  const tests = [
    // CMP
    { name:"CMP #$10, A>$10",     code:[0xC9,0x10],                  pre:{A:0x20},                          expect:{C:1,Z:0,N:0} },
    { name:"CMP #$20, A=$20",     code:[0xC9,0x20],                  pre:{A:0x20},                          expect:{C:1,Z:1,N:0} },
    { name:"CMP zeroPage",        code:[0xC5,0x10],                  pre:{A:0x05}, setup:()=>{ checkWriteOffset(0x10, 0x05); }, expect:{C:1,Z:1,N:0} },

// 1) Equal → Z=1, C=1, N=0
{ name:"CMP $10,X equal -> Z,C",
  code:[0xD5,0x10],
  pre:{A:0x3C, X:0x02},
  setup:()=>{ checkWriteOffset(0x0012, 0x3C); }, // $10 + X = $12
  expect:{C:1, Z:1, N:0}
},

// 2) A > M (small positive diff) → Z=0, C=1, N=0
{ name:"CMP $0F,X A>M -> C",
  code:[0xD5,0x0F],
  pre:{A:0x05, X:0x00},
  setup:()=>{ checkWriteOffset(0x000F, 0x01); },
  expect:{C:1, Z:0, N:0}
},

// 3) A < M with ZP wrap (0xFE + 5 -> 0x03) → Z=0, C=0, N=1
{ name:"CMP $FE,X wrap A<M -> N",
  code:[0xD5,0xFE],
  pre:{A:0x10, X:0x05},
  setup:()=>{ checkWriteOffset(0x0003, 0x90); }, // diff = 0x10 - 0x90 = 0x80
  expect:{C:0, Z:0, N:1}
},

   // 1) Equal → Z=1, C=1, N=0
{ name:"CMP $10,X equal -> Z,C",
  code:[0xD5,0x10],
  pre:{A:0x20, X:0x02},
  setup:()=>{ checkWriteOffset(0x0012, 0x20); },   // $10 + X = $12
  expect:{C:1, Z:1, N:0}
},

// 2) A > M (small positive diff) → Z=0, C=1, N=0
{ name:"CMP $0F,X A>M -> C",
  code:[0xD5,0x0F],
  pre:{A:0x10, X:0x01},
  setup:()=>{ checkWriteOffset(0x0010, 0x05); },   // eff = $0F + 1 = $10
  expect:{C:1, Z:0, N:0}
},

// 3) A < M with ZP wrap (0xFE + 5 -> 0x03) → Z=0, C=0, N=1
{ name:"CMP $FE,X wrap A<M -> N",
  code:[0xD5,0xFE],
  pre:{A:0x10, X:0x05},
  setup:()=>{ checkWriteOffset(0x0003, 0x90); },   // diff = 0x10 - 0x90 = 0x80
  expect:{C:0, Z:0, N:1}
},

    { name:"CMP absolute",        code:[0xCD,0x00,0x20],             pre:{A:0x05}, setup:()=>{ checkWriteOffset(0x2000, 0x10); }, expect:{C:0,Z:0,N:1} },
    { name:"CMP absolute,X",      code:[0xDD,0x00,0x20], pre:{A:0x10,X:0x01}, setup:()=>{ checkWriteOffset(0x2001, 0x10); }, expect:{C:1,Z:1,N:0} },
    { name:"CMP absolute,Y",      code:[0xD9,0x00,0x20], pre:{A:0x05,Y:0x01}, setup:()=>{ checkWriteOffset(0x2001, 0x05); }, expect:{C:1,Z:1,N:0} },

// 1) Equal → Z=1, C=1, N=0
{ name:"CMP ($0F,X) equal -> Z,C",
  code:[0xC1,0x0F],
  pre:{A:0x11, X:0x01},
  setup:()=>{                     // ptr at ($0F+1)=$10
    checkWriteOffset(0x0010, 0x00); // lo
    checkWriteOffset(0x0011, 0x03); // hi  => base=$0300
    checkWriteOffset(0x0300, 0x11); // M[$0300]=0x11
  },
  expect:{C:1, Z:1, N:0}
},

// 2) A > M → Z=0, C=1, N=0
{ name:"CMP ($12,X) A>M -> C",
  code:[0xC1,0x12],
  pre:{A:0x10, X:0x03},
  setup:()=>{                     // ptr at ($12+3)=$15
    checkWriteOffset(0x0015, 0x34); // lo
    checkWriteOffset(0x0016, 0x00); // hi  => base=$0034
    checkWriteOffset(0x0034, 0x05); // M=0x05, diff=0x0B
  },
  expect:{C:1, Z:0, N:0}
},

// 3) ZP wrap, A < M → Z=0, C=0, N=1
{ name:"CMP ($FE,X) wrap A<M -> N",
  code:[0xC1,0xFE],
  pre:{A:0x10, X:0x05},
  setup:()=>{                     // ($FE+5)&FF = $03
    checkWriteOffset(0x0003, 0x20); // lo
    checkWriteOffset(0x0004, 0x01); // hi  => base=$0120
    checkWriteOffset(0x0120, 0x90); // diff=0x10-0x90=0x80
  },
  expect:{C:0, Z:0, N:1}
},
    // CPX
    { name:"CPX #$10, X>$10",     code:[0xE0,0x10], pre:{X:0x20},                          expect:{C:1,Z:0,N:0} },
    { name:"CPX #$20, X=$20",     code:[0xE0,0x20], pre:{X:0x20},                          expect:{C:1,Z:1,N:0} },
    { name:"CPX zeroPage",        code:[0xE4,0x30], pre:{X:0x05}, setup:()=>{ checkWriteOffset(0x30, 0x10); }, expect:{C:0,Z:0,N:1} },
    { name:"CPX absolute",        code:[0xEC,0x00,0x02], pre:{X:0x05}, setup:()=>{ checkWriteOffset(0x0200, 0x05); }, expect:{C:1,Z:1,N:0} },

    // CPY
    { name:"CPY #$10, Y>$10",     code:[0xC0,0x10], pre:{Y:0x20},                          expect:{C:1,Z:0,N:0} },
    { name:"CPY #$20, Y=$20",     code:[0xC0,0x20], pre:{Y:0x20},                          expect:{C:1,Z:1,N:0} },
    { name:"CPY zeroPage",        code:[0xC4,0x40], pre:{Y:0x05}, setup:()=>{ checkWriteOffset(0x40, 0x00); }, expect:{C:1,Z:0,N:0} },
    { name:"CPY absolute",        code:[0xCC,0x00,0x02], pre:{Y:0x02}, setup:()=>{ checkWriteOffset(0x0200, 0x03); }, expect:{C:0,Z:0,N:1} }
  ];

  setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       COMPARE OPS (CMP, CPX, CPY)
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th>
         <th>Expected</th><th>Result</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test => {
    const fb = {...CPUregisters.P}, cb = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};

    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }
    if(test.setup) test.setup();

    step();

    const fa = {...CPUregisters.P}, ca = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};

    let reasons=[], pass=true, exp=test.expect||{};
    if(test.expect){
      ["A","X","Y","S"].forEach(rn=>{ if(exp[rn]!=null && ca[rn]!==exp[rn]){ reasons.push(`${rn}=${hex(ca[rn])}≠${hex(exp[rn])}`); pass=false; } });
      ["C","Z","N","V"].forEach(fn=>{ if(exp[fn]!=null && CPUregisters.P[fn]!==exp[fn]){ reasons.push(`${fn}=${CPUregisters.P[fn]}≠${exp[fn]}`); pass=false; } });
    }

    const expectedLabel = Object.entries(test.expect||{}).map(([k,v])=>`${k}=${testSuiteHex(v)}`).join(" ");
    const resultLabel   = Object.entries(test.expect||{}).map(([k])=>{
      const val = k in ca ? ca[k] : CPUregisters.P[k];
      return `${k}=${hex(val)}`;
    }).join(" ");
    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>`+
        `<ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(ca.A)} X=${hex(ca.X)} Y=${hex(ca.Y)} S=${hex(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
  CPUregisters.PC = 0x8000;    
  prgRom[0x00] = 0x02;
}

function runBranchOpsTests() {
  const startPC = 0x8000;
  const smallOffset = 0x02;             // stays on page ($8000 + 2 + 2 = $8004)
  const pageCrossOffset = 0x82;         // -0x7E = jump back and cross to $7F80

  const cases = [
    { name: "BCC taken (C=0, no page cross)", code: [0x90, smallOffset], pre: {P:{C:0}}, taken: true, offset: smallOffset, pageCross: false },
    { name: "BCC taken (C=0, page cross)", code: [0x90, pageCrossOffset], pre: {P:{C:0}}, taken: true, offset: pageCrossOffset, pageCross: true },
    { name: "BCC not taken (C=1)", code: [0x90, smallOffset], pre: {P:{C:1}}, taken: false, offset: smallOffset, pageCross: false },

    { name: "BCS taken (C=1, no page cross)", code: [0xB0, smallOffset], pre: {P:{C:1}}, taken: true, offset: smallOffset, pageCross: false },
    { name: "BCS taken (C=1, page cross)", code: [0xB0, pageCrossOffset], pre: {P:{C:1}}, taken: true, offset: pageCrossOffset, pageCross: true },
    { name: "BCS not taken (C=0)", code: [0xB0, smallOffset], pre: {P:{C:0}}, taken: false, offset: smallOffset, pageCross: false },

    { name: "BEQ taken (Z=1, no page cross)", code: [0xF0, smallOffset], pre: {P:{Z:1}}, taken: true, offset: smallOffset, pageCross: false },
    { name: "BEQ taken (Z=1, page cross)", code: [0xF0, pageCrossOffset], pre: {P:{Z:1}}, taken: true, offset: pageCrossOffset, pageCross: true },
    { name: "BEQ not taken (Z=0)", code: [0xF0, smallOffset], pre: {P:{Z:0}}, taken: false, offset: smallOffset, pageCross: false },

    { name: "BMI taken (N=1, no page cross)", code: [0x30, smallOffset], pre: {P:{N:1}}, taken: true, offset: smallOffset, pageCross: false },
    { name: "BMI taken (N=1, page cross)", code: [0x30, pageCrossOffset], pre: {P:{N:1}}, taken: true, offset: pageCrossOffset, pageCross: true },
    { name: "BMI not taken (N=0)", code: [0x30, smallOffset], pre: {P:{N:0}}, taken: false, offset: smallOffset, pageCross: false },

    { name: "BNE taken (Z=0, no page cross)", code: [0xD0, smallOffset], pre: {P:{Z:0}}, taken: true, offset: smallOffset, pageCross: false },
    { name: "BNE taken (Z=0, page cross)", code: [0xD0, pageCrossOffset], pre: {P:{Z:0}}, taken: true, offset: pageCrossOffset, pageCross: true },
    { name: "BNE not taken (Z=1)", code: [0xD0, smallOffset], pre: {P:{Z:1}}, taken: false, offset: smallOffset, pageCross: false },

    { name: "BPL taken (N=0, no page cross)", code: [0x10, smallOffset], pre: {P:{N:0}}, taken: true, offset: smallOffset, pageCross: false },
    { name: "BPL taken (N=0, page cross)", code: [0x10, pageCrossOffset], pre: {P:{N:0}}, taken: true, offset: pageCrossOffset, pageCross: true },
    { name: "BPL not taken (N=1)", code: [0x10, smallOffset], pre: {P:{N:1}}, taken: false, offset: smallOffset, pageCross: false },

    { name: "BVC taken (V=0, no page cross)", code: [0x50, smallOffset], pre: {P:{V:0}}, taken: true, offset: smallOffset, pageCross: false },
    { name: "BVC taken (V=0, page cross)", code: [0x50, pageCrossOffset], pre: {P:{V:0}}, taken: true, offset: pageCrossOffset, pageCross: true },
    { name: "BVC not taken (V=1)", code: [0x50, smallOffset], pre: {P:{V:1}}, taken: false, offset: smallOffset, pageCross: false },

    { name: "BVS taken (V=1, no page cross)", code: [0x70, smallOffset], pre: {P:{V:1}}, taken: true, offset: smallOffset, pageCross: false },
    { name: "BVS taken (V=1, page cross)", code: [0x70, pageCrossOffset], pre: {P:{V:1}}, taken: true, offset: pageCrossOffset, pageCross: true },
    { name: "BVS not taken (V=0)", code: [0x70, smallOffset], pre: {P:{V:0}}, taken: false, offset: smallOffset, pageCross: false }
  ];

  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
      BRANCH OPS (ALL: taken, not taken, page cross, etc)
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;table-layout:fixed;">
      <thead><tr style="background:#222">
        <th>Test</th>
        <th>Op</th>
        <th>Registers<br>Before</th>
        <th>Flags<br>Before</th>
        <th>PC<br>Before</th>
        <th>Registers<br>After</th>
        <th>Flags<br>After</th>
        <th>PC<br>After</th>
        <th>Expected PC</th>
        <th>ΔCycles</th>
        <th>Expected Cycles</th>
        <th>Page Cross</th>
        <th>Status</th>
        <th>Details</th>
      </tr></thead><tbody>`;

  cases.forEach(test => {
    // Setup registers/memory
    CPUregisters.PC = startPC;
    prgRom[0x00] = test.code[0];
    prgRom[0x01] = test.code[1];
    CPUregisters.A = 0x12; CPUregisters.X = 0x34; CPUregisters.Y = 0x56; CPUregisters.S = 0xFD;
    Object.assign(CPUregisters.P, {N:0,V:0,B:0,D:0,I:0,Z:0,C:0});
    if(test.pre && test.pre.P) Object.assign(CPUregisters.P, test.pre.P);

    // Before
    const pcBefore = CPUregisters.PC;
    const cyclesBefore = cpuCycles;
    const flagsBefore = { ...CPUregisters.P };
    const regsBefore = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };

    // Execute
    step();

    // After
    const pcAfter = CPUregisters.PC;
    const cyclesAfter = cpuCycles;
    const flagsAfter = { ...CPUregisters.P };
    const regsAfter = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };

    // Calculate expected PC and page cross (actual)
    let offset = test.offset;
    if (offset & 0x80) offset = offset - 0x100;
    let expectedPC = test.taken
      ? (pcBefore + 2 + offset) & 0xFFFF
      : (pcBefore + 2) & 0xFFFF;

    // Determine if actual branch crosses a page
    let actualPageCrossed = false;
    if (test.taken) {
      const fromPage = ((pcBefore + 2) & 0xFF00);
      const toPage = (expectedPC & 0xFF00);
      actualPageCrossed = fromPage !== toPage;
    }

    let deltaCycles = cyclesAfter - cyclesBefore;

    // *** Expected Cycles logic ***
    let expectedCycles = 2;
    if (test.taken) expectedCycles += 1;
    if (test.taken && actualPageCrossed) expectedCycles += 1;

    // Pass/fail check
    let failReasons = [];
    let pass = true;
    if (pcAfter !== expectedPC) { failReasons.push(`PC=${hex(pcAfter)}≠${hex(expectedPC)}`); pass = false; }
    if (deltaCycles !== expectedCycles) { failReasons.push(`cycles=${deltaCycles}≠${expectedCycles}`); pass = false; }
    for (let r of ["A","X","Y","S"]) {
      if (regsAfter[r] !== regsBefore[r]) { failReasons.push(`${r}=${hex(regsAfter[r])}≠${hex(regsBefore[r])}`); pass = false; }
    }
    if (!flagsEqual(flagsBefore, flagsAfter)) {
      failReasons.push(`flags changed`);
      pass = false;
    }
    // "Page Cross" column shows actual page cross status and pass/fail for expectedness
    let pageCrossCell = actualPageCrossed === !!test.pageCross
      ? `<span style='color:${actualPageCrossed ? "orange" : "lightgreen"};font-weight:bold;'>${actualPageCrossed ? "YES" : "NO"}</span>`
      : `<span style='color:red;font-weight:bold;'>${actualPageCrossed ? "YES" : "NO"}</span>`;

    let status = pass
      ? "<span style='color:#7fff7f;font-weight:bold;'>✔️ Pass</span>"
      : "<span style='color:#ff7777;font-weight:bold;'>❌ Fail</span>";

    let details = failReasons.join("; ");

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(' ')}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(regsBefore.A)} X=${hex(regsBefore.X)} Y=${hex(regsBefore.Y)} S=${hex(regsBefore.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(flagsBefore)}</td>
        <td style="border:1px solid #444;padding:6px;">${hex(pcBefore)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(regsAfter.A)} X=${hex(regsAfter.X)} Y=${hex(regsAfter.Y)} S=${hex(regsAfter.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(flagsAfter)}</td>
        <td style="border:1px solid #444;padding:6px;">${hex(pcAfter)}</td>
        <td style="border:1px solid #444;padding:6px;">${hex(expectedPC)}</td>
        <td style="border:1px solid #444;padding:6px;">${deltaCycles}</td>
        <td style="border:1px solid #444;padding:6px;">${expectedCycles}</td>
        <td style="border:1px solid #444;padding:6px;">${pageCrossCell}</td>
        <td style="border:1px solid #444;padding:6px;">${status}</td>
        <td style="border:1px solid #444;padding:6px;color:#FF7777;max-width:260px;word-wrap:break-word;white-space:pre-line;">${details}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
  CPUregisters.PC = 0x8000;
  prgRom[CPUregisters.PC - 0x8000] = 0x02;
}

function runJumpAndSubRoutinesTests() {

  // ===== JUMP & SUBROUTINES (JMP, JSR, RTI, RTS) =====

  // --- DMA-safe reset (avoid touching $4000–$401F; $4014 triggers OAM DMA) ---
  function clearForTest() {
    // WRAM ($0000–$1FFF) mirrors
    for (let a = 0x0000; a <= 0x1FFF; a++) checkWriteOffset(a, 0);
    // PRG-RAM ($6000–$7FFF) if present
    if (typeof prgRam !== "undefined" && prgRam) {
      for (let a = 0x6000; a <= 0x7FFF; a++) checkWriteOffset(a, 0);
    }
    // Leave PPU/APU/IO alone to avoid side effects.
  }

  // --- Write bytes into PRG window ($8000+) without bus side-effects ---
  function writeCodeToROM(cpuAddr, bytes) {
    for (let i = 0; i < bytes.length; i++) {
      const a = (cpuAddr + i) & 0xFFFF;
      if (a < 0x8000) {
        // If ever testing code < $8000, fall back to bus write
        checkWriteOffset(a, bytes[i] & 0xFF);
      } else {
        // Mapper 0 assumption; adjust if you have banking
        prgRom[(a - 0x8000) & (prgRom.length - 1)] = bytes[i] & 0xFF;
      }
    }
  }

  // --- Small helpers for pretty output ---
  const hx16 = v => "0x" + ((v & 0xFFFF).toString(16).padStart(4, "0"));
  const hx8  = v => "0x" + ((v & 0xFF).toString(16).padStart(2, "0"));

  // ---- Tests (targets now in $8000+) ----
  const tests = [
    // JMP absolute → $9000 (low,high = 00,90)
    { name: "JMP absolute", code: [0x4C, 0x00, 0x90], expectPC: 0x9000 },

    // JMP indirect ($0010) → $8034  (write $34, $80 at $0010/$0011)
    { name: "JMP indirect",
      code: [0x6C, 0x10, 0x00],
      setup: () => {
        checkWriteOffset(0x0010, 0x34);
        checkWriteOffset(0x0011, 0x80);
      },
      expectPC: 0x8034
    },

    // JSR absolute → $8005
    // JSR pushes (PC+2-1) to stack, then sets PC to the target.
    { name: "JSR absolute", code: [0x20, 0x05, 0x80], expectPC: 0x8005 },

    // RTS: with S=0xFC and stack[$01FD]=$00 (low), $01FE=$90 (high) → PC=$9000+1=$9001
    { name: "RTS return",
      code: [0x60],
      setup: () => {
        CPUregisters.S = 0xFC;
        checkWriteOffset(0x01FD, 0x00); // low
        checkWriteOffset(0x01FE, 0x90); // high
      },
      expectPC: 0x9001
    },

    // RTI: pick S=0xFC so the pulls are: P  from $01FD, PCL from $01FE, PCH from $01FF.
    // Push image should have bit5=1; B in the *pushed* copy is typically 1 for BRK/PHP, 0 for IRQ/NMI.
    // We only care about PC here, so set P to some sane value (e.g., 0b00101101).
    // Target: $8000 → PCL=$00 at $01FE, PCH=$80 at $01FF.
    { name: "RTI return",
      code: [0x40],
      setup: () => {
        CPUregisters.S = 0xFC;
        checkWriteOffset(0x01FD, 0b00101101); // P (pushed copy)
        checkWriteOffset(0x01FE, 0x00);       // PCL
        checkWriteOffset(0x01FF, 0x80);       // PCH
      },
      expectPC: 0x8000
    }
  ];

  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       JUMP & SUBROUTINES
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th>
         <th>Op</th>
         <th>Flags<br>Before</th>
         <th>Flags<br>After</th>
         <th>CPU<br>Before</th>
         <th>CPU<br>After</th>
         <th>Target PC</th>
         <th>Status</th>
       </tr></thead><tbody>`;

  for (const test of tests) {
    // Fresh environment for each test
    clearForTest();
    cpuCycles = 0;

    // CPU baseline
    CPUregisters.A = CPUregisters.X = CPUregisters.Y = 0;
    CPUregisters.S = 0xFF;
    CPUregisters.P = { C:0, Z:0, I:0, D:0, B:0, V:0, N:0 };
    CPUregisters.PC = 0x8000;

    // Pre-case overrides (if any)
    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A & 0xFF;
      if (test.pre.X != null) CPUregisters.X = test.pre.X & 0xFF;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y & 0xFF;
      if (test.pre.S != null) CPUregisters.S = test.pre.S & 0xFF;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
      if (test.pre.PC != null) CPUregisters.PC = test.pre.PC & 0xFFFF;
    }

    // Install code at current PC and run optional setup
    writeCodeToROM(CPUregisters.PC, test.code);
    if (test.setup) test.setup();

    // Snap before
    const fb = { ...CPUregisters.P };
    const cb = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };

    // Execute one instruction
    step();

    // Snap after
    const fa = { ...CPUregisters.P };
    const ca = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };
    const targetPC = CPUregisters.PC & 0xFFFF;

    // Pass/fail
    let pass = true, reasons = [];
    if (typeof test.expectPC === "number") {
      const want = test.expectPC & 0xFFFF;
      if (targetPC !== want) {
        pass = false;
        reasons.push(`PC=${hx16(targetPC)}≠${hx16(want)}`);
      }
    }

    const opBytes = test.code.map(b => b.toString(16).padStart(2, "0")).join(" ");
    const status = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details style="color:#ff4444;cursor:pointer;"><summary>❌ Show Details</summary><ul>${
          reasons.map(r=>`<li>${r}</li>`).join("")
        }</ul></details>`;

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${opBytes}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hx8(cb.A)} X=${hx8(cb.X)} Y=${hx8(cb.Y)} S=${hx8(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hx8(ca.A)} X=${hx8(ca.X)} Y=${hx8(ca.Y)} S=${hx8(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${hx16(targetPC)}</td>
        <td style="border:1px solid #444;padding:6px;">${status}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);

  // Restore predictable environment for whatever runs next
  CPUregisters.PC = 0x8000;
  writeCodeToROM(0x8000, [0x02]); // optional "magic" byte if your harness expects it
}

function runStackOpsTests() {
  // --- tiny helpers (self-contained) ---
  const hex8  = v => '0x' + (v & 0xFF).toString(16).toUpperCase().padStart(2,'0');
  const hex16 = v => '0x' + (v & 0xFFFF).toString(16).toUpperCase().padStart(4,'0');
  const flagsStr = P => (P.N? 'N':'-')+(P.V? 'V':'-')+'-'+(P.B? 'B':'-')+(P.D? 'D':'-')+(P.I? 'I':'-')+(P.Z? 'Z':'-')+(P.C? 'C':'-');

  // ===== STACK OPS (PHA, PHP, PLA, PLP) =====
  // Notes:
  //  - PHA/PHP write to $0100|S THEN S--; address is the *original* S.
  //  - PLA/PLP do S++ THEN read from $0100|S (the incremented S).
  const tests = [
    // --- PHA ---
    { name:"PHA pushes A (S=FF)", code:[0x48], pre:{A:0x37,S:0xFF}, expectMem:{addr:0x01FF,value:0x37}, expect:{S:0xFE} },
    { name:"PHA pushes A (S=80)", code:[0x48], pre:{A:0xAB,S:0x80}, expectMem:{addr:0x0180,value:0xAB}, expect:{S:0x7F} },

    // --- PHP (bit5=1, B=0 expected in pushed value; only checking C here) ---
    { name:"PHP pushes P (C=1,S=FF)", code:[0x08], pre:{P:{C:1},S:0xFF}, expectMem:{addr:0x01FF,value:0x21}, expect:{S:0xFE} },
    { name:"PHP pushes P (C=0,S=80)", code:[0x08], pre:{P:{C:0},S:0x80}, expectMem:{addr:0x0180,value:0x20}, expect:{S:0x7F} },

    // --- PLA (sets Z/N from pulled A) ---
    // Prepare stack slot at $01FF, S=FE -> PLA will S++ to FF, read $01FF
    { name:"PLA pulls A (Z=0,N=0)", code:[0x68], pre:{S:0xFE}, setup:()=>{ checkWriteOffset(0x01FF, 0x44); },
      expect:{A:0x44,Z:0,N:0,S:0xFF} },
    // S=7E -> PLA will S++ to 7F, read $017F
    { name:"PLA pulls A (Z=1)", code:[0x68], pre:{S:0x7E}, setup:()=>{ checkWriteOffset(0x017F, 0x00); },
      expect:{A:0x00,Z:1,N:0,S:0x7F} },
    // Negative
    { name:"PLA pulls A (N=1)", code:[0x68], pre:{S:0x7E}, setup:()=>{ checkWriteOffset(0x017F, 0x80); },
      expect:{A:0x80,Z:0,N:1,S:0x7F} },

    // --- PLP (pulls P; we only assert flags we care about) ---
    // S=FE -> PLP S++ => FF, read $01FF
    { name:"PLP pulls P (C=1)", code:[0x28], pre:{S:0xFE}, setup:()=>{ checkWriteOffset(0x01FF, 0x21); },
      expect:{S:0xFF,C:1} },
    { name:"PLP pulls P (C=0)", code:[0x28], pre:{S:0x7E}, setup:()=>{ checkWriteOffset(0x017F, 0x20); },
      expect:{S:0x7F,C:0} },
    // Mixed flags example: N=1, Z=1, C=1
    { name:"PLP pulls P (N,Z,C)", code:[0x28], pre:{S:0x7E}, setup:()=>{ checkWriteOffset(0x017F, 0xA3); }, // 0b1010_0011
      expect:{S:0x7F,N:1,Z:1,C:1} },
  ];

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       STACK OPS (PHA, PHP, PLA, PLP)
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th style="text-align:left;padding:6px;border:1px solid #444;">Test</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">Op</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">CPU Before</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">Flags Before</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">CPU After</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">Flags After</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">Addr</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">Expected</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">Result</th>
         <th style="text-align:left;padding:6px;border:1px solid #444;">Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test => {
    // Reset PC and seed opcode in PRG at $8000
    CPUregisters.PC = 0x8000;
    prgRom[(CPUregisters.PC - 0x8000) & 0xFFFF] = test.code[0] & 0xFF;

    // Clear regs/flags (only the ones we care about)
    CPUregisters.A = 0; CPUregisters.X = 0; CPUregisters.Y = 0;
    Object.assign(CPUregisters.P, {N:0,V:0,B:0,D:0,I:0,Z:0,C:0});
    CPUregisters.S = 0xFF;

    // Apply pre
    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A & 0xFF;
      if (test.pre.S != null) CPUregisters.S = test.pre.S & 0xFF;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }

    const fb = {...CPUregisters.P};
    const cb = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S};

    if (test.setup) test.setup();

    // Run one instruction
    step();

    const fa = {...CPUregisters.P};
    const ca = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S};

    // Validate
    let reasons = [], pass = true;
    const exp = test.expect || {};

    // Registers/flags expectations
    ["A","X","Y","S"].forEach(r=>{
      if (exp[r] !== undefined && ca[r] !== exp[r]) { reasons.push(`${r}=${hex8(ca[r])}≠${hex8(exp[r])}`); pass = false; }
    });
    ["C","Z","N","V","D","I","B"].forEach(f=>{
      if (exp[f] !== undefined && fa[f] !== exp[f]) { reasons.push(`${f}=${fa[f]}≠${exp[f]}`); pass = false; }
    });

    // Memory write/read expectations
    let addrLabel = "", expectedLabel = "", resultLabel = "";
    if (test.expectMem) {
      const addr = test.expectMem.addr & 0xFFFF;
      const gotVal = checkReadOffset(addr) & 0xFF; // <-- FIX: read bus at addr
      addrLabel = hex16(addr);
      expectedLabel = hex8(test.expectMem.value);
      resultLabel = hex8(gotVal);
      if (gotVal !== (test.expectMem.value & 0xFF)) {
        reasons.push(`${addrLabel}=${resultLabel}≠${expectedLabel}`);
        pass = false;
      }
    } else {
      // If no memory check, show the expected vs actual registers/flags we asserted
      expectedLabel = Object.entries(exp).map(([k,v]) => `${k}=${hex8(v)}`).join(" ");
      resultLabel = Object.entries(exp).map(([k])=>{
        const val = (k in ca) ? ca[k] : fa[k];
        return `${k}=${hex8(val)}`;
      }).join(" ");
    }

    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>
           <ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul>
         </details>`;

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex8(cb.A)} X=${hex8(cb.X)} Y=${hex8(cb.Y)} S=${hex8(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsStr(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex8(ca.A)} X=${hex8(ca.X)} Y=${hex8(ca.Y)} S=${hex8(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsStr(fa)}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${addrLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);

  // reset PC and a harmless byte so subsequent steps don't run garbage
  CPUregisters.PC = 0x8000;
  prgRom[(CPUregisters.PC - 0x8000) & 0xFFFF] = 0x02; // (NOP-equivalent in your table maybe?)
}



function runBrkAndNopsTests() {
  const tests = [
    // ───────────────────── BRK (0x00) ─────────────────────
    // BRK pushes PC+2 and P|B to stack, sets I, uses 7 cycles
    {
      name: "BRK (S=FF, I=0)",
      code: [0x00],
      pre:  { S: 0xFF, P: { I: 0 } },
      expect: { S: 0xFC, P: { I: 1 } },
      expectedCycles: 7
    },
    {
      name: "BRK (S=80, I=0)",
      code: [0x00],
      pre:  { S: 0x80, P: { I: 0 } },
      expect: { S: 0x7D, P: { I: 1 } },
      expectedCycles: 7
    },
    {
      name: "BRK (S=00 wrap case, I=0)",
      code: [0x00],
      pre:  { S: 0x00, P: { I: 0 } },
      expect:{ S: 0xFD, P: { I: 1 } }, // 00 -> FF -> FE -> FD
      expectedCycles: 7
    },
    {
      name: "BRK (I already 1)",
      code: [0x00],
      pre:  { S: 0xFF, P: { I: 1 } },
      expect:{ S: 0xFC, P: { I: 1 } },
      expectedCycles: 7
    },
    {
      name: "BRK (D=1 preserved; I goes 1)",
      code: [0x00],
      pre:  { S: 0xFF, P: { I: 0, D: 1 } },
      expect:{ S: 0xFC, P: { I: 1, D: 1 } },
      expectedCycles: 7
    },
    {
      name: "BRK (Z=1, C=1 preserved; I goes 1)",
      code: [0x00],
      pre:  { S: 0xFE, P: { I: 0, Z: 1, C: 1 } },
      expect:{ S: 0xFB, P: { I: 1, Z: 1, C: 1 } },
      expectedCycles: 7
    },
    {
      name: "BRK (N=1, V=1 preserved; I goes 1)",
      code: [0x00],
      pre:  { S: 0x10, P: { I: 0, N: 1, V: 1 } },
      expect:{ S: 0x0D, P: { I: 1, N: 1, V: 1 } },
      expectedCycles: 7
    },
    {
      name: "BRK (all flags set except I; I becomes 1)",
      code: [0x00],
      pre:  { S: 0xA5, P: { N:1,V:1,D:1,I:0,Z:1,C:1 } },
      expect:{ S: 0xA2, P: { I:1, N:1,V:1,D:1,Z:1,C:1 } },
      expectedCycles: 7
    },
    {
      name: "BRK (all flags clear; only I becomes 1)",
      code: [0x00],
      pre:  { S: 0x7F, P: { N:0,V:0,D:0,I:0,Z:0,C:0 } },
      expect:{ S: 0x7C, P: { I:1, N:0,V:0,D:0,Z:0,C:0 } },
      expectedCycles: 7
    },
    {
      name: "BRK (stack near underflow edge)",
      code: [0x00],
      pre:  { S: 0x02, P: { I: 0 } },
      expect:{ S: 0xFF, P: { I: 1 } }, // 02 -> 01 -> 00 -> FF
      expectedCycles: 7
    },

    // ───────────────────── Official & Implied NOPs ─────────────────────
    { name: "NOP implied (0xEA)", code: [0xEA], expectedCycles: 2 },
    { name: "NOP implied (0x1A)", code: [0x1A], expectedCycles: 2 },
    { name: "NOP implied (0x3A)", code: [0x3A], expectedCycles: 2 },
    { name: "NOP implied (0x5A)", code: [0x5A], expectedCycles: 2 },
    { name: "NOP implied (0x7A)", code: [0x7A], expectedCycles: 2 },
    { name: "NOP implied (0xDA)", code: [0xDA], expectedCycles: 2 },
    { name: "NOP implied (0xFA)", code: [0xFA], expectedCycles: 2 },

    // ───────────────────── Two-byte DOP/SKB NOPs (no mem read) ─────────────────────
    { name: "NOP DOP (0x80)", code: [0x80, 0x00], expectedCycles: 2 },
    { name: "NOP DOP (0x82)", code: [0x82, 0x00], expectedCycles: 2 },
    { name: "NOP DOP (0x89)", code: [0x89, 0x00], expectedCycles: 2 },
    { name: "NOP DOP (0xC2)", code: [0xC2, 0x00], expectedCycles: 2 },
    { name: "NOP DOP (0xE2)", code: [0xE2, 0x00], expectedCycles: 2 },

    // ───────────────────── Memory-reading NOPs ─────────────────────
    // ZP
    { name: "NOP ZP (0x04)", code: [0x04, 0x00], expectedCycles: 3 },
    { name: "NOP ZP (0x44)", code: [0x44, 0x00], expectedCycles: 3 },
    { name: "NOP ZP (0x64)", code: [0x64, 0x00], expectedCycles: 3 },
    // ZP,X
    { name: "NOP ZPX (0x14)", code: [0x14, 0x00], expectedCycles: 4 },
    { name: "NOP ZPX (0x34)", code: [0x34, 0x00], expectedCycles: 4 },
    { name: "NOP ZPX (0x54)", code: [0x54, 0x00], expectedCycles: 4 },
    { name: "NOP ZPX (0x74)", code: [0x74, 0x00], expectedCycles: 4 },
    { name: "NOP ZPX (0xD4)", code: [0xD4, 0x00], expectedCycles: 4 },
    { name: "NOP ZPX (0xF4)", code: [0xF4, 0x00], expectedCycles: 4 },
    // ABS
    { name: "NOP ABS (0x0C)", code: [0x0C, 0x00, 0x00], expectedCycles: 4 },
    // ABS,X (no page cross → 4 cycles)
    { name: "NOP ABSX (0x1C)", code: [0x1C, 0x00, 0x00], expectedCycles: 4 },
    { name: "NOP ABSX (0x3C)", code: [0x3C, 0x00, 0x00], expectedCycles: 4 },
    { name: "NOP ABSX (0x5C)", code: [0x5C, 0x00, 0x00], expectedCycles: 4 },
    { name: "NOP ABSX (0x7C)", code: [0x7C, 0x00, 0x00], expectedCycles: 4 },
    { name: "NOP ABSX (0xDC)", code: [0xDC, 0x00, 0x00], expectedCycles: 4 },
    { name: "NOP ABSX (0xFC)", code: [0xFC, 0x00, 0x00], expectedCycles: 4 },

    // ───────────────────── Page-crossing ABS,X NOPs (+1 cycle) ─────────────────────
    // Base = $00FF, X=1 → cross to $0100 → expect 5 cycles.
    {
      name: "NOP ABSX (0x1C) page cross",
      code: [0x1C, 0xFF, 0x00],
      pre:  { X: 0x01 },
      expectedCycles: 5
    },
    {
      name: "NOP ABSX (0x7C) page cross",
      code: [0x7C, 0xFF, 0x00],
      pre:  { X: 0x01 },
      expectedCycles: 5
    }
  ];

  // Full clear (if your emulator needs it)
  for (let addr = 0; addr < 0x10000; addr++) checkWriteOffset(addr, 0);

  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       BRK & NOPs Test Suite
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead>
         <tr style="background:#222">
           <th>Test</th><th>Opcode</th><th>Flags Before</th><th>Flags After</th>
           <th>CPU Before</th><th>CPU After</th>
           <th>PC Before</th><th>PC After</th>
           <th>Cycles Used</th><th>Expected Cycles</th><th>Status</th>
         </tr>
       </thead><tbody>`;

  for (const test of tests) {
    // Reset CPU & memory for each test
    for (let addr = 0; addr < 0x10000; addr++) checkWriteOffset(addr, 0);
    CPUregisters.A = 0; CPUregisters.X = 0; CPUregisters.Y = 0;
    CPUregisters.S = 0xFF;
    CPUregisters.P = { C: 0, Z: 0, I: 0, D: 0, B: 0, V: 0, N: 0 };
    CPUregisters.PC = 0x8000;

    // Load test code at $8000 (assuming prgRom[0] is mapped to CPU $8000)
    for (let i = 0; i < test.code.length; i++) {
      prgRom[i] = test.code[i];
    }

    // Preconditions
    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A;
      if (test.pre.X != null) CPUregisters.X = test.pre.X;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y;
      if (test.pre.S != null) CPUregisters.S = test.pre.S;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }

    // Sanity: ensure the opcode is actually at $8000
    console.assert(prgRom[0x00] === test.code[0], "Test byte not at $8000");

    // Snapshots
    const flagsBefore = { ...CPUregisters.P };
    const cpuBefore   = { A: CPUregisters.A, X: CPUregisters.X, Y: CPUregisters.Y, S: CPUregisters.S };
    const pcBefore    = CPUregisters.PC;
    const cyclesBefore= cpuCycles;

    // Execute one instruction
    step();

    // After
    const flagsAfter  = { ...CPUregisters.P };
    const cpuAfter    = { A: CPUregisters.A, X: CPUregisters.X, Y: CPUregisters.Y, S: CPUregisters.S };
    const pcAfter     = CPUregisters.PC;
    const cyclesAfter = cpuCycles;

    const cyclesUsed = cyclesAfter - cyclesBefore;
    const expectedCycles = test.expectedCycles || 0;

    // Expected PC:
    // BRK is special: PC behaves as if the opcode had a 2-byte length for the pushed return address.
    // For all others, expect + code.length (opcode + operands).
    let expectedPC;
    if (test.code[0] === 0x00) {
      expectedPC = pcBefore + 2;
    } else {
      expectedPC = pcBefore + test.code.length;
    }

    // Assertions
    let pass = true;
    const reasons = [];

    if (test.expect) {
      if (test.expect.S != null && cpuAfter.S !== test.expect.S) {
        pass = false;
        reasons.push(`S=${cpuAfter.S}≠${test.expect.S}`);
      }
      if (test.expect.P) {
        for (const flag of ["C", "Z", "I", "D", "B", "V", "N"]) {
          if (test.expect.P[flag] != null && flagsAfter[flag] !== test.expect.P[flag]) {
            pass = false;
            reasons.push(`P.${flag}=${flagsAfter[flag]}≠${test.expect.P[flag]}`);
          }
        }
      }
    }

    if (pcAfter !== expectedPC) {
      pass = false;
      reasons.push(`PC=0x${pcAfter.toString(16)}≠0x${expectedPC.toString(16)}`);
    }

    if (cyclesUsed !== expectedCycles) {
      pass = false;
      reasons.push(`cycles=${cyclesUsed}≠${expectedCycles}`);
    }

    const opcodeHex = test.code.map(b => b.toString(16).padStart(2, "0")).join(" ");
    const flagsStr = f => [f.N?"N":".",f.V?"V":".",f.B?"B":".",f.D?"D":".",f.I?"I":".",f.Z?"Z":".",f.C?"C":"."].join("");

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td>${test.name}</td>
        <td>${opcodeHex}</td>
        <td>${flagsStr(flagsBefore)}</td>
        <td>${flagsStr(flagsAfter)}</td>
        <td>A=${cpuBefore.A} X=${cpuBefore.X} Y=${cpuBefore.Y} S=${cpuBefore.S}</td>
        <td>A=${cpuAfter.A}  X=${cpuAfter.X}  Y=${cpuAfter.Y}  S=${cpuAfter.S}</td>
        <td>0x${pcBefore.toString(16)}</td>
        <td>0x${pcAfter.toString(16)}</td>
        <td>${cyclesUsed}</td>
        <td>${expectedCycles}</td>
        <td>${pass ? "✓" : `<details style="color:#ff4444"><summary>❌ Details</summary><ul>${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`}</td>
      </tr>`;
  }

  html += "</tbody></table>";
  document.body.insertAdjacentHTML("beforeend", html);

  // Restore ROM byte that triggers your suite, if you need it afterward.
  CPUregisters.PC = 0x8000;
  prgRom[0] = 0x02;
  CPUregisters.PC = 0x8000;
}

// --- Helpers ---
function deepCloneCPU(cpu) {
  return {
    A: cpu.A,
    X: cpu.X,
    Y: cpu.Y,
    S: cpu.S,
    PC: cpu.PC,
    P: {...cpu.P}
  };
}
function deepClonePPU(ppu) { return {...ppu}; }
function deepCloneAPU(apu) { return {...apu}; }
function deepCloneJoypad(jp) { return {...jp}; }

function flagsBin(f) {
  return [
    f.N ? "N" : ".", f.V ? "V" : ".", f.B ? "B" : ".", f.D ? "D" : ".",
    f.I ? "I" : ".", f.Z ? "Z" : ".", f.C ? "C" : "."
  ].join('');
}
function regionLabel(addr) {
  if (addr >= 0x0000 && addr <= 0x1FFF) return null; // RAM
  if (addr >= 0x2000 && addr <= 0x3FFF) return 'PPU';
  if (addr >= 0x4000 && addr <= 0x4013) return 'APU';
  if (addr === 0x4014) return 'PPU OAMDMA';
  if (addr === 0x4015) return 'APU Status';
  if (addr === 0x4016) return 'JOY1';
  if (addr === 0x4017) return 'JOY2/APU Frame';
  if (addr >= 0x4018 && addr <= 0x401F) return 'Test/IO';
  if (addr >= 0x4020 && addr <= 0x5FFF) return 'Expansion';
  if (addr >= 0x6000 && addr <= 0x7FFF) return 'SRAM';
  if (addr >= 0x8000 && addr <= 0xFFFF) return 'PRG ROM';
  return null;
}

function runUnofficialOpcodeTests() {
  
  const tests = [
  // LAX: load into A & X (IMM)
  { name:"LAX #$33 (IMM)", code:[0xAB,0x33], expect:{A:0x33,X:0x33,Z:0,N:0}, expectCycles: baseCycles.immediate },

  // ZP
  { name:"LAX $10 (ZP)", code:[0xA7,0x10], setup:()=>{checkWriteOffset(0x10, 0x44);}, expect:{A:0x44,X:0x44,Z:0,N:0}, expectCycles: baseCycles.zeroPage },

  // ZP,Y
  { name:"LAX $10,Y (ZP,Y)", code:[0xB7,0x0F], pre:{Y:0x01}, setup:()=>{checkWriteOffset(0x10, 0x00);}, expect:{A:0x00,X:0x00,Z:1,N:0}, expectCycles: baseCycles.zeroPageY },

  // ABS
  {
  name:"LAX $1234,Y (ABS,Y)",
  code:[0xBF,0x33,0x12],
  pre:{Y:0x01},
  setup:()=>{checkWriteOffset(0x1235, 0x00);},
  expect:{A:0x00, X:0x00, Z:1, N:0},
  expectCycles: baseCycles.absoluteY
},


  // ABS,Y
  { name:"LAX $1234,Y (ABS,Y)", code:[0xBF,0x33,0x12], pre:{Y:0x01}, setup:()=>{checkWriteOffset(0x1235, 0x00);}, expect:{A:0x00,X:0x00,Z:1,N:0}, expectCycles: baseCycles.absoluteY },

  // IND,X ($0012 = base)
  {
    name: "LAX ($10,X) (IND,X) [CPU RAM $0012]",
    code: [0xA3, 0x0F],
    pre: { X: 0x01 },
    setup: () => {
      checkWriteOffset(0x10, 0x12);
      checkWriteOffset(0x11, 0x00);
      checkWriteOffset(0x0012, 0x77);
    },
    expect: { A: 0x77, X: 0x77, Z: 0, N: 0 },
    expectCycles: baseCycles.indirectX,
    expectMem: { addr: 0x0012, value: 0x77 }
  },

  // IND,X ($0812)
  {
    name: "LAX ($10,X) (IND,X) [CPU RAM $0812]",
    code: [0xA3, 0x0F],
    pre: { X: 0x01 },
    setup: () => {
      checkWriteOffset(0x10, 0x12);
      checkWriteOffset(0x11, 0x08);
      checkWriteOffset(0x0812, 0x55);
    },
    expect: { A: 0x55, X: 0x55, Z: 0, N: 0 },
    expectCycles: baseCycles.indirectX,
    expectMem: { addr: 0x0812, value: 0x55 }
  },

  // IND,X ($1012)
  {
    name: "LAX ($10,X) (IND,X) [CPU RAM $1012]",
    code: [0xA3, 0x0F],
    pre: { X: 0x01 },
    setup: () => {
      checkWriteOffset(0x10, 0x12);
      checkWriteOffset(0x11, 0x10);
      checkWriteOffset(0x1012, 0x33);
    },
    expect: { A: 0x33, X: 0x33, Z: 0, N: 0 },
    expectCycles: baseCycles.indirectX,
    expectMem: { addr: 0x1012, value: 0x33 }
  },

  // IND,X ($1812)
  {
    name: "LAX ($10,X) (IND,X) [CPU RAM $1812]",
    code: [0xA3, 0x0F],
    pre: { X: 0x01 },
    setup: () => {
      checkWriteOffset(0x10, 0x12);
      checkWriteOffset(0x11, 0x18);
      checkWriteOffset(0x1812, 0x11);
    },
    expect: { A: 0x11, X: 0x11, Z: 0, N: 0 },
    expectCycles: baseCycles.indirectX,
    expectMem: { addr: 0x1812, value: 0x11 }
  },

{
  name: "LAX ($20),Y (IND,Y) [RAM safe]",
  code: [0xB3, 0x20],
  pre: { Y: 0x02 },
  setup: () => {
    checkWriteOffset(0x20, 0x00);      // pointer low byte
    checkWriteOffset(0x21, 0x00);      // pointer high byte: points to $0000
    checkWriteOffset(0x0002, 0x88);    // $0000 + Y = $0002
  },
  expect: { A: 0x88, X: 0x88, Z: 0, N: 1 },
  expectCycles: baseCycles.indirectY,
  expectMem: { addr: 0x0002, value: 0x88 }
},


  // IND,Y, $9015
  {
    name: "LAX ($30),Y (IND,Y)",
    code: [0xB3, 0x30],
    pre: { Y: 0x05 },
    setup: () => {
      checkWriteOffset(0x30, 0x10);
      checkWriteOffset(0x31, 0x90);
      checkWriteOffset(0x9015, 0xAB);
    },
    expect: { A: 0xAB, X: 0xAB, Z: 0, N: 1 },
    expectCycles: baseCycles.indirectY,
    expectMem: { addr: 0x9015, value: 0xAB }
  },

  // SAX: store A & X AND memory - ZP
  { name:"SAX $20 (ZP)", code:[0x87,0x20], pre:{A:0x55,X:0x55}, expectMem:{addr:0x20,value:0x55}, expectCycles: baseCycles.zeroPage },

  // SAX: ZP,Y
  { name:"SAX $20,Y (ZP,Y)", code:[0x97,0x1F], pre:{A:0xAA,X:0xAA,Y:0x01}, expectMem:{addr:0x20,value:0xAA}, expectCycles: baseCycles.zeroPageY },

  // SAX: ABS
  { name:"SAX $1234 (ABS)", code:[0x8F,0x34,0x12], pre:{A:0x77,X:0x77}, expectMem:{addr:0x1234,value:0x77}, expectCycles: baseCycles.absolute },

  // IND,X $0012
  {
    name: "SAX ($10,X) (IND,X) [CPU RAM $0012]",
    code: [0x83, 0x0F],
    pre: { A: 0x99, X: 0x01 },
    setup: () => {
      checkWriteOffset(0x10, 0x12);
      checkWriteOffset(0x11, 0x00);
      checkWriteOffset(0x12, 0x00);
    },
    expectMem: { addr: 0x0012, value: 0x01 },
    expectCycles: baseCycles.indirectX,
  },

  // DCP: ZP
  { name:"DCP $30 (ZP)", code:[0xC7,0x30], pre:{A:0x06}, setup:()=>{checkWriteOffset(0x30, 0x07);},
    expectMem:{addr:0x30,value:0x06}, expect:{C:1,Z:1,N:0}, expectCycles: baseCycles.zeroPage },

  // DCP: ZP,X
  { name:"DCP $30,X (ZP,X)", code:[0xD7,0x2F], pre:{A:0x05,X:0x01}, setup:()=>{checkWriteOffset(0x30, 0x05);},
    expectMem:{addr:0x30,value:0x04}, expect:{C:1,Z:0,N:0}, expectCycles: baseCycles.zeroPageX },

  // DCP: ABS
  { name:"DCP $1234 (ABS)", code:[0xCF,0x34,0x12], pre:{A:0x10}, setup:()=>{checkWriteOffset(0x1234, 0x11);},
    expectMem:{addr:0x1234,value:0x10}, expect:{C:1,Z:1,N:0}, expectCycles: baseCycles.absolute },

  // ISC: ZP
  { name:"ISC $40 (ZP)", code:[0xE7,0x40], pre:{A:0x10,P:{C:1}}, setup:()=>{checkWriteOffset(0x40, 0x0F);},
    expectMem:{addr:0x40,value:0x10}, expect:{A:0x00,C:1,Z:1,N:0}, expectCycles: baseCycles.zeroPage },

  // SLO: ZP
  { name:"SLO $50 (ZP)", code:[0x07,0x50], pre:{A:0x01,P:{C:0}}, setup:()=>{checkWriteOffset(0x50, 0x02);},
    expectMem:{addr:0x50,value:0x04}, expect:{A:0x05,C:0,Z:0,N:0}, expectCycles: baseCycles.zeroPage },

  // RLA: ZP
  { name:"RLA $60 (ZP)", code:[0x27,0x60], pre:{A:0xF0,P:{C:1}}, setup:()=>{checkWriteOffset(0x60, 0x10);},
    expectMem:{addr:0x60,value:0x21}, expect:{A:0x20,C:0,Z:0,N:0}, expectCycles: baseCycles.zeroPage },

  // SRE: ZP
  { name:"SRE $70 (ZP)", code:[0x47,0x70], pre:{A:0xFF,P:{C:0}}, setup:()=>{checkWriteOffset(0x70, 0x02);},
    expectMem:{addr:0x70,value:0x01}, expect:{A:0xFE,C:0,Z:0,N:1}, expectCycles: baseCycles.zeroPage },

  // RRA: ZP
{
  name: "RRA $80 (ZP)",
  code: [0x67, 0x80],
  pre: { A: 0x05, X: 0x01, Y: 0x01, P: { C: 1, Z: 0, I: 0, D: 0, B: 0, U: 1, V: 0, N: 1 } },
  setup: () => { checkWriteOffset(0x80, 0x01); },
  expect: { A: 0x86, C: 0, Z: 0, N: 1, V: 0 },
  expectMem: { addr: 0x80, value: 0x80 },
  expectCycles: 3
},



  // ANC: IMM
{
  name: "ANC #$80",
  code: [0x0B, 0x80],
  pre: { A: 0x80 },
  expect: { A: 0x80, C: 1, Z: 0, N: 1 },
  expectCycles: baseCycles.immediate
},


  // ALR: IMM
  {
  name: "ALR #$03",
  code: [0x4B, 0x03],
  pre: { A: 0x07 },
  expect: { A: 0x01, C: 1, Z: 0, N: 0 },
  expectCycles: baseCycles.immediate
},


  // ARR: IMM
  {
  name: "ARR #$01",
  code: [0x6B, 0x01],
  pre: { A: 0x81, P: { C: 0 } },
  expect: { A: 0x00, C: 1, Z: 1, N: 0 },
  expectCycles: 2
},


  // AXA: ABS,Y
{
  name: "AXA $0200,Y (ABS,Y)",
  code: [0x9F, 0x00, 0x02],
  pre: { A: 0xFF, X: 0x0F, Y: 0x00 },
  expectMem: { addr: 0x0200, value: 0x03 },
  expectCycles: 4
},



  // XAA: IMM
  { name:"XAA #$0F", code:[0x8B,0x0F], pre:{A:0xFF,X:0x0F}, expect:{A:0x0F,Z:0,N:0}, expectCycles: baseCycles.immediate },

  // SBX/AXS (IMM)
  { name: "SBX #$10 (IMM)", code: [0xCB, 0x10], pre: {A: 0x22, X: 0x33},
    expect: {X: 0x12, Z: 0, N: 0}, expectCycles: baseCycles.immediate },

  // TAS/SHS (ABS,Y)
  { name: "TAS $1234,Y (ABS,Y)", code: [0x9B, 0x34, 0x12], pre: {A: 0xAA, X: 0xBB, Y: 0x01},
    expect: {S: 0xAA & 0xBB},
    expectMem: { addr: 0x1235, value: (0xAA & 0xBB) & (((0x12 + ((0x34 + 1) >> 8)) & 0xFF)) },
    expectCycles: baseCycles.absoluteY },

  // SHY (ABS,X)
{
  name: "SHY $1234,X (ABS,X)",
  code: [0x9C, 0x34, 0x12],
  pre: { A: 0xAA, X: 0x01, Y: 0x77 },
  expectMem: { addr: 0x1235, value: 0x13 },
  expectCycles: 4
},


  // SHX (ABS,Y)
{
  name: "SHX $1234,Y (ABS,Y)",
  code: [0x9E, 0x34, 0x12],
  pre: { X: 0x99, Y: 0x01 },
  expectMem: { addr: 0x1235, value: 0x11 },
  expectCycles: baseCycles.absoluteY
}


    
];

function fmtExpect(expect, expectMem, expectCycles) {
  let lines = [];
  if (expect) {
    let regs = [];
    let flags = [];
    for (const reg of ["A", "X", "Y", "S"])
      if (expect[reg] !== undefined)
        regs.push(`${reg}=${expect[reg].toString(16).toUpperCase()}`);
    for (const flg of ["C", "Z", "I", "D", "B", "U", "V", "N"])
      if (expect[flg] !== undefined)
        flags.push(`${flg}=${expect[flg]}`);
    if (regs.length) lines.push(regs.join(' '));
    if (flags.length) lines.push(flags.join(' '));
  }
  if (expectMem)
    lines.push(`Mem[$${expectMem.addr.toString(16).toUpperCase()}]=${expectMem.value.toString(16).toUpperCase()}`);
  if (expectCycles !== undefined)
    lines.push(`Cycles=${expectCycles}`);
  return lines.join('<br>');
}


  function fmtCPU(cpu) {
    // Use your structure: cpu.A, cpu.X, cpu.Y, cpu.S, cpu.PC, cpu.P.C etc.
    return `
      <span style="color:#FFD700;font-weight:bold;">
        A=${cpu.A.toString(16).padStart(2, '0').toUpperCase()} 
        X=${cpu.X.toString(16).padStart(2, '0').toUpperCase()} 
        Y=${cpu.Y.toString(16).padStart(2, '0').toUpperCase()} 
        S=${cpu.S.toString(16).padStart(2, '0').toUpperCase()} 
        PC=${cpu.PC.toString(16).padStart(4, '0').toUpperCase()}
      </span>
      <br>
      <span style="color:#00d7ff;">
        C=${cpu.P.C} Z=${cpu.P.Z} I=${cpu.P.I} D=${cpu.P.D} B=${cpu.P.B} U=${cpu.P.U} V=${cpu.P.V} N=${cpu.P.N}
      </span>`;
  }

  function fmtMem(addr, before, after) {
    if (addr === undefined) return '';
    return `<span style="color:#FFD700;">Mem[$${addr.toString(16).toUpperCase().padStart(4,"0")}]</span>
      <span style="color:#aaa;">${before !== undefined ? 'before: 0x'+before.toString(16).toUpperCase().padStart(2,"0") : ''}
      ${after !== undefined ? ', after: 0x'+after.toString(16).toUpperCase().padStart(2,"0") : ''}</span>`;
  }

  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
      ILLEGAL/UNOFFICIAL OPCODES
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead><tr style="background:#222">
        <th>Test</th>
        <th>Op</th>
        <th>Expected</th>
        <th>Before</th>
        <th>After</th>
        <th>Cycles<br>(exp/act)</th>
        <th>Status</th>
        <th>Why/Details</th>
      </tr></thead><tbody>`;

  tests.forEach(test => {
    if (test.setup) test.setup();
    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A;
      if (test.pre.X != null) CPUregisters.X = test.pre.X;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y;
      if (test.pre.S != null) CPUregisters.S = test.pre.S;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }
    for (let i = 0; i < 3; i++) checkWriteOffset(0x8000 + i, 0);
    for (let i = 0; i < test.code.length; i++) checkWriteOffset(0x8000 + i, test.code[i]);
    CPUregisters.PC = 0x8000;

    // --- Snap before
    const cpuBefore = JSON.parse(JSON.stringify(CPUregisters));
    const memBefore = test.expectMem ? checkReadOffset(test.expectMem.addr) : undefined;
    const cyclesBefore = cpuCycles;

    step();

    // --- Snap after
    const cpuAfter = JSON.parse(JSON.stringify(CPUregisters));
    const memAfter = test.expectMem ? checkReadOffset(test.expectMem.addr) : undefined;
    const cyclesAfter = cpuCycles;

    const deltaCycles = cyclesAfter - cyclesBefore;
    let pass = true, reasons = [];

    if (test.expect) {
      for (const reg of ["A","X","Y","S"]) {
        if (test.expect[reg] !== undefined && cpuAfter[reg] !== test.expect[reg]) {
          reasons.push(`<b>${reg}=${cpuAfter[reg].toString(16).toUpperCase()}≠${test.expect[reg].toString(16).toUpperCase()}</b>`);
          pass = false;
        }
      }
      for (const flg of ["C","Z","I","D","B","U","V","N"]) {
        if (test.expect[flg] !== undefined && cpuAfter.P[flg] !== test.expect[flg]) {
          reasons.push(`<b>${flg}=${cpuAfter.P[flg]}≠${test.expect[flg]}</b>`);
          pass = false;
        }
      }
    }
    if (test.expectMem && memAfter !== test.expectMem.value) {
      reasons.push(`<b>$${test.expectMem.addr.toString(16).toUpperCase()}=${memAfter.toString(16).toUpperCase()}≠${test.expectMem.value.toString(16).toUpperCase()}</b>`);
      pass = false;
    }
    if (test.expectCycles !== undefined && deltaCycles !== test.expectCycles) {
      reasons.push(`<b>cycles=${deltaCycles}≠${test.expectCycles}</b>`);
      pass = false;
    }

    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<span style="color:#ff4444;font-weight:bold;">❌</span>`;

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${fmtExpect(test.expect, test.expectMem, test.expectCycles)}</td>
        <td style="border:1px solid #444;padding:6px;">
          ${fmtCPU(cpuBefore)}
          ${test.expectMem ? '<br>'+fmtMem(test.expectMem.addr, memBefore) : ''}
          <br><span style="color:#aaa;">Cycles=${cyclesBefore}</span>
        </td>
        <td style="border:1px solid #444;padding:6px;">
          ${fmtCPU(cpuAfter)}
          ${test.expectMem ? '<br>'+fmtMem(test.expectMem.addr, memAfter) : ''}
          <br><span style="color:#aaa;">Cycles=${cyclesAfter}</span>
        </td>
        <td style="border:1px solid #444;padding:6px;">${test.expectCycles !== undefined ? test.expectCycles : "-"} / ${deltaCycles}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
        <td style="border:1px solid #444;padding:6px;">${reasons.join('<br>')}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);

CPUregisters.PC = 0x8000;    
prgRom[CPUregisters.PC - 0x8000] = 0x02;
}


function runPageCrossAndQuirksTests() {
  // ========= 6502 PAGE CROSS & CYCLE QUIRK SUITE =========

  // Helper labelers
  const cross   = (desc, test) => Object.assign(test, { desc, cross: true  });
  const nocross = (desc, test) => Object.assign(test, { desc, cross: false });

  // Helper: [mnemonic, addressing] for each case
  const testLookup = {
    "LDA $12FF,X cross":      ["LDA", "absoluteX"],
    "LDA $1200,X no cross":   ["LDA", "absoluteX"],
    "LDA $12FF,Y cross":      ["LDA", "absoluteY"],
    "LDA $1200,Y no cross":   ["LDA", "absoluteY"],
    "LDX $12FF,Y cross":      ["LDX", "absoluteY"],
    "LDX $1200,Y no cross":   ["LDX", "absoluteY"],
    "LDY $12FF,X cross":      ["LDY", "absoluteX"],
    "LDY $1200,X no cross":   ["LDY", "absoluteX"],
    "LAX $12FF,Y cross":      ["LAX", "absoluteY"],
    "LAX $1200,Y no cross":   ["LAX", "absoluteY"],
    "LAS $12FF,Y cross":      ["LAS", "absoluteY"],
    "LAS $1200,Y no cross":   ["LAS", "absoluteY"],
    "LDA ($10),Y cross":      ["LDA", "indirectY"],
    "LDA ($20),Y no cross":   ["LDA", "indirectY"],
    "ASL $12FF,X cross (RMW always +1)": ["ASL", "absoluteX"],
    "ASL $1200,X no cross (RMW always +1)": ["ASL", "absoluteX"],
    "INC $12FF,X cross (RMW always +1)": ["INC", "absoluteX"],
    "DEC $1200,X no cross (RMW always +1)": ["DEC", "absoluteX"],
    "STA $12FF,X cross (NO +1, store quirk)": ["STA", "absoluteX"],
    "STA ($10),Y cross (NO +1, store quirk)": ["STA", "indirectY"],
    "BNE branch taken, cross": ["BNE", "relative"],
    "BNE branch taken, no cross": ["BNE", "relative"],
    "BNE not taken": ["BNE", "relative"],
    "JMP ($02FF) indirect, page wrap": ["JMP", "indirect"],
    "NOP $12FF,X cross (illegal)": ["NOP", "absoluteX"],
    "NOP $1200,X no cross (illegal)": ["NOP", "absoluteX"],
    "SLO $12FF,X cross (RMW always +1)": ["SLO", "absoluteX"],
    "SLO $1200,X no cross (RMW always +1)": ["SLO", "absoluteX"],
  };

  function getBaseCycles(testDesc) {
    const lookup = testLookup[testDesc];
    if (!lookup) throw new Error(`No testLookup mapping for "${testDesc}"`);
    const [mnemonic, addressing] = lookup;
    return opcodes[mnemonic][addressing].cycles; // total cycles for this opcode+mode
  }

  // --- DMA-safe test memory init: avoid $4000-$401F (OAM DMA at $4014) ---
  function clearForTest() {
    // WRAM ($0000–$1FFF) mirrors
    for (let a = 0x0000; a <= 0x1FFF; a++) checkWriteOffset(a, 0);
    // PRG-RAM ($6000–$7FFF) if present
    if (typeof prgRam !== "undefined" && prgRam) {
      for (let a = 0x6000; a <= 0x7FFF; a++) checkWriteOffset(a, 0);
    }
    // Leave PPU/APU/IO ($2000–$5FFF and $4000–$401F) alone to avoid side-effects.
    // PRG-ROM is injected via writeCodeToROM below.
  }

  // --- Write bytes into PRG-ROM window ($8000–) without bus side-effects ---
  function writeCodeToROM(cpuAddr, bytes) {
    for (let i = 0; i < bytes.length; i++) {
      const a = (cpuAddr + i) & 0xFFFF;
      if (a < 0x8000) {
        // If ever testing code < $8000, fall back to bus write
        checkWriteOffset(a, bytes[i] & 0xFF);
      } else {
        // Mapper 0 assumptions; adjust if you have a mapper layer
        prgRom[(a - 0x8000) & (prgRom.length - 1)] = bytes[i] & 0xFF;
      }
    }
  }

  // --- TRUE page crossing logic (pure, no side-effects) ---
  function didPageCross(test) {
    if (!test.code || test.code.length === 0) return false;

    // Branches (relative)
    if (test.opcodeFn && test.opcodeFn.endsWith("_REL")) {
      const offset = test.code[1] & 0xFF;
      const signed = offset < 0x80 ? offset : offset - 0x100;
      const base = (((test.pre?.PC) ?? 0x8000) + 2) & 0xFFFF;

      // Taken?
      const P = test.pre?.P ?? {};
      const taken =
        (/BNE/.test(test.opcodeFn) && (P.Z === 0)) ||
        (/BEQ/.test(test.opcodeFn) && (P.Z === 1)) ||
        (/BCC/.test(test.opcodeFn) && (P.C === 0)) ||
        (/BCS/.test(test.opcodeFn) && (P.C === 1)) ||
        (/BPL/.test(test.opcodeFn) && (P.N === 0)) ||
        (/BMI/.test(test.opcodeFn) && (P.N === 1)) ||
        (/BVC/.test(test.opcodeFn) && (P.V === 0)) ||
        (/BVS/.test(test.opcodeFn) && (P.V === 1));

      if (!taken) return false;

      const dest = (base + signed) & 0xFFFF;
      return (base & 0xFF00) !== (dest & 0xFF00);
    }

    // Absolute,X / Absolute,Y
    if (test.opcodeFn && /(ABSX|ABSY)/.test(test.opcodeFn)) {
      const base = (test.code[1] | (test.code[2] << 8)) & 0xFFFF;
      const index = /ABSX/.test(test.opcodeFn)
        ? (test.pre?.X ?? 0)
        : (test.pre?.Y ?? 0);
      const eff = (base + (index & 0xFF)) & 0xFFFF;
      return (base & 0xFF00) !== (eff & 0xFF00);
    }

    // Indirect,Y
    if (test.opcodeFn && /INDY/.test(test.opcodeFn)) {
      const zp = test.code[1] & 0xFF;
      // Read ZP pointer bytes without calling test.setup() again
      const low  = checkReadOffset(zp) & 0xFF;
      const high = checkReadOffset((zp + 1) & 0xFF) & 0xFF;
      const ptr  = (high << 8) | low;
      const y    = test.pre?.Y ?? 0;
      const eff  = (ptr + (y & 0xFF)) & 0xFFFF;
      return (ptr & 0xFF00) !== (eff & 0xFF00);
    }

    return false; // Not a page-crossing addressing mode
  }

  // ---- TEST CASES ----
  const cases = [
    cross("LDA $12FF,X cross",    {code:[0xBD,0xFF,0x12], opcodeFn:"LDA_ABSX", pre:{X:1}, setup:()=>{checkWriteOffset(0x1300, 0x55);}, expect:{A:0x55}, baseCycles:getBaseCycles("LDA $12FF,X cross"), extra:1}),
    nocross("LDA $1200,X no cross",{code:[0xBD,0x00,0x12], opcodeFn:"LDA_ABSX", pre:{X:0}, setup:()=>{checkWriteOffset(0x1200, 0x66);}, expect:{A:0x66}, baseCycles:getBaseCycles("LDA $1200,X no cross"), extra:0}),
    cross("LDA $12FF,Y cross",    {code:[0xB9,0xFF,0x12], opcodeFn:"LDA_ABSY", pre:{Y:1}, setup:()=>{checkWriteOffset(0x1300, 0x77);}, expect:{A:0x77}, baseCycles:getBaseCycles("LDA $12FF,Y cross"), extra:1}),
    nocross("LDA $1200,Y no cross",{code:[0xB9,0x00,0x12], opcodeFn:"LDA_ABSY", pre:{Y:0}, setup:()=>{checkWriteOffset(0x1200, 0x88);}, expect:{A:0x88}, baseCycles:getBaseCycles("LDA $1200,Y no cross"), extra:0}),
    cross("LDX $12FF,Y cross",    {code:[0xBE,0xFF,0x12], opcodeFn:"LDX_ABSY", pre:{Y:1}, setup:()=>{checkWriteOffset(0x1300, 0x99);}, expect:{X:0x99}, baseCycles:getBaseCycles("LDX $12FF,Y cross"), extra:1}),
    nocross("LDX $1200,Y no cross",{code:[0xBE,0x00,0x12], opcodeFn:"LDX_ABSY", pre:{Y:0}, setup:()=>{checkWriteOffset(0x1200, 0x77);}, expect:{X:0x77}, baseCycles:getBaseCycles("LDX $1200,Y no cross"), extra:0}),
    cross("LDY $12FF,X cross",    {code:[0xBC,0xFF,0x12], opcodeFn:"LDY_ABSX", pre:{X:1}, setup:()=>{checkWriteOffset(0x1300, 0xAB);}, expect:{Y:0xAB}, baseCycles:getBaseCycles("LDY $12FF,X cross"), extra:1}),
    nocross("LDY $1200,X no cross",{code:[0xBC,0x00,0x12], opcodeFn:"LDY_ABSX", pre:{X:0}, setup:()=>{checkWriteOffset(0x1200, 0xAC);}, expect:{Y:0xAC}, baseCycles:getBaseCycles("LDY $1200,X no cross"), extra:0}),
    cross("LAX $12FF,Y cross",    {code:[0xBF,0xFF,0x12], opcodeFn:"LAX_ABSY", pre:{Y:1}, setup:()=>{checkWriteOffset(0x1300, 0x56);}, expect:{A:0x56,X:0x56}, baseCycles:getBaseCycles("LAX $12FF,Y cross"), extra:1}),
    nocross("LAX $1200,Y no cross",{code:[0xBF,0x00,0x12], opcodeFn:"LAX_ABSY", pre:{Y:0}, setup:()=>{checkWriteOffset(0x1200, 0x57);}, expect:{A:0x57,X:0x57}, baseCycles:getBaseCycles("LAX $1200,Y no cross"), extra:0}),
    cross("LAS $12FF,Y cross",    {code:[0xBB,0xFF,0x12], opcodeFn:"LAS_ABSY", pre:{Y:1}, setup:()=>{checkWriteOffset(0x1300, 0xF0);}, expect:{A:0xF0,X:0xF0,S:0xF0}, baseCycles:getBaseCycles("LAS $12FF,Y cross"), extra:0}),
    nocross("LAS $1200,Y no cross",{code:[0xBB,0x00,0x12], opcodeFn:"LAS_ABSY", pre:{Y:0}, setup:()=>{checkWriteOffset(0x1200, 0xE0);}, expect:{A:0xE0,X:0xE0,S:0xE0}, baseCycles:getBaseCycles("LAS $1200,Y no cross"), extra:0}),
    cross("LDA ($10),Y cross",    {code:[0xB1,0x10], opcodeFn:"LDA_INDY", pre:{Y:1}, setup:()=>{checkWriteOffset(0x10, 0xFF);checkWriteOffset(0x11, 0x12);checkWriteOffset(0x1300, 0x44);}, expect:{A:0x44}, baseCycles:getBaseCycles("LDA ($10),Y cross"), extra:1}),
    nocross("LDA ($20),Y no cross",{code:[0xB1,0x20], opcodeFn:"LDA_INDY", pre:{Y:0}, setup:()=>{checkWriteOffset(0x20, 0x00);checkWriteOffset(0x21, 0x14);checkWriteOffset(0x1400, 0x33);}, expect:{A:0x33}, baseCycles:getBaseCycles("LDA ($20),Y no cross"), extra:0}),
    cross("ASL $12FF,X cross (RMW always +1)",{code:[0x1E,0xFF,0x12], opcodeFn:"ASL_ABSX", pre:{X:1}, setup:()=>{checkWriteOffset(0x1300, 0x80);}, expectMem:{addr:0x1300,value:0x00}, baseCycles:getBaseCycles("ASL $12FF,X cross (RMW always +1)"), extra:3}),
    nocross("ASL $1200,X no cross (RMW always +1)",{code:[0x1E,0x00,0x12], opcodeFn:"ASL_ABSX", pre:{X:0}, setup:()=>{checkWriteOffset(0x1200, 0x81);}, expectMem:{addr:0x1200,value:0x02}, baseCycles:getBaseCycles("ASL $1200,X no cross (RMW always +1)"), extra:3}),
    cross("INC $12FF,X cross (RMW always +1)",{code:[0xFE,0xFF,0x12], opcodeFn:"INC_ABSX", pre:{X:1}, setup:()=>{checkWriteOffset(0x1300, 0x04);}, expectMem:{addr:0x1300,value:0x05}, baseCycles:getBaseCycles("INC $12FF,X cross (RMW always +1)"), extra:3}),
    nocross("DEC $1200,X no cross (RMW always +1)",{code:[0xDE,0x00,0x12], opcodeFn:"DEC_ABSX", pre:{X:0}, setup:()=>{checkWriteOffset(0x1200, 0x01);}, expectMem:{addr:0x1200,value:0x00}, baseCycles:getBaseCycles("DEC $1200,X no cross (RMW always +1)"), extra:3}),
    cross("STA $12FF,X cross (NO +1, store quirk)",{code:[0x9D,0xFF,0x12], opcodeFn:"STA_ABSX", pre:{A:0xAB,X:1}, expectMem:{addr:0x1300,value:0xAB}, baseCycles:getBaseCycles("STA $12FF,X cross (NO +1, store quirk)"), extra:0}),
    cross("STA ($10),Y cross (NO +1, store quirk)",{code:[0x91,0x10], opcodeFn:"STA_INDY", pre:{A:0xBA,Y:1}, setup:()=>{checkWriteOffset(0x10, 0xFF);checkWriteOffset(0x11, 0x12);}, expectMem:{addr:0x1300,value:0xBA}, baseCycles:getBaseCycles("STA ($10),Y cross (NO +1, store quirk)"), extra:0}),
    cross("BNE branch taken, cross", { code: [0xD0, 0x03], opcodeFn: "BNE_REL", pre: { P: { Z: 0 }, PC: 0x80FD }, setup: ()=>{}, expectPC: 0x8102, baseCycles: getBaseCycles("BNE branch taken, cross"), extra: 2 }),
    nocross("BNE branch taken, no cross", { code: [0xD0, 0x02], opcodeFn: "BNE_REL", pre: { P: { Z: 0 }, PC: 0x8000 }, setup: ()=>{}, expectPC: 0x8004, baseCycles: getBaseCycles("BNE branch taken, no cross"), extra: 1 }),
    nocross("BNE not taken", { code: [0xD0, 0x02], opcodeFn: "BNE_REL", pre: { P: { Z: 1 }, PC: 0x8000 }, setup: ()=>{}, expectPC: 0x8002, baseCycles: getBaseCycles("BNE not taken"), extra: 0 }),
    cross("JMP ($02FF) indirect, page wrap",{code:[0x6C,0xFF,0x02], opcodeFn:"JMP_IND", setup:()=>{checkWriteOffset(0x02FF, 0x00);checkWriteOffset(0x0200, 0x80);}, expectPC:0x8000, baseCycles:getBaseCycles("JMP ($02FF) indirect, page wrap"), extra:0}),
    cross("NOP $12FF,X cross (illegal)",{code:[0x3C,0xFF,0x12], opcodeFn:"NOP_ABSX", pre:{X:1}, baseCycles:getBaseCycles("NOP $12FF,X cross (illegal)"), extra:1}),
    nocross("NOP $1200,X no cross (illegal)",{code:[0x3C,0x00,0x12], opcodeFn:"NOP_ABSX", pre:{X:0}, baseCycles:getBaseCycles("NOP $1200,X no cross (illegal)"), extra:0}),
    cross("SLO $12FF,X cross (RMW always +1)",{code:[0x1F,0xFF,0x12], opcodeFn:"SLO_ABSX", pre:{X:1}, setup:()=>{checkWriteOffset(0x1300, 0x01);}, expectMem:{addr:0x1300,value:0x02}, baseCycles:getBaseCycles("SLO $12FF,X cross (RMW always +1)"), extra:3}),
    nocross("SLO $1200,X no cross (RMW always +1)",{code:[0x1F,0x00,0x12], opcodeFn:"SLO_ABSX", pre:{X:0}, setup:()=>{checkWriteOffset(0x1200, 0x01);}, expectMem:{addr:0x1200,value:0x02}, baseCycles:getBaseCycles("SLO $1200,X no cross (RMW always +1)"), extra:3}),
  ];

  let html = `
    <div style="background:darkblue;color:white;padding:7px 6px 7px 6px;font-weight:bold;">
      6502 PAGE CROSSING & CYCLE QUIRKS TEST SUITE
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead>
      <tr style="background:#223366;">
        <th>Test</th>
        <th>Op</th>
        <th>Opcode Fn</th>
        <th>Flags<br>Before</th>
        <th>Flags<br>After</th>
        <th>CPU<br>Before</th>
        <th>CPU<br>After</th>
        <th>PC<br>Before</th>
        <th>PC<br>After</th>
        <th>Page<br>Crossed?</th>
        <th>Cycles<br>Before</th>
        <th>Cycles<br>After</th>
        <th>ΔCycles</th>
        <th>Status</th>
      </tr></thead><tbody>`;

  for (const test of cases) {
    // --- Setup (DMA-safe) ---
    clearForTest();
    cpuCycles = 0;

    CPUregisters.A = CPUregisters.X = CPUregisters.Y = 0;
    CPUregisters.S = 0xFF;
    CPUregisters.P = { C:0, Z:0, I:0, D:0, B:0, V:0, N:0 };
    CPUregisters.PC = (test.pre && test.pre.PC !== undefined) ? test.pre.PC : 0x8000;

    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A & 0xFF;
      if (test.pre.X != null) CPUregisters.X = test.pre.X & 0xFF;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y & 0xFF;
      if (test.pre.S != null) CPUregisters.S = test.pre.S & 0xFF;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }

    if (test.setup) test.setup();

    // --- State snapshot ---
    const fb = { ...CPUregisters.P };
    const cb = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };
    const pcBefore = CPUregisters.PC & 0xFFFF;
    const beforeCycles = cpuCycles | 0;

    // --- Load code & run one instruction ---
    if (test.code && test.code.length) {
      writeCodeToROM(CPUregisters.PC, test.code);
      step();
    }

    // --- After snapshot ---
    const afterCycles = cpuCycles | 0;
    const usedCycles  = (afterCycles - beforeCycles) | 0;
    const fa = { ...CPUregisters.P };
    const ca = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };
    const pcAfter = CPUregisters.PC & 0xFFFF;

    // --- Page crossed? ---
    const pageCrossed = didPageCross(test)
      ? `<span style="color:orange;">Yes</span>`
      : `<span style="color:lightgreen;">No</span>`;

    // --- Checks ---
    let pass = true, reasons = [];

    if (test.expect) {
      for (const r in test.expect) {
        const actual = (r in ca) ? ca[r] : CPUregisters.P[r];
        if (actual !== test.expect[r]) {
          pass = false;
          reasons.push(`${r}=${actual}≠${test.expect[r]}`);
        }
      }
    }

    if (test.expectMem) {
      const memVal = checkReadOffset(test.expectMem.addr) & 0xFF; // FIX: read memory, not the address
      if (memVal !== (test.expectMem.value & 0xFF)) {
        pass = false;
        reasons.push(`M[0x${test.expectMem.addr.toString(16)}]=${memVal}≠${test.expectMem.value}`);
      }
    }

    if (test.expectPC !== undefined && pcAfter !== (test.expectPC & 0xFFFF)) {
      pass = false;
      reasons.push(`PC=0x${pcAfter.toString(16)}≠0x${(test.expectPC & 0xFFFF).toString(16)}`);
    }

    const cycleTarget = (test.baseCycles + test.extra) | 0;
    if (usedCycles !== cycleTarget) {
      pass = false;
      reasons.push(`cycles=${usedCycles}≠${cycleTarget}`);
    }

    // --- Render row ---
    const opLabel = (test.code || []).map(b => b.toString(16).padStart(2,'0')).join(" ");
    const status = pass
      ? `<span style="color:#7fff7f;">✔️</span>`
      : `<details style="color:#ff4444;cursor:pointer;"><summary>❌ Show Details</summary><ul>${
          reasons.map(r => `<li>${r}</li>`).join("")
        }</ul></details>`;

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td>${test.desc}</td>
        <td>${opLabel}</td>
        <td>${test.opcodeFn || ""}</td>
        <td>${flagsBin(fb)}</td>
        <td>${flagsBin(fa)}</td>
        <td>A=${cb.A} X=${cb.X} Y=${cb.Y} S=${cb.S}</td>
        <td>A=${ca.A} X=${ca.X} Y=${ca.Y} S=${ca.S}</td>
        <td>0x${pcBefore.toString(16)}</td>
        <td>0x${pcAfter.toString(16)}</td>
        <td>${pageCrossed}</td>
        <td>${beforeCycles}</td>
        <td>${afterCycles}</td>
        <td>${usedCycles}</td>
        <td>${status}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);

  // Restore to a predictable state for whatever runs next
  CPUregisters.PC = 0x8000;
  // If your harness expects a magic byte at $8000, write it safely:
  writeCodeToROM(0x8000, [0x02]);
}


function runExtensiveDecimalModeTests() { // http://www.6502.org/tutorials/decimal_mode.html#B
  // ======= Extensive 6502 Decimal Mode (BCD) ADC & SBC Tests =======

  // Helpers for test decoration
  const cross = (desc, test) => Object.assign(test, { desc, cross: true });
  const nocross = (desc, test) => Object.assign(test, { desc, cross: false });

  function getBaseCycles(testDesc) {
    if (/ADC/.test(testDesc)) return 2;
    if (/SBC/.test(testDesc)) return 2;
    throw new Error(`No base cycles for test: ${testDesc}`);
  }

  // Test cases
    const cases = [
      cross("ADC Dec: 58 + 46 + 1", {
        code: [0x69, 0x46],
        pre: { A: 0x58, P: { D: 1, C: 1 } },
        opcodeFn: "ADC_IMM",
        expect: { A: 0x05, C: 1 },
        baseCycles: getBaseCycles("ADC Dec: 58 + 46 + 1"),
        extra: 0
      }),
      nocross("ADC Dec: 12 + 34 + 0", {
        code: [0x69, 0x34],
        pre: { A: 0x12, P: { D: 1, C: 0 } },
        opcodeFn: "ADC_IMM",
        expect: { A: 0x46, C: 0 },
        baseCycles: getBaseCycles("ADC Dec: 12 + 34 + 0"),
        extra: 0
      }),
      nocross("ADC Dec: 15 + 26 + 0", {
        code: [0x69, 0x26],
        pre: { A: 0x15, P: { D: 1, C: 0 } },
        opcodeFn: "ADC_IMM",
        expect: { A: 0x41, C: 0 },
        baseCycles: getBaseCycles("ADC Dec: 15 + 26 + 0"),
        extra: 0
      }),
      cross("ADC Dec: 81 + 92 + 0 (carry out)", {
        code: [0x69, 0x92],
        pre: { A: 0x81, P: { D: 1, C: 0 } },
        opcodeFn: "ADC_IMM",
        expect: { A: 0x73, C: 1 },
        baseCycles: getBaseCycles("ADC Dec: 81 + 92 + 0 (carry out)"),
        extra: 0
      }),
      nocross("SBC Dec: 46 - 12 - no borrow", {
        code: [0xE9, 0x12],
        pre: { A: 0x46, P: { D: 1, C: 1 } },
        opcodeFn: "SBC_IMM",
        expect: { A: 0x34, C: 1 },
        baseCycles: getBaseCycles("SBC Dec: 46 - 12 - no borrow"),
        extra: 0
      }),
      nocross("SBC Dec: 40 - 13 - no borrow", {
        code: [0xE9, 0x13],
        pre: { A: 0x40, P: { D: 1, C: 1 } },
        opcodeFn: "SBC_IMM",
        expect: { A: 0x27, C: 1 },
        baseCycles: getBaseCycles("SBC Dec: 40 - 13 - no borrow"),
        extra: 0
      }),
      nocross("SBC Dec: 32 - 2 - 1 borrow", {
        code: [0xE9, 0x02],
        pre: { A: 0x32, P: { D: 1, C: 0 } },
        opcodeFn: "SBC_IMM",
        expect: { A: 0x29, C: 1 },
        baseCycles: getBaseCycles("SBC Dec: 32 - 2 - 1 borrow"),
        extra: 0
      }),
      nocross("SBC Dec: 12 - 21 - borrow", {
        code: [0xE9, 0x21],
        pre: { A: 0x12, P: { D: 1, C: 1 } },
        opcodeFn: "SBC_IMM",
        expect: { A: 0x91, C: 0 },
        baseCycles: getBaseCycles("SBC Dec: 12 - 21 - borrow"),
        extra: 0
      }),
      nocross("SBC Dec: 21 - 34 - borrow", {
        code: [0xE9, 0x34],
        pre: { A: 0x21, P: { D: 1, C: 1 } },
        opcodeFn: "SBC_IMM",
        expect: { A: 0x87, C: 0 },
        baseCycles: getBaseCycles("SBC Dec: 21 - 34 - borrow"),
        extra: 0
      }),
      cross("ADC Dec: 99 + 01 (wrap to 00)", {
        code: [0x69, 0x01],
        pre: { A: 0x99, P: { D: 1, C: 1 } },
        opcodeFn: "ADC_IMM",
        expect: { A: 0x01, C: 1 }, // corrected to align with easy6502 results
        baseCycles: getBaseCycles("ADC Dec: 99 + 01 (wrap to 00)"),
        extra: 0
      }),
      nocross("SBC Dec: 01 - 01 - no borrow", {
        code: [0xE9, 0x01],
        pre: { A: 0x01, P: { D: 1, C: 1 } },
        opcodeFn: "SBC_IMM",
        expect: { A: 0x00, C: 1 },
        baseCycles: getBaseCycles("SBC Dec: 01 - 01 - no borrow"),
        extra: 0
      }),
  cross("ADC Dec: 50 + 50 + 0 no carry", {
    code: [0x69, 0x50],
    pre: { A: 0x50, P: { D: 1, C: 0 } },
    opcodeFn: "ADC_IMM",
    expect: { A: 0x00, C: 1 },  // corrected to align with easy6502 results
    baseCycles: getBaseCycles("ADC Dec: 50 + 50 + 0 no carry"),
    extra: 0
  }),

    ];
  
  let html = `
    <div style="background:darkblue;color:white;padding:7px 6px 7px 6px;font-weight:bold;">
      6502 EXTENSIVE DECIMAL MODE TEST SUITE
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead>
        <tr style="background:#223366;">
          <th>Test</th>
          <th>Op</th>
          <th>Opcode Fn</th>
          <th>Flags<br>Before</th>
          <th>Flags<br>After</th>
          <th>CPU<br>Before</th>
          <th>CPU<br>After</th>
          <th>PC<br>Before</th>
          <th>PC<br>After</th>
          <th>Page<br>Crossed?</th>
          <th>Cycles<br>Before</th>
          <th>Cycles<br>After</th>
          <th>ΔCycles</th>
          <th>Status</th>
        </tr>
      </thead><tbody>`;

  for (const test of cases) {
    // Setup
    for (let a = 0; a < 0x10000; a++) checkWriteOffset(a, 0);
    cpuCycles = 0;
    CPUregisters.A = CPUregisters.X = CPUregisters.Y = 0;
    CPUregisters.S = 0xFF;
    CPUregisters.P = { C: 0, Z: 0, I: 0, D: 0, B: 0, V: 0, N: 0 };
    CPUregisters.PC = test.pre && test.pre.PC !== undefined ? test.pre.PC : 0x8000;

    if (test.pre) {
      if (test.pre.A != null) CPUregisters.A = test.pre.A;
      if (test.pre.X != null) CPUregisters.X = test.pre.X;
      if (test.pre.Y != null) CPUregisters.Y = test.pre.Y;
      if (test.pre.S != null) CPUregisters.S = test.pre.S;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }

    if (test.setup) test.setup();

    // Snapshots before execution
    const fb = { ...CPUregisters.P };
    const cb = { A: CPUregisters.A, X: CPUregisters.X, Y: CPUregisters.Y, S: CPUregisters.S };
    const pcBefore = CPUregisters.PC;
    const beforeCycles = cpuCycles;

    // Load code at PC and execute
    if (test.code && test.code.length) {
      test.code.forEach((b, i) => {
        checkWriteOffset(CPUregisters.PC + i, b);
      });
      step(); // run instruction
    }

    // Snapshots after execution
    const afterCycles = cpuCycles;
    const usedCycles = afterCycles - beforeCycles;
    const fa = { ...CPUregisters.P };
    const ca = { A: CPUregisters.A, X: CPUregisters.X, Y: CPUregisters.Y, S: CPUregisters.S };
    const pcAfter = CPUregisters.PC;

    // Page crossed - immediate mode does not cross pages
    let pageCrossed = `<span style="color:lightgreen;">No</span>`;

    // Check results
    let pass = true,
      reasons = [];
    if (test.expect) {
      for (const r in test.expect) {
        const actual = r in ca ? ca[r] : CPUregisters.P[r];
        if (actual !== test.expect[r]) {
          pass = false;
          reasons.push(`${r}=${actual}≠${test.expect[r]}`);
        }
      }
    }
    if (test.expectMem) {
      const val = [test.expectMem.addr];
      if (val !== test.expectMem.value) {
        pass = false;
        reasons.push(`M[0x${test.expectMem.addr.toString(16)}]=${val}≠${test.expectMem.value}`);
      }
    }
    if (test.expectPC !== undefined && pcAfter !== test.expectPC) {
      pass = false;
      reasons.push(`PC=0x${pcAfter.toString(16)}≠0x${test.expectPC.toString(16)}`);
    }
    const cycleTarget = test.baseCycles + test.extra;
    if (usedCycles !== cycleTarget) {
      pass = false;
      reasons.push(`cycles=${usedCycles}≠${cycleTarget}`);
    }

    const opLabel = (test.code || []).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const status = pass
      ? `<span style="color:#7fff7f;">✔️</span>`
      : `<details style="color:#ff4444;cursor:pointer;"><summary>❌ Show Details</summary><ul>${reasons
          .map(r => `<li>${r}</li>`)
          .join("")}</ul></details>`;

    html += `
      <tr style="background:${pass ? "#113311" : "#331111"}">
        <td>${test.desc}</td>
        <td>${opLabel}</td>
        <td>${test.opcodeFn || ""}</td>
        <td>${flagsBin(fb)}</td>
        <td>${flagsBin(fa)}</td>
        <td>A=${cb.A} X=${cb.X} Y=${cb.Y} S=${cb.S}</td>
        <td>A=${ca.A} X=${ca.X} Y=${ca.Y} S=${ca.S}</td>
        <td>0x${pcBefore.toString(16)}</td>
        <td>0x${pcAfter.toString(16)}</td>
        <td>${pageCrossed}</td>
        <td>${beforeCycles}</td>
        <td>${afterCycles}</td>
        <td>${usedCycles}</td>
        <td>${status}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);

  // Reset after tests
CPUregisters.PC = 0x8000;    
prgRom[CPUregisters.PC - 0x8000] = 0x02;
}

function runEvery6502Test() {
runLoadsTests();
runStoresTests();
runRegisterTransfersAndFlagsTest();
runAluAndLogicOpsTests();
runShiftOpsTests();
runLoadsOpsTests();
runRegisterTransfersAndFlagsTestTwo();
runCompareOpsTests();
runJumpAndSubRoutinesTests();
runStackOpsTests();
runBrkAndNopsTests();
runUnofficialOpcodeTests();
runEdgeCaseTests();
runPageCrossAndQuirksTests();
runBranchOpsTests();
runExtensiveDecimalModeTests(); // based off http://www.6502.org/tutorials/decimal_mode.html#B
runMirroredLocationTests();
}

function runMirroredLocationTests() {
     
    // mainly silly tests you can easily check through console in a couple of seconds
    // probably like most of this test suite
    
  // Set PPU status directly for read-only mirror test
  PPUregister.STATUS = 0x77;

  const tests = [
    { name: "CPU RAM base ($0002)", addr: 0x0002, value: 0x12 },
    { name: "CPU RAM mirror ($0802)", addr: 0x0802, value: 0x34 },
    { name: "PPUSTATUS mirror ($2002 + $8N)", addr: 0x2002, value: 0x77, readonly: true },
    { name: "Palette mirror ($3F10)", addr: 0x3F10, value: 0x41 }
  ];

  let html = `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
    MIRRORED LOCATION TESTS
  </div>
  <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
    <thead><tr style="background:#222">
      <th>Test</th>
      <th>Addr</th>
      <th>Value</th>
      <th>Mirrors (expand)</th>
      <th>Status</th>
    </tr></thead><tbody>`;

  for (let t = 0; t < tests.length; ++t) {
    const test = tests[t];
    let mirrors = [];

    // Mirror calculation
    if (test.addr >= 0x0000 && test.addr <= 0x1FFF) {
      let base = test.addr & 0x07FF;
      for (let i = 0; i < 4; ++i)
        mirrors.push(0x0000 + base + 0x800 * i);
    } else if (test.addr >= 0x2000 && test.addr <= 0x3FFF) {
      let regOffset = (test.addr & 0x7);
      for (let i = 0x2000 + regOffset; i <= 0x3FFF; i += 8)
        mirrors.push(i);
    } else if (test.addr >= 0x3F00 && test.addr <= 0x3FFF) {
      let palAddr = 0x3F00 + (test.addr & 0x1F);
      for (let i = 0; i < 0x20; ++i) {
        let pa = 0x3F00 + (palAddr & 0x1F);
        if (!mirrors.includes(pa)) mirrors.push(pa);
        if ([0x10, 0x14, 0x18, 0x1C].includes(pa & 0x1F)) {
          let alias = pa - 0x10;
          if (!mirrors.includes(alias)) mirrors.push(alias);
        }
      }
      for (let a = (palAddr & 0x1F); a < 0x1000; a += 0x20)
        if (!mirrors.includes(0x3F00 + a)) mirrors.push(0x3F00 + a);
    } else {
      mirrors.push(test.addr);
    }

    mirrors = Array.from(new Set(mirrors)).filter(a => a >= 0 && a <= 0xFFFF);

    let passes = [];
    let fails = [];

    // Special PPUSTATUS read-only handling
    if (test.readonly) {
      for (let i = 0; i < mirrors.length; ++i) {
        let v = checkReadOffset(mirrors[i]);
        if (v === test.value) {
          passes.push(mirrors[i]);
        } else {
          fails.push({ addr: mirrors[i], value: v });
        }
      }
    } else {
      checkWriteOffset(test.addr, test.value);
      for (let i = 0; i < mirrors.length; ++i) {
        let v = checkReadOffset(mirrors[i]);
        if (v === test.value) {
          passes.push(mirrors[i]);
        } else {
          fails.push({ addr: mirrors[i], value: v });
        }
      }
    }

    let status, detail;
    let divId = "mirr" + t;
    let mirrorHtml = `<button onclick="document.getElementById('${divId}').style.display=(document.getElementById('${divId}').style.display==='none'?'block':'none')"
      style="background:#444;color:#fff;border:1px solid #888;border-radius:6px;padding:2px 8px;cursor:pointer;">Show</button>
      <div id="${divId}" style="display:none;padding:4px;max-height:300px;overflow:auto;">`;

    // Show pass/fail for each mirror, color coded
    for (let i = 0; i < mirrors.length; ++i) {
      let found = passes.includes(mirrors[i]);
      let fail = fails.find(f => f.addr === mirrors[i]);
      mirrorHtml += `<div style="color:${found ? '#7fff7f' : '#ff4444'};">
        $${mirrors[i].toString(16).toUpperCase().padStart(4, '0')}
        ${found ? '' : `=0x${fail.value.toString(16).toUpperCase().padStart(2,'0')} ❌`}
      </div>`;
    }
    mirrorHtml += "</div>";

    if (passes.length === 0) {
      status = `<span style="color:#ff4444;">❌ Fault</span>`;
      detail = ""; // mirrors list is in the dropdown
    } else if (fails.length === 0) {
      status = `<span style="color:#7fff7f;">✔️ All mirrors correct</span>`;
      detail = ""; // mirrors list is in the dropdown
    } else {
      status = `<span style="color:#ffd700;">⚠️ Partial</span>`;
      detail = ""; // mirrors list is in the dropdown
    }

    html += `
      <tr style="background:${passes.length === 0 ? "#331111" : fails.length === 0 ? "#113311" : "#332211"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">$${test.addr.toString(16).toUpperCase().padStart(4, '0')}</td>
        <td style="border:1px solid #444;padding:6px;">0x${test.value.toString(16).toUpperCase().padStart(2, '0')}</td>
        <td style="border:1px solid #444;padding:6px;max-width:320px;">${mirrorHtml}</td>
        <td style="border:1px solid #444;padding:6px;">${status}</td>
      </tr>`;
  }
  html += "</tbody></table>";
  document.body.insertAdjacentHTML("beforeend", html);
}

function runStoresTests() {
  // ===== STORES (STA/STX/STY) =====
  const tests = [
    { name: "STA zeroPage",         code: [0x85, 0x80],              setup: () => { CPUregisters.A = 0x99; },   expectMem: { addr: 0x0080, value: 0x99 } },
    { name: "STA zeroPage,X (wrap)",code: [0x95, 0xFF],              setup: () => { CPUregisters.X = 1; CPUregisters.A = 0x42; }, expectMem: { addr: 0x0000, value: 0x42 } },
    { name: "STA absolute",         code: [0x8D, 0x34, 0x12],        setup: () => { CPUregisters.A = 0x56; },   expectMem: { addr: 0x1234, value: 0x56 } },
    { name: "STA absolute,X",       code: [0x9D, 0x00, 0x07],        setup: () => { CPUregisters.X = 2; CPUregisters.A = 0xAB; }, expectMem: { addr: 0x0702, value: 0xAB } },
    { name: "STA absolute,Y",       code: [0x99, 0x00, 0x07],        setup: () => { CPUregisters.Y = 3; CPUregisters.A = 0xFE; }, expectMem: { addr: 0x0703, value: 0xFE } },
    { name: "STX zeroPage",         code: [0x86, 0x30],              setup: () => { CPUregisters.X = 0x55; },   expectMem: { addr: 0x0030, value: 0x55 } },
    { name: "STX zeroPage,Y",       code: [0x96, 0x40],              setup: () => { CPUregisters.X = 0xAA; CPUregisters.Y = 2; }, expectMem: { addr: 0x0042, value: 0xAA } },
    { // STA abs → WRAM
  name: "STA absolute → WRAM",
  code: [0x8D, 0x00, 0x02],           // STA $0200
  setup: () => { CPUregisters.A = 0x5A; },
  expectMem: { addr: 0x0200, value: 0x5A },
  expectedCycles: 4
},
{
  name: "STY absolute → WRAM",
  code: [0x8C, 0x10, 0x01],           // STY $0110
  setup: () => { CPUregisters.Y = 0xCC; },
  expectMem: { addr: 0x0110, value: 0xCC },
  expectedCycles: 4
},
{
  name: "STA zero page",
  code: [0x85, 0x80],
  setup: () => { CPUregisters.A = 0x99; },
  expectMem: { addr: 0x0080, value: 0x99 },
  expectedCycles: 3
},
{
  name: "STA abs,X → WRAM",
  code: [0x9D, 0x40, 0x03],           // STA $0340,X
  setup: () => { CPUregisters.A = 0x22; CPUregisters.X = 0x05; },
  expectMem: { addr: 0x0345, value: 0x22 },
  expectedCycles: 5                    // abs,X store = 5 cycles
},
{
  name: "STA abs,Y → WRAM",
  code: [0x99, 0x40, 0x03],
  setup: () => { CPUregisters.A = 0x33; CPUregisters.Y = 0x05; },
  expectMem: { addr: 0x0345, value: 0x33 },
  expectedCycles: 5,
},

    { name: "STY zeroPage",         code: [0x84, 0x50],              setup: () => { CPUregisters.Y = 0x44; },   expectMem: { addr: 0x0050, value: 0x44 } },
    { name: "STY zeroPage,X",       code: [0x94, 0x60],              setup: () => { CPUregisters.Y = 0x88; CPUregisters.X = 3; }, expectMem: { addr: 0x0063, value: 0x88 } },
    { name: "STY absolute",         code: [0x8C, 0xAB, 0xCD],        setup: () => { CPUregisters.Y = 0x99; },   expectMem: { addr: 0xCDAB, value: 0x99 } }
  ];

  // Clear RAM and reset regs
  for(let a=0; a<0x4000; a++) checkWriteOffset(a, 0);
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};

  // Lay out all store opcodes sequentially into PRG-ROM
  CPUregisters.PC = 0x8000;
  let seqOffset = 0;
  tests.forEach(t => t.code.forEach(b => { checkWriteOffset(0x8000+seqOffset, b); seqOffset++; }));

  let html = `
    <div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
      STORES (STA/STX/STY)
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead><tr style="background:#222">
        <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
        <th>CPU<br>Before</th><th>CPU<br>After</th>
        <th>Effective Addr</th><th>Expected</th><th>Result</th><th>Mirrors</th><th>Status</th>
      </tr></thead><tbody>`;

  // Helper to compute effective store address
  function calcEffectiveAddress(test) {
    const c = test.code, op = c[0];
    switch(op) {
      case 0x85: return c[1] & 0xFF;                        // STA zp
      case 0x95: return (c[1] + CPUregisters.X) & 0xFF;     // STA zp,X
      case 0x8D: return (c[2]<<8) | c[1];                   // STA abs
      case 0x9D: return (((c[2]<<8) | c[1]) + CPUregisters.X) & 0xFFFF; // STA abs,X
      case 0x99: return (((c[2]<<8) | c[1]) + CPUregisters.Y) & 0xFFFF; // STA abs,Y
      case 0x86: return c[1] & 0xFF;                        // STX zp
      case 0x96: return (c[1] + CPUregisters.Y) & 0xFF;     // STX zp,Y
      case 0x8E: return (c[2]<<8) | c[1];                   // STX abs
      case 0x84: return c[1] & 0xFF;                        // STY zp
      case 0x94: return (c[1] + CPUregisters.X) & 0xFF;     // STY zp,X
      case 0x8C: return (c[2]<<8) | c[1];                   // STY abs
      default: return 0;
    }
  }

  // Test runner
  tests.forEach(test => {
    // Record before
    const fb = {...CPUregisters.P};
    const cb = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S};

    if(test.setup) test.setup();

    step();

    const fa = {...CPUregisters.P};
    const ca = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S};

    const effAddr = calcEffectiveAddress(test);
    const mirrors = getMirrors(effAddr).filter(a=>a<0x10000);

    // Check all mirrors
    let reasons = [], pass = true;
    let mirrorLabels = mirrors.map(addr => {
      const val = checkReadOffset(addr);
      const isOk = val === test.expectMem.value;
      if (!isOk) { reasons.push(`$${addr.toString(16).padStart(4,'0')}=${hex(val)}≠${hex(test.expectMem.value)}`); pass = false; }
      return `<span style="color:${isOk ? '#7fff7f' : '#ff4444'};">$${addr.toString(16).padStart(4,'0')}=${hex(val)}</span>`;
    }).join(" ");

    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>` +
        `<ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(ca.A)} X=${hex(ca.X)} Y=${hex(ca.Y)} S=${hex(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;">$${effAddr.toString(16).padStart(4,'0')}</td>
        <td style="border:1px solid #444;padding:6px;">${hex(test.expectMem.value)}</td>
        <td style="border:1px solid #444;padding:6px;">${hex(checkReadOffset(effAddr))}</td>
        <td style="border:1px solid #444;padding:6px;">${mirrorLabels}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
  CPUregisters.PC = 0x8000;
  prgRom[0x00] = 0x02;
}

const testSuites = [
  // Loads, both standard and alternate for extra cross-verification
  { name: "LOADS (LDA/LDX/LDY)", run: runLoadsTests },
  { name: "LOADS (LDA/LDX/LDY) (Alt)", run: runLoadsOpsTests },

  // Stores
  { name: "STORES (STA/STX/STY)", run: runStoresTests },

  // Register and flag transfers
  { name: "Register Transfers & Flags", run: runRegisterTransfersAndFlagsTest },
  { name: "Register Transfers & Flags (Part 2)", run: runRegisterTransfersAndFlagsTestTwo },

  // Arithmetic/logic and compare
  { name: "ALU & Logic Ops", run: runAluAndLogicOpsTests },
  { name: "COMPARE Ops", run: runCompareOpsTests },

  // Shifts
  { name: "Shift Ops", run: runShiftOpsTests },

  // Control flow
  { name: "Branch Ops", run: runBranchOpsTests },
  { name: "JUMP & SubRoutines", run: runJumpAndSubRoutinesTests },
  { name: "STACK Ops", run: runStackOpsTests },
  { name: "BRK & NOPs", run: runBrkAndNopsTests },

  // Unofficial, edge, and quirk tests
  { name: "Unofficial Opcode Tests", run: runUnofficialOpcodeTests },
  { name: "Edge Case Tests", run: runEdgeCaseTests },
  { name: "Page Cross & Quirks Tests", run: runPageCrossAndQuirksTests },

  // Extensive decimal mode tests
  { name: "Extensive Decimal Mode Tests", run: runExtensiveDecimalModeTests },

  // Mirroring test suite
  { name: "Mirrored Offset Tests", run: runMirroredLocationTests },

];

function showTestModal() {
  // Create modal background
  let modal = document.createElement('div');
  modal.id = 'test-modal';
  modal.style = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:#000a; z-index:9999; display:flex; align-items:center; justify-content:center;';

  // Modal content box
  let box = document.createElement('div');
  box.style = 'background:#fff; border-radius:12px; padding:2em; min-width:350px; box-shadow:0 0 32px #0008; display:flex; flex-direction:column; align-items:center;';

  let title = document.createElement('div');
  title.textContent = "Select test group to run";
  title.style = "font-size:1.5em; margin-bottom:0.5em;";
  box.appendChild(title);

  // Test suite selector
  let sel = document.createElement('select');
  sel.style = 'font-size:1.1em; margin-bottom:1em; width:90%;';
  testSuites.forEach((suite, idx) => {
    let opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = suite.name;
    sel.appendChild(opt);
  });
  box.appendChild(sel);

  // Run Selected button
  let btnOne = document.createElement('button');
  btnOne.textContent = "Run Selected Suite";
  btnOne.style = "margin-bottom:0.7em; font-size:1em; padding:0.5em 1.5em;";
  btnOne.onclick = () => {
    modal.remove();
    // invoke without arguments
    testSuites[+sel.value].run();
  };
  box.appendChild(btnOne);

  // Run All button
  let btnAll = document.createElement('button');
  btnAll.textContent = "Run ALL Suites";
  btnAll.style = "font-size:1em; padding:0.5em 1.5em;";
  btnAll.onclick = () => {
    modal.remove();
    testSuites.forEach(s => s.run());
  };
  box.appendChild(btnAll);

  // Cancel button
  let btnCancel = document.createElement('button');
  btnCancel.textContent = "Cancel";
  btnCancel.style = "margin-top:1.5em; font-size:0.95em;";
  btnCancel.onclick = () => modal.remove();
  box.appendChild(btnCancel);

  modal.appendChild(box);
  document.body.appendChild(modal);
}
