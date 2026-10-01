// Unmodified upstream ROMs, using their documented $6000 result protocol.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createEmulator}=require('./headless.cjs');
const root=process.argv[2];if(!root)throw Error('Usage: node tests/blargg.cjs nes-test-roms-dir [report.json]');
const groups=['mmc3_test_2/rom_singles','ppu_vbl_nmi/rom_singles','cpu_interrupts_v2/rom_singles','instr_timing/rom_singles'];const results=[];
for(const group of groups)for(const file of fs.readdirSync(path.join(root,group)).filter(p=>p.endsWith('.nes')&&(!process.env.TEST_FILTER || p.includes(process.env.TEST_FILTER))).sort()){
 const rom=fs.readFileSync(path.join(root,group,file)),e=createEmulator();let status=null,text='',error=null;
 try{
  e.load(new Uint8Array(rom));
  // 6-MMC3_alt tests NEC/old MMC3 silicon, but its legacy iNES header cannot
  // encode that chip revision. Select the documented variant explicitly.
  if(file==='6-MMC3_alt.nes') e.evaluate('mmc3SetIrqVariant("nec")');
  for(let i=0;i<180;i++){e.run(200000);const data=e.evaluate('Array.from(prgRam.slice(0,4096))');if(data[1]===0xde&&data[2]===0xb0&&data[3]===0x61){status=data[0];text=String.fromCharCode(...data.slice(4,data.indexOf(0,4)));if(status<128)break;}}}catch(ex){error=String(ex);}
 const result={rom:group+'/'+file,sha256:crypto.createHash('sha256').update(rom).digest('hex'),status,text,error,cycles:e.state().cpuCycles};results.push(result);console.log(JSON.stringify(result));
}
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({upstreamCommit:'95d8f621ae55cee0d09b91519a8989ae0e64753b',results},null,2)+'\n');
process.exitCode=results.some(r=>r.status!==0||r.error)?1:0;
