const APU_REG_ADDRESSES = {
  0x4000: "SQ1_VOL",
  0x4001: "SQ1_SWEEP",
  0x4002: "SQ1_LO",
  0x4003: "SQ1_HI",
  0x4004: "SQ2_VOL",
  0x4005: "SQ2_SWEEP",
  0x4006: "SQ2_LO",
  0x4007: "SQ2_HI",
  0x4008: "TRI_LINEAR",
  0x400A: "TRI_LO",
  0x400B: "TRI_HI",
  0x400C: "NOISE_VOL",
  0x400E: "NOISE_LO",
  0x400F: "NOISE_HI",
  0x4010: "DMC_FREQ",
  0x4011: "DMC_RAW",
  0x4012: "DMC_START",
  0x4013: "DMC_LEN",
  0x4015: "SND_CHN",    // Write
  0x4017: "FRAME_CNT"   // Write

};

/*
console tested, no test suite 
------------------------------
checkWriteOffset(0x4000, 0x99)
undefined
checkReadOffset(0x4000)
153
*/


let APUregister = {
  SQ1_VOL:   0x00, // $4000
  SQ1_SWEEP: 0x00, // $4001
  SQ1_LO:    0x00, // $4002
  SQ1_HI:    0x00, // $4003
  SQ2_VOL:   0x00, // $4004
  SQ2_SWEEP: 0x00, // $4005
  SQ2_LO:    0x00, // $4006
  SQ2_HI:    0x00, // $4007
  TRI_LINEAR:0x00, // $4008
  TRI_LO:    0x00, // $400A
  TRI_HI:    0x00, // $400B
  NOISE_VOL: 0x00, // $400C
  NOISE_LO:  0x00, // $400E
  NOISE_HI:  0x00, // $400F
  DMC_FREQ:  0x00, // $4010
  DMC_RAW:   0x00, // $4011
  DMC_START: 0x00, // $4012
  DMC_LEN:   0x00, // $4013
  SND_CHN:   0x00, // $4015
  FRAME_CNT: 0x00, // $4017
};
// NTSC frame sequencer. Cycle counts are CPU clocks, independent of PPU frames.
// References: NESdev APU Frame Counter / APU Length Counter.
const APU_LENGTH_TABLE = [10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,
                         12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30];
const apuTiming = {
  cycle: 0, fiveStep: false, inhibitIRQ: false, resetDelay: 0,
  pendingFiveStep: false, enabled: 0, length: [0,0,0,0],
  halt: [false,false,false,false], clearFrameIRQ: 0
};
function apuResetTiming() {
  apuTiming.cycle=0; apuTiming.fiveStep=false; apuTiming.inhibitIRQ=false;
  apuTiming.resetDelay=0; apuTiming.pendingFiveStep=false;
  apuTiming.enabled=0; apuTiming.length.fill(0); apuTiming.halt.fill(false);
  apuTiming.clearFrameIRQ=0;
  irqAssert.frame=false;
}
function apuHalfFrame() {
  for(let i=0;i<4;i++) if(apuTiming.length[i] && !apuTiming.halt[i]) apuTiming.length[i]--;
}
function apuClock() {
  if(apuTiming.clearFrameIRQ && --apuTiming.clearFrameIRQ===0) irqAssert.frame=false;
  if(apuTiming.resetDelay && --apuTiming.resetDelay===0) {
    apuTiming.cycle=0;
    apuTiming.fiveStep=apuTiming.pendingFiveStep;
    if(apuTiming.fiveStep) apuHalfFrame();
    return;
  }
  const c=++apuTiming.cycle;
  if(c===14913 || c===(apuTiming.fiveStep?37281:29829)) apuHalfFrame();
  if(!apuTiming.fiveStep && c>=29828 && c<=29830 && !apuTiming.inhibitIRQ) irqAssert.frame=true;
  if(c===(apuTiming.fiveStep?37282:29830)) apuTiming.cycle=0;
}
function apuTimingWrite(address,value) {
  if(address===0x4017) {
    apuTiming.pendingFiveStep=!!(value&0x80);
    apuTiming.inhibitIRQ=!!(value&0x40);
    if(apuTiming.inhibitIRQ) irqAssert.frame=false;
    // Writes occur before consumeCycle; include the write cycle in this delay.
    apuTiming.resetDelay=(cpuCycles&1)?4:3;
  } else if(address===0x4015) {
    apuTiming.enabled=value&15;
    for(let i=0;i<4;i++) if(!(value&(1<<i))) apuTiming.length[i]=0;
    irqAssert.dmcDma=false;
  } else if(address>=0x4000 && address<=0x400F) {
    const channel=(address-0x4000)>>2;
    if((address&3)===0) apuTiming.halt[channel]=!!(value&(channel===2?0x80:0x20));
    if((address&3)===3 && (apuTiming.enabled&(1<<channel))) apuTiming.length[channel]=APU_LENGTH_TABLE[value>>3];
  }
}
function apuStatusRead() {
  let result=(irqAssert.frame?0x40:0)|(irqAssert.dmcDma?0x80:0)|(DMC.bytesRemaining?0x10:0);
  for(let i=0;i<4;i++) if(apuTiming.length[i]) result|=1<<i;
  // Frame IRQ acknowledgement is synchronized to the next APU get cycle.
  apuTiming.clearFrameIRQ=(cpuCycles&1)?2:1;
  return result;
}
