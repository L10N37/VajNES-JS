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
const scanline0Trace = e.evaluate('accuracyCoinScanline0Trace');
for (const [i,t] of scanline0Trace.entries()) {
  console.log('SCAN0['+i+'] event='+t.event+' frame='+t.frame+' odd='+(t.odd?1:0)+
    ' dot='+t.dot+' oamMask='+t.oamMask.toString(16).padStart(2,'0')+
    ' visualMask='+t.visualMask.toString(16).padStart(2,'0')+
    ' addr='+t.secAddr.toString(16).padStart(2,'0')+' frozen='+(t.frozen?1:0)+
    ' sec='+t.secondary.map(x=>x.toString(16).padStart(2,'0')).join(',')+
    ' nextCount='+t.nextCount+' spr0='+t.nextSprite0+
    ' tile0='+t.tile0.toString(16).padStart(2,'0')+
    ' row0='+t.row0+' attr0='+t.attr0.toString(16).padStart(2,'0')+
    ' x0='+t.x0.toString(16).padStart(2,'0'));
}
const frozenFetchTrace = e.evaluate('accuracyCoinFrozenFetchTrace');
for (const [i,t] of frozenFetchTrace.entries()) {
  console.log('FROZENFETCH['+i+'] sl='+t.scanline+' dot='+t.dot+
    ' value='+t.value.toString(16).padStart(2,'0')+
    ' addr='+t.secAddr.toString(16).padStart(2,'0')+
    ' frozen='+(t.frozen?1:0)+
    ' oamMask='+t.oamMask.toString(16).padStart(2,'0')+
    ' visualMask='+t.visualMask.toString(16).padStart(2,'0')+
    ' target='+t.targetLine+' row='+t.row+
    ' oldCount='+t.oldCount+' oldSprite0='+t.oldSprite0+
    ' oldTile0='+t.oldTile0.toString(16).padStart(2,'0')+
    ' oldAttr0='+t.oldAttr0.toString(16).padStart(2,'0')+
    ' oldX0='+t.oldX0.toString(16).padStart(2,'0'));
}
const oam2ReadTrace = e.evaluate('accuracyCoinOAM2ReadTrace');
for (const [i,t] of oam2ReadTrace.entries()) {
  console.log('OAM2READ['+i+'] sl='+t.scanline+' dot='+t.dot+
    ' value='+t.value.toString(16).padStart(2,'0')+
    ' addr='+t.secAddr.toString(16).padStart(2,'0')+
    ' frozen='+(t.frozen?1:0)+' interrupted='+(t.interrupted?1:0)+
    ' oam20='+t.oam20.toString(16).padStart(2,'0')+
    ' oam24='+t.oam24.toString(16).padStart(2,'0'));
}
const stressSnapshots = e.evaluate('accuracyCoinStressSnapshots');
for (const [i,trace] of stressSnapshots.entries()) {
  console.log('STRESSSNAP['+i+'] tag='+trace.tag+' error='+trace.errorCode+
    ' table='+trace.table.map(x=>x.toString(16).padStart(2,'0')).join(' '));
}
const liveTrace654 = e.evaluate('accuracyCoinTrace654');
for (const [i,trace] of liveTrace654.entries()) {
  console.log('TRACE654['+i+'] value='+trace.value.toString(16).padStart(2,'0')+
    ' error='+trace.errorCode+
    ' table='+trace.table.map(x=>x.toString(16).padStart(2,'0')).join(' '));
}
// Temporary $2007 timing sweep: one CI run tests several PPU DATA refill
// delays against AccuracyCoin's stable-byte answer key.
function run2007DelayVariant(delay) {
  const v=createEmulator(); v.load(new Uint8Array(rom));
  v.evaluate('ppuCpu2007CaptureDelay='+delay);
  v.run(3000000); v.buttons(8); v.run(100000); v.buttons(0);
  let st;
  for(let i=0;i<3000;i++) {
    v.run(100000); st=v.state();
    if(st.ram[0x35]===0 && st.ram[0x37]===144 &&
       tests.every(tt=>st.ram[tt.address]!==0)) break;
  }
  const traces=v.evaluate('accuracyCoinTrace654');
  const trace=[...traces].reverse().find(x=>x.errorCode===2 &&
    x.table && x.table.length===341 && x.table[0]!==0x7F);
  const test=tests.find(tt=>tt.name==='$2007 Stress Test');
  const raw=test?st.ram[test.address]:0;
  if(!trace) return {delay,raw,mismatches:-1,first:[]};

  const key=('02 C0 46 46 03 C0 06 06 04 C1 6C 6C 05 C1 60 60 '+
    '06 C1 60 60 07 C1 06 06 08 C2 66 66 09 C2 66 66 '+
    '0A C2 24 24 0B C2 66 66 0C C3 66 66 0D C3 64 64 '+
    '0E C3 60 60 0F C3 60 60 10 C4 66 66 11 C4 66 66 '+
    '12 C4 18 18 13 C4 0C 0C 14 C5 6C 6C 15 C5 60 60 '+
    '16 C5 76 76 17 C5 72 72 18 C6 66 66 19 C6 7C 7C '+
    '1A C6 3C 3C 1B C6 7C 7C 1C C7 3C 3C 1D C7 7E 7E '+
    '1E C7 66 66 1F C7 66 66 00 C0 3C 3C 01 C0 18 18 '+
    '02 00 FF FF 00 00 FF FF 00 00 FF FF 00 00 FF FF '+
    '00 00 FF FF 00 00 FF FF 00 00 FF FF 00 00 FF FF '+
    '00 C0 66 66 01 C0 38 38 02 02').split(' ').map(x=>parseInt(x,16));
  let stable=[];
  for(let y=1;y<trace.table.length && stable.length<key.length;y+=2)
    stable.push(trace.table[y]&0xFF);
  let first=[], mismatches=0;
  for(let i=0;i<key.length;i++) if(stable[i]!==key[i]) {
    mismatches++;
    if(first.length<12) first.push([i,stable[i],key[i]]);
  }
  return {delay,raw,mismatches,first};
}
for (const delay of [3,4,5,6,7,8,9,10]) {
  const d=run2007DelayVariant(delay);
  console.log('PPU2007SWEEP '+JSON.stringify(d));
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
