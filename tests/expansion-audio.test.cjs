const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const assert=require('node:assert/strict');

function renderer(chip='Konami VRC6',rate=48000){
  const sandbox={};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/audio/expansion-renderer.js'),'utf8'),sandbox);
  return new sandbox.ExpansionAudioRenderer(chip,rate);
}
function drain(r){const a=[];while(r.available())a.push(r.pop());return a;}
function amplitude(samples,rate,freq){
  let re=0,im=0;
  for(let i=0;i<samples.length;i++){
    const phase=2*Math.PI*i*freq/rate;
    re+=samples[i]*Math.cos(phase);im+=samples[i]*Math.sin(phase);
  }
  return 2*Math.hypot(re,im)/samples.length;
}

test('VRC6 pulse follows CPU/(16*(period+1))',()=>{
  const rate=48000,r=renderer('Konami VRC6',rate),period=100;
  r.write(0x9000,0x7f); // 50% duty, volume 15
  r.write(0x9001,period&255);
  r.write(0x9002,0x80|(period>>8));
  r.advance(Math.floor(1789772.7272727273*0.25));
  const samples=drain(r);
  assert(samples.length>11000 && samples.length<13000);
  const f=1789772.7272727273/(16*(period+1));
  const fundamental=amplitude(samples.slice(2000),rate,f);
  assert(fundamental>0.035);
  assert(fundamental>4*amplitude(samples.slice(2000),rate,f/2));
});

test('VRC6 channel disable resets pulse phase and silences it',()=>{
  const r=renderer();r.write(0x9000,0xff);r.write(0x9001,40);r.write(0x9002,0x80);
  r.advance(20000);drain(r);
  r.write(0x9002,0);assert.equal(r.vrc6.pulse[0].phase,0);
  r.advance(5000);assert(drain(r).every(v=>v===0));
});

test('VRC6 saw produces its 14-step accumulator waveform',()=>{
  const r=renderer();r.write(0xb000,8);r.write(0xb001,40);r.write(0xb002,0x80);
  r.advance(100000);const samples=drain(r);
  assert(samples.some(v=>v>0));
  assert(Math.max(...samples)<=0.34+1e-9);
});

test('VRC6 frequency-control halt freezes oscillator phase',()=>{
  const r=renderer();r.write(0x9000,0x7f);r.write(0x9001,20);r.write(0x9002,0x80);
  r.advance(1000);const before=r.vrc6.pulse[0].phase;
  r.write(0x9003,1);r.advance(10000);
  assert.equal(r.vrc6.pulse[0].phase,before);
});
