// Cycle-timestamped expansion-audio renderer mixed with the existing APU PCM.
// The first supported chip is Konami VRC6. Additional chips plug into the
// same write/advance/pop interface without changing CPU/APU timing.
class ExpansionAudioRenderer {
  static CPU_HZ = 1789772.7272727273;
  static MMC5_LENGTH = [10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,
                        12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30];

  // VRC7's fixed instrument ROM. Instrument 0 is the writable custom patch.
  static VRC7_PATCHES = [
    [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00],
    [0x03,0x21,0x05,0x06,0xe8,0x81,0x42,0x27],
    [0x13,0x41,0x14,0x0d,0xd8,0xf6,0x23,0x12],
    [0x11,0x11,0x08,0x08,0xfa,0xb2,0x20,0x12],
    [0x31,0x61,0x0c,0x07,0xa8,0x64,0x61,0x27],
    [0x32,0x21,0x1e,0x06,0xe1,0x76,0x01,0x28],
    [0x02,0x01,0x06,0x00,0xa3,0xe2,0xf4,0xf4],
    [0x21,0x61,0x1d,0x07,0x82,0x81,0x11,0x07],
    [0x23,0x21,0x22,0x17,0xa2,0x72,0x01,0x17],
    [0x35,0x11,0x25,0x00,0x40,0x73,0x72,0x01],
    [0xb5,0x01,0x0f,0x0f,0xa8,0xa5,0x51,0x02],
    [0x17,0xc1,0x24,0x07,0xf8,0xf8,0x22,0x12],
    [0x71,0x23,0x11,0x06,0x65,0x74,0x18,0x16],
    [0x01,0x02,0xd3,0x05,0xc9,0x95,0x03,0x02],
    [0x61,0x63,0x0c,0x00,0x94,0xc0,0x33,0xf6],
    [0x21,0x72,0x0d,0x00,0xc1,0xd5,0x56,0x06]
  ];
  static VRC7_MUL = [0.5,1,2,3,4,5,6,7,8,9,10,10,12,12,15,15];
  static VRC7_CLOCK = 3579545;

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
    this.mmc5={
      pulse:[
        {control:0,period:0,enabled:false,phase:0,length:0,envelope:0,envelopeDivider:0,envelopeStart:false},
        {control:0,period:0,enabled:false,phase:0,length:0,envelope:0,envelopeDivider:0,envelopeStart:false}
      ],
      pcmControl:0,
      pcm:0x80,
      pcmIrqTrip:false,
      frameClock:0
    };
    this.sunsoft5b={
      selected:0,
      writeEnabled:true,
      regs:new Array(16).fill(0),
      tonePhase:[0,0,0],
      noiseClock:0,
      noiseLfsr:0x1ffff,
      noiseOut:1,
      envelopeClock:0,
      envelopeLevel:0,
      envelopeDirection:-1,
      envelopeHolding:false
    };
    this.vrc7=this.makeVRC7State();
  }

  write(address,value) {
    value&=0xff;
    if(this.chip==='Konami VRC6') this.writeVRC6(address&0xffff,value);
    else if(this.chip==='Konami VRC7') this.writeVRC7(address&0xffff,value);
    else if(this.chip==='MMC5') this.writeMMC5(address&0xffff,value);
    else if(this.chip==='Sunsoft 5B') this.writeSunsoft5B(address&0xffff,value);
  }

  makeVRC7State() {
    const channel=()=>({
      fnum:0,block:0,key:false,sustain:false,instrument:0,volume:15,
      modPhase:0,carPhase:0,modEnv:0,carEnv:0,
      modStage:'off',carStage:'off',feedback:0,lastMod:0
    });
    return {
      selected:0,
      reset:false,
      custom:new Array(8).fill(0),
      regs:new Array(0x40).fill(0),
      channels:Array.from({length:6},channel),
      pmPhase:0,
      amPhase:0
    };
  }

  resetVRC7Sound() {
    const selected=this.vrc7?.selected||0;
    const reset=this.vrc7?.reset||false;
    this.vrc7=this.makeVRC7State();
    this.vrc7.selected=selected;
    this.vrc7.reset=reset;
  }

  writeVRC7(address,value) {
    const v=this.vrc7;
    if(address===0xe000){
      const nextReset=!!(value&0x40);
      if(nextReset && !v.reset){
        v.reset=true;
        this.resetVRC7Sound();
        this.vrc7.reset=true;
      } else {
        v.reset=nextReset;
      }
      return;
    }
    if(address===0x9010){
      if(!v.reset)v.selected=value&0xff;
      return;
    }
    if(address!==0x9030 || v.reset)return;

    const reg=v.selected&0x3f;
    v.regs[reg]=value&0xff;
    if(reg<=0x07){
      v.custom[reg]=value&0xff;
      return;
    }
    if(reg>=0x10&&reg<=0x15){
      const ch=v.channels[reg-0x10];
      ch.fnum=(ch.fnum&0x100)|value;
      return;
    }
    if(reg>=0x20&&reg<=0x25){
      const ch=v.channels[reg-0x20];
      const wasKey=ch.key;
      ch.fnum=(ch.fnum&0xff)|((value&1)<<8);
      ch.block=(value>>>1)&7;
      ch.key=!!(value&0x10);
      ch.sustain=!!(value&0x20);
      if(ch.key&&!wasKey)this.vrc7KeyOn(ch);
      else if(!ch.key&&wasKey)this.vrc7KeyOff(ch);
      return;
    }
    if(reg>=0x30&&reg<=0x35){
      const ch=v.channels[reg-0x30];
      ch.instrument=(value>>>4)&0x0f;
      ch.volume=value&0x0f;
    }
  }

  vrc7KeyOn(ch) {
    ch.modPhase=0;
    ch.carPhase=0;
    ch.modEnv=0;
    ch.carEnv=0;
    ch.modStage='attack';
    ch.carStage='attack';
    ch.feedback=0;
    ch.lastMod=0;
  }

  vrc7KeyOff(ch) {
    if(ch.modStage!=='off')ch.modStage='release';
    if(ch.carStage!=='off')ch.carStage='release';
  }

  vrc7PatchBytes(ch) {
    return ch.instrument===0 ? this.vrc7.custom : ExpansionAudioRenderer.VRC7_PATCHES[ch.instrument];
  }

  vrc7PatchOperator(ch,carrier) {
    const p=this.vrc7PatchBytes(ch);
    const b=carrier?p[1]:p[0];
    const egByte=carrier?p[5]:p[4];
    const srByte=carrier?p[7]:p[6];
    return {
      am:!!(b&0x80),pm:!!(b&0x40),eg:!!(b&0x20),kr:!!(b&0x10),ml:b&0x0f,
      kl:carrier?((p[3]>>>6)&3):((p[2]>>>6)&3),
      tl:carrier?0:(p[2]&0x3f),
      wf:carrier?((p[3]>>>4)&1):((p[3]>>>3)&1),
      fb:carrier?0:(p[3]&7),
      ar:(egByte>>>4)&0x0f,dr:egByte&0x0f,sl:(srByte>>>4)&0x0f,rr:srByte&0x0f
    };
  }

  vrc7RateTime(rate,kind) {
    rate&=15;
    if(rate===0)return Infinity;
    if(kind==='attack'&&rate===15)return 0.0015;
    const base=kind==='attack'?0.0025:0.018;
    return base*Math.pow(2,(15-rate)/1.55);
  }

  vrc7AdvanceEnvelope(ch,op,which,dt) {
    const stageKey=which+'Stage',envKey=which+'Env';
    let stage=ch[stageKey],env=ch[envKey];
    if(stage==='off'){ch[envKey]=0;return;}
    if(stage==='attack'){
      const t=this.vrc7RateTime(op.ar,'attack');
      if(!Number.isFinite(t))return;
      env+=dt/t;
      if(env>=1){env=1;stage='decay';}
    } else if(stage==='decay'){
      const target=Math.pow(10,-(op.sl===15?48:op.sl*3)/20);
      const t=this.vrc7RateTime(op.dr,'decay');
      if(Number.isFinite(t)){
        env-=dt*(1-target)/t;
        if(env<=target){
          env=target;
          stage=op.eg?'sustain':'sustainDecay';
        }
      }
    } else if(stage==='sustainDecay'){
      const t=this.vrc7RateTime(op.rr,'decay');
      if(Number.isFinite(t))env-=dt/t;
      if(env<=0){env=0;stage='off';}
    } else if(stage==='release'){
      const rr=ch.sustain?5:(op.eg?op.rr:7);
      const t=this.vrc7RateTime(rr,'decay');
      if(Number.isFinite(t))env-=dt/Math.max(t,0.001);
      if(env<=0){env=0;stage='off';}
    }
    ch[stageKey]=stage;
    ch[envKey]=Math.max(0,Math.min(1,env));
  }

  vrc7OperatorWave(phase,wf) {
    const x=Math.sin(phase);
    return wf ? Math.max(0,x) : x;
  }

  vrc7BaseFrequency(ch) {
    return ExpansionAudioRenderer.VRC7_CLOCK*ch.fnum*Math.pow(2,ch.block)/(72*524288);
  }

  advanceVRC7(cycles) {
    const v=this.vrc7;
    if(v.reset)return;
    const dt=cycles/ExpansionAudioRenderer.CPU_HZ;
    v.pmPhase=(v.pmPhase+2*Math.PI*6.4*dt)%(2*Math.PI);
    v.amPhase=(v.amPhase+2*Math.PI*3.7*dt)%(2*Math.PI);

    for(const ch of v.channels){
      if(ch.modStage==='off'&&ch.carStage==='off')continue;
      const mod=this.vrc7PatchOperator(ch,false);
      const car=this.vrc7PatchOperator(ch,true);
      this.vrc7AdvanceEnvelope(ch,mod,'mod',dt);
      this.vrc7AdvanceEnvelope(ch,car,'car',dt);

      const base=this.vrc7BaseFrequency(ch);
      const pm=Math.pow(2,(13.75*Math.sin(v.pmPhase))/1200);
      const mf=base*ExpansionAudioRenderer.VRC7_MUL[mod.ml]*(mod.pm?pm:1);
      const cf=base*ExpansionAudioRenderer.VRC7_MUL[car.ml]*(car.pm?pm:1);
      ch.modPhase=(ch.modPhase+2*Math.PI*mf*dt)%(2*Math.PI);
      ch.carPhase=(ch.carPhase+2*Math.PI*cf*dt)%(2*Math.PI);
    }
  }

  sampleVRC7() {
    const v=this.vrc7;
    if(v.reset)return 0;
    let sum=0;
    for(const ch of v.channels){
      if(ch.carStage==='off')continue;
      const mod=this.vrc7PatchOperator(ch,false);
      const car=this.vrc7PatchOperator(ch,true);
      const amDb=2.4*(1+Math.sin(v.amPhase));
      const modAmp=ch.modEnv*Math.pow(10,-(mod.tl*0.75+(mod.am?amDb:0))/20);
      const carAmp=ch.carEnv*Math.pow(10,-(ch.volume*3+(car.am?amDb:0))/20);

      const fbScale=mod.fb?Math.pow(2,mod.fb-4)*0.25:0;
      const modWave=this.vrc7OperatorWave(ch.modPhase+ch.feedback*fbScale,mod.wf);
      const modSignal=modWave*modAmp;
      ch.feedback=(ch.feedback+ch.lastMod)*0.5;
      ch.lastMod=modSignal;

      // VRC7 is phase modulation: the modulator bends the carrier phase.
      const modulationIndex=5.5;
      const carWave=this.vrc7OperatorWave(ch.carPhase+modSignal*modulationIndex,car.wf);
      sum+=carWave*carAmp;
    }
    return (sum/6)*0.55;
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

  writeMMC5(address,value) {
    const m=this.mmc5;
    if(address===0x5010){m.pcmControl=value&0x81;return;}
    if(address===0x5011){
      if(!(m.pcmControl&1) && value!==0)m.pcm=value;
      if(!(m.pcmControl&1) && value===0)m.pcmIrqTrip=true;
      return;
    }
    if(address===0x5015){
      for(let i=0;i<2;i++){
        const enabled=!!(value&(1<<i));
        m.pulse[i].enabled=enabled;
        if(!enabled)m.pulse[i].length=0;
      }
      return;
    }
    let p=null,reg=-1;
    if(address>=0x5000&&address<=0x5003){p=m.pulse[0];reg=address-0x5000;}
    else if(address>=0x5004&&address<=0x5007){p=m.pulse[1];reg=address-0x5004;}
    if(!p)return;
    if(reg===0)p.control=value;
    else if(reg===2)p.period=(p.period&0x700)|value;
    else if(reg===3){
      p.period=(p.period&0xff)|((value&7)<<8);
      p.phase=0;
      p.envelopeStart=true;
      if(p.enabled)p.length=ExpansionAudioRenderer.MMC5_LENGTH[(value>>>3)&31];
    }
  }

  writeSunsoft5B(address,value) {
    const a=this.sunsoft5b;
    if(address>=0xc000 && address<0xe000){
      a.selected=value&0x0f;
      a.writeEnabled=(value&0xf0)===0;
      return;
    }
    if(address<0xe000 || !a.writeEnabled)return;
    const reg=a.selected&0x0f;
    a.regs[reg]=value&0xff;
    if(reg===13)this.resetSunsoftEnvelope(value);
  }

  resetSunsoftEnvelope(shape) {
    const a=this.sunsoft5b;
    const attack=!!(shape&0x04);
    a.envelopeLevel=attack?0:31;
    a.envelopeDirection=attack?1:-1;
    a.envelopeClock=0;
    a.envelopeHolding=false;
  }

  sunsoftTonePeriod(channel) {
    const r=this.sunsoft5b.regs;
    const p=((r[channel*2+1]&0x0f)<<8)|r[channel*2];
    return p||1;
  }

  sunsoftNoisePeriod() {
    return (this.sunsoft5b.regs[6]&0x1f)||1;
  }

  sunsoftEnvelopePeriod() {
    const r=this.sunsoft5b.regs;
    return ((r[12]<<8)|r[11])||1;
  }

  clockSunsoftEnvelopeStep() {
    const a=this.sunsoft5b;
    if(a.envelopeHolding)return;
    let next=a.envelopeLevel+a.envelopeDirection;
    if(next>=0 && next<=31){a.envelopeLevel=next;return;}

    const shape=a.regs[13]&0x0f;
    const cont=!!(shape&0x08);
    const alternate=!!(shape&0x02);
    const hold=!!(shape&0x01);
    if(!cont){
      a.envelopeLevel=0;
      a.envelopeHolding=true;
      return;
    }
    if(alternate)a.envelopeDirection=-a.envelopeDirection;
    if(hold){
      a.envelopeLevel=a.envelopeDirection>0?31:0;
      a.envelopeHolding=true;
      return;
    }
    a.envelopeLevel=a.envelopeDirection>0?0:31;
  }

  advanceSunsoft5B(cycles) {
    const a=this.sunsoft5b;
    for(let ch=0;ch<3;ch++){
      const halfPeriod=16*this.sunsoftTonePeriod(ch);
      a.tonePhase[ch]=(a.tonePhase[ch]+cycles/halfPeriod)%2;
    }

    const noiseStep=32*this.sunsoftNoisePeriod();
    a.noiseClock+=cycles;
    while(a.noiseClock>=noiseStep){
      a.noiseClock-=noiseStep;
      const feedback=((a.noiseLfsr>>16)^(a.noiseLfsr>>13))&1;
      a.noiseLfsr=((a.noiseLfsr<<1)&0x1ffff)|feedback;
      a.noiseOut=a.noiseLfsr&1;
    }

    const envStep=16*this.sunsoftEnvelopePeriod();
    a.envelopeClock+=cycles;
    while(a.envelopeClock>=envStep){
      a.envelopeClock-=envStep;
      this.clockSunsoftEnvelopeStep();
    }
  }

  sunsoftLevelToLinear(level) {
    level=Math.max(0,Math.min(31,level|0));
    if(level<=1)return 0;
    // YM2149's DAC is approximately 1.5 dB per 5-bit step.
    return Math.pow(10,(level-31)*1.5/20);
  }

  sampleSunsoft5B() {
    const a=this.sunsoft5b,r=a.regs,mixer=r[7];
    let sum=0;
    for(let ch=0;ch<3;ch++){
      const toneDisabled=!!(mixer&(1<<ch));
      const noiseDisabled=!!(mixer&(1<<(ch+3)));
      const toneHigh=a.tonePhase[ch]<1;
      const gate=(toneDisabled||toneHigh) && (noiseDisabled||!!a.noiseOut);
      if(!gate)continue;
      const v=r[8+ch];
      const level=(v&0x10)?a.envelopeLevel:((v&0x0f)<<1)|((v&0x0f)?1:0);
      sum+=this.sunsoftLevelToLinear(level);
    }
    // 5B is mixed loudly on original hardware, but retain headroom with 2A03.
    return (sum/3)*0.42;
  }

  read(address) {
    if(this.chip!=='MMC5')return 0;
    const m=this.mmc5;
    if(address===0x5010){
      const out=((m.pcmIrqTrip&&(m.pcmControl&0x80))?0x80:0)|1;
      m.pcmIrqTrip=false;
      return out;
    }
    if(address===0x5015)
      return (m.pulse[0].length?1:0)|(m.pulse[1].length?2:0);
    return 0;
  }

  observeRead(address,value) {
    if(this.chip!=='MMC5')return;
    const m=this.mmc5;
    if((m.pcmControl&1) && address>=0x8000 && address<=0xbfff) {
      if(value===0)m.pcmIrqTrip=true;
      else {m.pcmIrqTrip=false;m.pcm=value&0xff;}
    }
  }

  clockMMC5Frame() {
    const m=this.mmc5;
    for(const p of m.pulse){
      if(p.envelopeStart){
        p.envelopeStart=false;p.envelope=15;p.envelopeDivider=p.control&15;
      } else if(p.envelopeDivider>0)p.envelopeDivider--;
      else {
        p.envelopeDivider=p.control&15;
        if(p.envelope>0)p.envelope--;
        else if(p.control&0x20)p.envelope=15;
      }
      if(p.length && !(p.control&0x20))p.length--;
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
    if(this.chip==='Konami VRC7'){
      this.advanceVRC7(cycles);
      return;
    }
    if(this.chip==='Sunsoft 5B'){
      this.advanceSunsoft5B(cycles);
      return;
    }
    if(this.chip==='MMC5'){
      const m=this.mmc5;
      m.frameClock+=cycles;
      while(m.frameClock>=7424){m.frameClock-=7424;this.clockMMC5Frame();}
      for(const p of m.pulse){
        if(!p.enabled || !p.length)continue;
        const period=2*(p.period+1);
        p.phase=(p.phase+cycles/period)%8;
      }
      return;
    }
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

  sampleMMC5() {
    const dutyPatterns=[0x02,0x06,0x1e,0xf9];
    let pulseSum=0;
    for(const p of this.mmc5.pulse){
      if(!p.enabled || !p.length)continue;
      const duty=(p.control>>>6)&3;
      const step=Math.floor(p.phase)&7;
      if((dutyPatterns[duty]>>step)&1)
        pulseSum+=(p.control&0x10)?(p.control&15):p.envelope;
    }
    const pulse=(pulseSum/30)*0.22;
    const pcm=((this.mmc5.pcm-128)/128)*0.18;
    return pulse+pcm;
  }

  sample() {
    if(this.chip==='Konami VRC6')return this.sampleVRC6();
    if(this.chip==='Konami VRC7')return this.sampleVRC7();
    if(this.chip==='MMC5')return this.sampleMMC5();
    if(this.chip==='Sunsoft 5B')return this.sampleSunsoft5B();
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

  saveState(){
    return {
      chip:this.chip,cycle:this.cycle,sampleClock:this.sampleClock,
      vrc6:JSON.parse(JSON.stringify(this.vrc6)),
      vrc7:JSON.parse(JSON.stringify(this.vrc7)),
      mmc5:JSON.parse(JSON.stringify(this.mmc5)),
      sunsoft5b:JSON.parse(JSON.stringify(this.sunsoft5b))
    };
  }
  loadState(state){
    if(!state||state.chip!==this.chip)return false;
    this.cycle=Number(state.cycle)||0;
    this.sampleClock=Number(state.sampleClock)||0;
    this.queue.length=0;
    if(state.vrc6)this.vrc6=JSON.parse(JSON.stringify(state.vrc6));
    if(state.vrc7)this.vrc7=JSON.parse(JSON.stringify(state.vrc7));
    if(state.mmc5)this.mmc5=JSON.parse(JSON.stringify(state.mmc5));
    if(state.sunsoft5b)this.sunsoft5b=JSON.parse(JSON.stringify(state.sunsoft5b));
    return true;
  }
  available(){return this.queue.length;}
  pop(){return this.queue.length?this.queue.shift():0;}
}

globalThis.ExpansionAudioRenderer=ExpansionAudioRenderer;
