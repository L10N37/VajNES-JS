// Konami VRC6 mapper (iNES 24/26).
// Mapper 26 swaps CPU A0/A1 for register decode.
let vrc6Prg16=0,vrc6Prg8=0,vrc6Chr=new Uint8Array(8),vrc6B003=0;
let vrc6IrqLatch=0,vrc6IrqCounter=0,vrc6IrqPrescaler=341;
let vrc6IrqEnabled=false,vrc6IrqEnableAfterAck=false,vrc6IrqCycleMode=false;

function vrc6CanonicalAddress(addr){
  addr&=0xf003;
  if(mapperNumber===26){
    const low=addr&3;
    addr=(addr&~3)|((low&1)<<1)|((low&2)>>1);
  }
  return addr;
}

function vrc6Init(){
  vrc6Prg16=vrc6Prg8=0;vrc6Chr.fill(0);vrc6B003=0;
  vrc6IrqLatch=vrc6IrqCounter=0;vrc6IrqPrescaler=341;
  vrc6IrqEnabled=vrc6IrqEnableAfterAck=vrc6IrqCycleMode=false;
  irqAssert.vrc=false;
}

function vrc6PrgRamEnabled(){return !!(vrc6B003&0x80);}

function vrc6CpuRead(addr){
  addr&=0xffff;
  if(addr>=0x6000&&addr<0x8000)
    return vrc6PrgRamEnabled()?prgRam[addr-0x6000]&0xff:openBus.CPU&0xff;
  if(addr<0x8000)return openBus.CPU&0xff;
  if(addr<0xc000)return mapperReadBank(prgRom,0x4000,vrc6Prg16,addr&0x3fff);
  if(addr<0xe000)return mapperReadBank(prgRom,0x2000,vrc6Prg8,addr&0x1fff);
  return mapperReadBank(prgRom,0x2000,mapperBankCount(prgRom,0x2000)-1,addr&0x1fff);
}

function vrc6SetMirroring(value){
  if(!(value&0x20))return; // unused by all original commercial VRC6 games
  switch(value&0x0c){
    case 0x00:MIRRORING='vertical';break;
    case 0x04:MIRRORING='horizontal';break;
    case 0x08:MIRRORING='single0';break;
    case 0x0c:MIRRORING='single1';break;
  }
}

function vrc6CpuWrite(addr,value){
  addr&=0xffff;value&=0xff;
  if(addr>=0x6000&&addr<0x8000){
    if(vrc6PrgRamEnabled())prgRam[addr-0x6000]=value;
    return;
  }
  if(addr<0x8000)return;
  const reg=vrc6CanonicalAddress(addr);

  const isAudioReg =
    (reg>=0x9000&&reg<=0x9003) ||
    (reg>=0xa000&&reg<=0xa002) ||
    (reg>=0xb000&&reg<=0xb002);
  if(isAudioReg && typeof NESAudio!=='undefined' && NESAudio.expansionWrite)
    NESAudio.expansionWrite(cpuCycles,reg,value);

  if((reg&0xf000)===0x8000){vrc6Prg16=value&0x0f;return;}
  if((reg&0xf003)===0xb003){vrc6B003=value;vrc6SetMirroring(value);return;}
  if((reg&0xf000)===0xc000){vrc6Prg8=value&0x1f;return;}
  if((reg&0xf000)===0xd000){vrc6Chr[reg&3]=value;return;}
  if((reg&0xf000)===0xe000){vrc6Chr[4+(reg&3)]=value;return;}
  if((reg&0xf003)===0xf000){vrc6IrqLatch=value;return;}
  if((reg&0xf003)===0xf001){
    vrc6IrqEnableAfterAck=!!(value&1);
    vrc6IrqEnabled=!!(value&2);
    vrc6IrqCycleMode=!!(value&4);
    irqAssert.vrc=false;
    if(vrc6IrqEnabled){vrc6IrqCounter=vrc6IrqLatch;vrc6IrqPrescaler=341;}
    return;
  }
  if((reg&0xf003)===0xf002){
    irqAssert.vrc=false;
    vrc6IrqEnabled=vrc6IrqEnableAfterAck;
  }
}

function vrc6ChrRead(addr){
  addr&=0x1fff;
  const slot=addr>>>10;
  return mapperReadBank(CHR_ROM,0x400,vrc6Chr[slot],addr&0x3ff);
}

function vrc6IrqCounterClock(){
  if(vrc6IrqCounter===0xff){
    vrc6IrqCounter=vrc6IrqLatch;
    irqAssert.vrc=true;
  }else vrc6IrqCounter=(vrc6IrqCounter+1)&0xff;
}

function vrc6ClockCpu(){
  if(!vrc6IrqEnabled)return;
  if(vrc6IrqCycleMode){vrc6IrqCounterClock();return;}
  vrc6IrqPrescaler-=3;
  if(vrc6IrqPrescaler<=0){vrc6IrqPrescaler+=341;vrc6IrqCounterClock();}
}
