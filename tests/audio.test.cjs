const fs=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const moduleBytes=fs.readFileSync(path.join(__dirname,'../assets/js/audio/apu.wasm'));
function audio(rate=48000){const a=new WebAssembly.Instance(new WebAssembly.Module(moduleBytes),{}).exports;a.audio_reset(rate);return a;}
function drain(a){const samples=[];while(a.audio_available())samples.push(a.audio_pop());return samples;}
function tone(rate=48000,channel=0){const a=audio(rate);a.audio_lengths(1<<channel);const b=0x4000+channel*4;a.audio_write(b,0xbf);a.audio_write(b+2,253);a.audio_write(b+3,0);return a;}
function amplitude(samples,rate,freq){let re=0,im=0;for(let i=0;i<samples.length;i++){const phase=2*Math.PI*i*freq/rate;re+=samples[i]*Math.cos(phase);im+=samples[i]*Math.sin(phase);}return 2*Math.hypot(re,im)/samples.length;}
test('WASM has no external runtime imports',()=>assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(moduleBytes)),[]));
for(const rate of [44100,48000]) test(`pulse frequency and sample count at ${rate} Hz`,()=>{
 const a=tone(rate);const samples=[];for(let i=0;i<20;i++){a.audio_advance(17898);samples.push(...drain(a));}
 assert.equal(samples.length,Math.floor(357960*rate/1789772.7272727273));
 assert(samples.every(Number.isFinite));assert(Math.max(...samples)<1);assert(Math.min(...samples)>-1);
 const steady=samples.slice(Math.floor(rate*0.04));const f=1789772.7272727273/(16*254);
 assert(amplitude(steady,rate,f)>0.05);
 assert(amplitude(steady,rate,f)>5*amplitude(steady,rate,f/2));
 assert.equal(a.audio_overruns(),0);
});
test('pulse channels render the same constant-volume trace',()=>{
 const a=tone(48000,0),b=tone(48000,1);a.audio_advance(100000);b.audio_advance(100000);assert.deepEqual(drain(a),drain(b));
});
test('envelope decay, restart and looping',()=>{
 const a=audio();a.audio_write(0x4000,2);a.audio_write(0x4003,0);a.audio_quarter();assert.equal(a.audio_debug(6),15);
 for(let i=0;i<3;i++)a.audio_quarter();assert.equal(a.audio_debug(6),14);
 a.audio_write(0x4000,0x20);for(let i=0;i<17;i++)a.audio_quarter();assert(a.audio_debug(6)>0);
 a.audio_write(0x4003,0);a.audio_quarter();assert.equal(a.audio_debug(6),15);
});
test('pulse sweep negate differs by one between the two channels',()=>{
 const a=audio();for(let c=0;c<2;c++){a.audio_write(0x4002+c*4,100);a.audio_write(0x4001+c*4,0x89);}a.audio_half();
 assert.equal(a.audio_debug(0),49);assert.equal(a.audio_debug(1),50);
});
test('triangle linear counter gates phase while holding its DAC level',()=>{
 const a=audio();a.audio_lengths(4);a.audio_write(0x4008,2);a.audio_write(0x400a,40);a.audio_write(0x400b,0);
 a.audio_advance(1000);assert.equal(a.audio_debug(4),0);a.audio_quarter();a.audio_advance(1000);assert.notEqual(a.audio_debug(4),0);
 a.audio_quarter();a.audio_quarter();const phase=a.audio_debug(4);a.audio_advance(1000);assert.equal(a.audio_debug(4),phase);
});
test('noise LFSR modes diverge and never lock to zero',()=>{
 const a=audio(),b=audio();a.audio_write(0x400e,0);b.audio_write(0x400e,0x80);a.audio_advance(400);b.audio_advance(400);
 assert.notEqual(a.audio_debug(3),0);assert.notEqual(b.audio_debug(3),0);assert.notEqual(a.audio_debug(3),b.audio_debug(3));
});
test('DMC direct DAC is 7 bit and DC is removed after settling',()=>{
 const a=audio();a.audio_dmc(255);assert.equal(a.audio_debug(5),127);
 let last;for(let i=0;i<50;i++){a.audio_advance(17898);last=drain(a);}assert(Math.max(...last.map(Math.abs))<1e-5);
});
test('advance batching does not change samples',()=>{
 const a=tone(),b=tone();a.audio_advance(100000);for(let i=0;i<100;i++)b.audio_advance(1000);assert.deepEqual(drain(a),drain(b));
});
test('worklet starts after prefill, survives underrun, and clears queued PCM',()=>{
 let Processor;const sandbox={AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}}}},registerProcessor:(name,p)=>Processor=p,Float32Array};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/audio/output-worklet.js'),'utf8'),sandbox);
 const p=new Processor();const out=new Float32Array(128);p.process([],[[out]]);assert(out.every(v=>v===0));
 p.port.onmessage({data:{type:'samples',samples:new Float32Array(2048).fill(.2)}});p.process([],[[out]]);assert(out.every(v=>Math.abs(v-.2)<1e-6));
 for(let i=0;i<20;i++)p.process([],[[out]]);assert.equal(p.underruns,1);
 p.port.onmessage({data:{type:'reset'}});p.process([],[[out]]);assert(out.every(v=>v===0));
});
module.exports={audio,drain};
test('cycle-driven WASM rendering leaves CPU, PPU and APU execution unchanged',()=>{
 const {createEmulator}=require('./headless.cjs');const wasm=audio();let last=0,samples=0,emulator;
 const sync=c=>{wasm.audio_advance(c-last);last=c;};const lengths=()=>wasm.audio_lengths(emulator.evaluate('apuTiming.length.reduce((m,n,i)=>m|(n?1<<i:0),0)'));
 const renderer={unlock(){},reset(c){wasm.audio_reset(48000);last=c;},write(c,a,v){sync(c);lengths();wasm.audio_write(a,v);},quarter(c){sync(c);wasm.audio_quarter();},half(c){sync(c);lengths();wasm.audio_half();},dmc(c,v){sync(c);wasm.audio_dmc(v);},frame(c){sync(c);while(wasm.audio_available()){assert(Number.isFinite(wasm.audio_pop()));samples++;}},pause(){}};
 const rom=new Uint8Array(16+32768+8192);rom.set([78,69,83,26,2,1]);rom.set([0xea,0x4c,0,0x80],16);rom[16+32768-3]=0x80;
 emulator=createEmulator(renderer);const silent=createEmulator();emulator.load(rom);silent.load(rom);
 for(const e of [emulator,silent]){e.evaluate('apuWrite(0x4015,15);apuWrite(0x4000,0xbf);apuWrite(0x4002,253);apuWrite(0x4003,8);apuWrite(0x4011,64)');e.run(300000);}
 assert.deepEqual(emulator.state(),silent.state());assert.equal(emulator.evaluate('JSON.stringify(apuTiming)'),silent.evaluate('JSON.stringify(apuTiming)'));
 assert(samples>7000);assert.equal(wasm.audio_overruns(),0);
});
