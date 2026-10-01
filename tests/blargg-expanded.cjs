// Exploratory expanded Blargg/nes-test-roms sweep. Legacy suites use delayed final-result reads.
// Uses the standard $6000 result protocol where available. This discovery
// script never fails CI itself; the report tells us which suites need work.
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
 ]
};
const groups=groupsByShard[shard];if(!groups)throw Error('Unknown BLARGG_SHARD '+shard);
const results=[];
for(const group of groups){
 const dir=path.join(root,group);
 if(!fs.existsSync(dir)){results.push({rom:group,status:null,error:'missing directory'});continue;}
 for(const file of fs.readdirSync(dir).filter(p=>p.endsWith('.nes')).sort()){
  const rom=fs.readFileSync(path.join(dir,file)),e=createEmulator();let status=null,text='',error=null;
  try{
   e.load(new Uint8Array(rom));
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
      if(status<128)break;
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
  }catch(ex){error=String(ex);}
  const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,cycles:e.state().cpuCycles};
  results.push(result);console.log('BLARGG_EXPANDED '+JSON.stringify(result));
 }
}
const summary={
 shard,
 total:results.length,
 pass:results.filter(r=>r.status===0&&!r.error).length,
 fail:results.filter(r=>r.status!==null&&r.status!==0).length,
 noProtocol:results.filter(r=>r.status===null&&!r.error).length,
 errors:results.filter(r=>r.error).length
};
console.log('BLARGG_EXPANDED_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',summary,results},null,2)+'\n');
