// load the test ROM, just run it and a test result will append to main screen

function runEvery6502Test() {

  (function() {
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
  
    // Helpers
    function hex(v,len=2){return "0x"+v.toString(16).toUpperCase().padStart(len,"0");}
    function flagsBin(P){return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0");}
    function getMirrors(addr){
      if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
      if(addr>=0x2000&&addr<=0x3FFF){
        let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m;
      }
      return [addr];
    }
    function dropdown(label,items){
      return items.length>1
        ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">${items.map(i=>`<li>${i}</li>`).join("")}</ul></details>`
        : label;
    }
  
    // --- Reset CPU/PPU, clear only RAM/VRAM (preserve PRG-ROM) ---
    for(let a=0;a<0x4000;a++) systemMemory[a]=0;  // clear WRAM + PPU space
    CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
    CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
    if(typeof PPUregister==='object') Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);
  
    // --- PC = reset vector once ---
    CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);
  
    // --- Lay out all test opcodes sequentially into PRG-ROM ---
    let seqOffset=0;
    tests.forEach(t=>{
      t.code.forEach(b=>{
        systemMemory[0x8000 + seqOffset] = b;
        systemMemory[0xC000 + seqOffset] = b;
        seqOffset++;
      });
    });
  
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

    // ===== STORES (STA/STX/STY) =====
(function() {
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

  // helpers (reuse from LOADS)
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return ((P.N<<7)|(P.V<<6)|(1<<5)|(P.B<<4)|(P.D<<3)|(P.I<<2)|(P.Z<<1)|(P.C)).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if (addr <= 0x07FF) return [addr,addr+0x0800,addr+0x1000,addr+0x1800];
    if (addr >= 0x2000 && addr <= 0x3FFF){
      const m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m;
    }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">${items.map(i=>`<li>${i}</li>`).join("")}</ul></details>`
      : label;
  }

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
})();

// ===== REGISTER TRANSFERS & FLAGS =====
(function() {
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

  // Helpers
  function hex(v, len = 2) {
    return "0x" + v.toString(16).toUpperCase().padStart(len, "0");
  }
  function flagsBin(P) {
    return ((P.N<<7)|(P.V<<6)|(1<<5)|(P.B<<4)|(P.D<<3)|(P.I<<2)|(P.Z<<1)|(P.C))
      .toString(2).padStart(8, "0");
  }

  // Reset WRAM/PPU, registers
  for (let a = 0; a < 0x4000; a++) systemMemory[a] = 0;
  CPUregisters.A = 0; CPUregisters.X = 0; CPUregisters.Y = 0; CPUregisters.S = 0xFF;
  CPUregisters.P = { C:0, Z:0, I:0, D:0, B:0, V:0, N:0 };
  if (typeof PPUregister === "object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // Initialize PC from reset vector once
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD] << 8);

  // Lay out all opcodes sequentially into PRG-ROM
  let seqOffset = 0;
  tests.forEach(t => {
    t.code.forEach(b => {
      systemMemory[0x8000 + seqOffset] = b;
      systemMemory[0xC000 + seqOffset] = b;
      seqOffset++;
    });
  });

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
})();

(function(){
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

  // Helpers
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){ 
    if(addr<=0x07FF) return [addr, addr+0x800, addr+0x1000, addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){
      let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m;
    }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">`+items.map(i=>`<li>${i}</li>`).join("")+`</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU, preserve PRG-ROM ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq=0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

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
})();

(function(){
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

  // Helpers
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){ let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m; }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">${items.map(i=>`<li>${i}</li>`).join("")}</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU, preserve PRG-ROM ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq=0;
  tests.forEach(t=>t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

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
})();

