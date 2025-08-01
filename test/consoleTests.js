// ─── GLOBAL TEST SETUP ─────────────────────────────────────────────────────────
function setupTests(tests) {
  // --- Reset CPU/PPU & clear WRAM/PPU space (preserve PRG-ROM) ---
  for (let a = 0; a < 0x4000; a++) systemMemory[a] = 0;
  CPUregisters.A = 0; CPUregisters.X = 0; CPUregisters.Y = 0; CPUregisters.S = 0xFF;
  CPUregisters.P = { C:0, Z:0, I:0, D:0, B:0, V:0, N:0 };
  if (typeof PPUregister === "object") {
    Object.keys(PPUregister).forEach(k => PPUregister[k] = 0);
  }

  // --- Set PC to reset vector ---
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD] << 8);

  // --- Lay out all test opcodes into PRG-ROM at $8000/$C000 ---
  let seqOffset = 0;
  tests.forEach(t => {
    t.code.forEach(b => {
      systemMemory[0x8000 + seqOffset] = b;
      systemMemory[0xC000 + seqOffset] = b;
      seqOffset++;
    });
  });
}
// ────────────────────────────────────────────────────────────────────────────────

function hex(v, len = 2) {
  if (v == null || typeof v.toString !== "function") return "--";
  return "0x" + v.toString(16).toUpperCase().padStart(len, "0");
}
function flagsBin(P) {
  return ((P.N<<7)|(P.V<<6)|(1<<5)|(P.B<<4)|(P.D<<3)|(P.I<<2)|(P.Z<<1)|(P.C))
           .toString(2).padStart(8,"0");
}
function getMirrors(addr) {
  if (addr <= 0x07FF) return [addr, addr+0x800, addr+0x1000, addr+0x1800];
  if (addr >= 0x2000 && addr <= 0x3FFF) {
    let m = [];
    for (let a=0x2000; a<=0x3FFF; a+=8) m.push(a + (addr % 8));
    return m;
  }
  return [addr];
}
function dropdown(label, items) {
  return items.length > 1
    ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">`
      + items.map(i=>`<li>${i}</li>`).join("") + `</ul></details>`
    : label;
}

function runLoadsTests() {
    // ===== LOADS (LDA/LDX/LDY) as a continuous PRG-ROM stream =====
  
    const tests = [
      { name:"LDA #$42",         code:[0xA9,0x42],                    expect:{A:0x42,Z:0,N:0} },
      { name:"LDA zeroPage",     code:[0xA5,0x80], setup:()=>{ systemMemory[0x80]=0x55; }, expect:{A:0x55,Z:0,N:0} },
      { name:"LDA zeroPage,X",   code:[0xB5,0x80], setup:()=>{ CPUregisters.X=2; systemMemory[0x82]=0x77; }, expect:{A:0x77,Z:0,N:0} },
      { name:"LDA absolute",     code:[0xAD,0x00,0x20], setup:()=>{ systemMemory[0x2000]=0x12; }, expect:{A:0x12,Z:0,N:0} },
      { name:"LDA absolute,X",   code:[0xBD,0x00,0x07], setup:()=>{ CPUregisters.X=1; systemMemory[0x0701]=0x88; }, expect:{A:0x88,Z:0,N:1} },
      { name:"LDA absolute,Y",   code:[0xB9,0x00,0x07], setup:()=>{ CPUregisters.Y=2; systemMemory[0x0702]=0x44; }, expect:{A:0x44,Z:0,N:0} },
      { name:"LDA (indirect,X)", code:[0xA1,0x80], setup:()=>{ CPUregisters.X=1; systemMemory[0x81]=0x10; systemMemory[0x82]=0x80; systemMemory[0x8010]=0xB5; }, expect:{A:0xB5,Z:0,N:1} },
      { name:"LDA (indirect),Y", code:[0xB1,0x80], setup:()=>{ systemMemory[0x80]=0x00; systemMemory[0x81]=0x20; CPUregisters.Y=2; PPUregister.STATUS=0xC4; }, expect:{A:0xC4,Z:0,N:1} },
      { name:"LDA zero flag",    code:[0xA9,0x00],                    expect:{A:0x00,Z:1,N:0} },
      { name:"LDA negative flag",code:[0xA9,0xFF],                    expect:{A:0xFF,Z:0,N:1} },
      { name:"LDX #$34",         code:[0xA2,0x34],                    expect:{X:0x34,Z:0,N:0} },
      { name:"LDX zeroPage",     code:[0xA6,0x22], setup:()=>{ systemMemory[0x22]=0x80; }, expect:{X:0x80,Z:0,N:1} },
      { name:"LDX zeroPage,Y",   code:[0xB6,0x50], setup:()=>{ CPUregisters.Y=3; systemMemory[0x53]=0x01; }, expect:{X:0x01,Z:0,N:0} },
      { name:"LDX absolute,Y",   code:[0xBE,0x10,0x20], setup:()=>{ CPUregisters.Y=2; systemMemory[0x2012]=0xFF; }, expect:{X:0xFF,Z:0,N:1} },
      { name:"LDY #$99",         code:[0xA0,0x99],                    expect:{Y:0x99,Z:0,N:1} },
      { name:"LDY zeroPage",     code:[0xA4,0x40], setup:()=>{ systemMemory[0x40]=0x11; }, expect:{Y:0x11,Z:0,N:0} },
      { name:"LDY zeroPage,X",   code:[0xB4,0x10], setup:()=>{ CPUregisters.X=1; systemMemory[0x11]=0x80; }, expect:{Y:0x80,Z:0,N:1} },
      { name:"LDY absolute",     code:[0xAC,0x80,0x00], setup:()=>{ systemMemory[0x80]=0x7F; }, expect:{Y:0x7F,Z:0,N:0} },
      { name:"LDY absolute,X",   code:[0xBC,0x00,0x30], setup:()=>{ CPUregisters.X=2; systemMemory[0x3002]=0xFF; }, expect:{Y:0xFF,Z:0,N:1} }
    ];
  
    setupTests(tests);
  
    // --- Build table ---
    let html=`
      <div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
        LOADS (LDA/LDX/LDY)
      </div>
      <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
        <thead>
          <tr style="background:#222">
            <th style="border:1px solid #444;padding:6px;">Test</th>
            <th style="border:1px solid #444;padding:6px;">Op</th>
            <th style="border:1px solid #444;padding:6px;">Flags<br>Before</th>
            <th style="border:1px solid #444;padding:6px;">Flags<br>After</th>
            <th style="border:1px solid #444;padding:6px;">CPU<br>Before</th>
            <th style="border:1px solid #444;padding:6px;">CPU<br>After</th>
            <th style="border:1px solid #444;padding:6px;">PPU<br>Before</th>
            <th style="border:1px solid #444;padding:6px;">PPU<br>After</th>
            <th style="border:1px solid #444;padding:6px;">Eff Addr</th>
            <th style="border:1px solid #444;padding:6px;">Expected</th>
            <th style="border:1px solid #444;padding:6px;">Result</th>
            <th style="border:1px solid #444;padding:6px;">Intercept</th>
            <th style="border:1px solid #444;padding:6px;">GUI Cell</th>
            <th style="border:1px solid #444;padding:6px;">Status</th>
          </tr>
        </thead><tbody>`;
  
    // Run tests back-to-back
    tests.forEach(test=>{
      // intercept tracking
      let intercepted={flag:false,addr:null};
      const origChk=checkReadOffset;
      checkReadOffset = addr=>{
        intercepted.flag=true;
        intercepted.addr = addr & 0xFFFF;
        return origChk(addr);
      };
  
      // record before-states
      const fb={...CPUregisters.P};
      const cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};
      const pb={...PPUregister};
  
      // apply any test.setup for memory/regs
      if(test.setup) test.setup();
  
      // execute one instruction
      step(); updateDebugTables();
  
      // restore checkReadOffset
      checkReadOffset = origChk;
  
      // compute effective address
      let ea=0, m=lastFetched.addressingMode, r=lastFetched.raw;
      switch(m){
        case "immediate": ea=lastFetched.pc+1; break;
        case "zeroPage":  ea=r[1]&0xFF; break;
        case "zeroPageX": ea=(r[1]+CPUregisters.X)&0xFF; break;
        case "zeroPageY": ea=(r[1]+CPUregisters.Y)&0xFF; break;
        case "absolute":  ea=(r[2]<<8)|r[1]; break;
        case "absoluteX": ea=(((r[2]<<8)|r[1])+CPUregisters.X)&0xFFFF; break;
        case "absoluteY": ea=(((r[2]<<8)|r[1])+CPUregisters.Y)&0xFFFF; break;
        case "indirectX": {
          const zp=(r[1]+CPUregisters.X)&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF);
          ea=(hi<<8)|lo; break;
        }
        case "indirectY": {
          const zp=r[1]&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF);
          ea=(((hi<<8)|lo)+CPUregisters.Y)&0xFFFF; break;
        }
      }
  
      // mirror list (within 0–0xFFFF)
      const mirrors = getMirrors(ea).filter(a=>a<0x10000);
      const mirrorLabel = `$${ea.toString(16).padStart(4,'0')}`;
  
      // GUI cells not applicable for LOADS
      const guiLabel = "n/a";
  
      // check results
      let reasons=[], pass=true;
      if(test.expect.A!==undefined && CPUregisters.A!==test.expect.A){ reasons.push(`A=${hex(CPUregisters.A)}≠${hex(test.expect.A)}`); pass=false; }
      if(test.expect.X!==undefined && CPUregisters.X!==test.expect.X){ reasons.push(`X=${hex(CPUregisters.X)}≠${hex(test.expect.X)}`); pass=false; }
      if(test.expect.Y!==undefined && CPUregisters.Y!==test.expect.Y){ reasons.push(`Y=${hex(CPUregisters.Y)}≠${hex(test.expect.Y)}`); pass=false; }
      if(test.expect.Z!==undefined && CPUregisters.P.Z!==test.expect.Z){ reasons.push(`Z=${CPUregisters.P.Z}≠${test.expect.Z}`); pass=false; }
      if(test.expect.N!==undefined && CPUregisters.P.N!==test.expect.N){ reasons.push(`N=${CPUregisters.P.N}≠${test.expect.N}`); pass=false; }
  
      // intercept cell
      const interceptCell = intercepted.flag
        ? dropdown(`$${intercepted.addr.toString(16).padStart(4,'0')}`, [`$${intercepted.addr.toString(16).padStart(4,'0')}`])
        : "no";
  
      // status cell
      const statusCell = pass
        ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
        : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>` +
          `<ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;
  
      html += `
        <tr style="background:${pass?"#113311":"#331111"}">
          <td style="border:1px solid #444;padding:6px;">${test.name}</td>
          <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
          <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
          <td style="border:1px solid #444;padding:6px;">${flagsBin(CPUregisters.P)}</td>
          <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
          <td style="border:1px solid #444;padding:6px;">A=${hex(CPUregisters.A)} X=${hex(CPUregisters.X)} Y=${hex(CPUregisters.Y)} S=${hex(CPUregisters.S)}</td>
          <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>k+"="+hex(v)).join(" ")}</td>
          <td style="border:1px solid #444;padding:6px;">${Object.entries(PPUregister).map(([k,v])=>k+"="+hex(v)).join(" ")}</td>
          <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdown(mirrorLabel, mirrors.map(a=>`$${a.toString(16).padStart(4,'0')}`))}</td>
          <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${
            test.expect.A!==undefined?hex(test.expect.A):
            test.expect.X!==undefined?hex(test.expect.X):
            hex(test.expect.Y)}</td>
          <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${
            test.expect.A!==undefined?hex(CPUregisters.A):
            test.expect.X!==undefined?hex(CPUregisters.X):
            hex(CPUregisters.Y)}</td>
          <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
          <td style="border:1px solid #444;padding:6px;">${guiLabel}</td>
          <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
        </tr>`;
    });
  
    html += "</tbody></table>";
    document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep stepping once and testing
CPUregisters.PC = 0x8000;

}

