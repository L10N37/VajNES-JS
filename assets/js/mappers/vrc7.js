// Konami VRC7 (iNES mapper 85).
// Three switchable 8 KiB PRG banks, fixed final 8 KiB, eight 1 KiB CHR
// banks, four mirroring modes, 8 KiB WRAM, cycle/scanline IRQs, and VRC7
// register forwarding for expansion audio.

const vrc7Prg=new Uint8Array(3);
const vrc7Chr=new Uint8Array(8);
let vrc7Mirror=0;
let vrc7AudioIndex=0;
let vrc7IrqLatch=0;
let vrc7IrqCounter=0;
let vrc7IrqPrescaler=0;
let vrc7IrqEnabled=false;
let vrc7IrqEnableAfterAck=false;
let vrc7IrqCycleMode=false;

function vrc7Init(){
  vrc7Prg.fill(0);
  vrc7Chr.fill(0);
  vrc7Mirror=0;
  vrc7AudioIndex=0;
  vrc7IrqLatch=0;
  vrc7IrqCounter=0;
  vrc7IrqPrescaler=0;
  vrc7IrqEnabled=false;
  vrc7IrqEnableAfterAck=false;
  vrc7IrqCycleMode=false;
  irqAssert.vrc=false;
  // Keep the loader-selected CHR type. VRC7 supports either CHR ROM or
  // bank-switched CHR RAM.
  vrc7ApplyMirroring();
}

function vrc7CanonicalAddress(addr){
  addr&=0xffff;
  addr |= (addr&8)<<1;
  return addr;
}

function vrc7ApplyMirroring(){
  switch(vrc7Mirror&3){
    case 0:MIRRORING='vertical';break;
    case 1:MIRRORING='horizontal';break;
    case 2:MIRRORING='single0';break;
    case 3:MIRRORING='single1';break;
  }
}

function vrc7CpuRead(addr){
  addr&=0xffff;
  if(addr>=0x6000&&addr<0x8000)return prgRam[addr-0x6000]&0xff;
  if(addr<0x8000)return openBus.CPU&0xff;
  if(addr<0xa000)return mapperReadBank(prgRom,0x2000,vrc7Prg[0],addr&0x1fff);
  if(addr<0xc000)return mapperReadBank(prgRom,0x2000,vrc7Prg[1],addr&0x1fff);
  if(addr<0xe000)return mapperReadBank(prgRom,0x2000,vrc7Prg[2],addr&0x1fff);
  return mapperReadBank(prgRom,0x2000,mapperBankCount(prgRom,0x2000)-1,addr&0x1fff);
}

function vrc7CpuWrite(addr,value){
  addr&=0xffff;
  value&=0xff;
  if(addr>=0x6000&&addr<0x8000){
    prgRam[addr-0x6000]=value;
    return;
  }
  if(addr<0x8000)return;

  const reg=vrc7CanonicalAddress(addr);

  if(reg>=0xa000&&reg<=0xdfff){
    const a=reg&0xf010;
    const index=((a>>>4)&1)|((a-0xa000)>>>11);
    if(index>=0&&index<8)vrc7Chr[index]=value;
    return;
  }

  if(reg===0x9030){
    if(typeof NESAudio!=='undefined'&&NESAudio.expansionWrite)
      NESAudio.expansionWrite(cpuCycles,reg,value);
    return;
  }

  switch(reg&0xf010){
    case 0x8000:vrc7Prg[0]=value;return;
    case 0x8010:vrc7Prg[1]=value;return;
    case 0x9000:vrc7Prg[2]=value;return;
    case 0x9010:
      vrc7AudioIndex=value;
      if(typeof NESAudio!=='undefined'&&NESAudio.expansionWrite)
        NESAudio.expansionWrite(cpuCycles,reg,value);
      return;
    case 0xe000:
      vrc7Mirror=value&3;
      vrc7ApplyMirroring();
      if(typeof NESAudio!=='undefined'&&NESAudio.expansionWrite)
        NESAudio.expansionWrite(cpuCycles,reg,value);
      return;
    case 0xe010:
      vrc7IrqLatch=value;
      irqAssert.vrc=false;
      return;
    case 0xf000:
      vrc7IrqCycleMode=!!(value&4);
      vrc7IrqEnabled=!!(value&2);
      vrc7IrqEnableAfterAck=!!(value&1);
      if(vrc7IrqEnabled)vrc7IrqCounter=vrc7IrqLatch;
      vrc7IrqPrescaler=0;
      irqAssert.vrc=false;
      return;
    case 0xf010:
      vrc7IrqEnabled=vrc7IrqEnableAfterAck;
      irqAssert.vrc=false;
      return;
  }
}

function vrc7ChrRead(addr){
  addr&=0x1fff;
  const slot=addr>>>10;
  return mapperReadBank(CHR_ROM,0x400,vrc7Chr[slot],addr&0x3ff);
}

function vrc7ChrWrite(addr,value){
  if(!chrIsRAM)return;
  addr&=0x1fff;
  value&=0xff;
  const slot=addr>>>10;
  const count=mapperBankCount(CHR_ROM,0x400);
  const bank=mapperBankIndex(vrc7Chr[slot],count);
  CHR_ROM[bank*0x400+(addr&0x3ff)]=value;
}

function vrc7IrqCounterClock(){
  if(vrc7IrqCounter===0xff){
    vrc7IrqCounter=vrc7IrqLatch;
    irqAssert.vrc=true;
  }else vrc7IrqCounter=(vrc7IrqCounter+1)&0xff;
}

function vrc7ClockCpu(){
  if(!vrc7IrqEnabled)return;
  if(vrc7IrqCycleMode){
    vrc7IrqCounterClock();
    return;
  }
  vrc7IrqPrescaler+=3;
  while(vrc7IrqPrescaler>=341){
    vrc7IrqPrescaler-=341;
    vrc7IrqCounterClock();
  }
}

function vrc7SaveState(){
  const out=new Uint8Array(1+3+8+1+1+1+1+2+1);
  let o=0;
  out[o++]=1;
  out.set(vrc7Prg,o);o+=3;
  out.set(vrc7Chr,o);o+=8;
  out[o++]=vrc7Mirror&255;
  out[o++]=vrc7AudioIndex&255;
  out[o++]=vrc7IrqLatch&255;
  out[o++]=vrc7IrqCounter&255;
  out[o++]=vrc7IrqPrescaler&255;
  out[o++]=(vrc7IrqPrescaler>>>8)&255;
  out[o++]=(vrc7IrqEnabled?1:0)|(vrc7IrqEnableAfterAck?2:0)|(vrc7IrqCycleMode?4:0)|(irqAssert.vrc?8:0);
  return out;
}

function vrc7LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<19||bytes[0]!==1)return false;
  let o=1;
  vrc7Prg.set(bytes.subarray(o,o+3));o+=3;
  vrc7Chr.set(bytes.subarray(o,o+8));o+=8;
  vrc7Mirror=bytes[o++];
  vrc7AudioIndex=bytes[o++];
  vrc7IrqLatch=bytes[o++];
  vrc7IrqCounter=bytes[o++];
  vrc7IrqPrescaler=bytes[o++]|(bytes[o++]<<8);
  const f=bytes[o++];
  vrc7IrqEnabled=!!(f&1);
  vrc7IrqEnableAfterAck=!!(f&2);
  vrc7IrqCycleMode=!!(f&4);
  irqAssert.vrc=!!(f&8);
  vrc7ApplyMirroring();
  return true;
}
