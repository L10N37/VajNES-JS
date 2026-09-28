const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){const events={},timers=[],nodes=[];let context;
 const param=()=>({value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v},linearRampToValueAtTime(v){this.value=v}});
 const node=()=>{const n={gain:param(),frequency:param(),Q:param(),connect(){return this},start(){this.started=true},stop(){this.stopped=true},disconnect(){this.disconnected=true}};nodes.push(n);return n};
 class AudioContext{constructor(){context=this;this.state='suspended';this.sampleRate=48000;this.currentTime=0;this.destination={}}createGain(){return node()}createBiquadFilter(){return node()}createOscillator(){return node()}createBufferSource(){return node()}createBuffer(c,n){return {getChannelData:()=>new Float32Array(n)}}async resume(){this.state='running';this.onstatechange?.()}}
 const env=vm.createContext({window:{AudioContext},document:{addEventListener:(type,fn)=>events[type]=fn},setTimeout:fn=>timers.push(fn)});
 vm.runInContext(fs.readFileSync('assets/js/screen/analogueFuzz.js','utf8')+';globalThis.audio=NoSignalAudio',env);
 return {audio:env.audio,events,timers,nodes,get context(){return context}};
}
test('RF noise resumes on a gesture; disabling alone does not create a context',async()=>{const f=fixture();f.audio.setEnabled(false);assert.equal(f.context,undefined);f.audio.setEnabled(true);assert.equal(f.context.state,'suspended');await f.events.pointerdown();assert.equal(f.context.state,'running');assert(f.nodes.some(n=>n.buffer&&n.started));});
test('repeated CPU mute requests schedule one fade; stale fade cannot stop a restart',async()=>{const f=fixture();f.audio.setEnabled(true);await f.events.keydown();const old=f.nodes.find(n=>n.buffer);for(let i=0;i<1000;i++)f.audio.setEnabled(false);assert.equal(f.timers.length,1);assert.equal(f.nodes[0].gain.value,0);f.audio.setEnabled(true);const fresh=f.nodes.filter(n=>n.buffer).at(-1);assert.notEqual(old,fresh);f.timers[0]();assert(old.disconnected);assert(!fresh.disconnected);assert(!fresh.stopped);});
test('cancelled RF request stays silent when a later gesture resumes the context',async()=>{const f=fixture();f.audio.setEnabled(true);f.audio.setEnabled(false);await f.events.pointerdown();assert(!f.nodes.some(n=>n.buffer));});