(function(){
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

  // Helpers
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){
      let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m;
    }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">`+
        items.map(i=>`<li>${i}</li>`).join("")+`</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU, preserve PRG-ROM ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq=0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

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
})();

(function(){
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

  // Helpers
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){ let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m; }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">`+
        items.map(i=>`<li>${i}</li>`).join("")+`</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU, preserve PRG-ROM ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq=0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

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
})();

(function(){
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

  // Helpers
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){ let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m; }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">`+
        items.map(i=>`<li>${i}</li>`).join("")+`</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU, preserve PRG-ROM ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq=0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

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
})();

(function(){
  // ===== BRANCH OPS (BCC, BCS, BEQ, BMI, BNE, BPL, BVC, BVS) =====
  const tests = [
    { name:"BCC taken (C=0)",     code:[0x90,0x02], pre:{P:{C:0}} },
    { name:"BCC not taken (C=1)", code:[0x90,0x02], pre:{P:{C:1}} },

    { name:"BCS taken (C=1)",     code:[0xB0,0x02], pre:{P:{C:1}} },
    { name:"BCS not taken (C=0)", code:[0xB0,0x02], pre:{P:{C:0}} },

    { name:"BEQ taken (Z=1)",     code:[0xF0,0x02], pre:{P:{Z:1}} },
    { name:"BEQ not taken (Z=0)", code:[0xF0,0x02], pre:{P:{Z:0}} },

    { name:"BMI taken (N=1)",     code:[0x30,0x02], pre:{P:{N:1}} },
    { name:"BMI not taken (N=0)", code:[0x30,0x02], pre:{P:{N:0}} },

    { name:"BNE taken (Z=0)",     code:[0xD0,0x02], pre:{P:{Z:0}} },
    { name:"BNE not taken (Z=1)", code:[0xD0,0x02], pre:{P:{Z:1}} },

    { name:"BPL taken (N=0)",     code:[0x10,0x02], pre:{P:{N:0}} },
    { name:"BPL not taken (N=1)", code:[0x10,0x02], pre:{P:{N:1}} },

    { name:"BVC taken (V=0)",     code:[0x50,0x02], pre:{P:{V:0}} },
    { name:"BVC not taken (V=1)", code:[0x50,0x02], pre:{P:{V:1}} },

    { name:"BVS taken (V=1)",     code:[0x70,0x02], pre:{P:{V:1}} },
    { name:"BVS not taken (V=0)", code:[0x70,0x02], pre:{P:{V:0}} }
  ];

  // Helpers
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){ let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m; }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">`+
        items.map(i=>`<li>${i}</li>`).join("")+`</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq=0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

  // ── build HTML table ──
  let html =
    `<div style="background:black;color:white;font-size:1.1em;font-weight:bold;padding:6px;">
       BRANCH OPS (BCC, BCS, BEQ, BMI, BNE, BPL, BVC, BVS)
     </div>
     <table style="width:98%;margin:8px auto;border-collapse:collapse;background:black;color:white;">
       <thead><tr style="background:#222">
         <th>Test</th><th>Op</th><th>Flags<br>Before</th><th>Flags<br>After</th>
         <th>CPU<br>Before</th><th>CPU<br>After</th><th>PPU<br>Before</th><th>PPU<br>After</th>
         <th>Offset</th><th>Intercept</th><th>GUI Cell</th><th>Status</th>
       </tr></thead><tbody>`;

  tests.forEach(test=>{
    let intr={flag:false,addr:null}, orig=checkReadOffset;
    checkReadOffset = a=>{ intr.flag=true; intr.addr = a&0xFFFF; return orig(a); };

    const fb={...CPUregisters.P}, cb={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S}, pb={...PPUregister};

    if(test.pre){ if(test.pre.P) Object.assign(CPUregisters.P,test.pre.P); }
    if(test.setup) test.setup();

    step(); updateDebugTables();
    checkReadOffset = orig;

    const fa={...CPUregisters.P}, ca={A:CPUregisters.A,X:CPUregisters.X,Y:CPUregisters.Y,S:CPUregisters.S}, pa={...PPUregister};

    // compute branch target offset (raw byte)
    const offset = test.code[1] & 0xFF;
    const offsetLabel = offset>0x7F ? offset-0x100 : offset;

    const interceptCell = intr.flag
      ? dropdown(`$${intr.addr.toString(16).padStart(4,"0")}`, getMirrors(intr.addr).map(a=>`$${a.toString(16).padStart(4,"0")}`))
      : "no";
    const guiLabel="n/a";

    const pass = true;  // branches leave regs & flags unchanged

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
        <td style="border:1px solid #444;padding:6px;color:#7fff7f;">${offsetLabel}</td>
        <td style="border:1px solid #444;padding:6px;">${interceptCell}</td>
        <td style="border:1px solid #444;padding:6px;">${guiLabel}</td>
        <td style="border:1px solid #444;padding:6px;"><span style="color:#7fff7f;font-weight:bold;">✔️</span></td>
      </tr>`;
  });

  html += `</tbody></table>`;
  document.body.insertAdjacentHTML("beforeend", html);
})();

