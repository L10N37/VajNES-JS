// PCM transport only: no emulation clocks or hardware state on this thread.
class NESPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue=new Float32Array(32768); this.read=0;this.write=0;
    this.started=false;this.last=0;this.underruns=0;this.overruns=0;
    this.port.onmessage=({data})=>{
      if(data.type==='reset'){this.read=this.write=0;this.started=false;this.last=0;return;}
      if(data.type==='stats'){this.port.postMessage({queued:this.write-this.read,underruns:this.underruns,overruns:this.overruns});return;}
      if(data.type!=='samples')return;
      const samples=data.samples;
      // Bound latency after a stalled/background tab. Drop oldest PCM, never CPU cycles.
      if(this.write-this.read+samples.length>8192){this.read=this.write;this.started=false;this.overruns++;}
      for(let i=0;i<samples.length;i++)this.queue[this.write++&32767]=samples[i];
    };
  }
  process(inputs,outputs) {
    const channels=outputs[0];if(!channels || !channels.length)return true;
    const out=channels[0];
    if(!this.started && this.write-this.read>=2048)this.started=true;
    for(let i=0;i<out.length;i++) {
      if(this.started && this.read<this.write)this.last=this.queue[this.read++&32767];
      else {if(this.started){this.underruns++;this.started=false;}this.last*=0.98;}
      out[i]=this.last;
    }
    for(let c=1;c<channels.length;c++)channels[c].set(out);
    return true;
  }
}
registerProcessor('nes-pcm',NESPCMProcessor);
