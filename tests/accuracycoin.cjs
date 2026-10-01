const fs = require('node:fs');
const crypto = require('node:crypto');
const {createEmulator} = require('./headless.cjs');
const romPath = process.argv[2];
if (!romPath) throw new Error('Usage: node tests/accuracycoin.cjs /path/to/AccuracyCoin.nes [report.json] [baseline.json]');
const rom = fs.readFileSync(romPath);
const hash = crypto.createHash('sha256').update(rom).digest('hex');
const expected = '4fe8c2bc9abc6f4d418da47b73f62cba89fcacd950fae763097a1681d650e839';
if (hash !== expected) throw new Error('Unsupported AccuracyCoin revision: '+hash);
const read = a => rom[16+a-0x8000];
const word = a => read(a)|(read(a+1)<<8);
function string(a) {let s='';while(read(a)!==255) s+=String.fromCharCode(read(a++));return [s,a+1];}
const tests=[];
for(let page=0;page<22;page++) {
  let [group,p]=string(word(0x8100+page*2));
  while(read(p)!==255) {
    let name; [name,p]=string(p);
    const address=word(p);p+=4;
    if(address>=0x400) tests.push({page:page+1,group,name,address});
  }
}
if(tests.length!==144) throw new Error('Test table mismatch');
const e=createEmulator();e.load(new Uint8Array(rom));
e.run(3000000);e.buttons(8);e.run(100000);e.buttons(0);
let state;
const stress2004 = tests.find(t=>t.name==='$2004 Stress Test');
let stress2004Captured = false;
// Diagnostic branch: use smaller execution slices so the stress-test scratch
// buffer can be captured before the following test reuses it.
for(let i=0;i<3000;i++) {
  e.run(100000);state=e.state();
  if(i%300===299) console.error('Emulated cycles:',state.cpuCycles);
  if (!stress2004Captured && stress2004) {
    const v=state.ram[stress2004.address];
    if (v!==0 && v!==3) {
      console.log('TRACE2004:'+Array.from(state.ram.slice(0x500,0x655),
        x=>x.toString(16).padStart(2,'0')).join(' '));
      stress2004Captured=true;
    }
  }
  if(state.ram[0x35]===0 && state.ram[0x37]===144 && tests.every(t=>state.ram[t.address]!==0)) break;
}
const results=tests.map(t=>{
 const raw=state.ram[t.address];
 const status=raw===255?'skipped':raw===0?'not-completed':raw===3?'in-progress':raw&1?'pass':'fail';
 return {...t,raw,status,code:raw>>2};
});
const counts={}; for(const t of results) counts[t.status]=(counts[t.status]||0)+1;
const suiteFinished=state.ram[0x35]===0 && state.ram[0x37]===144 && state.ram[0x38]===counts.pass;
const report={suiteFinished,suiteCommit:'673ef550db296136d52229961e7d39366116882a',romSha256:hash,cpuCycles:state.cpuCycles,pc:state.pc,counts,results};
if(process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(counts));
for(const t of results.filter(t=>t.status!=='pass')) console.log(`${t.page}: ${t.name}: ${t.status} (raw ${t.raw}, code ${t.code})`);
if(process.argv[4]) {
 const baseline=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
 if(baseline.romSha256!==hash) throw new Error('Baseline ROM mismatch');
 const regressions=baseline.results.filter(t=>t.status==='pass' &&
   !results.some(r=>r.address===t.address && r.name===t.name && r.status==='pass'));
 console.log('Previously passing tests lost:',regressions.map(t=>t.name));
 process.exitCode=suiteFinished && !regressions.length && !counts.skipped && !counts['not-completed']?0:1;
} else process.exitCode=suiteFinished && counts.pass===144?0:1;