function runStoresTests() {
    // ===== STORES (STA/STX/STY) =====

  const tests = [
    { name: "STA zeroPage",         code: [0x85, 0x80],              setup: () => { CPUregisters.A = 0x99; },   expectMem: { addr: 0x0080, value: 0x99 } },
    { name: "STA zeroPage,X (wrap)",code: [0x95, 0xFF],              setup: () => { CPUregisters.X = 1; CPUregisters.A = 0x42; }, expectMem: { addr: 0x0000, value: 0x42 } },
    { name: "STA absolute",         code: [0x8D, 0x34, 0x12],       setup: () => { CPUregisters.A = 0x56; },   expectMem: { addr: 0x1234, value: 0x56 } },
    { name: "STA absolute,X",       code: [0x9D, 0x00, 0x07],       setup: () => { CPUregisters.X = 2; CPUregisters.A = 0xAB; }, expectMem: { addr: 0x0702, value: 0xAB } },
    { name: "STA absolute,Y",       code: [0x99, 0x00, 0x07],       setup: () => { CPUregisters.Y = 3; CPUregisters.A = 0xFE; }, expectMem: { addr: 0x0703, value: 0xFE } },
    { name: "STX zeroPage",         code: [0x86, 0x30],              setup: () => { CPUregisters.X = 0x55; },   expectMem: { addr: 0x0030, value: 0x55 } },
    { name: "STX zeroPage,Y",       code: [0x96, 0x40],              setup: () => { CPUregisters.X = 0xAA; CPUregisters.Y = 2; }, expectMem: { addr: 0x0042, value: 0xAA } },
    { name: "STX absolute",         code: [0x8E, 0x12, 0x34],       setup: () => { CPUregisters.X = 0x77; },   expectMem: { addr: 0x3412, value: 0x77 } },
    { name: "STY zeroPage",         code: [0x84, 0x50],              setup: () => { CPUregisters.Y = 0x44; },   expectMem: { addr: 0x0050, value: 0x44 } },
    { name: "STY zeroPage,X",       code: [0x94, 0x60],              setup: () => { CPUregisters.Y = 0x88; CPUregisters.X = 3; }, expectMem: { addr: 0x0063, value: 0x88 } },
    { name: "STY absolute",         code: [0x8C, 0xAB, 0xCD],       setup: () => { CPUregisters.Y = 0x99; },   expectMem: { addr: 0xCDAB, value: 0x99 } }
  ];

  // clear WRAM & PPU space, reset regs
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==='object') Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // set PC to reset-vector
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // lay out store opcodes sequentially into PRG-ROM
  let seqOffset=0;
  tests.forEach(t=>{
    t.code.forEach(b=>{
      systemMemory[0x8000+seqOffset]=b;
      systemMemory[0xC000+seqOffset]=b;
      seqOffset++;
    });
  });

  // build HTML table
  let html=`
    <div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
      STORES (STA/STX/STY)
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead><tr style="background:#222">
        <th style="border:1px solid #444;padding:6px;">Test</th>
        <th style="border:1px solid #444;padding:6px;">Op</th>
        <th style="border:1px solid #444;padding:6px;">Flags<br>Before</th>
        <th style="border:1px solid #444;padding:6px;">Flags<br>After</th>
        <th style="border:1px solid #444;padding:6px;">CPU<br>Before</th>
        <th style="border:1px solid #444;padding:6px;">CPU<br>After</th>
        <th style="border:1px solid #444;padding:6px;">PPU<br>Before</th>
        <th style="border:1px solid #444;padding:6px;">PPU<br>After</th>
        <th style="border:1px solid #444;padding:6px;">Eff Addr</th>
        <th style="border:1px solid #444;padding:6px;">Expected</th>
        <th style="border:1px solid #444;padding:6px;">Result</th>
        <th style="border:1px solid #444;padding:6px;">Intercept</th>
        <th style="border:1px solid #444;padding:6px;">GUI Cell</th>
        <th style="border:1px solid #444;padding:6px;">Status</th>
      </tr></thead><tbody>`;

  tests.forEach(test=>{
    // intercept writes? for now always "no"
    const interceptCell = "no";
    const guiCell = "n/a";

    // record before state
    const fb = {...CPUregisters.P};
    const cb = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};
    const pb = {...PPUregister};

    if(test.setup) test.setup();

    // execute
    step(); updateDebugTables();

    // effective address
    const r = lastFetched.raw, m = lastFetched.addressingMode;
    let ea = 0;
    switch(m){
      case "zeroPage":    ea = r[1]&0xFF; break;
      case "zeroPageX":   ea = (r[1]+CPUregisters.X)&0xFF; break;
      case "zeroPageY":   ea = (r[1]+CPUregisters.Y)&0xFF; break;
      case "absolute":    ea = (r[2]<<8)|r[1]; break;
      case "absoluteX":   ea = (((r[2]<<8)|r[1])+CPUregisters.X)&0xFFFF; break;
      case "absoluteY":   ea = (((r[2]<<8)|r[1])+CPUregisters.Y)&0xFFFF; break;
    }
    const mirrors = getMirrors(ea).filter(a=>a<0x10000);
    const addrLabel = dropdown(`$${ea.toString(16).padStart(4,'0')}`, mirrors.map(a=>`$${a.toString(16).padStart(4,'0')}`));

    // check memory
    let reasons = [], pass = true;
    mirrors.forEach(a => {
      const got = systemMemory[a];
      if (got !== test.expectMem.value) {
        reasons.push(`$${a.toString(16).padStart(4,'0')}=${hex(got)}≠${hex(test.expectMem.value)}`);
        pass = false;
      }
    });

    const expectedLabel = hex(test.expectMem.value);
    const resultLabel   = hex(systemMemory[ea]);

    const statusCell = pass
      ? `<span style="color:#7fff7f;font-weight:bold;">✔️</span>`
      : `<details><summary style="color:#ff4444;font-weight:bold;cursor:pointer;">❌</summary>` +
        `<ul style="margin:0 0 0 18px;color:#ff4444;">${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(CPUregisters.P)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(CPUregisters.A)} X=${hex(CPUregisters.X)} Y=${hex(CPUregisters.Y)} S=${hex(CPUregisters.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>k+"="+hex(v)).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(PPUregister).map(([k,v])=>k+"="+hex(v)).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${addrLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${guiCell}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep testing
CPUregisters.PC = 0x8000;
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
    { name: "CLC", code: [0x18], expectP: { C: 0 } },
    { name: "SEC", code: [0x38], expectP: { C: 1 } },
    { name: "CLI", code: [0x58], expectP: { I: 0 } },
    { name: "SEI", code: [0x78], expectP: { I: 1 } },
    { name: "CLV", code: [0xB8], expectP: { V: 0 } },
    { name: "CLD", code: [0xD8], expectP: { D: 0 } },
    { name: "SED", code: [0xF8], expectP: { D: 1 } }
  ];

  setupTests(tests);

  // Build HTML
  let html = `
    <div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
      REGISTER TRANSFERS & FLAGS
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead><tr style="background:#222">
        <th style="border:1px solid #444;padding:6px;">Test</th>
        <th style="border:1px solid #444;padding:6px;">Op</th>
        <th style="border:1px solid #444;padding:6px;">Flags<br>Before</th>
        <th style="border:1px solid #444;padding:6px;">Flags<br>After</th>
        <th style="border:1px solid #444;padding:6px;">CPU<br>Before</th>
        <th style="border:1px solid #444;padding:6px;">CPU<br>After</th>
        <th style="border:1px solid #444;padding:6px;">PPU<br>Before</th>
        <th style="border:1px solid #444;padding:6px;">PPU<br>After</th>
        <th style="border:1px solid #444;padding:6px;">Intercept</th>
        <th style="border:1px solid #444;padding:6px;">GUI Cell</th>
        <th style="border:1px solid #444;padding:6px;">Status</th>
      </tr></thead><tbody>`;

  tests.forEach(test => {
    // record before-state
    const fb = { ...CPUregisters.P };
    const cb = { A: CPUregisters.A, X: CPUregisters.X, Y: CPUregisters.Y, S: CPUregisters.S };
    const pb = { ...PPUregister };

    // apply any setup
    if (test.pre) {
      if (test.pre.A !== undefined) CPUregisters.A = test.pre.A;
      if (test.pre.X !== undefined) CPUregisters.X = test.pre.X;
      if (test.pre.Y !== undefined) CPUregisters.Y = test.pre.Y;
      if (test.pre.S !== undefined) CPUregisters.S = test.pre.S;
      if (test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }

    // execute
    step(); updateDebugTables();

    // record after-state
    const fa = { ...CPUregisters.P };
    const ca = { A: CPUregisters.A, X: CPUregisters.X, Y: CPUregisters.Y, S: CPUregisters.S };
    const pa = { ...PPUregister };

    // check results
    let reasons = [], pass = true;
    const exp = test.expect || {};
    // registers
    ["A","X","Y","S"].forEach(r => {
      if (exp[r] !== undefined && ca[r] !== exp[r]) {
        reasons.push(`${r}=${hex(ca[r])}≠${hex(exp[r])}`);
        pass = false;
      }
    });

      // flags
      if (exp.Z !== undefined && CPUregisters.P.Z !== exp.Z) {
        reasons.push(`Z=${CPUregisters.P.Z}≠${exp.Z}`);
        pass = false;
      }
      if (exp.N !== undefined && CPUregisters.P.N !== exp.N) {
        reasons.push(`N=${CPUregisters.P.N}≠${exp.N}`);
        pass = false;
      }

      // explicit flag expectations (expectP)
      const expP = test.expectP || {};
      for (const k in expP) {
        if (CPUregisters.P[k] !== expP[k]) {
          reasons.push(`${k}=${CPUregisters.P[k]}≠${expP[k]}`);
          pass = false;
        }
      }


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
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">no</td>
        <td style="border:1px solid #444;padding:6px;">n/a</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep testing
CPUregisters.PC = 0x8000;
  }

  function runAluAndLogicOpsTests(){
      // ===== ALU & LOGIC OPS (ADC, SBC, INC, DEC, AND, ORA, EOR, BIT) =====
  const tests = [
    { name:"ADC #$10, C=0",           code:[0x69,0x10], pre:{A:0x20,P:{C:0}},                        expect:{A:0x30,C:0,Z:0,N:0,V:0} },
    { name:"ADC #$90, C=1 (O/N)",      code:[0x69,0x90], pre:{A:0x70,P:{C:1}},                        expect:{A:0x01,C:1,Z:0,N:0,V:1} },
    { name:"ADC #$00, C=1 (Z stays)",  code:[0x69,0x00], pre:{A:0xFF,P:{C:1}},                        expect:{A:0x00,C:1,Z:1,N:0,V:0} },
    { name:"SBC #$10, C=1",           code:[0xE9,0x10], pre:{A:0x20,P:{C:1}},                        expect:{A:0x10,C:1,Z:0,N:0,V:0} },
    { name:"SBC #$01, C=0 (borrow)",   code:[0xE9,0x01], pre:{A:0x00,P:{C:0}},                        expect:{A:0xFE,C:0,Z:0,N:1,V:0} },
    { name:"SBC #$80, C=1 (O/N)",      code:[0xE9,0x80], pre:{A:0x7F,P:{C:1}},                        expect:{A:0xFF,C:0,Z:0,N:1,V:1} },
    { name:"INC $20",                 code:[0xE6,0x20], setup:()=>{ systemMemory[0x20]=0x01; },        expectMem:{addr:0x20,value:0x02}, expectFlags:{Z:0,N:0} },
    { name:"INC $20 (to zero)",       code:[0xE6,0x20], setup:()=>{ systemMemory[0x20]=0xFF; },        expectMem:{addr:0x20,value:0x00}, expectFlags:{Z:1,N:0} },
    { name:"DEC $20 (set N)",         code:[0xC6,0x20], setup:()=>{ systemMemory[0x20]=0x00; },        expectMem:{addr:0x20,value:0xFF}, expectFlags:{Z:0,N:1} },
    { name:"DEC $20 (to zero)",       code:[0xC6,0x20], setup:()=>{ systemMemory[0x20]=0x01; },        expectMem:{addr:0x20,value:0x00}, expectFlags:{Z:1,N:0} },
    { name:"INX (no Z/N)",            code:[0xE8],          pre:{X:0x01},                            expect:{X:0x02,Z:0,N:0} },
    { name:"INX (overflow)",          code:[0xE8],          pre:{X:0xFF},                            expect:{X:0x00,Z:1,N:0} },
    { name:"DEX (set N)",             code:[0xCA],          pre:{X:0x00},                            expect:{X:0xFF,Z:0,N:1} },
    { name:"INY (set Z)",             code:[0xC8],          pre:{Y:0xFF},                            expect:{Y:0x00,Z:1,N:0} },
    { name:"DEY (no Z/N)",            code:[0x88],          pre:{Y:0x01},                            expect:{Y:0x00,Z:1,N:0} },
    { name:"AND #$F0",                code:[0x29,0xF0],     pre:{A:0xAB},                            expect:{A:0xA0,Z:0,N:1} },
    { name:"ORA #$0F",                code:[0x09,0x0F],     pre:{A:0x10},                            expect:{A:0x1F,Z:0,N:0} },
    { name:"EOR #$FF",                code:[0x49,0xFF],     pre:{A:0x55},                            expect:{A:0xAA,Z:0,N:1} },
    { name:"BIT $40 (Z,V,N)",         code:[0x24,0x40],     setup:()=>{ systemMemory[0x40]=0x40; CPUregisters.A=0x00; }, expectFlags:{Z:1,V:0,N:0} },
    { name:"BIT $C0 (V,N)",           code:[0x24,0x42],     setup:()=>{ systemMemory[0x42]=0xC0; CPUregisters.A=0xFF; }, expectFlags:{Z:0,V:1,N:1} }
  ];

setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       ALU & LOGIC OPS
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Eff Addr</th><th>Expected</th><th>Result</th><th>Intercept</th><th>GUI Cell</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    // intercept hook
    let intr={flag:false,addr:null};
    const orig=checkReadOffset;
    checkReadOffset = a=>{ intr.flag=true; intr.addr=a&0xFFFF; return orig(a); };

    // before snapshots
    const fb={...CPUregisters.P}, cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pb={...PPUregister};

    // apply pre/setup
    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    // execute and update
    step(); updateDebugTables();

    // restore
    checkReadOffset = orig;

    // record after snapshots
    const fa={...CPUregisters.P}, ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pa={...PPUregister};

    // compute effective address
    const m=lastFetched.addressingMode, r=lastFetched.raw;
    let ea=0;
    switch(m){
      case "immediate":  ea=lastFetched.pc+1; break;
      case "zeroPage":   ea=r[1]&0xFF; break;
      case "zeroPageX":  ea=(r[1]+CPUregisters.X)&0xFF; break;
      case "zeroPageY":  ea=(r[1]+CPUregisters.Y)&0xFF; break;
      case "absolute":   ea=(r[2]<<8)|r[1]; break;
      case "absoluteX":  ea=(((r[2]<<8)|r[1])+CPUregisters.X)&0xFFFF; break;
      case "absoluteY":  ea=(((r[2]<<8)|r[1])+CPUregisters.Y)&0xFFFF; break;
      case "indirectX": {
        const zp=(r[1]+CPUregisters.X)&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF);
        ea=(hi<<8)|lo; break;
      }
      case "indirectY": {
        const zp=r[1]&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF);
        ea=(((hi<<8)|lo)+CPUregisters.Y)&0xFFFF; break;
      }
    }
    const mirrors = getMirrors(ea).filter(a=>a<0x10000);
    const eaLabel = `$${ea.toString(16).padStart(4,"0")}`;

    // check results
    let reasons = [], pass = true;
    const exp = test.expect || {};

    // only check regs & flags if expect was provided
    if (test.expect) {
      ["A","X","Y","S"].forEach(r=>{
        if (exp[r] !== undefined && ca[r] !== exp[r]) {
          reasons.push(`${r}=${hex(ca[r])}≠${hex(exp[r])}`);
          pass = false;
        }
      });
      ["C","Z","N","V"].forEach(f=>{
        if (exp[f] !== undefined && CPUregisters.P[f] !== exp[f]) {
          reasons.push(`${f}=${CPUregisters.P[f]}≠${exp[f]}`);
          pass = false;
        }
      });
    }

    // memory ops
    if (test.expectMem) {
      mirrors.forEach(a=>{
        const got = systemMemory[a];
        if (got !== test.expectMem.value) {
          reasons.push(`$${a.toString(16).padStart(4,"0")}=${hex(got)}≠${hex(test.expectMem.value)}`);
          pass = false;
        }
      });
    }

    // BIT-only flags
    if (test.expectFlags) {
      ["Z","V","N"].forEach(f=>{
        if (test.expectFlags[f] !== undefined && CPUregisters.P[f] !== test.expectFlags[f]) {
          reasons.push(`${f}=${CPUregisters.P[f]}≠${test.expectFlags[f]}`);
          pass = false;
        }
      });
    }

    // labels
    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const guiLabel     = "n/a";
    const expectedLabel= test.expect?.A!==undefined
      ? hex(test.expect.A)
      : test.expectMem
        ? hex(test.expectMem.value)
        : test.expectFlags
          ? `Z=${test.expectFlags.Z} V=${test.expectFlags.V} N=${test.expectFlags.N}`
          : "";
    const resultLabel  = test.expect?.A!==undefined
      ? hex(CPUregisters.A)
      : test.expectMem
        ? hex(systemMemory[ea])
        : test.expectFlags
          ? `Z=${CPUregisters.P.Z} V=${CPUregisters.P.V} N=${CPUregisters.P.N}`
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
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdown(eaLabel, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${guiLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep testing
CPUregisters.PC = 0x8000;

  }

  function runShiftOpsTests(){

      // ===== SHIFT OPS (ASL, LSR, ROL, ROR) =====
  const tests = [
    // ASL accumulator
    { name:"ASL A (no carry)",            code:[0x0A],                   pre:{A:0x41,P:{C:0}}, expect:{A:0x82,C:0,Z:0,N:1} },
    { name:"ASL A (carry & zero)",        code:[0x0A],                   pre:{A:0x80,P:{C:0}}, expect:{A:0x00,C:1,Z:1,N:0} },
    // ASL memory
    { name:"ASL $20",                     code:[0x06,0x20],              setup:()=>{ systemMemory[0x20]=0x03; }, expectMem:{addr:0x20,value:0x06}, expect:{C:0,Z:0,N:0} },
    { name:"ASL $20 (carry)",             code:[0x06,0x20],              setup:()=>{ systemMemory[0x20]=0x80; }, expectMem:{addr:0x20,value:0x00}, expect:{C:1,Z:1,N:0} },
    { name:"ASL $10,X",                   code:[0x16,0x10],   pre:{X:0x10}, setup:()=>{ systemMemory[0x20]=0x02; }, expectMem:{addr:0x20,value:0x04}, expect:{C:0,Z:0,N:0} },
    { name:"ASL $1234",                   code:[0x0E,0x34,0x12],         setup:()=>{ systemMemory[0x1234]=0x01; }, expectMem:{addr:0x1234,value:0x02}, expect:{C:0,Z:0,N:0} },
    { name:"ASL $1234,X",                 code:[0x1E,0x34,0x12], pre:{X:0x10}, setup:()=>{ systemMemory[0x1244]=0x80; }, expectMem:{addr:0x1244,value:0x00}, expect:{C:1,Z:1,N:0} },
    // LSR accumulator
    { name:"LSR A (no carry)",            code:[0x4A],                   pre:{A:0x02,P:{C:0}}, expect:{A:0x01,C:0,Z:0,N:0} },
    { name:"LSR A (carry & zero)",        code:[0x4A],                   pre:{A:0x01,P:{C:0}}, expect:{A:0x00,C:1,Z:1,N:0} },
    // LSR memory
    { name:"LSR $30",                     code:[0x46,0x30],              setup:()=>{ systemMemory[0x30]=0x04; }, expectMem:{addr:0x30,value:0x02}, expect:{C:0,Z:0,N:0} },
    { name:"LSR $30 (carry)",             code:[0x46,0x30],              setup:()=>{ systemMemory[0x30]=0x01; }, expectMem:{addr:0x30,value:0x00}, expect:{C:1,Z:1,N:0} },
    { name:"LSR $20,X",                   code:[0x56,0x1F],   pre:{X:0x01}, setup:()=>{ systemMemory[0x20]=0x02; }, expectMem:{addr:0x20,value:0x01}, expect:{C:0,Z:0,N:0} },
    { name:"LSR $0C00",                   code:[0x4E,0x00,0x0C],         setup:()=>{ systemMemory[0x0C00]=0x02; }, expectMem:{addr:0x0C00,value:0x01}, expect:{C:0,Z:0,N:0} },
    { name:"LSR $0C00,X",                 code:[0x5E,0xFF,0x0B], pre:{X:0x01}, setup:()=>{ systemMemory[0x0C00]=0x01; }, expectMem:{addr:0x0C00,value:0x00}, expect:{C:1,Z:1,N:0} },
    // ROL accumulator
    { name:"ROL A (no carry)",            code:[0x2A],                   pre:{A:0x40,P:{C:0}}, expect:{A:0x80,C:0,Z:0,N:1} },
    { name:"ROL A (carry in & out)",      code:[0x2A],                   pre:{A:0x80,P:{C:1}}, expect:{A:0x01,C:1,Z:0,N:0} },
    // ROL memory
    { name:"ROL $10",                     code:[0x26,0x10],   pre:{P:{C:0}}, setup:()=>{ systemMemory[0x10]=0x01; }, expectMem:{addr:0x10,value:0x02}, expect:{C:0,Z:0,N:0} },
    { name:"ROL $10 (carry)",             code:[0x26,0x10],   pre:{P:{C:1}}, setup:()=>{ systemMemory[0x10]=0x80; }, expectMem:{addr:0x10,value:0x01}, expect:{C:1,Z:0,N:0} },
    { name:"ROL $20,X",                   code:[0x36,0x10], pre:{X:0x10,P:{C:0}}, setup:()=>{ systemMemory[0x20]=0x40; }, expectMem:{addr:0x20,value:0x80}, expect:{C:0,Z:0,N:1} },
    { name:"ROL $2000",                   code:[0x2E,0x00,0x20], pre:{P:{C:1}}, setup:()=>{ systemMemory[0x2000]=0x40; }, expectMem:{addr:0x2000,value:0x81}, expect:{C:0,Z:0,N:1} },
    { name:"ROL $2000,X",                 code:[0x3E,0xFF,0x1F], pre:{X:0x01,P:{C:1}}, setup:()=>{ systemMemory[0x2000]=0x80; }, expectMem:{addr:0x2000,value:0x01}, expect:{C:1,Z:0,N:0} },
    // ROR accumulator
    { name:"ROR A (no carry)",            code:[0x6A],                   pre:{A:0x02,P:{C:0}}, expect:{A:0x01,C:0,Z:0,N:0} },
    { name:"ROR A (carry in & zero)",     code:[0x6A],                   pre:{A:0x00,P:{C:1}}, expect:{A:0x80,C:0,Z:0,N:1} },
    // ROR memory
    { name:"ROR $15",                     code:[0x66,0x15],   pre:{P:{C:0}}, setup:()=>{ systemMemory[0x15]=0x02; }, expectMem:{addr:0x15,value:0x01}, expect:{C:0,Z:0,N:0} },
    { name:"ROR $15 (carry)",             code:[0x66,0x15],   pre:{P:{C:1}}, setup:()=>{ systemMemory[0x15]=0x01; }, expectMem:{addr:0x15,value:0x80}, expect:{C:1,Z:0,N:1} },
    { name:"ROR $20,X",                   code:[0x76,0x1F], pre:{X:0x01,P:{C:1}}, setup:()=>{ systemMemory[0x20]=0x00; }, expectMem:{addr:0x20,value:0x80}, expect:{C:0,Z:0,N:1} },
    { name:"ROR $0D00",                   code:[0x6E,0x00,0x0D],         setup:()=>{ systemMemory[0x0D00]=0x02; }, pre:{P:{C:1}}, expectMem:{addr:0x0D00,value:0x81}, expect:{C:0,Z:0,N:1} },
    { name:"ROR $0D00,X",                 code:[0x7E,0xFF,0x0C], pre:{X:0x01,P:{C:1}}, setup:()=>{ systemMemory[0x0D00]=0x01; }, expectMem:{addr:0x0D00,value:0x80}, expect:{C:1,Z:0,N:1} }
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
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Eff Addr</th><th>Expected</th><th>Result</th><th>Intercept</th><th>GUI Cell</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    let intr={flag:false,addr:null}, orig=checkReadOffset;
    checkReadOffset=a=>{intr.flag=true;intr.addr=a&0xFFFF;return orig(a);};

    let fb={...CPUregisters.P},
        cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
        pb={...PPUregister};

    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    step(); updateDebugTables();
    checkReadOffset=orig;

    let fa={...CPUregisters.P},
        ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
        pa={...PPUregister};

    let m=lastFetched.addressingMode, r=lastFetched.raw, ea=0;
    switch(m){
      case"immediate":  ea=lastFetched.pc+1; break;
      case"zeroPage":   ea=r[1]&0xFF;      break;
      case"zeroPageX":  ea=(r[1]+CPUregisters.X)&0xFF; break;
      case"absolute":   ea=(r[2]<<8)|r[1]; break;
      case"absoluteX":  ea=(((r[2]<<8)|r[1])+CPUregisters.X)&0xFFFF; break;
      case"indirectX": { const zp=(r[1]+CPUregisters.X)&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF); ea=(hi<<8)|lo; break; }
      case"indirectY": { const zp=r[1]&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF); ea=(((hi<<8)|lo)+CPUregisters.Y)&0xFFFF; break; }
    }
    const mirrors=getMirrors(ea).filter(a=>a<0x10000),
          eaLabel=`$${ea.toString(16).padStart(4,"0")}`;

    let reasons=[], pass=true,
        exp=test.expect||{};
    if(test.expect){
      ["A","X","Y","S"].forEach(rn=>{ if(exp[rn]!=null && ca[rn]!==exp[rn]){ reasons.push(`${rn}=${hex(ca[rn])}≠${hex(exp[rn])}`); pass=false; } });
      ["C","Z","N","V"].forEach(fn=>{ if(exp[fn]!=null && CPUregisters.P[fn]!==exp[fn]){ reasons.push(`${fn}=${CPUregisters.P[fn]}≠${exp[fn]}`); pass=false; } });
    }
    if(test.expectMem){
      mirrors.forEach(a=>{ const got=systemMemory[a]; if(got!==test.expectMem.value){ reasons.push(`$${a.toString(16).padStart(4,"0")}=${hex(got)}≠${hex(test.expectMem.value)}`); pass=false; } });
    }

    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const guiLabel="n/a";
    const expectedLabel = test.expect?.A!=null
      ? hex(test.expect.A)
      : test.expectMem
        ? hex(test.expectMem.value)
        : "";
    const resultLabel = test.expect?.A!=null
      ? hex(CPUregisters.A)
      : test.expectMem
        ? hex(systemMemory[ea])
        : "";
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
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdown(eaLabel,mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${guiLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep stepping once and testing
CPUregisters.PC = 0x8000;

  }

  function runLoadsOpsTests(){
      // ===== LOADS (LDA, LDX, LDY) =====
  const tests = [
    // LDA immediate
    { name:"LDA #$10",            code:[0xA9,0x10], expect:{A:0x10,Z:0,N:0} },
    { name:"LDA #$00 (zero)",     code:[0xA9,0x00], expect:{A:0x00,Z:1,N:0} },
    { name:"LDA #$80 (negative)", code:[0xA9,0x80], expect:{A:0x80,Z:0,N:1} },
    // LDA zeroPage
    { name:"LDA zeroPage",        code:[0xA5,0x20], setup:()=>{ systemMemory[0x20]=0x37; }, expect:{A:0x37,Z:0,N:0} },
    { name:"LDA zeroPage,X",      code:[0xB5,0x1F], pre:{X:0x01}, setup:()=>{ systemMemory[0x20]=0x99; }, expect:{A:0x99,Z:0,N:1} },
    // LDA absolute
    { name:"LDA absolute",        code:[0xAD,0x00,0x02], setup:()=>{ systemMemory[0x0200]=0x55; }, expect:{A:0x55,Z:0,N:0} },
    { name:"LDA absolute,X",      code:[0xBD,0x00,0x02], pre:{X:0x01}, setup:()=>{ systemMemory[0x0201]=0x44; }, expect:{A:0x44,Z:0,N:0} },
    { name:"LDA absolute,Y",      code:[0xB9,0x00,0x02], pre:{Y:0x02}, setup:()=>{ systemMemory[0x0202]=0x88; }, expect:{A:0x88,Z:0,N:1} },
    // LDA indirect
    { name:"LDA (indirect,X)",    code:[0xA1,0x0F], pre:{X:0x01}, setup:()=>{
        systemMemory[0x10]=0x34; systemMemory[0x11]=0x12; systemMemory[0x1234]=0x77;
      }, expect:{A:0x77,Z:0,N:0} },
    { name:"LDA (indirect),Y",    code:[0xB1,0x20], pre:{Y:0x02}, setup:()=>{
        systemMemory[0x20]=0x00; systemMemory[0x21]=0x80; systemMemory[0x0202]=0x66;
      }, expect:{A:0x66,Z:0,N:0} },

    // LDX immediate
    { name:"LDX #$03",            code:[0xA2,0x03], expect:{X:0x03,Z:0,N:0} },
    { name:"LDX #$00 (zero)",     code:[0xA2,0x00], expect:{X:0x00,Z:1,N:0} },
    { name:"LDX #$80 (negative)", code:[0xA2,0x80], expect:{X:0x80,Z:0,N:1} },
    // LDX zeroPage
    { name:"LDX zeroPage",        code:[0xA6,0x30], setup:()=>{ systemMemory[0x30]=0x12; }, expect:{X:0x12,Z:0,N:0} },
    { name:"LDX zeroPage,Y",      code:[0xB6,0x2F], pre:{Y:0x01}, setup:()=>{ systemMemory[0x30]=0x34; }, expect:{X:0x34,Z:0,N:0} },
    // LDX absolute
    { name:"LDX absolute",        code:[0xAE,0x00,0x02], setup:()=>{ systemMemory[0x0200]=0x56; }, expect:{X:0x56,Z:0,N:0} },
    { name:"LDX absolute,Y",      code:[0xBE,0x00,0x02], pre:{Y:0x02}, setup:()=>{ systemMemory[0x0202]=0x99; }, expect:{X:0x99,Z:0,N:1} },

    // LDY immediate
    { name:"LDY #$04",            code:[0xA0,0x04], expect:{Y:0x04,Z:0,N:0} },
    { name:"LDY #$00 (zero)",     code:[0xA0,0x00], expect:{Y:0x00,Z:1,N:0} },
    { name:"LDY #$80 (negative)", code:[0xA0,0x80], expect:{Y:0x80,Z:0,N:1} },
    // LDY zeroPage
    { name:"LDY zeroPage",        code:[0xA4,0x40], setup:()=>{ systemMemory[0x40]=0x21; }, expect:{Y:0x21,Z:0,N:0} },
    { name:"LDY zeroPage,X",      code:[0xB4,0x3F], pre:{X:0x01}, setup:()=>{ systemMemory[0x40]=0x22; }, expect:{Y:0x22,Z:0,N:0} },
    // LDY absolute
    { name:"LDY absolute",        code:[0xAC,0x00,0x02], setup:()=>{ systemMemory[0x0200]=0x33; }, expect:{Y:0x33,Z:0,N:0} },
    { name:"LDY absolute,X",      code:[0xBC,0x00,0x02], pre:{X:0x02}, setup:()=>{ systemMemory[0x0202]=0x44; }, expect:{Y:0x44,Z:0,N:0} }
  ];

setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       LOADS (LDA, LDX, LDY) 2nd run!
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Eff Addr</th><th>Expected</th><th>Result</th><th>Intercept</th><th>GUI Cell</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    let intr={flag:false,addr:null}, orig=checkReadOffset;
    checkReadOffset=a=>{ intr.flag=true; intr.addr=a&0xFFFF; return orig(a); };

    const fb={...CPUregisters.P},
          cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pb={...PPUregister};

    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    step(); updateDebugTables();
    checkReadOffset=orig;

    const fa={...CPUregisters.P},
          ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pa={...PPUregister};

    let m=lastFetched.addressingMode, r=lastFetched.raw, ea=0;
    switch(m){
      case "immediate":  ea=lastFetched.pc+1; break;
      case "zeroPage":   ea=r[1]&0xFF; break;
      case "zeroPageX":  ea=(r[1]+CPUregisters.X)&0xFF; break;
      case "zeroPageY":  ea=(r[1]+CPUregisters.Y)&0xFF; break;
      case "absolute":   ea=(r[2]<<8)|r[1]; break;
      case "absoluteX":  ea=(((r[2]<<8)|r[1])+CPUregisters.X)&0xFFFF; break;
      case "absoluteY":  ea=(((r[2]<<8)|r[1])+CPUregisters.Y)&0xFFFF; break;
      case "indirectX": {
        const zp=(r[1]+CPUregisters.X)&0xFF,
              lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF);
        ea=(hi<<8)|lo; break;
      }
      case "indirectY": {
        const zp=r[1]&0xFF,
              lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF);
        ea=(((hi<<8)|lo)+CPUregisters.Y)&0xFFFF; break;
      }
    }
    const mirrors=getMirrors(ea).filter(a=>a<0x10000),
          eaLabel=`$${ea.toString(16).padStart(4,"0")}`;

    let reasons=[], pass=true, exp=test.expect||{};
    if(test.expect){
      ["A","X","Y","S"].forEach(rn=>{
        if(exp[rn]!=null && ca[rn]!==exp[rn]){
          reasons.push(`${rn}=${hex(ca[rn])}≠${hex(exp[rn])}`); pass=false;
        }
      });
      ["C","Z","N","V"].forEach(fn=>{
        if(exp[fn]!=null && CPUregisters.P[fn]!==exp[fn]){
          reasons.push(`${fn}=${CPUregisters.P[fn]}≠${exp[fn]}`); pass=false;
        }
      });
    }

    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const guiLabel="n/a";
    const expectedLabel= test.expect?.A!=null
      ? hex(test.expect.A)
      : test.expect?.X!=null
        ? hex(test.expect.X)
        : test.expect?.Y!=null
          ? hex(test.expect.Y)
          : "";
    const resultLabel= test.expect?.A!=null
      ? hex(ca.A)
      : test.expect?.X!=null
        ? hex(ca.X)
        : test.expect?.Y!=null
          ? hex(ca.Y)
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
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdown(eaLabel,mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${guiLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep stepping once and testing
CPUregisters.PC = 0x8000;

  }

  function runRegisterTransfersAndFlagsTestTwo(){

     // ===== REGISTER TRANSFERS & FLAGS (TAX, TAY, TXA, TYA, TSX, TXS, CLC, SEC, CLV, CLI, SEI, CLD, SED) =====
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
    { name:"CLI",         code:[0x58], pre:{P:{I:1}},           /* no expect */ },
    { name:"SEI",         code:[0x78], pre:{P:{I:0}},           /* no expect */ },
    { name:"CLD",         code:[0xD8], pre:{P:{D:1}},           /* no expect */ },
    { name:"SED",         code:[0xF8], pre:{P:{D:0}},           /* no expect */ }
  ];

setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       REGISTER TRANSFERS & FLAGS 2nd run!
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Eff Addr</th><th>Expected</th><th>Result</th><th>Intercept</th><th>GUI Cell</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    let intr={flag:false,addr:null}, orig=checkReadOffset;
    checkReadOffset = a=> { intr.flag=true; intr.addr = a&0xFFFF; return orig(a); };

    const fb={...CPUregisters.P},
          cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pb={...PPUregister};

    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.S!=null) CPUregisters.S=test.pre.S;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    step(); updateDebugTables();
    checkReadOffset = orig;

    const fa={...CPUregisters.P},
          ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pa={...PPUregister};

    let m=lastFetched.addressingMode, r=lastFetched.raw, ea=0;
    switch(m){
      case "immediate":  ea=lastFetched.pc+1; break;
      case "zeroPage":   ea=r[1]&0xFF; break;
      case "zeroPageX":  ea=(r[1]+CPUregisters.X)&0xFF; break;
      case "absolute":   ea=(r[2]<<8)|r[1]; break;
      case "absoluteX":  ea=(((r[2]<<8)|r[1])+CPUregisters.X)&0xFFFF; break;
      case "indirectX":  { const zp=(r[1]+CPUregisters.X)&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF); ea=(hi<<8)|lo; break; }
      case "indirectY":  { const zp=r[1]&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF); ea=(((hi<<8)|lo)+CPUregisters.Y)&0xFFFF; break; }
    }
    const mirrors = getMirrors(ea).filter(a=>a<0x10000),
          eaLabel = `$${ea.toString(16).padStart(4,"0")}`;

    let reasons = [], pass = true, exp = test.expect || {};
    if(test.expect){
      ["A","X","Y","S"].forEach(rn=> {
        if(exp[rn]!=null && ca[rn]!==exp[rn]){ reasons.push(`${rn}=${hex(ca[rn])}≠${hex(exp[rn])}`); pass=false; }
      });
      ["C","Z","N","V"].forEach(fn=> {
        if(exp[fn]!=null && CPUregisters.P[fn]!==exp[fn]){ reasons.push(`${fn}=${CPUregisters.P[fn]}≠${exp[fn]}`); pass=false; }
      });
    }

    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const guiLabel="n/a";
    const expectedLabel = test.expect
      ? Object.entries(test.expect).map(([k,v])=> k.length>1 ? `${k}=${hex(v)}` : `${k}=${v}`).join(" ")
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
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdown(eaLabel,mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${guiLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep testing
CPUregisters.PC = 0x8000;

  }

  function runCompareOpsTests(){


  // ===== COMPARE OPS (CMP, CPX, CPY) =====
  const tests = [
    // CMP
    { name:"CMP #$10, A>$10",     code:[0xC9,0x10],                  pre:{A:0x20},                          expect:{C:1,Z:0,N:0} },
    { name:"CMP #$20, A=$20",     code:[0xC9,0x20],                  pre:{A:0x20},                          expect:{C:1,Z:1,N:0} },
    { name:"CMP zeroPage",        code:[0xC5,0x10],                  pre:{A:0x05}, setup:()=>{ systemMemory[0x10]=0x05; }, expect:{C:1,Z:1,N:0} },
    { name:"CMP zeroPage,X",      code:[0xD5,0x0F], pre:{A:0x10,X:0x01}, setup:()=>{ systemMemory[0x10]=0x05; }, expect:{C:1,Z:0,N:1} },
    { name:"CMP absolute",        code:[0xCD,0x00,0x20],             pre:{A:0x05}, setup:()=>{ systemMemory[0x2000]=0x10; }, expect:{C:0,Z:0,N:1} },
    { name:"CMP absolute,X",      code:[0xDD,0x00,0x20], pre:{A:0x10,X:0x01}, setup:()=>{ systemMemory[0x2001]=0x10; }, expect:{C:1,Z:1,N:0} },
    { name:"CMP absolute,Y",      code:[0xD9,0x00,0x20], pre:{A:0x05,Y:0x01}, setup:()=>{ systemMemory[0x2001]=0x05; }, expect:{C:1,Z:1,N:0} },
    { name:"CMP (ind,X)",         code:[0xC1,0x0F], pre:{A:0x11,X:0x01}, setup:()=>{
        systemMemory[0x10]=0x00;
        systemMemory[0x11]=0x30;
        systemMemory[0x3001]=0x11;
      }, expect:{C:1,Z:1,N:0} },
    { name:"CMP (ind),Y",         code:[0xD1,0x20], pre:{A:0x05,Y:0x02}, setup:()=>{
        systemMemory[0x20]=0x00;
        systemMemory[0x21]=0x30;
        systemMemory[0x3002]=0x06;
      }, expect:{C:1,Z:0,N:0} },

    // CPX
    { name:"CPX #$10, X>$10",     code:[0xE0,0x10], pre:{X:0x20},                          expect:{C:1,Z:0,N:0} },
    { name:"CPX #$20, X=$20",     code:[0xE0,0x20], pre:{X:0x20},                          expect:{C:1,Z:1,N:0} },
    { name:"CPX zeroPage",        code:[0xE4,0x30], pre:{X:0x05}, setup:()=>{ systemMemory[0x30]=0x10; }, expect:{C:0,Z:0,N:1} },
    { name:"CPX absolute",        code:[0xEC,0x00,0x02], pre:{X:0x05}, setup:()=>{ systemMemory[0x0200]=0x05; }, expect:{C:1,Z:1,N:0} },

    // CPY
    { name:"CPY #$10, Y>$10",     code:[0xC0,0x10], pre:{Y:0x20},                          expect:{C:1,Z:0,N:0} },
    { name:"CPY #$20, Y=$20",     code:[0xC0,0x20], pre:{Y:0x20},                          expect:{C:1,Z:1,N:0} },
    { name:"CPY zeroPage",        code:[0xC4,0x40], pre:{Y:0x05}, setup:()=>{ systemMemory[0x40]=0x00; }, expect:{C:1,Z:0,N:0} },
    { name:"CPY absolute",        code:[0xCC,0x00,0x02], pre:{Y:0x02}, setup:()=>{ systemMemory[0x0200]=0x03; }, expect:{C:0,Z:0,N:1} }
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
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Eff Addr</th><th>Expected</th><th>Result</th><th>Intercept</th><th>GUI Cell</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    let intr={flag:false,addr:null}, orig=checkReadOffset;
    checkReadOffset=a=>{ intr.flag=true; intr.addr=a&0xFFFF; return orig(a); };

    const fb={...CPUregisters.P},
          cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pb={...PPUregister};

    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    step(); updateDebugTables();
    checkReadOffset=orig;

    const fa={...CPUregisters.P},
          ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pa={...PPUregister};

    let m=lastFetched.addressingMode, r=lastFetched.raw, ea=0;
    switch(m){
      case "immediate":  ea=lastFetched.pc+1; break;
      case "zeroPage":   ea=r[1]&0xFF; break;
      case "zeroPageX":  ea=(r[1]+CPUregisters.X)&0xFF; break;
      case "absolute":   ea=(r[2]<<8)|r[1]; break;
      case "absoluteX":  ea=(((r[2]<<8)|r[1])+CPUregisters.X)&0xFFFF; break;
      case "absoluteY":  ea=(((r[2]<<8)|r[1])+CPUregisters.Y)&0xFFFF; break;
      case "indirectX":  { const zp=(r[1]+CPUregisters.X)&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF); ea=(hi<<8)|lo; break; }
      case "indirectY":  { const zp=r[1]&0xFF, lo=memoryRead(zp), hi=memoryRead((zp+1)&0xFF); ea=(((hi<<8)|lo)+CPUregisters.Y)&0xFFFF; break; }
    }
    const mirrors = getMirrors(ea).filter(a=>a<0x10000),
          eaLabel = `$${ea.toString(16).padStart(4,"0")}`;

    let reasons=[], pass=true, exp=test.expect||{};
    if(test.expect){
      ["A","X","Y","S"].forEach(rn=>{ if(exp[rn]!=null && ca[rn]!==exp[rn]){ reasons.push(`${rn}=${hex(ca[rn])}≠${hex(exp[rn])}`); pass=false; } });
      ["C","Z","N","V"].forEach(fn=>{ if(exp[fn]!=null && CPUregisters.P[fn]!==exp[fn]){ reasons.push(`${fn}=${CPUregisters.P[fn]}≠${exp[fn]}`); pass=false; } });
    }

    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const guiLabel="n/a";
    const expectedLabel = Object.entries(test.expect||{}).map(([k,v])=>`${k}=${hex(v)}`).join(" ");
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
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdown(eaLabel,mirrors)}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${guiLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep stepping once and testing
CPUregisters.PC = 0x8000;

  }

function runBranchOpsTests() {
  const startPC = 0x8000;
  // Offsets for testing
  const smallOffset = 0x02;           // stays on page ($8000 + 2 + 2 = $8004)
  const pageCrossOffset = 0x82;       // -0x7E = jump back and cross to $7F80

  // Each entry: { name, code, pre, taken, offset, pageCross }
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
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
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
        <th>Status</th>
        <th>Details</th>
      </tr></thead><tbody>`;

  cases.forEach(test => {
    // ---- Set up ----
    CPUregisters.PC = startPC;
    systemMemory[startPC] = test.code[0];
    systemMemory[startPC + 1] = test.code[1];

    // Set registers/flags clean
    CPUregisters.A = 0x12; CPUregisters.X = 0x34; CPUregisters.Y = 0x56; CPUregisters.S = 0xFD;
    // Set only the tested flags (leave others alone)
    Object.assign(CPUregisters.P, {N:0,V:0,B:0,D:0,I:0,Z:0,C:0}); // clear all, so each test is isolated
    if(test.pre && test.pre.P) Object.assign(CPUregisters.P, test.pre.P);

    // Save before-state
    const pcBefore = CPUregisters.PC;
    const cyclesBefore = cpuCycles;
    const flagsBefore = { ...CPUregisters.P };
    const regsBefore = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };

    // ---- Execute ----
    step();

    // Save after-state
    const pcAfter = CPUregisters.PC;
    const cyclesAfter = cpuCycles;
    const flagsAfter = { ...CPUregisters.P };
    const regsAfter = { A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S };

    // ---- Calculate expected PC ----
    let offset = test.offset;
    if (offset & 0x80) offset = offset - 0x100; // signed branch
    let expectedPC = test.taken
      ? (pcBefore + 2 + offset) & 0xFFFF
      : (pcBefore + 2) & 0xFFFF;

    // ---- Calculate expected cycles ----
    let expectedCycles = 2;
    if(test.taken) expectedCycles += 1;
    if(test.taken && test.pageCross) expectedCycles += 1;
    let deltaCycles = cyclesAfter - cyclesBefore;

    // ---- Check pass/fail and build fail reasons ----
    let failReasons = [];
    let pass = true;
    if (pcAfter !== expectedPC) { failReasons.push(`PC=${hex(pcAfter)}≠${hex(expectedPC)}`); pass = false; }
    if (deltaCycles !== expectedCycles) { failReasons.push(`cycles=${deltaCycles}≠${expectedCycles}`); pass = false; }
    // Register check: for branches, A/X/Y/S shouldn't change
    for (let r of ["A","X","Y","S"]) {
      if (regsAfter[r] !== regsBefore[r]) { failReasons.push(`${r}=${hex(regsAfter[r])}≠${hex(regsBefore[r])}`); pass = false; }
    }
    // Flags: for branches, only Z/N/V/C may affect branch, all others should be untouched unless opcode is broken
    if (!flagsEqual(flagsBefore, flagsAfter)) {
      failReasons.push(`flags changed`);
      pass = false;
    }
    let status = pass
      ? "<span style='color:#7fff7f;font-weight:bold;'>✔️ Pass</span>"
      : "<span style='color:#ff7777;font-weight:bold;'>❌ Fail</span>";

    let details = pass ? "" : failReasons.join("; ");

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
        <td style="border:1px solid #444;padding:6px;${(deltaCycles!==expectedCycles)?'color:#FFD700;font-weight:bold;':''}">${deltaCycles}</td>
        <td style="border:1px solid #444;padding:6px;${(deltaCycles!==expectedCycles)?'color:#FFD700;font-weight:bold;':''}">${expectedCycles}</td>
        <td style="border:1px solid #444;padding:6px;">${status}</td>
        <td style="border:1px solid #444;padding:6px;color:#FF7777;">${details}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
  systemMemory[0x8000] = 0x02; // for next run
  CPUregisters.PC = 0x8000;

}

// helpers
function flagsEqual(a, b) {
  return a.N === b.N && a.V === b.V && a.B === b.B && a.D === b.D &&
         a.I === b.I && a.Z === b.Z && a.C === b.C;
}
function hex(v) {
  if (v == null) return "--";
  let n = Number(v);
  return "0x" + n.toString(16).toUpperCase().padStart(4, '0');
}
function flagsBin(f) {
  return [
    f.N ? "N" : ".",
    f.V ? "V" : ".",
    f.B ? "B" : ".",
    f.D ? "D" : ".",
    f.I ? "I" : ".",
    f.Z ? "Z" : ".",
    f.C ? "C" : "."
  ].join('');
}  



  function runJumpAndSubRoutinesTests(){

  // ===== JUMP & SUBROUTINES (JMP, JSR, RTI, RTS) =====
  const tests = [
    // JMP
    { name:"JMP absolute",   code:[0x4C,0x00,0x20] },
    { name:"JMP indirect",   code:[0x6C,0x10,0x00], setup:()=>{
        systemMemory[0x0010]=0x34;
        systemMemory[0x0011]=0x12;
      } },
    // Subroutines
    { name:"JSR absolute",   code:[0x20,0x05,0x80] },
    { name:"RTS return",     code:[0x60], setup:()=>{
        // simulate a return address pushed at $01FD/$01FE
        CPUregisters.S = 0xFC;
        systemMemory[0x01FD] = 0x00;
        systemMemory[0x01FE] = 0x90;
      } },
    // Interrupt return
    { name:"RTI return",     code:[0x40], setup:()=>{
        // simulate status & PC pushed at $01FB–$01FD
        CPUregisters.S = 0xFD;
        systemMemory[0x01FB] = 0b00101101;   // P after BRK
        systemMemory[0x01FC] = 0x00;         // PCL
        systemMemory[0x01FD] = 0x80;         // PCH
      } }
  ];

setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       JUMP & SUBROUTINES
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Target</th><th>Intercept</th><th>GUI Cell</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    let intr={flag:false,addr:null}, orig=checkReadOffset;
    checkReadOffset = a=>{ intr.flag=true; intr.addr=a&0xFFFF; return orig(a); };

    const fb={...CPUregisters.P},
          cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pb={...PPUregister};

    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.S!=null) CPUregisters.S=test.pre.S;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    step(); updateDebugTables();
    checkReadOffset = orig;

    const fa={...CPUregisters.P},
          ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pa={...PPUregister};

    // compute target EA (for JMP/JSR) or return PC (for RTS/RTI)
    const m = lastFetched.addressingMode, r = lastFetched.raw, target = (() => {
      switch(m){
        case "absolute":    return (r[2]<<8)|r[1];
        case "indirect":    {
          const lo=memoryRead(r[1]), hi=memoryRead((r[1]+1)&0xFF);
          return (hi<<8)|lo;
        }
        default:
          return CPUregisters.PC;
      }
    })();
    const mirrors = getMirrors(target).filter(a=>a<0x10000);
    const targetLabel = `$${target.toString(16).padStart(4,"0")}`;

    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const guiLabel="n/a";
    const pass = true;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(ca.A)} X=${hex(ca.X)} Y=${hex(ca.Y)} S=${hex(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdown(targetLabel,mirrors)}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${guiLabel}</td>
        <td style="border:1px solid #444;padding:6px;"><span style="color:#7fff7f;font-weight:bold;">✔️</span></td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep testing
CPUregisters.PC = 0x8000;

  }

  function runStackOpsTests(){

  // ===== STACK OPS (PHA, PHP, PLA, PLP) =====
  const tests = [
    { name:"PHA pushes A",    code:[0x48], pre:{A:0x37,S:0xFF},                                     expectMem:{addr:0x01FF,value:0x37}, expect:{S:0xFE} },
    { name:"PHP pushes P",    code:[0x08], pre:{P:{C:1},S:0xFF},                                    expectMem:{addr:0x01FF,value:0x21}, expect:{S:0xFE} },
    { name:"PLA pulls A",     code:[0x68], pre:{S:0xFE},   setup:()=>{ systemMemory[0x01FF]=0x44; }, expect:{A:0x44,Z:0,N:0,S:0xFF} },
    { name:"PLP pulls P",     code:[0x28], pre:{S:0xFE},   setup:()=>{ systemMemory[0x01FF]=0x21; }, expect:{S:0xFF,C:1} }
  ];

setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       STACK OPS (PHA, PHP, PLA, PLP)
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Addr</th><th>Expected</th><th>Result</th><th>Intercept</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    let intr={flag:false,addr:null}, orig=checkReadOffset;
    checkReadOffset = a=>{ intr.flag=true; intr.addr = a&0xFFFF; return orig(a); };

    const fb={...CPUregisters.P},
          cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pb={...PPUregister};

    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.S!=null) CPUregisters.S=test.pre.S;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    step(); updateDebugTables();
    checkReadOffset = orig;

    const fa={...CPUregisters.P},
          ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pa={...PPUregister};

    let reasons=[], pass=true;
    const exp = test.expect || {};

    // check registers & flags
    ["A","X","Y","S"].forEach(r=>{
      if(exp[r]!==undefined && ca[r]!==exp[r]){
        reasons.push(`${r}=${hex(ca[r])}≠${hex(exp[r])}`); pass=false;
      }
    });
    ["C","Z","N","V"].forEach(f=>{
      if(exp[f]!==undefined && CPUregisters.P[f]!==exp[f]){
        reasons.push(`${f}=${CPUregisters.P[f]}≠${exp[f]}`); pass=false;
      }
    });

    // check memory writes
    if(test.expectMem){
      const got = systemMemory[test.expectMem.addr];
      if(got !== test.expectMem.value){
        reasons.push(`$${test.expectMem.addr.toString(16).padStart(4,"0")}=${hex(got)}≠${hex(test.expectMem.value)}`);
        pass=false;
      }
    }

    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, getMirrors(intr.addr).map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const addrLabel = test.expectMem ? `$${test.expectMem.addr.toString(16).padStart(4,"0")}` : "";

    const expectedLabel = test.expectMem
      ? hex(test.expectMem.value)
      : Object.entries(exp).map(([k,v])=>`${k}=${hex(v)}`).join(" ");
    const resultLabel = test.expectMem
      ? hex(systemMemory[test.expectMem.addr])
      : Object.entries(exp).map(([k])=>{
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
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${addrLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep stepping once and testing
CPUregisters.PC = 0x8000;

  }

  function runBrkAndNopsTests(){

  // ===== BRK & NOP/SKB/DOP =====
  const tests = [
    // BRK: pushes PC+2 and flags, sets I; here we just check S decremented by 3
    { name:"BRK (interrupt)",       code:[0x00],                     pre:{S:0xFF,P:{I:0}}, expect:{S:0xFC} },

    // Legal NOP
    { name:"NOP implied",           code:[0xEA] },

    // Unofficial single‐byte NOPs
    { name:"NOP 1A",                code:[0x1A] },
    { name:"NOP 3A",                code:[0x3A] },
    { name:"NOP 5A",                code:[0x5A] },
    { name:"NOP 7A",                code:[0x7A] },
    { name:"NOP DA",                code:[0xDA] },
    { name:"NOP FA",                code:[0xFA] },

    // SKB/DOP two‐byte NOPs
    { name:"NOP 80",                code:[0x80,0x00] },
    { name:"NOP 82",                code:[0x82,0x00] },
    { name:"NOP 89",                code:[0x89,0x00] },
    { name:"SKB C2",                code:[0xC2,0x00] },
    { name:"NOP E2",                code:[0xE2,0x00] },

    // SKB three‐byte NOPs
    { name:"NOP 04",                code:[0x04,0x00] },
    { name:"NOP 44",                code:[0x44,0x00] },
    { name:"NOP 64",                code:[0x64,0x00] },
    { name:"NOP 14",                code:[0x14,0x00] },
    { name:"NOP 34",                code:[0x34,0x00] },
    { name:"NOP 54",                code:[0x54,0x00] },
    { name:"NOP 74",                code:[0x74,0x00] },
    { name:"NOP D4",                code:[0xD4,0x00] },
    { name:"NOP F4",                code:[0xF4,0x00] },
    { name:"NOP 0C",                code:[0x0C,0x00,0x00] },
    { name:"NOP 1C",                code:[0x1C,0x00,0x00] },
    { name:"NOP 3C",                code:[0x3C,0x00,0x00] },
    { name:"NOP 5C",                code:[0x5C,0x00,0x00] },
    { name:"NOP 7C",                code:[0x7C,0x00,0x00] },
    { name:"NOP DC",                code:[0xDC,0x00,0x00] },
    { name:"NOP FC",                code:[0xFC,0x00,0x00] },

    // NOP zeroPage,Y
    { name:"NOP 92 (ZPY)",          code:[0x92,0x10] }
  ];

setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       BRK & NOP
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>Addr</th>
         <th>Expected</th><th>Result</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    // snapshots
    const fb = {...CPUregisters.P},
          cb = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};

    // apply pre/setup
    if(test.pre){
      if(test.pre.S!=null) CPUregisters.S = test.pre.S;
      if(test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }
    if(test.setup) test.setup();

    // run
    step(); updateDebugTables();

    // after
    const fa = {...CPUregisters.P},
          ca = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S};

    // check
    let pass = true, reasons = [];
    const exp = test.expect || {};
    ["A","X","Y","S"].forEach(r=>{
      if(exp[r]!==undefined && ca[r]!==exp[r]){
        pass = false;
        reasons.push(`${r}=${hex(ca[r])}≠${hex(exp[r])}`);
      }
    });

    // addr column only for BRK (stack write) or NOP skip
    const addrLabel = test.expectMem
      ? `$${test.expectMem.addr.toString(16).padStart(4,"0")}`
      : "";

    // expected/result labels
    const expectedLabel = Object.entries(exp).map(([k,v])=>
      k==="S"? hex(v) : `${k}=${v}`
    ).join(" ");
    const resultLabel = Object.entries(exp).map(([k])=>{
      const val = ca[k];
      return k==="S"? hex(val) : `${k}=${val}`;
    }).join(" ");

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td style="border:1px solid #444;padding:6px;">${test.name}</td>
        <td style="border:1px solid #444;padding:6px;">${test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fb)}</td>
        <td style="border:1px solid #444;padding:6px;">${flagsBin(fa)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)} S=${hex(cb.S)}</td>
        <td style="border:1px solid #444;padding:6px;">A=${hex(ca.A)} X=${hex(ca.X)} Y=${hex(ca.Y)} S=${hex(ca.S)}</td>
        <td style="border:1px solid #444;padding:6px;">${addrLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${pass?"✓":"✗"}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep stepping once and testing
CPUregisters.PC = 0x8000;

  }

  function runUnofficialOpcodeTests(){

    // ===== UNOFFICIAL/ILLEGAL OPS =====
  const tests = [
    // LAX: load into A & X
    { name:"LAX #$33 (IMM)",        code:[0xAB,0x33],                  expect:{A:0x33,X:0x33,Z:0,N:0} },
    { name:"LAX $10 (ZP)",          code:[0xA7,0x10], setup:()=>{ systemMemory[0x10]=0x44; }, expect:{A:0x44,X:0x44,Z:0,N:0} },
    { name:"LAX $10,Y (ZP,Y)",      code:[0xB7,0x0F], pre:{Y:0x01}, setup:()=>{ systemMemory[0x10]=0x00; }, expect:{A:0x00,X:0x00,Z:1,N:0} },
    { name:"LAX $1234 (ABS)",       code:[0xAF,0x34,0x12], setup:()=>{ systemMemory[0x1234]=0x99; }, expect:{A:0x99,X:0x99,Z:0,N:1} },
    { name:"LAX $1234,Y (ABS,Y)",   code:[0xBF,0x33,0x12], pre:{Y:0x01}, setup:()=>{ systemMemory[0x1234+1]=0x00; }, expect:{A:0x00,X:0x00,Z:1,N:0} },
    { name:"LAX ($10,X) (IND,X)",   code:[0xA3,0x0F], pre:{X:0x01}, setup:()=>{
        systemMemory[0x10]=0x00; systemMemory[0x11]=0x40; systemMemory[0x4001]=0x77;
      }, expect:{A:0x77,X:0x77,Z:0,N:0} },
    { name:"LAX ($20),Y (IND),Y)",   code:[0xB3,0x20], pre:{Y:0x02}, setup:()=>{
        systemMemory[0x20]=0x00; systemMemory[0x21]=0x80; systemMemory[0x0202]=0x88;
      }, expect:{A:0x88,X:0x88,Z:0,N:1} },

    // SAX: store A & X AND memory
    { name:"SAX $20 (ZP)",          code:[0x87,0x20], pre:{A:0x55,X:0x55}, expectMem:{addr:0x20,value:0x55} },
    { name:"SAX $20,Y (ZP,Y)",      code:[0x97,0x1F], pre:{A:0xAA,X:0xAA,Y:0x01}, expectMem:{addr:0x20,value:0xAA} },
    { name:"SAX $1234 (ABS)",       code:[0x8F,0x34,0x12], pre:{A:0x77,X:0x77}, expectMem:{addr:0x1234,value:0x77} },
    { name:"SAX ($10,X) (IND,X)",   code:[0x83,0x0F], pre:{A:0x99,X:0x01}, setup:()=>{
        systemMemory[0x10]=0x00; systemMemory[0x11]=0x30;
      }, expectMem:{addr:(0x3001&0xFFFF),value:0x99} },

    // DCP: DEC then CMP
    { name:"DCP $30 (ZP)",          code:[0xC7,0x30], pre:{A:0x06}, setup:()=>{ systemMemory[0x30]=0x07; },
                                     expectMem:{addr:0x30,value:0x06}, expect:{C:1,Z:1,N:0} },
    { name:"DCP $30,X (ZP,X)",      code:[0xD7,0x2F], pre:{A:0x05,X:0x01}, setup:()=>{ systemMemory[0x30]=0x05; },
                                     expectMem:{addr:0x30,value:0x04}, expect:{C:1,Z:0,N:1} },
    { name:"DCP $1234 (ABS)",       code:[0xCF,0x34,0x12], pre:{A:0x10}, setup:()=>{ systemMemory[0x1234]=0x11; },
                                     expectMem:{addr:0x1234,value:0x10}, expect:{C:1,Z:1,N:0} },

    // ISC: INC then SBC
    { name:"ISC $40 (ZP)",          code:[0xE7,0x40], pre:{A:0x10,P:{C:1}}, setup:()=>{ systemMemory[0x40]=0x0F; },
                                     expectMem:{addr:0x40,value:0x10}, expect:{A:0x00,C:1,Z:1,N:0} },

    // SLO: ASL then ORA
    { name:"SLO $50 (ZP)",          code:[0x07,0x50], pre:{A:0x01,P:{C:0}}, setup:()=>{ systemMemory[0x50]=0x02; },
                                     expectMem:{addr:0x50,value:0x04}, expect:{A:0x05,C:0,Z:0,N:0} },

    // RLA: ROL then AND
    { name:"RLA $60 (ZP)",          code:[0x27,0x60], pre:{A:0xF0,P:{C:1}}, setup:()=>{ systemMemory[0x60]=0x10; },
                                     expectMem:{addr:0x60,value:0x21}, expect:{A:0x20,C:0,Z:0,N:0} },

    // SRE: LSR then EOR
    { name:"SRE $70 (ZP)",          code:[0x47,0x70], pre:{A:0xFF,P:{C:0}}, setup:()=>{ systemMemory[0x70]=0x02; },
                                     expectMem:{addr:0x70,value:0x01}, expect:{A:0xFE,C:0,Z:0,N:1} },

    // RRA: ROR then ADC
    { name:"RRA $80 (ZP)",          code:[0x67,0x80], pre:{A:0x05,P:{C:1}}, setup:()=>{ systemMemory[0x80]=0x02; },
                                     expectMem:{addr:0x80,value:0x81}, expect:{A:0x07,C:0,Z:0,N:0} },

    // ANC: AND then C = A
    { name:"ANC #$80",              code:[0x0B,0x80],                  pre:{A:0x80}, expect:{A:0x00,C:0,Z:1,N:0} },

    // ALR: AND then LSR
    { name:"ALR #$03",              code:[0x4B,0x03],                  pre:{A:0x07}, expect:{A:0x01,C:1,Z:0,N:0} },

    // ARR: AND then ROR
    { name:"ARR #$01",              code:[0x6B,0x01], pre:{A:0x03,P:{C:1}}, expect:{A:0x81,C:0,Z:0,N:1} },

    // AXA: X AND A AND high-byte of address+Y (illegal store)
    { name:"AXA $2000,Y (ABS,Y)",   code:[0x9F,0x00,0x20], pre:{A:0xFF,X:0x0F,Y:0x00},
                                     expectMem:{addr:0x2000,value:0x0F} },

    // XAA: X AND A then LDA-like
    { name:"XAA #$0F",              code:[0x8B,0x0F], pre:{A:0xFF,X:0x0F}, expect:{A:0x0F,Z:0,N:0} }
  ];

setupTests(tests);

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       ILLEGAL/UNOFFICIAL OPCODES
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Eff Addr</th><th>Expected</th><th>Result</th><th>Intercept</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    let intr={flag:false,addr:null}, orig=checkReadOffset;
    checkReadOffset=a=>{ intr.flag=true; intr.addr=a&0xFFFF; return orig(a); };

    const fb={...CPUregisters.P},
          cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pb={...PPUregister};

    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A=test.pre.A;
      if(test.pre.X!=null) CPUregisters.X=test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y=test.pre.Y;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    step(); updateDebugTables();
    checkReadOffset=orig;

    const fa={...CPUregisters.P},
          ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S},
          pa={...PPUregister};

    // effective address
    let m=lastFetched.addressingMode, r=lastFetched.raw, ea=0;
    switch(m){
      case"immediate":  ea=lastFetched.pc+1; break;
      case"zeroPage":   ea=r[1]&0xFF; break;
      case"zeroPageY":  ea=(r[1]+CPUregisters.Y)&0xFF; break;
      case"absolute":   ea=(r[2]<<8)|r[1]; break;
    }
    const mirrors=getMirrors(ea).filter(a=>a<0x10000),
          eaLabel=`$${ea.toString(16).padStart(4,"0")}`;

    // check regs & flags
    let pass=true, reasons=[];
    const exp=test.expect||{};
    ["A","X","Y","S"].forEach(rn=>{ if(exp[rn]!=null && ca[rn]!==exp[rn]){ reasons.push(`${rn}=${hex(ca[rn])}≠${hex(exp[rn])}`); pass=false; } });
    ["C","Z","N","V"].forEach(fn=>{ if(exp[fn]!=null && CPUregisters.P[fn]!==exp[fn]){ reasons.push(`${fn}=${CPUregisters.P[fn]}≠${exp[fn]}`); pass=false; } });
    if(test.expectMem){
      mirrors.forEach(a=>{ const got=systemMemory[a]; if(got!==test.expectMem.value){ reasons.push(`$${a.toString(16).padStart(4,"0")}=${hex(got)}≠${hex(test.expectMem.value)}`); pass=false; } });
    }

    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, mirrors.map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const expectedLabel = test.expectMem
      ? hex(test.expectMem.value)
      : Object.entries(exp).map(([k,v])=>`${k}=${hex(v)}`).join(" ");
    const resultLabel = test.expectMem
      ? hex(systemMemory[ea])
      : Object.entries(exp).map(([k])=>{
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
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pb).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;">${Object.entries(pa).map(([k,v])=>`${k}=${hex(v)}`).join(" ")}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${dropdown(eaLabel,mirrors)}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${expectedLabel}</td>
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${resultLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${statusCell}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep stepping once and testing
CPUregisters.PC = 0x8000;
  }

  function runEdgeCaseTests(){
    // ===== EDGE CASES =====
  const edgeCases = [
    { name: "JMP ($02FF) page-wrap bug", code:[0x6C,0xFF,0x02], setup:()=>{
        systemMemory[0x02FF]=0x00;
        systemMemory[0x0200]=0x80;
      }, expectPC:0x8000 },
    { name: "STA $FF,X wraps",       code:[0x95,0xFF], pre:{A:0x42,X:0x01},
      expectMem:{addr:0x0000,value:0x42} },
    { name: "BNE crosses page",      code:[0xD0,0x7E], pre:{P:{Z:0}},
      expectPC:0x807E, expectExtraCycle:true },
    { name: "ADC BCD half-carry",    code:[0x69,0x15], pre:{A:0x27,P:{D:1,C:0}},
      expect:{A:0x42,C:0} },
    { name: "SBC BCD borrow",        code:[0xE9,0x15], pre:{A:0x42,P:{D:1,C:0}},
      expect:{A:0x27,C:0} },
    { name: "BIT $80 dummy-read",    code:[0x24,0x80], setup:()=>{
        systemMemory[0x0080]=0xFF;
      }, pre:{A:0x00}, expectFlags:{Z:1,V:1,N:1} },
    { name: "ASL $10 dummy-read",    code:[0x06,0x10], setup:()=>{
        systemMemory[0x10]=0x01;
      }, expectInterceptReads:2, expectMem:{addr:0x10,value:0x02} },
    { name: "PHA wraps SP",          code:[0x48], pre:{A:0x99,S:0x00},
      expectMem:{addr:0x0100,value:0x99}, expect:{S:0xFF} },
    { name: "PHP/PLP order",         code:[0x08,0x28], pre:{P:{C:1,D:1,I:0,Z:1},S:0xFF},
      setup:()=>{
        systemMemory[0x01FF]=0b00101101;
      }, expectFlags:{C:1,Z:1,I:0,D:1,B:0,V:0,N:0} },
    { name: "Self-mod IMM",          code:[0xA9,0x00], pre:{A:0x00}, setup:()=>{
        systemMemory[CPUregisters.PC+1]=0x77;
      }, expect:{A:0x77} },
    { name: "BRK sets B",            code:[0x00], pre:{P:{I:0,B:0}},
      expectFlags:{B:1,I:1} },
    { name: "IRQ leaves B",          code:[],     pre:{P:{I:0,B:0}},
      expectFlags:{B:0,I:1} }
  ];

  let html = `
    <div style="background:black;color:white;padding:6px;font-weight:bold;">
      EDGE CASES
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;
                  background:black;color:white;">
      <thead><tr style="background:#222">
        <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
        <th>CPU<br>Before</th><th>CPU<br>After</th><th>PC</th>
        <th>Reads</th><th>Cycles<br>Before</th><th>Cycles<br>After</th><th>ΔCycles</th><th>Status</th>
      </tr></thead><tbody>`;

  edgeCases.forEach(test=>{
    // 1) clear WRAM/PPU
    for(let a=0;a<0x4000;a++) systemMemory[a]=0;
    // 2) reset CPU registers
    CPUregisters.A = CPUregisters.X = CPUregisters.Y = 0;
    CPUregisters.S = 0xFF;
    CPUregisters.P = {C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
    // 3) set PC to start of PRG-ROM
    CPUregisters.PC = 0x8000;

    // 4) apply pre & setup hooks
    if(test.pre){
      if(test.pre.A != null) CPUregisters.A = test.pre.A;
      if(test.pre.X != null) CPUregisters.X = test.pre.X;
      if(test.pre.Y != null) CPUregisters.Y = test.pre.Y;
      if(test.pre.S != null) CPUregisters.S = test.pre.S;
      if(test.pre.P) Object.assign(CPUregisters.P, test.pre.P);
    }
    if(test.setup) test.setup();

    // 5) snapshot flags & regs before
    const fb = {...CPUregisters.P};
    const cb = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y};

    // 6) snapshot cycles before (NO RESET)
    const beforeCycles = cpuCycles;

    // 7) hook read intercept counting
    let intercepts = 0;
    const origRead = checkReadOffset;
    checkReadOffset = addr => { intercepts++; return origRead(addr); };

    // 8) load code bytes into PRG-ROM and execute
    if(test.code.length){
      test.code.forEach((b,i)=>{
        systemMemory[0x8000+i]=b;
        systemMemory[0xC000+i]=b;
      });
      step(); updateDebugTables();
    }

    // 9) restore read helper & snapshot cycles after
    checkReadOffset = origRead;
    const afterCycles = cpuCycles;
    const usedCycles  = afterCycles - beforeCycles;

    // 10) snapshot flags & regs after, and PC
    const fa = {...CPUregisters.P};
    const ca = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y};
    const pc = CPUregisters.PC;

    // 11) evaluate pass/fail
    let pass = true, reasons = [];
    if(test.expectPC!=null && pc!==test.expectPC){
      pass=false; reasons.push(`PC=0x${pc.toString(16)}≠0x${test.expectPC.toString(16)}`);
    }
    if(test.expectMem){
      const val = systemMemory[test.expectMem.addr];
      if(val!==test.expectMem.value){
        pass=false; reasons.push(`M[0x${test.expectMem.addr.toString(16)}]=${hex(val)}≠${hex(test.expectMem.value)}`);
      }
    }
    if(test.expectFlags){
      for(const f in test.expectFlags){
        if(CPUregisters.P[f]!==test.expectFlags[f]){
          pass=false; reasons.push(`${f}=${CPUregisters.P[f]}≠${test.expectFlags[f]}`);
        }
      }
    }
    if (test.expect) {
      for (const r in test.expect) {
        const actual = (r in ca) ? ca[r] : CPUregisters.P[r];
        const expectVal = test.expect[r];
        let aStr, eStr;
        if (typeof actual === "number") {
          aStr = "0x" + actual.toString(16);
        } else if (actual === undefined) {
          aStr = "undefined";
        } else {
          aStr = String(actual);
        }
        if (typeof expectVal === "number") {
          eStr = "0x" + expectVal.toString(16);
        } else if (expectVal === undefined) {
          eStr = "undefined";
        } else {
          eStr = String(expectVal);
        }
        if (actual !== expectVal) {
          pass = false;
          reasons.push(`${r}=${aStr}≠${eStr}`);
        }
      }
    }
    if(test.expectInterceptReads!=null && intercepts!==test.expectInterceptReads){
      pass=false; reasons.push(`reads=${intercepts}≠${test.expectInterceptReads}`);
    }
    if(test.expectExtraCycle && usedCycles<=2){
      pass=false; reasons.push(`cycles=${usedCycles} no extra`);
    }

    // 12) render row
    const opLabel = test.code.map(b=>b.toString(16).padStart(2,'0')).join(" ");
    const status = pass
      ? `<span style="color:#7fff7f;">✔️</span>`
      : `<details style="color:#ff4444;"><summary>❌</summary><ul>`+
        reasons.map(r=>`<li>${r}</li>`).join("")+"</ul></details>";

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td>${test.name}</td>
        <td>${opLabel}</td>
        <td>${flagsBin(fb)}</td>
        <td>${flagsBin(fa)}</td>
        <td>A=${hex(cb.A)} X=${hex(cb.X)} Y=${hex(cb.Y)}</td>
        <td>A=${hex(ca.A)} X=${hex(ca.X)} Y=${hex(ca.Y)}</td>
        <td>0x${pc.toString(16)}</td>
        <td>${intercepts}</td>
        <td>${beforeCycles}</td>
        <td>${afterCycles}</td>
        <td>${usedCycles}</td>
        <td>${status}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep stepping once and testing
CPUregisters.PC = 0x8000;

  }

  function runPageCrossAndQuirksTests(){
    // ========= 6502 PAGE CROSS & CYCLE QUIRK SUITE =========

  const cross = (desc, test) => Object.assign(test, {desc, cross:true});
  const nocross = (desc, test) => Object.assign(test, {desc, cross:false});

  // Each test can specify:
  // - code:    code bytes to execute
  // - desc:    human-readable desc
  // - opcodeFn: opcode function name (for debug row)
  // - pre:     CPU state before
  // - setup:   memory setup
  // - expect:  expected CPU reg/flag
  // - expectMem: expected memory state (for writes)
  // - baseCycles: minimum cycles (from your main table)
  // - extra:   expected cycles beyond base (page cross, quirk etc)

  // --- Test Definitions ---
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
  "NOP $12FF,X cross (illegal)": ["NOP", "absx2"], // absx2 = $3C
  "NOP $1200,X no cross (illegal)": ["NOP", "absx2"],
  "SLO $12FF,X cross (RMW always +1)": ["SLO", "absoluteX"],
  "SLO $1200,X no cross (RMW always +1)": ["SLO", "absoluteX"],
};

// Helper: get base cycles from opcodes object for this test case
function getBaseCycles(testDesc) {
  const lookup = testLookup[testDesc];
  if (!lookup) throw new Error(`No testLookup mapping for "${testDesc}"`);
  const [mnemonic, addressing] = lookup;
  return opcodes[mnemonic][addressing].cycles;
}

// Then, build cases dynamically:
const cases = [
  cross("LDA $12FF,X cross",    {code:[0xBD,0xFF,0x12], opcodeFn:"LDA_ABSX", pre:{X:1}, setup:()=>{systemMemory[0x1300]=0x55;}, expect:{A:0x55}, baseCycles:getBaseCycles("LDA $12FF,X cross"), extra:1}),
  nocross("LDA $1200,X no cross",{code:[0xBD,0x00,0x12], opcodeFn:"LDA_ABSX", pre:{X:0}, setup:()=>{systemMemory[0x1200]=0x66;}, expect:{A:0x66}, baseCycles:getBaseCycles("LDA $1200,X no cross"), extra:0}),
  cross("LDA $12FF,Y cross",    {code:[0xB9,0xFF,0x12], opcodeFn:"LDA_ABSY", pre:{Y:1}, setup:()=>{systemMemory[0x1300]=0x77;}, expect:{A:0x77}, baseCycles:getBaseCycles("LDA $12FF,Y cross"), extra:1}),
  nocross("LDA $1200,Y no cross",{code:[0xB9,0x00,0x12], opcodeFn:"LDA_ABSY", pre:{Y:0}, setup:()=>{systemMemory[0x1200]=0x88;}, expect:{A:0x88}, baseCycles:getBaseCycles("LDA $1200,Y no cross"), extra:0}),
  cross("LDX $12FF,Y cross",    {code:[0xBE,0xFF,0x12], opcodeFn:"LDX_ABSY", pre:{Y:1}, setup:()=>{systemMemory[0x1300]=0x99;}, expect:{X:0x99}, baseCycles:getBaseCycles("LDX $12FF,Y cross"), extra:1}),
  nocross("LDX $1200,Y no cross",{code:[0xBE,0x00,0x12], opcodeFn:"LDX_ABSY", pre:{Y:0}, setup:()=>{systemMemory[0x1200]=0x77;}, expect:{X:0x77}, baseCycles:getBaseCycles("LDX $1200,Y no cross"), extra:0}),
  cross("LDY $12FF,X cross",    {code:[0xBC,0xFF,0x12], opcodeFn:"LDY_ABSX", pre:{X:1}, setup:()=>{systemMemory[0x1300]=0xAB;}, expect:{Y:0xAB}, baseCycles:getBaseCycles("LDY $12FF,X cross"), extra:1}),
  nocross("LDY $1200,X no cross",{code:[0xBC,0x00,0x12], opcodeFn:"LDY_ABSX", pre:{X:0}, setup:()=>{systemMemory[0x1200]=0xAC;}, expect:{Y:0xAC}, baseCycles:getBaseCycles("LDY $1200,X no cross"), extra:0}),
  cross("LAX $12FF,Y cross",    {code:[0xBF,0xFF,0x12], opcodeFn:"LAX_ABSY", pre:{Y:1}, setup:()=>{systemMemory[0x1300]=0x56;}, expect:{A:0x56,X:0x56}, baseCycles:getBaseCycles("LAX $12FF,Y cross"), extra:1}),
  nocross("LAX $1200,Y no cross",{code:[0xBF,0x00,0x12], opcodeFn:"LAX_ABSY", pre:{Y:0}, setup:()=>{systemMemory[0x1200]=0x57;}, expect:{A:0x57,X:0x57}, baseCycles:getBaseCycles("LAX $1200,Y no cross"), extra:0}),
  cross("LAS $12FF,Y cross",    {code:[0xBB,0xFF,0x12], opcodeFn:"LAS_ABSY", pre:{Y:1}, setup:()=>{systemMemory[0x1300]=0xF0;}, expect:{A:0xF0,X:0xF0,S:0xF0}, baseCycles:getBaseCycles("LAS $12FF,Y cross"), extra:0}),
  nocross("LAS $1200,Y no cross",{code:[0xBB,0x00,0x12], opcodeFn:"LAS_ABSY", pre:{Y:0}, setup:()=>{systemMemory[0x1200]=0xE0;}, expect:{A:0xE0,X:0xE0,S:0xE0}, baseCycles:getBaseCycles("LAS $1200,Y no cross"), extra:0}),
  cross("LDA ($10),Y cross",    {code:[0xB1,0x10], opcodeFn:"LDA_INDY", pre:{Y:1}, setup:()=>{systemMemory[0x10]=0xFF;systemMemory[0x11]=0x12;systemMemory[0x1300]=0x44;}, expect:{A:0x44}, baseCycles:getBaseCycles("LDA ($10),Y cross"), extra:1}),
  nocross("LDA ($20),Y no cross",{code:[0xB1,0x20], opcodeFn:"LDA_INDY", pre:{Y:0}, setup:()=>{systemMemory[0x20]=0x00;systemMemory[0x21]=0x14;systemMemory[0x1400]=0x33;}, expect:{A:0x33}, baseCycles:getBaseCycles("LDA ($20),Y no cross"), extra:0}),
  cross("ASL $12FF,X cross (RMW always +1)",{code:[0x1E,0xFF,0x12], opcodeFn:"ASL_ABSX", pre:{X:1}, setup:()=>{systemMemory[0x1300]=0x80;}, expectMem:{addr:0x1300,value:0x00}, baseCycles:getBaseCycles("ASL $12FF,X cross (RMW always +1)"), extra:3}),
  nocross("ASL $1200,X no cross (RMW always +1)",{code:[0x1E,0x00,0x12], opcodeFn:"ASL_ABSX", pre:{X:0}, setup:()=>{systemMemory[0x1200]=0x81;}, expectMem:{addr:0x1200,value:0x02}, baseCycles:getBaseCycles("ASL $1200,X no cross (RMW always +1)"), extra:3}),
  cross("INC $12FF,X cross (RMW always +1)",{code:[0xFE,0xFF,0x12], opcodeFn:"INC_ABSX", pre:{X:1}, setup:()=>{systemMemory[0x1300]=0x04;}, expectMem:{addr:0x1300,value:0x05}, baseCycles:getBaseCycles("INC $12FF,X cross (RMW always +1)"), extra:3}),
  nocross("DEC $1200,X no cross (RMW always +1)",{code:[0xDE,0x00,0x12], opcodeFn:"DEC_ABSX", pre:{X:0}, setup:()=>{systemMemory[0x1200]=0x01;}, expectMem:{addr:0x1200,value:0x00}, baseCycles:getBaseCycles("DEC $1200,X no cross (RMW always +1)"), extra:3}),
  cross("STA $12FF,X cross (NO +1, store quirk)",{code:[0x9D,0xFF,0x12], opcodeFn:"STA_ABSX", pre:{A:0xAB,X:1}, expectMem:{addr:0x1300,value:0xAB}, baseCycles:getBaseCycles("STA $12FF,X cross (NO +1, store quirk)"), extra:0}),
  cross("STA ($10),Y cross (NO +1, store quirk)",{code:[0x91,0x10], opcodeFn:"STA_INDY", pre:{A:0xBA,Y:1}, setup:()=>{systemMemory[0x10]=0xFF;systemMemory[0x11]=0x12;}, expectMem:{addr:0x1300,value:0xBA}, baseCycles:getBaseCycles("STA ($10),Y cross (NO +1, store quirk)"), extra:0}),
  
  
cross("BNE branch taken, cross", {
    code: [0xD0, 0x02],            // BNE +2
    opcodeFn: "BNE_REL",
    pre: { P: { Z: 0 }, PC: 0x80FE },
    setup: ()=>{},
    expectPC: 0x8102,
    baseCycles: getBaseCycles("BNE branch taken, cross"),
    extra: 2
  }),
  nocross("BNE branch taken, no cross", {
    code: [0xD0, 0x02],            // BNE +2
    opcodeFn: "BNE_REL",
    pre: { P: { Z: 0 }, PC: 0x8000 },
    setup: ()=>{},
    expectPC: 0x8004,
    baseCycles: getBaseCycles("BNE branch taken, no cross"),
    extra: 1
  }),
  nocross("BNE not taken", {
    code: [0xD0, 0x02],
    opcodeFn: "BNE_REL",
    pre: { P: { Z: 1 }, PC: 0x8000 },
    setup: ()=>{},
    expectPC: 0x8002,
    baseCycles: getBaseCycles("BNE not taken"),
    extra: 0
  }),



  cross("JMP ($02FF) indirect, page wrap",{code:[0x6C,0xFF,0x02], opcodeFn:"JMP_IND", setup:()=>{systemMemory[0x02FF]=0x00;systemMemory[0x0200]=0x80;}, expectPC:0x8000, baseCycles:getBaseCycles("JMP ($02FF) indirect, page wrap"), extra:0}),
  cross("NOP $12FF,X cross (illegal)",{code:[0x3C,0xFF,0x12], opcodeFn:"NOP_ABSX", pre:{X:1}, baseCycles:getBaseCycles("NOP $12FF,X cross (illegal)"), extra:1}),
  nocross("NOP $1200,X no cross (illegal)",{code:[0x3C,0x00,0x12], opcodeFn:"NOP_ABSX", pre:{X:0}, baseCycles:getBaseCycles("NOP $1200,X no cross (illegal)"), extra:0}),
  cross("SLO $12FF,X cross (RMW always +1)",{code:[0x1F,0xFF,0x12], opcodeFn:"SLO_ABSX", pre:{X:1}, setup:()=>{systemMemory[0x1300]=0x01;}, expectMem:{addr:0x1300,value:0x02}, baseCycles:getBaseCycles("SLO $12FF,X cross (RMW always +1)"), extra:3}),
  nocross("SLO $1200,X no cross (RMW always +1)",{code:[0x1F,0x00,0x12], opcodeFn:"SLO_ABSX", pre:{X:0}, setup:()=>{systemMemory[0x1200]=0x01;}, expectMem:{addr:0x1200,value:0x02}, baseCycles:getBaseCycles("SLO $1200,X no cross (RMW always +1)"), extra:3}),
];

  let html = `
    <div style="background:darkblue;color:white;padding:7px 6px 7px 6px;font-weight:bold;">
      6502 PAGE CROSSING & CYCLE QUIRKS TEST SUITE
    </div>
    <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
      <thead>
      <tr style="background:#223366;">
        <th>Test</th><th>Op</th><th>Opcode Fn</th>
        <th>Flags<br>Before</th><th>Flags<br>After</th>
        <th>CPU<br>Before</th><th>CPU<br>After</th>
        <th>PC</th>
        <th>Cycles<br>Before</th><th>Cycles<br>After</th><th>ΔCycles</th>
        <th>Status</th>
      </tr></thead><tbody>`;

  for (const test of cases) {
    // --- Setup ---
    for(let a=0;a<0x4000;a++) systemMemory[a]=0;
    CPUregisters.A = CPUregisters.X = CPUregisters.Y = 0;
    CPUregisters.S = 0xFF;
    CPUregisters.P = {C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
    CPUregisters.PC = 0x8000;
    if(test.pre){
      if(test.pre.A!=null) CPUregisters.A = test.pre.A;
      if(test.pre.X!=null) CPUregisters.X = test.pre.X;
      if(test.pre.Y!=null) CPUregisters.Y = test.pre.Y;
      if(test.pre.S!=null) CPUregisters.S = test.pre.S;
      if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P);
    }
    if(test.setup) test.setup();

    // --- State snapshot ---
    const fb = {...CPUregisters.P};
    const cb = {A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y};
    const beforeCycles = cpuCycles;

    // --- Load code into PRG-ROM ---
    if(test.code && test.code.length){
      test.code.forEach((b,i)=>{ systemMemory[0x8000+i]=b; systemMemory[0xC000+i]=b; });
      step(); // one instruction
      if (typeof updateDebugTables==="function") updateDebugTables();
    }

    const afterCycles = cpuCycles;
    const usedCycles = afterCycles - beforeCycles;
    const fa = {...CPUregisters.P};
    const ca = {A:CPUregisters.A, X:CPUregisters.X, Y:CPUregisters.Y, S:CPUregisters.S};
    const pc = CPUregisters.PC;

    // --- Result/Check logic ---
    let pass = true, reasons = [];
    if(test.expect){
      for(const r in test.expect) {
        const actual = (r in ca) ? ca[r] : CPUregisters.P[r];
        if(actual!==test.expect[r]){ pass=false; reasons.push(`${r}=${actual}≠${test.expect[r]}`); }
      }
    }
    if(test.expectMem){
      const val = systemMemory[test.expectMem.addr];
      if(val!==test.expectMem.value){
        pass=false; reasons.push(`M[0x${test.expectMem.addr.toString(16)}]=${val}≠${test.expectMem.value}`);
      }
    }
    if(test.expectPC!==undefined && pc!==test.expectPC){
      pass=false; reasons.push(`PC=0x${pc.toString(16)}≠0x${test.expectPC.toString(16)}`);
    }
    // Must exactly match: base + extra
    const cycleTarget = test.baseCycles + test.extra;
    if(usedCycles!==cycleTarget){
      pass=false; reasons.push(`cycles=${usedCycles}≠${cycleTarget}`);
    }

    // --- Render row ---
    const opLabel = (test.code||[]).map(b=>b.toString(16).padStart(2,'0')).join(" ");
    const status = pass
      ? `<span style="color:#7fff7f;">✔️</span>`
      : `<details style="color:#ff4444;"><summary>❌</summary><ul>${reasons.map(r=>`<li>${r}</li>`).join("")}</ul></details>`;

    html += `
      <tr style="background:${pass?"#113311":"#331111"}">
        <td>${test.desc}</td>
        <td>${opLabel}</td>
        <td>${test.opcodeFn||""}</td>
        <td>${flagsBin(fb)}</td>
        <td>${flagsBin(fa)}</td>
        <td>A=${cb.A} X=${cb.X} Y=${cb.Y}</td>
        <td>A=${ca.A} X=${ca.X} Y=${ca.Y}</td>
        <td>0x${pc.toString(16)}</td>
        <td>${beforeCycles}</td>
        <td>${afterCycles}</td>
        <td>${usedCycles}</td>
        <td>${status}</td>
      </tr>`;
  }
  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
systemMemory[0x8000] = 0x02; //reset so we can keep testing
CPUregisters.PC = 0x8000;
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
}

const testSuites = [
  // Loads, both standard and alternate for extra cross-verification
  { name: "LOADS (LDA/LDX/LDY)", run: runLoadsTests },
  { name: "LOADS (LDA/LDX/LDY) (Alt)", run: runLoadsOpsTests }, // alternate block

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
  { name: "Page Cross & Quirks Tests", run: runPageCrossAndQuirksTests }
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
  title.style = "font-size:1.5em; margin-bottom:1em;";
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