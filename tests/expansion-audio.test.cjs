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


test('MMC5 pulse channel generates duty-gated output',()=>{
 const r=renderer('MMC5',48000);
 r.write(0x5015,0x01);
 r.write(0x5000,0xdf); // duty 3, constant volume 15
 r.write(0x5002,0x20);
 r.write(0x5003,0x08); // load length
 r.advance(5000);
 const samples=[];
 while(r.available())samples.push(r.pop());
 assert.ok(samples.some(v=>v>0));
});

test('MMC5 PCM DAC contributes signed mixed output',()=>{
 const r=renderer('MMC5',48000);
 r.write(0x5011,0xff);
 r.advance(2000);
 let positive=false;
 while(r.available())if(r.pop()>0)positive=true;
 assert.equal(positive,true);
 r.write(0x5011,0x01);
 r.advance(2000);
 let negative=false;
 while(r.available())if(r.pop()<0)negative=true;
 assert.equal(negative,true);
});

test('MMC5 5015 reports active pulse length and disabling clears it',()=>{
 const r=renderer('MMC5',48000);
 r.write(0x5015,1);r.write(0x5003,0x08);
 assert.equal(r.read(0x5015)&1,1);
 r.write(0x5015,0);
 assert.equal(r.read(0x5015)&1,0);
});


test('Sunsoft 5B tone follows CPU/(32*period)',()=>{
 const rate=48000,r=renderer('Sunsoft 5B',rate),period=100;
 // Channel A period.
 r.write(0xc000,0);r.write(0xe000,period&255);
 r.write(0xc000,1);r.write(0xe000,(period>>8)&0x0f);
 // A tone on, A noise off; B/C tone+noise off.
 r.write(0xc000,7);r.write(0xe000,0x3e);
 r.write(0xc000,8);r.write(0xe000,0x0f);
 r.advance(Math.floor(1789772.7272727273*0.25));
 const samples=drain(r),f=1789772.7272727273/(32*period);
 assert(samples.length>11000&&samples.length<13000);
 const fundamental=amplitude(samples.slice(2000),rate,f);
 assert(fundamental>0.03);
 assert(fundamental>3*amplitude(samples.slice(2000),rate,f/2));
});

test('Sunsoft 5B register select high nibble disables data writes',()=>{
 const r=renderer('Sunsoft 5B',48000);
 r.write(0xc000,0x08);r.write(0xe000,0x0f);
 assert.equal(r.sunsoft5b.regs[8],0x0f);
 r.write(0xc000,0xf8);r.write(0xe000,0x02);
 assert.equal(r.sunsoft5b.regs[8],0x0f);
});

test('Sunsoft 5B mixer supports shared noise and envelope clocks',()=>{
 const r=renderer('Sunsoft 5B',48000);
 // Enable noise on A, disable tone on A; silence B/C.
 r.write(0xc000,6);r.write(0xe000,1);
 r.write(0xc000,7);r.write(0xe000,0x37);
 r.write(0xc000,11);r.write(0xe000,2);
 r.write(0xc000,12);r.write(0xe000,0);
 r.write(0xc000,13);r.write(0xe000,0x0e);
 r.write(0xc000,8);r.write(0xe000,0x10);
 const before=r.sunsoft5b.noiseLfsr;
 r.advance(5000);
 const samples=drain(r);
 assert.notEqual(r.sunsoft5b.noiseLfsr,before);
 assert(samples.some(v=>v>0));
 assert(r.sunsoft5b.envelopeLevel>=0&&r.sunsoft5b.envelopeLevel<=31);
});

test('Sunsoft 5B save-state restores PSG registers and oscillator state',()=>{
 const r=renderer('Sunsoft 5B',48000);
 r.write(0xc000,0);r.write(0xe000,37);
 r.write(0xc000,8);r.write(0xe000,15);
 r.advance(12345);
 const state=r.saveState(),phase=r.sunsoft5b.tonePhase[0],lfsr=r.sunsoft5b.noiseLfsr;
 r.reset(0);
 assert.equal(r.loadState(state),true);
 assert.equal(r.sunsoft5b.regs[0],37);
 assert.equal(r.sunsoft5b.regs[8],15);
 assert.equal(r.sunsoft5b.tonePhase[0],phase);
 assert.equal(r.sunsoft5b.noiseLfsr,lfsr);
});


test('VRC7 FM channel produces audible output from register writes',()=>{
 const r=renderer('Konami VRC7',48000);
 // Use built-in instrument 1, medium volume, A4-ish tone.
 r.write(0x9010,0x10);r.write(0x9030,0x80);
 r.write(0x9010,0x20);r.write(0x9030,0x15);
 r.write(0x9010,0x30);r.write(0x9030,0x10);
 r.advance(Math.floor(1789772.7272727273*0.25));
 const samples=drain(r);
 assert(samples.length>11000&&samples.length<13000);
 assert(samples.some(v=>Math.abs(v)>1e-4));
});

test('VRC7 key off releases channel instead of leaving a stuck tone',()=>{
 const r=renderer('Konami VRC7',48000);
 r.write(0x9010,0x10);r.write(0x9030,0x90);
 r.write(0x9010,0x20);r.write(0x9030,0x15);
 r.write(0x9010,0x30);r.write(0x9030,0x10);
 r.advance(50000);drain(r);
 r.write(0x9010,0x20);r.write(0x9030,0x05);
 r.advance(Math.floor(1789772.7272727273*2));
 const samples=drain(r);
 const tail=samples.slice(-2000);
 assert(tail.every(v=>Math.abs(v)<0.03));
});

test('VRC7 reset bit silences FM core and register writes while asserted',()=>{
 const r=renderer('Konami VRC7',48000);
 r.write(0x9010,0x10);r.write(0x9030,0x80);
 r.write(0x9010,0x20);r.write(0x9030,0x15);
 r.write(0x9010,0x30);r.write(0x9030,0x10);
 r.advance(30000);assert(drain(r).some(v=>Math.abs(v)>1e-4));
 r.write(0xe000,0x40);
 r.advance(30000);
 assert(drain(r).every(v=>v===0));
});

test('VRC7 save-state restores FM registers and oscillator state',()=>{
 const r=renderer('Konami VRC7',48000);
 r.write(0x9010,0x10);r.write(0x9030,0xa0);
 r.write(0x9010,0x20);r.write(0x9030,0x17);
 r.write(0x9010,0x30);r.write(0x9030,0x20);
 r.advance(12345);
 const state=r.saveState();
 const phase=r.vrc7.channels[0].carPhase;
 r.reset(0);
 assert.equal(r.loadState(state),true);
 assert.equal(r.vrc7.regs[0x10],0xa0);
 assert.equal(r.vrc7.channels[0].carPhase,phase);
});