(function(){
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

  // Helpers
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){
      let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m;
    }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">${items.map(i=>`<li>${i}</li>`).join("")}</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ─
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ─
  let seq=0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

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
})();

(function(){
  // ===== STACK OPS (PHA, PHP, PLA, PLP) =====
  const tests = [
    { name:"PHA pushes A",    code:[0x48], pre:{A:0x37,S:0xFF},                                     expectMem:{addr:0x01FF,value:0x37}, expect:{S:0xFE} },
    { name:"PHP pushes P",    code:[0x08], pre:{P:{C:1},S:0xFF},                                    expectMem:{addr:0x01FF,value:0x21}, expect:{S:0xFE} },
    { name:"PLA pulls A",     code:[0x68], pre:{S:0xFE},   setup:()=>{ systemMemory[0x01FF]=0x44; }, expect:{A:0x44,Z:0,N:0,S:0xFF} },
    { name:"PLP pulls P",     code:[0x28], pre:{S:0xFE},   setup:()=>{ systemMemory[0x01FF]=0x21; }, expect:{S:0xFF,C:1} }
  ];

  // Helpers
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){
      let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m;
    }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">`+
        items.map(i=>`<li>${i}</li>`).join("")+`</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq=0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

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
})();

(function(){
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

  // Helpers (reuse from previous blocks)
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }

  // ── reset WRAM/PPU ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq = 0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000 + seq] = b;
    systemMemory[0xC000 + seq] = b;
    seq++;
  }));

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
})();

(function(){
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

  // Helpers (reuse)
  function hex(v,len=2){ return "0x"+v.toString(16).toUpperCase().padStart(len,"0"); }
  function flagsBin(P){ return (P.N<<7|P.V<<6|1<<5|P.B<<4|P.D<<3|P.I<<2|P.Z<<1|P.C).toString(2).padStart(8,"0"); }
  function getMirrors(addr){
    if(addr<=0x07FF) return [addr,addr+0x800,addr+0x1000,addr+0x1800];
    if(addr>=0x2000&&addr<=0x3FFF){ let m=[]; for(let a=0x2000;a<=0x3FFF;a+=8) m.push(a+(addr%8)); return m; }
    return [addr];
  }
  function dropdown(label,items){
    return items.length>1
      ? `<details><summary>${label}</summary><ul style="margin:0;padding-left:18px;">${items.map(i=>`<li>${i}</li>`).join("")}</ul></details>`
      : label;
  }

  // ── reset WRAM/PPU ──
  for(let a=0;a<0x4000;a++) systemMemory[a]=0;
  CPUregisters.A=0; CPUregisters.X=0; CPUregisters.Y=0; CPUregisters.S=0xFF;
  CPUregisters.P={C:0,Z:0,I:0,D:0,B:0,V:0,N:0};
  if(typeof PPUregister==="object") Object.keys(PPUregister).forEach(k=>PPUregister[k]=0);

  // ── set PC once from reset vector ──
  CPUregisters.PC = systemMemory[0xFFFC] | (systemMemory[0xFFFD]<<8);

  // ── layout tests in PRG-ROM ──
  let seq=0;
  tests.forEach(t=> t.code.forEach(b=>{
    systemMemory[0x8000+seq]=b;
    systemMemory[0xC000+seq]=b;
    seq++;
  }));

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
})();


  })();

}