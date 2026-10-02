// Expanded Blargg/nes-test-roms regression gate. Legacy suites use delayed
// final-result reads, internal result bytes or accepted observational CRCs.
// Any failure, unclassified ROM or harness error fails CI.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createEmulator}=require('./headless.cjs');
const root=process.argv[2];if(!root)throw Error('Usage: node tests/blargg-expanded.cjs nes-test-roms-dir [report.json]');
const shard=process.env.BLARGG_SHARD||'cpu';
const groupsByShard={
 cpu:[
  'instr_misc/rom_singles',
  'instr_test-v5/rom_singles',
  'cpu_timing_test6',
  'cpu_dummy_reads',
  'cpu_dummy_writes'
 ],
 ppu:[
  'ppu_open_bus',
  'ppu_read_buffer',
  'sprite_hit_tests_2005.10.05',
  'sprite_overflow_tests',
  'vbl_nmi_timing'
 ],
 apu:[
  'apu_test/rom_singles',
  'dmc_dma_during_read4',
  'sprdma_and_dmc_dma'
 ],
 extra:[
  'branch_timing_tests',
  'cpu_exec_space',
  'dmc_tests',
  'blargg_ppu_tests_2005.09.15b',
  'mmc3_irq_tests',
  'nes_instr_test/rom_singles'
 ],
 reset:[
  'cpu_reset',
  'apu_reset'
 ],
 legacy:[
  'blargg_apu_2005.07.30',
  'mmc3_test',
  'instr_test-v3/rom_singles'
 ],
 legacycpu:[
  'blargg_nes_cpu_test5'
 ],
 aggregate:[
  'instr_test-v5',
  'instr_misc',
  'instr_timing',
  'cpu_interrupts_v2',
  'ppu_vbl_nmi',
  'apu_test'
 ],
 edge:[
  'read_joy3',
  'oam_read',
  'oam_stress'
 ],
 legacyaggregate:[
  'instr_test-v3'
 ],
 nestest:[
  'other'
 ]
};
const groups=groupsByShard[shard];if(!groups)throw Error('Unknown BLARGG_SHARD '+shard);
const observationalCrc={
 'dmc_dma_during_read4/dma_2007_read.nes':new Set(['159A7A8F','5E3DF9C4']),
 'dmc_dma_during_read4/double_2007_read.nes':new Set(['85CFD627','F018C287','440EF923','E52F41A5'])
};
const excludeByGroup={
 'read_joy3':new Set(['test_buttons.nes'])
};
const onlyByGroup={
 'other':new Set(['nestest.nes'])
};
const results=[];
for(const group of groups){
 const dir=path.join(root,group);
 if(!fs.existsSync(dir)){results.push({rom:group,status:null,error:'missing directory'});continue;}
 for(const file of fs.readdirSync(dir).filter(p=>p.endsWith('.nes')&&!(excludeByGroup[group]?.has(p))&&(!onlyByGroup[group]||onlyByGroup[group].has(p))).sort()){
  const rom=fs.readFileSync(path.join(dir,file)),e=createEmulator();let status=null,text='',error=null,classification='passfail',resetCount=0,resetRequestLatched=false;
  try{
   e.load(new Uint8Array(rom));
   if(group==='other' && file==='nestest.nes') e.evaluate('CPUregisters.PC=0xC000');
   if(group==='blargg_nes_cpu_test5'){
    e.evaluate(`(()=>{
      globalThis.__testSerialText='';
      globalThis.__testSerialWrites=0;
      globalThis.__testSerialRaw='';
      let state=0,byte=0,bitIndex=0;
      const original=checkWriteOffset;
      checkWriteOffset=(address,value)=>{
        if((address&0xffff)===0x4016){
          const bit=value&1;
          globalThis.__testSerialWrites++;
          if(globalThis.__testSerialRaw.length<512)globalThis.__testSerialRaw+=String(bit);
          if(state===0){
            if(bit===0){state=1;byte=0;bitIndex=0;}
          }else if(state===1){
            byte|=bit<<bitIndex++;
            if(bitIndex===8)state=2;
          }else{
            if(bit===1)globalThis.__testSerialText+=String.fromCharCode(byte);
            state=0;
          }
        }
        return original(address,value);
      };
    })()`);
   }
   // The two legacy MMC3 revision ROMs intentionally target different IRQ
   // silicon. Their old iNES headers cannot encode the revision, so select it
   // explicitly just as the existing mmc3_test_2 gate does.
   if(group==='mmc3_irq_tests'){
    if(file==='5.MMC3_rev_A.nes') e.evaluate('mmc3SetIrqVariant("nec")');
    if(file==='6.MMC3_rev_B.nes') e.evaluate('mmc3SetIrqVariant("sharp")');
   }
   if(group==='mmc3_test'){
    if(file==='6-MMC6.nes') e.evaluate('mmc3SetIrqVariant("nec")');
    if(file==='5-MMC3.nes') e.evaluate('mmc3SetIrqVariant("sharp")');
   }
   const legacyF8 =
    group.startsWith('sprite_hit_tests_2005.10.05') ||
    group.startsWith('sprite_overflow_tests') ||
    group.startsWith('vbl_nmi_timing');

   // Several older standalone suites predate the usual $6000 status block.
   // They report to the PPU text console instead, and a couple of them need
   // substantially more than 20M CPU cycles to reach their terminal loop.
   let chunks = legacyF8 ? 30 : 100;
   if(group.startsWith('cpu_timing_test6')) chunks = 220;
   if(group.startsWith('cpu_dummy_reads')) chunks = 220;
   if(group.startsWith('dmc_dma_during_read4')) chunks = 220;
   if(group.startsWith('ppu_read_buffer')) chunks = 320;
   if(group==='blargg_nes_cpu_test5') chunks = 220;
   if(group==='instr_test-v5') chunks = 600;
   if(group==='instr_timing') chunks = 240;
   if(group==='ppu_vbl_nmi') chunks = 320;
   if(group==='cpu_interrupts_v2') chunks = 300;
   if(group==='oam_stress') chunks = 400;
   if(group==='instr_test-v3') chunks = 450;
   if(group==='other' && file==='nestest.nes') chunks = 1;

   for(let i=0;i<chunks;i++){
    e.run(200000);
    const data=e.evaluate('Array.from(prgRam.slice(0,4096))');
    if(data[1]===0xde&&data[2]===0xb0&&data[3]===0x61){
      status=data[0];
      const z=data.indexOf(0,4);
      text=String.fromCharCode(...data.slice(4,z<0?data.length:z));
      // Blargg reset-aware tests request a physical RESET with status $81.
      // Preserve cartridge/RAM state and continue from the reset vector.
      if(status===0x81){
        // $81 remains in the test's output byte until its post-reset code has
        // progressed far enough to overwrite it. Treat one continuous $81
        // interval as a single physical reset request.
        if(!resetRequestLatched){
          if(++resetCount>4) throw new Error('Too many reset requests');
          resetRequestLatched=true;
          e.evaluate('resetCPU()');
        }
        status=null;
        text='';
        continue;
      }
      resetRequestLatched=false;
      if(status<128)break;
    }

    // ppu_read_buffer is mapper 3 (CNROM), so the ROM's optional $6000
    // output is correctly invisible on hardware without PRG-RAM. Its linker
    // map puts first_failed_test_code at $0A, failure count at $0B and the
    // 78 per-test result bytes at $0C-$59. A completed all-pass run has every
    // per-test byte set to 1 and both failure bytes clear.
    if(status===null && group.startsWith('ppu_read_buffer')){
      const rr=e.state().ram;
      const completed=rr.slice(0x0C,0x5A).length===78 &&
        rr.slice(0x0C,0x5A).every(v=>v===1);
      if(completed){
        status=(rr[0x0A]===0 && rr[0x0B]===0)?0:(rr[0x0A]||1);
        text=status===0?'Passed':'Failed #'+status;
        break;
      }
    }

    // Fallback for serial/PPU-console-era ROMs. Their console writes ASCII
    // character codes directly into nametable RAM, so the terminal result can
    // be recognized without special emulator hooks.
    if(status===null && (i%5===4 || i===chunks-1)){
      const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
      const pass=/\bpassed\b/i.test(screen);
      const fail=/\bfailed\b/i.test(screen);
      const error=screen.match(/\berror\s+(\d+)/i);
      if(pass || fail || error){
        status=pass?0:(error?Number(error[1]):1);
        text=pass?'Passed':(error?'Error '+error[1]:'Failed');
        break;
      }
    }
   }
   // These older suites continuously update $F8 with the test currently
   // running. Only inspect it after giving the ROM enough time to reach its
   // terminal pass/fail loop; reading the first nonzero value is a false fail.
   if(legacyF8 && status===null){
    const legacy=e.evaluate('systemMemory[0xF8]&0xFF');
    if(legacy){
      status=legacy===1?0:legacy;
      text=legacy===1?'PASSED':'FAILED #'+legacy;
    }
   }

   if(status===null && group==='blargg_nes_cpu_test5'){
     const serial=e.evaluate('globalThis.__testSerialText||""');
     const fail=/\bFailed\b/i.test(serial);
     const errorMatch=serial.match(/\bError\s+(\d+)/i);
     const explicitPass=/\bPassed\b/i.test(serial);
     const st=e.state();
     const pcOff=16+((st.pc-0x8000)&0x7fff);
     const terminalSelfLoop=st.pc===0x8003 &&
       rom[pcOff]===0x4c && rom[pcOff+1]===0x03 && rom[pcOff+2]===0x80;
     const aggregatePass=/All tests complete/i.test(serial) && !fail && !errorMatch && terminalSelfLoop;
     if(explicitPass || aggregatePass || fail || errorMatch){
       status=(explicitPass||aggregatePass)?0:(errorMatch?Number(errorMatch[1]):1);
       text=serial.trim()+(aggregatePass?'\nTerminal self-loop $8003':'');
     }
   }

   if(status===null && group==='other' && file==='nestest.nes'){
     const rr=e.state().ram;
     const lo=rr[0x0002]&0xff, hi=rr[0x0003]&0xff;
     status=(lo===0 && hi===0)?0:(lo || hi || 1);
     text=status===0?'Passed: $0002/$0003 = $00/$00':
       'Failed: $0002=
   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
+lo.toString(16).padStart(2,'0')+' $0003=
   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
+hi.toString(16).padStart(2,'0');
   }

   // read_joy3/count_errors*.nes are measurement diagnostics rather than
   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
+lo.toString(16).padStart(2,'0').toUpperCase()+
       ' $0003=
   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
+lo.toString(16).padStart(2,'0')+' $0003=
   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
+hi.toString(16).padStart(2,'0');
   }

   // read_joy3/count_errors*.nes are measurement diagnostics rather than
   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
+hi.toString(16).padStart(2,'0').toUpperCase();
   }

   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
+lo.toString(16).padStart(2,'0')+' $0003=
   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
+hi.toString(16).padStart(2,'0');
   }

   // read_joy3/count_errors*.nes are measurement diagnostics rather than
   // assertion ROMs. They return success after printing a counter; non-zero
   // conflict/error counts are the phenomenon being measured. Classify only
   // when the terminal result line is visible and no failure text was printed.
   if(status===null && group==='read_joy3' &&
      (file==='count_errors.nes' || file==='count_errors_fast.nes')){
     const screen=String.fromCharCode(...e.evaluate('Array.from(VRAM)'));
     const line=file==='count_errors.nes'
       ? screen.match(/Conflicts:\s*(\d+)\/1000/i)
       : screen.match(/Errors:\s*(\d+)\/1000/i);
     const failed=/\bFailed\b|\bError\s+\d+/i.test(screen);
     if(line && !failed){
       classification='diagnostic';
       status=0;
       text=(file==='count_errors.nes'?'Conflicts: ':'Errors: ')+line[1]+'/1000 (diagnostic complete)';
     }
   }

   // The 2005 APU suite also predates the modern $6000 protocol and leaves
   // its final result in zero-page $F0, where 1 means pass.
   if(status===null && group==='blargg_apu_2005.07.30'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // The 2005 PPU suite predates the modern $6000 protocol. Its shared
   // prefix stores its final result in zero-page $F0, where 1 means pass.
   // power_up_palette is explicitly machine-specific, so report it as
   // informational rather than treating a differing power-on palette as fail.
   if(status===null && group==='blargg_ppu_tests_2005.09.15b'){
     const legacy=e.state().ram[0xF0]&0xFF;
     if(file==='power_up_palette.nes'){
       classification='informational';
       status=0;
       text=legacy===1?'Informational: reference power-up palette matched':
         'Informational: power-up palette differs (result '+legacy+')';
     } else if(legacy){
       status=legacy===1?0:legacy;
       text=legacy===1?'Passed':'Failed #'+legacy;
     }
   }

   // These four very old DMC ROMs have no source or documented machine-readable
   // pass byte in the pinned archive. The archive's test manifest marks each as
   // a 60-frame pass case, but without a self-reporting protocol we keep them
   // explicitly diagnostic-only instead of inventing a pass/fail assertion.
   if(status===null && group==='dmc_tests'){
     classification='diagnostic';
     status=0;
     text='Diagnostic-complete (upstream manifest: 60-frame pass case)';
   }

   // Two DMC/$2007 timing ROMs are observational by design: they print a CRC
   // rather than a pass/fail status. Their CRC accumulator is the first six
   // bytes of the linker ZEROPAGE segment ($10...), with checksum at $10-$13.
   // print_crc outputs the complement in high-to-low byte order.
   if(status===null){
    const key=group+'/'+file, accepted=observationalCrc[key];
    if(accepted){
      const rr=e.state().ram;
      const crc=[rr[0x13],rr[0x12],rr[0x11],rr[0x10]]
        .map(v=>(v^0xFF).toString(16).padStart(2,'0')).join('').toUpperCase();
      status=accepted.has(crc)?0:1;
      text=(status===0?'Accepted CRC ':'Unexpected CRC ')+crc;
    }
   }
  }catch(ex){error=String(ex);}
  const st=e.state();
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,classification,cycles:st.cpuCycles};
  if(status===null&&!error){
   result.pc=st.pc;result.f0=st.ram[0xF0];result.f8=st.ram[0xF8];
   if(group==='blargg_nes_cpu_test5'){
    const pcOff=16+((st.pc-0x8000)&0x7fff);
    result.pcBytes=Array.from(rom.slice(Math.max(16,pcOff-8),Math.min(16+0x8000,pcOff+16))).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.serialWrites=e.evaluate('globalThis.__testSerialWrites||0');
    result.serialRaw=e.evaluate('globalThis.__testSerialRaw||""');
    result.serialText=e.evaluate('globalThis.__testSerialText||""');
   }
   if(group==='dmc_tests'){
    const prgBanks=rom[4], prgSize=prgBanks*0x4000;
    const cpuBase=prgSize===0x4000?0xC000:0x8000;
    const prgOff=16+((st.pc-cpuBase)&(prgSize-1));
    const lo=Math.max(16,prgOff-32),hi=Math.min(16+prgSize,prgOff+48);
    result.terminalBytes=Array.from(rom.slice(lo,hi)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
    result.terminalOffset=prgOff-16;
   }
  }
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error&&r.classification==='passfail').length,
 informational:results.filter(r=>r.status===0&&!r.error&&r.classification==='informational').length,
 diagnostic:results.filter(r=>r.status===0&&!r.error&&r.classification==='diagnostic').length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
if(summary.fail || summary.noProtocol || summary.errors) process.exitCode=1;
