// Cycle-timestamped expansion-audio renderer mixed with the existing APU PCM.
// The first supported chip is Konami VRC6. Additional chips plug into the
// same write/advance/pop interface without changing CPU/APU timing.
class ExpansionAudioRenderer {
  static CPU_HZ = 1789772.7272727273;

  constructor(chip, sampleRate=48000) {
    this.sampleRate=sampleRate;
    this.setChip(chip);
    this.reset(0);
  }

  setChip(chip) {
    this.chip=chip||null;
    this.reset(0);
  }

  reset(cycle=0) {
    this.cycle=cycle;
    this.sampleClock=0;
    this.queue=[];
    this.vrc6={
      freqControl:0,
      pulse:[
        {control:0,period:0,enabled:false,phase:0},
        {control:0,period:0,enabled:false,phase:0}
      ],
      saw:{rate:0,period:0,enabled:false,phase:0}
    };
  }

  write(address,value) {
    value&=0xff;
    if(this.chip==='Konami VRC6') this.writeVRC6(address&0xffff,value);
  }

  writeVRC6(address,value) {
    const v=this.vrc6;
    if(address===0x9003){v.freqControl=value&7;return;}
    let p=null,reg=-1;
    if(address>=0x9000&&address<=0x9002){p=v.pulse[0];reg=address-0x9000;}
    else if(address>=0xa000&&address<=0xa002){p=v.pulse[1];reg=address-0xa000;}
    if(p){
      if(reg===0)p.control=value;
      else if(reg===1)p.period=(p.period&0xf00)|value;
      else {
        p.period=(p.period&0x0ff)|((value&0x0f)<<8);
        const was=p.enabled;
        p.enabled=!!(value&0x80);
        if(was&&!p.enabled)p.phase=0;
      }
      return;
    }
    const s=v.saw;
    if(address===0xb000)s.rate=value&0x3f;
    else if(address===0xb001)s.period=(s.period&0xf00)|value;
    else if(address===0xb002){
      s.period=(s.period&0x0ff)|((value&0x0f)<<8);
      const was=s.enabled;
      s.enabled=!!(value&0x80);
      if(was&&!s.enabled)s.phase=0;
    }
  }

  vrc6Shift() {
    const f=this.vrc6.freqControl;
    if(f&1)return null; // oscillator halt
    if(f&4)return 8;
    if(f&2)return 4;
    return 0;
  }

  advanceOscillators(cycles) {
    if(this.chip!=='Konami VRC6')return;
    const shift=this.vrc6Shift();
    if(shift===null)return;
    for(const p of this.vrc6.pulse){
      if(!p.enabled)continue;
      const period=(p.period>>shift)+1;
      p.phase=(p.phase+cycles/period)%16;
    }
    const s=this.vrc6.saw;
    if(s.enabled){
      const period=(s.period>>shift)+1;
      s.phase=(s.phase+cycles/period)%14;
    }
  }

  sampleVRC6() {
    const v=this.vrc6;
    const shift=this.vrc6Shift();
    let sum=0;
    for(const p of v.pulse){
      if(!p.enabled)continue;
      const volume=p.control&0x0f;
      if(p.control&0x80)sum+=volume;
      else {
        const duty=(p.control>>4)&7;
        const step=(15-Math.floor(p.phase))&15;
        if(step<=duty)sum+=volume;
      }
    }
    const s=v.saw;
    if(s.enabled){
      const step=Math.floor(s.phase)%14;
      const adds=Math.floor(step/2);
      const accumulator=(adds*s.rate)&0xff;
      sum+=(accumulator>>3)&0x1f;
    }
    // VRC6 is a linear 6-bit DAC. Keep cartridge audio below full-scale and
    // let the base APU retain headroom in the final mix.
    return (sum/61)*0.34;
  }

  sample() {
    if(this.chip==='Konami VRC6')return this.sampleVRC6();
    return 0;
  }

  advance(cycles) {
    cycles=Math.max(0,cycles|0);
    let remaining=cycles;
    const hz=ExpansionAudioRenderer.CPU_HZ;
    while(remaining>0){
      const toSample=(hz-this.sampleClock)/this.sampleRate;
      const step=Math.min(remaining,toSample);
      this.advanceOscillators(step);
      this.sampleClock+=step*this.sampleRate;
      remaining-=step;
      if(this.sampleClock+1e-9>=hz){
        this.sampleClock-=hz;
        this.queue.push(this.sample());
      }
    }
    this.cycle+=cycles;
  }

  available(){return this.queue.length;}
  pop(){return this.queue.length?this.queue.shift():0;}
}

globalThis.ExpansionAudioRenderer=ExpansionAudioRenderer;
