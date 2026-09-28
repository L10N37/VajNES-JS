const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('audio unlock is automatic, full volume and shared across concurrent gestures',async()=>{
 const events={},contexts=[],nodes=[];let fail=true;
 class AudioContext{constructor(){this.sampleRate=48000;this.currentTime=0;this.state='suspended';this.audioWorklet={addModule:async()=>{}};contexts.push(this)}async resume(){this.state='running'}createGain(){this.gain={gain:{value:0},connect(){return this}};return this.gain}}
 class AudioWorkletNode{constructor(){this.messages=[];this.port={postMessage:v=>this.messages.push(v)};nodes.push(this)}connect(){return this}}
 const env=vm.createContext({AudioContext,AudioWorkletNode,document:{addEventListener:(k,v)=>events[k]=v},console:{error(){}},fetch:async()=>{if(fail)throw Error('temporary failure');return {ok:true,arrayBuffer:async()=>fs.readFileSync('assets/js/audio/apu.wasm')}},WebAssembly,Float32Array,cpuCycles:0,apuTiming:{length:[0,0,0,0]},APU_REG_ADDRESSES:{},APUregister:{},DMC:{outputLevel:0}});
 vm.runInContext(fs.readFileSync('assets/js/audio/browser-audio.js','utf8')+';globalThis.audio=NESAudio',env);
 assert.equal(contexts.length,0);await events.pointerdown();assert.equal(env.audio.ready,false);fail=false;
 await Promise.all([events.pointerdown(),events.keydown(),events.pointerdown()]);assert.equal(contexts.length,1);assert.equal(nodes.length,1);assert.equal(contexts[0].gain.gain.value,1);assert.equal(env.audio.ready,true);
 env.audio.frame(30000);assert(nodes[0].messages.some(m=>m.type==='samples'&&m.samples.length>0));
 const resets=nodes[0].messages.filter(m=>m.type==='reset').length;await events.keydown();assert.equal(nodes[0].messages.filter(m=>m.type==='reset').length,resets);
});
