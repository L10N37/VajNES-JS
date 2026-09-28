// Cycle-driven NTSC waveform renderer. CPU-visible length counters, frame
// sequencer, DMA and IRQ arbitration remain in the JS core (one clock authority).
// No runtime imports: build as freestanding wasm32 or native for trace tests.
using u32 = unsigned int;
static constexpr double CPU_HZ = 1789772.7272727273;
static constexpr double PI = 3.14159265358979323846;
static double sine(double x) {
  while(x>PI)x-=2*PI; while(x<-PI)x+=2*PI;
  double term=x,sum=x;
  for(int i=1;i<12;i++){term *= -x*x/((2*i)*(2*i+1));sum+=term;}
  return sum;
}
struct Envelope {
  int divider=0,decay=0; bool start=false;
  void clock(int reg) {
    if(start){start=false;decay=15;divider=reg&15;}
    else if(divider) --divider;
    else {divider=reg&15;if(decay)--decay;else if(reg&32)decay=15;}
  }
  int level(int reg) const {return reg&16?reg&15:decay;}
};
struct Pulse {
  int control=0,sweep=0,period=0,timer=0,sequence=0,sweepDivider=0;
  bool sweepReload=false; Envelope envelope;
  int target(int channel) const {
    int change=period>>(sweep&7);
    return sweep&8?period-change-(channel==0):period+change;
  }
  void half(int channel) {
    int next=target(channel);
    if(sweepDivider==0 && (sweep&128) && (sweep&7) && period>=8 && next<=0x7ff && next>=0)period=next;
    if(sweepDivider==0 || sweepReload){sweepDivider=(sweep>>4)&7;sweepReload=false;}
    else --sweepDivider;
  }
  int output(int channel,int mask) const {
    static const int duties[4]={0x02,0x06,0x1e,0xf9};
    if(!(mask&(1<<channel)) || period<8 || target(channel)>0x7ff)return 0;
    return (duties[control>>6]>>sequence)&1?envelope.level(control):0;
  }
};
static Pulse pulse[2];
static int triangleControl,trianglePeriod,triangleTimer,triangleSequence,linearCounter;
static bool linearReload;
static int noiseControl,noisePeriodIndex,noiseTimer,noiseShift,noiseMode;
static Envelope noiseEnvelope;
static int lengthMask,dmcLevel,parity;
static int rate=48000;
static double phase,previousMix,integrated;
static constexpr int TAPS=32, PHASES=256, QUEUE=16384;
static double kernel[PHASES][TAPS],impulses[64];
static int impulseHead;
static float output[QUEUE];
static u32 writeIndex,readIndex,overruns;
static double hp90,hp440,lp14,prev90,prev440,prevLP,a90,a440,a14,b90,b440,b14;
static double mix() {
  int p=pulse[0].output(0,lengthMask)+pulse[1].output(1,lengthMask);
  int tri=triangleSequence<16?15-triangleSequence:triangleSequence-16;
  int noise=(lengthMask&8) && !(noiseShift&1)?noiseEnvelope.level(noiseControl):0;
  double tnd=tri/8227.0+noise/12241.0+dmcLevel/22638.0;
  return (p?95.88/(8128.0/p+100):0)+(tnd?159.79/(1/tnd+100):0);
}
static void transition() {
  double now=mix(),delta=now-previousMix;
  if(delta==0)return;
  previousMix=now;
  int frac=int(phase/CPU_HZ*PHASES); if(frac>=PHASES)frac=PHASES-1;
  for(int j=0;j<TAPS;j++)impulses[(impulseHead+j)&63]+=delta*kernel[frac][j];
}
extern "C" {
void audio_reset(int sampleRate) {
  rate=sampleRate>=8000 && sampleRate<=192000?sampleRate:48000;
  pulse[0]=Pulse{};pulse[1]=Pulse{};noiseEnvelope=Envelope{};
  triangleControl=trianglePeriod=triangleTimer=triangleSequence=linearCounter=0;
  linearReload=false;noiseControl=noisePeriodIndex=noiseTimer=noiseMode=0;noiseShift=1;
  lengthMask=dmcLevel=parity=0;phase=previousMix=integrated=0;
  impulseHead=0;writeIndex=readIndex=overruns=0;
  hp90=hp440=lp14=prev90=prev440=prevLP=0;
  // Bilinear first-order analogue filter approximations, with prewarped corners.
  double k90=sine(PI*90/rate)/sine(PI*90/rate+PI/2);
  double k440=sine(PI*440/rate)/sine(PI*440/rate+PI/2);
  double cutoff=rate*0.45<14000?rate*0.45:14000;
  double k14=sine(PI*cutoff/rate)/sine(PI*cutoff/rate+PI/2);
  a90=1/(1+k90);b90=(1-k90)/(1+k90);
  a440=1/(1+k440);b440=(1-k440)/(1+k440);
  a14=k14/(1+k14);b14=(1-k14)/(1+k14);
  for(int i=0;i<64;i++)impulses[i]=0;
  for(int p=0;p<PHASES;p++) {
    double sum=0;
    for(int j=0;j<TAPS;j++) {
      double x=j-15.0-double(p)/PHASES;
      double window=0.42-0.5*sine(2*PI*j/(TAPS-1)+PI/2)+0.08*sine(4*PI*j/(TAPS-1)+PI/2);
      double v=(x==0?0.90:sine(PI*0.90*x)/(PI*x))*window;
      kernel[p][j]=v;sum+=v;
    }
    for(int j=0;j<TAPS;j++)kernel[p][j]/=sum;
  }
}
void audio_lengths(int mask){lengthMask=mask&15;transition();}
void audio_dmc(int level){dmcLevel=level&127;transition();}
void audio_quarter() {
  pulse[0].envelope.clock(pulse[0].control);pulse[1].envelope.clock(pulse[1].control);
  noiseEnvelope.clock(noiseControl);
  if(linearReload)linearCounter=triangleControl&127;else if(linearCounter)--linearCounter;
  if(!(triangleControl&128))linearReload=false;
  transition();
}
void audio_half(){pulse[0].half(0);pulse[1].half(1);transition();}
void audio_write(int address,int value) {
  value&=255;
  if(address>=0x4000 && address<=0x4007) {
    Pulse &p=pulse[(address>>2)&1];
    switch(address&3) {
      case 0:p.control=value;break;
      case 1:p.sweep=value;p.sweepReload=true;break;
      case 2:p.period=(p.period&0x700)|value;break;
      case 3:p.period=(p.period&255)|((value&7)<<8);p.sequence=0;p.envelope.start=true;break;
    }
  } else switch(address) {
    case 0x4008:triangleControl=value;break;
    case 0x400a:trianglePeriod=(trianglePeriod&0x700)|value;break;
    case 0x400b:trianglePeriod=(trianglePeriod&255)|((value&7)<<8);linearReload=true;break;
    case 0x400c:noiseControl=value;break;
    case 0x400e:noisePeriodIndex=value&15;noiseMode=value>>7;break;
    case 0x400f:noiseEnvelope.start=true;break;
    case 0x4011:dmcLevel=value&127;break;
  }
  transition();
}
void audio_advance(int cycles) {
  static const int noisePeriods[16]={4,8,16,32,64,96,128,160,202,254,380,508,762,1016,2034,4068};
  for(int c=0;c<cycles;c++) {
    parity^=1;
    if(!parity)for(int i=0;i<2;i++) {
      Pulse &p=pulse[i];if(p.timer==0){p.timer=p.period;p.sequence=(p.sequence+1)&7;}else --p.timer;
    }
    if(triangleTimer==0){triangleTimer=trianglePeriod;if((lengthMask&4) && linearCounter)triangleSequence=(triangleSequence+1)&31;}else --triangleTimer;
    if(noiseTimer==0){noiseTimer=noisePeriods[noisePeriodIndex]-1;int bit=(noiseShift^(noiseShift>>(noiseMode?6:1)))&1;noiseShift=(noiseShift>>1)|(bit<<14);}else --noiseTimer;
    transition();phase+=rate;
    if(phase>=CPU_HZ) {
      phase-=CPU_HZ;integrated+=impulses[impulseHead];impulses[impulseHead]=0;impulseHead=(impulseHead+1)&63;
      hp90=b90*hp90+a90*(integrated-prev90);prev90=integrated;
      hp440=b440*hp440+a440*(hp90-prev440);prev440=hp90;
      lp14=b14*lp14+a14*(hp440+prevLP);prevLP=hp440;
      if(writeIndex-readIndex>=QUEUE){readIndex++;overruns++;}
      output[writeIndex++&(QUEUE-1)]=float(lp14);
    }
  }
}
int audio_available(){return int(writeIndex-readIndex);}
float audio_pop(){return readIndex==writeIndex?0:output[readIndex++&(QUEUE-1)];}
int audio_overruns(){return int(overruns);}
int audio_debug(int item){switch(item){case 0:return pulse[0].period;case 1:return pulse[1].period;case 2:return linearCounter;case 3:return noiseShift;case 4:return triangleSequence;case 5:return dmcLevel;case 6:return pulse[0].envelope.decay;default:return 0;}}
}
