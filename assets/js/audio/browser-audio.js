// The C++ renderer follows timestamps from the existing CPU/APU. AudioWorklet
// receives PCM only. Audio readiness cannot change IRQs, DMA, or CPU speed.
const NESAudio = (()=>{
  let wasm=null,context=null,node=null,gain=null,lastCycle=0,loading=null;
  let starting=null;
  let expansion=null, expansionChip=null, expansionEnabled=false;
  function sync(cycle) {
    if(!wasm)return;
    if(cycle<lastCycle){reset(cycle);return;}
    let remaining=cycle-lastCycle;
    while(remaining>0){
      const n=Math.min(remaining,30000);
      wasm.audio_advance(n);
      expansion?.advance(n);
      remaining-=n;
    }
    lastCycle=cycle;
  }
  function mask(){return apuTiming.length.reduce((m,n,i)=>m|(n?1<<i:0),0);}
  function reset(cycle=0) {
    lastCycle=cycle;
    if(wasm)wasm.audio_reset(context?.sampleRate||48000);
    expansion?.reset(cycle);
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
  function unlock() {
    // Resume in the gesture itself, even if an earlier resume is still pending.
    try {
      if(!context)context=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
      const resumed=context.resume();
      if(starting){resumed.catch(()=>{});return starting;}
      starting=(async()=>{
        await resumed;
        await initialise();
        if(!node) {
          await context.audioWorklet.addModule('assets/js/audio/output-worklet.js');
          node=new AudioWorkletNode(context,'nes-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
          gain=context.createGain();gain.gain.value=1;
          node.connect(gain).connect(context.destination);
          seed(cpuCycles);
        }
      })().catch(error=>globalThis.NES_DEBUG_LOGGING && console.error('NES audio failed; next gesture will retry:',error))
        .finally(()=>{starting=null;});
      return starting;
    } catch(error) {globalThis.NES_DEBUG_LOGGING && console.error('NES audio unavailable:',error);}
  }
  function frame(cycle) {
    if(!wasm)return;sync(cycle);
    const count=wasm.audio_available();if(!count)return;
    const pcm=new Float32Array(count);
    for(let i=0;i<count;i++){
      const base=wasm.audio_pop();
      const extra=expansion?.pop()||0;
      pcm[i]=Math.max(-1,Math.min(1,base+extra));
    }
    if(node && context?.state==='running')node.port.postMessage({type:'samples',samples:pcm},[pcm.buffer]);
  }

  function setExpansion(chip,enabled) {
    expansionChip=chip||null;
    expansionEnabled=!!enabled && !!chip;
    expansion=expansionEnabled && typeof ExpansionAudioRenderer!=='undefined'
      ? new ExpansionAudioRenderer(expansionChip,context?.sampleRate||48000)
      : null;
    expansion?.reset(lastCycle);
  }

  function expansionWrite(cycle,address,value) {
    if(!expansionEnabled || !expansion)return;
    if(wasm)sync(cycle);
    else if(cycle>=lastCycle){
      expansion.advance(cycle-lastCycle);
      lastCycle=cycle;
    }
    expansion.write(address,value);
  }
  document.addEventListener('pointerdown',unlock,{capture:true});
  document.addEventListener('keydown',unlock,{capture:true});
  return {reset,frame,unlock,setExpansion,expansionWrite,
    write(cycle,address,value){if(wasm){sync(cycle);wasm.audio_lengths(mask());wasm.audio_write(address,value);}},
    quarter(cycle){if(wasm){sync(cycle);wasm.audio_quarter();}},
    half(cycle){if(wasm){sync(cycle);wasm.audio_lengths(mask());wasm.audio_half();}},
    dmc(cycle,value){if(wasm){sync(cycle);wasm.audio_dmc(value);}},
    pause(){node?.port.postMessage({type:'reset'});},
    get ready(){return !!node;}
  };
})();
