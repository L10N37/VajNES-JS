// The C++ renderer follows timestamps from the existing CPU/APU. AudioWorklet
// receives PCM only. Muting cannot change emulated IRQs, DMA, or CPU speed.
const NESAudio = (()=>{
  let wasm=null,context=null,node=null,gain=null,lastCycle=0,loading=null;
  let enabled=false,volume=0.6;
  const button=()=>document.getElementById('audio-toggle');
  function sync(cycle) {
    if(!wasm)return;
    if(cycle<lastCycle){reset(cycle);return;}
    let remaining=cycle-lastCycle;
    while(remaining>0){const n=Math.min(remaining,30000);wasm.audio_advance(n);remaining-=n;}
    lastCycle=cycle;
  }
  function mask(){return apuTiming.length.reduce((m,n,i)=>m|(n?1<<i:0),0);}
  function reset(cycle=0) {
    lastCycle=cycle;
    if(wasm)wasm.audio_reset(context?.sampleRate||48000);
    node?.port.postMessage({type:'reset'});
  }
  function seed(cycle) {
    reset(cycle);
    for(const [address,name] of Object.entries(APU_REG_ADDRESSES))wasm.audio_write(+address,APUregister[name]);
    wasm.audio_lengths(mask());wasm.audio_dmc(DMC.outputLevel||0);
  }
  async function initialise() {
    if(loading)return loading;
    loading=(async()=>{
      const response=await fetch('assets/js/audio/apu.wasm');
      if(!response.ok)throw new Error(`Audio module HTTP ${response.status}`);
      const result=await WebAssembly.instantiate(await response.arrayBuffer(),{});
      wasm=result.instance.exports;
      seed(typeof cpuCycles==='number'?cpuCycles:0);
    })().catch(error=>{loading=null;throw error;});
    return loading;
  }
  async function toggle() {
    const b=button();b.disabled=true;
    try {
      // Create/resume synchronously in the gesture before awaiting network I/O.
      if(!context)context=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
      await context.resume();
      await initialise();
      if(!node) {
        await context.audioWorklet.addModule('assets/js/audio/output-worklet.js');
        node=new AudioWorkletNode(context,'nes-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
        gain=context.createGain();node.connect(gain).connect(context.destination);
        seed(cpuCycles);
      }
      enabled=!enabled;gain.gain.setValueAtTime(enabled?volume:0,context.currentTime);
      b.textContent=enabled?'Mute audio':'Enable audio';
      b.title='C++ / WebAssembly NTSC audio';
      node.port.postMessage({type:'reset'});
    } catch(error) {
      enabled=false;b.textContent='Retry audio';b.title=String(error);
      console.error('NES audio failed:',error);
    } finally {b.disabled=false;}
  }
  function frame(cycle) {
    if(!wasm)return;sync(cycle);
    const count=wasm.audio_available();if(!count)return;
    const pcm=new Float32Array(count);for(let i=0;i<count;i++)pcm[i]=wasm.audio_pop();
    if(enabled && context?.state==='running')node.port.postMessage({type:'samples',samples:pcm},[pcm.buffer]);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    button()?.addEventListener('click',toggle);
    document.getElementById('audio-volume')?.addEventListener('input',event=>{
      volume=Number(event.target.value);if(gain)gain.gain.setTargetAtTime(enabled?volume:0,context.currentTime,0.01);
    });
  });
  return {reset,frame,
    write(cycle,address,value){if(wasm){sync(cycle);wasm.audio_lengths(mask());wasm.audio_write(address,value);}},
    quarter(cycle){if(wasm){sync(cycle);wasm.audio_quarter();}},
    half(cycle){if(wasm){sync(cycle);wasm.audio_lengths(mask());wasm.audio_half();}},
    dmc(cycle,value){if(wasm){sync(cycle);wasm.audio_dmc(value);}},
    pause(){node?.port.postMessage({type:'reset'});},
    get ready(){return !!wasm;}
  };
})();
