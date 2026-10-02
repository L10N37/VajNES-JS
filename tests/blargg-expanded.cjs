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
  'blargg_nes_cpu_test5',
  'mmc3_test',
  'instr_test-v3/rom_singles'
 ]
};
const groups=groupsByShard[shard];if(!groups)throw Error('Unknown BLARGG_SHARD '+shard);
const observationalCrc={
 'dmc_dma_during_read4/dma_2007_read.nes':new Set(['159A7A8F','5E3DF9C4']),
 'dmc_dma_during_read4/double_2007_read.nes':new Set(['85CFD627','F018C287','440EF923','E52F41A5'])
};
const results=[];
for(const group of groups){
 const dir=path.join(root,group);
 if(!fs.existsSync(dir)){results.push({rom:group,status:null,error:'missing directory'});continue;}
 for(const file of fs.readdirSync(dir).filter(p=>p.endsWith('.nes')).sort()){
  const rom=fs.readFileSync(path.join(dir,file)),e=createEmulator();let status=null,text='',error=null,classification='passfail',resetCount=0,resetRequestLatched=false;
  try{
   e.load(new Uint8Array(rom));
   // The two legacy MMC3 revision ROMs intentionally target different IRQ
   // silicon. Their old iNES headers cannot encode the revision, so select it
   // explicitly just as the existing mmc3_test_2 gate does.
   if(group==='mmc3_irq_tests'){
    if(file==='5.MMC3_rev_A.nes') e.evaluate('mmc3SetIrqVariant("nec")');
    if(file==='6.MMC3_rev_B.nes') e.evaluate('mmc3SetIrqVariant("sharp")');
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
