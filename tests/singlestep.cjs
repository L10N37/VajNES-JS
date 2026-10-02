// NES 2A03 CPU single-step oracle against SingleStepTests/ProcessorTests.
// Usage: node tests/singlestep.cjs <nes6502-v1-dir> [report.json]
const fs=require('node:fs'),path=require('node:path');
const {createEmulator}=require('./headless.cjs');

const root=process.argv[2];
if(!root) throw Error('Usage: node tests/singlestep.cjs <nes6502-v1-dir> [report.json]');

const opcodeFiles=['69.json','8d.json','a9.json','d0.json'];
const emu=createEmulator();
const failures=[];
let total=0,exactFail=0;

function sameRam(expected,actual){
  if(expected.length!==actual.length) return false;
  for(let i=0;i<expected.length;i++){
    if((expected[i][0]&0xffff)!==(actual[i][0]&0xffff) ||
       (expected[i][1]&0xff)!==(actual[i][1]&0xff)) return false;
  }
  return true;
}
function sameBus(expected,actual){
  if(expected.length!==actual.length) return false;
  for(let i=0;i<expected.length;i++){
    const e=expected[i],a=actual[i];
    if((e[0]&0xffff)!==(a[0]&0xffff) ||
       (e[1]&0xff)!==(a[1]&0xff) ||
       e[2]!==a[2]) return false;
  }
  return true;
}

for(const file of opcodeFiles){
  const tests=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  let opcodeFail=0;
  for(const test of tests){
    total++;
    const got=emu.singleStepFlat(test);
    const exp=test.final;
    const registerMismatch=
      got.pc!==(exp.pc&0xffff) ||
      got.s!==(exp.s&0xff) ||
      got.a!==(exp.a&0xff) ||
      got.x!==(exp.x&0xff) ||
      got.y!==(exp.y&0xff) ||
      got.p!==(exp.p&0xff);
    const ramMismatch=!sameRam(exp.ram||[],got.ram||[]);
    const busMismatch=!sameBus(test.cycles||[],got.bus||[]);
    const cycleMismatch=got.cycles!==(test.cycles||[]).length;
    if(got.error || registerMismatch || ramMismatch || busMismatch || cycleMismatch){
      opcodeFail++; exactFail++;
      if(failures.length<50){
        failures.push({
          opcode:file.slice(0,2),
          name:test.name,
          expected:{pc:exp.pc,s:exp.s,a:exp.a,x:exp.x,y:exp.y,p:exp.p,ram:exp.ram,cycles:test.cycles},
          actual:got,
          mismatch:{registerMismatch,ramMismatch,busMismatch,cycleMismatch}
        });
      }
    }
  }
  console.log('SINGLESTEP_OPCODE '+JSON.stringify({opcode:file.slice(0,2),total:tests.length,fail:opcodeFail,pass:tests.length-opcodeFail}));
}

const summary={opcodes:opcodeFiles.length,total,pass:total-exactFail,fail:exactFail,capturedFailures:failures.length};
console.log('SINGLESTEP_SUMMARY '+JSON.stringify(summary));
if(process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify({summary,failures},null,2)+'\n');
if(exactFail) process.exitCode=1;
