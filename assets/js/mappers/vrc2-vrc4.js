// Konami VRC2/VRC4 family (iNES 21, 22, 23 and 25).
// These mapper numbers primarily differ by which CPU address lines reach
// register A0/A1. Mapper 22 is VRC2-only: no IRQ unit or WRAM, and its CHR
// bank number is shifted right by one.

let vrc24Reg1Mask=0;
let vrc24Reg2Mask=0;
let vrc24Is22=false;
const vrc24Prg=new Uint8Array(2);
const vrc24Chr=new Uint8Array(8);
let vrc24RegCmd=0;
let vrc24Mirr=0;

let vrc24IrqLatch=0;
let vrc24IrqCounter=0;
let vrc24IrqPrescaler=0;
let vrc24IrqEnabled=false;
let vrc24IrqEnableAfterAck=false;
let vrc24IrqCycleMode=false;

function vrc24FamilyActive(){
  return mapperNumber===21 || mapperNumber===22 || mapperNumber===23 || mapperNumber===25;
}

function vrc24ConfigureWiring(){
  vrc24Is22=mapperNumber===22;
  switch(mapperNumber){
    case 21:
      vrc24Reg1Mask=0x42;
      vrc24Reg2Mask=0x84;
      break;
    case 22:
      vrc24Reg1Mask=0x02;
      vrc24Reg2Mask=0x01;
      break;
    case 23:
      vrc24Reg1Mask=0x15;
      vrc24Reg2Mask=0x2a;
      break;
    case 25:
      vrc24Reg1Mask=0x0a;
      vrc24Reg2Mask=0x05;
      break;
    default:
      vrc24Reg1Mask=vrc24Reg2Mask=0;
      break;
  }
}

function vrc24Init(){
  vrc24ConfigureWiring();
  vrc24Prg.fill(0);
  vrc24Chr.fill(0);
  vrc24RegCmd=0;
  vrc24Mirr=0;
  vrc24IrqLatch=0;
  vrc24IrqCounter=0;
  vrc24IrqPrescaler=0;
  vrc24IrqEnabled=false;
  vrc24IrqEnableAfterAck=false;
  vrc24IrqCycleMode=false;
  irqAssert.vrc=false;
  chrIsRAM=false;
}

function vrc24CanonicalAddress(addr){
  addr&=0xffff;
  return (addr&0xf000) |
    ((addr&vrc24Reg2Mask)?2:0) |
    ((addr&vrc24Reg1Mask)?1:0);
}

function vrc24SetMirroring(value){
  vrc24Mirr=value&0xff;
  switch(vrc24Mirr&3){
    case 0:MIRRORING='vertical';break;
    case 1:MIRRORING='horizontal';break;
    case 2:MIRRORING='single0';break;
    case 3:MIRRORING='single1';break;
  }
}

function vrc24CpuRead(addr){
  addr&=0xffff;
  if(addr>=0x6000&&addr<0x8000){
    if(vrc24Is22)return openBus.CPU&0xff;
    return prgRam[addr-0x6000]&0xff;
  }
  if(addr<0x8000)return openBus.CPU&0xff;

  const count=mapperBankCount(prgRom,0x2000);
  const last=Math.max(0,count-1);
  const secondLast=Math.max(0,count-2);
  const swap=!!(vrc24RegCmd&2);

  if(addr<0xa000)
    return mapperReadBank(prgRom,0x2000,swap?secondLast:vrc24Prg[0],addr&0x1fff);
  if(addr<0xc000)
    return mapperReadBank(prgRom,0x2000,vrc24Prg[1],addr&0x1fff);
  if(addr<0xe000)
    return mapperReadBank(prgRom,0x2000,swap?vrc24Prg[0]:secondLast,addr&0x1fff);
  return mapperReadBank(prgRom,0x2000,last,addr&0x1fff);
}

function vrc24WriteChrNibble(reg,value){
  const group=(reg>>>12)-0xb;
  const index=(group<<1)|((reg>>>1)&1);
  const high=!!(reg&1);
  if(index<0||index>=8)return;
  if(high)vrc24Chr[index]=(vrc24Chr[index]&0x0f)|((value&0x0f)<<4);
  else vrc24Chr[index]=(vrc24Chr[index]&0xf0)|(value&0x0f);
}

function vrc24CpuWrite(addr,value){
  addr&=0xffff;
  value&=0xff;

  if(addr>=0x6000&&addr<0x8000){
    if(!vrc24Is22)prgRam[addr-0x6000]=value;
    return;
  }
  if(addr<0x8000)return;

  const reg=vrc24CanonicalAddress(addr);

  if(reg>=0xb000&&reg<=0xe003){
    vrc24WriteChrNibble(reg,value);
    return;
  }

  switch(reg&0xf003){
    case 0x8000:case 0x8001:case 0x8002:case 0x8003:
      vrc24Prg[0]=value&0x1f;
      return;

    case 0xa000:case 0xa001:case 0xa002:case 0xa003:
      vrc24Prg[1]=value&0x1f;
      return;

    case 0x9000:case 0x9001:
      if(value!==0xff)vrc24SetMirroring(value);
      return;

    case 0x9002:case 0x9003:
      vrc24RegCmd=value;
      return;

    case 0xf000:
      if(vrc24Is22)return;
      irqAssert.vrc=false;
      vrc24IrqLatch=(vrc24IrqLatch&0xf0)|(value&0x0f);
      return;

    case 0xf001:
      if(vrc24Is22)return;
      irqAssert.vrc=false;
      vrc24IrqLatch=(vrc24IrqLatch&0x0f)|((value&0x0f)<<4);
      return;

    case 0xf002:
      if(vrc24Is22)return;
      irqAssert.vrc=false;
      vrc24IrqPrescaler=0;
      vrc24IrqCounter=vrc24IrqLatch;
      vrc24IrqCycleMode=!!(value&4);
      vrc24IrqEnabled=!!(value&2);
      vrc24IrqEnableAfterAck=!!(value&1);
      return;

    case 0xf003:
      if(vrc24Is22)return;
      irqAssert.vrc=false;
      vrc24IrqEnabled=vrc24IrqEnableAfterAck;
      return;
  }
}

function vrc24ChrRead(addr){
  addr&=0x1fff;
  const slot=addr>>>10;
  const bank=(vrc24Chr[slot] >>> (vrc24Is22?1:0))&0xff;
  return mapperReadBank(CHR_ROM,0x400,bank,addr&0x3ff);
}

function vrc24IrqCounterClock(){
  if(vrc24IrqCounter===0xff){
    vrc24IrqCounter=vrc24IrqLatch;
    irqAssert.vrc=true;
  }else{
    vrc24IrqCounter=(vrc24IrqCounter+1)&0xff;
  }
}

function vrc24ClockCpu(){
  if(vrc24Is22||!vrc24IrqEnabled)return;
  if(vrc24IrqCycleMode){
    vrc24IrqCounterClock();
    return;
  }
  vrc24IrqPrescaler+=3;
  while(vrc24IrqPrescaler>=341){
    vrc24IrqPrescaler-=341;
    vrc24IrqCounterClock();
  }
}

function vrc24SaveState(){
  const out=new Uint8Array(1+2+8+2+2+2+1);
  let o=0;
  out[o++]=1;
  out.set(vrc24Prg,o);o+=2;
  out.set(vrc24Chr,o);o+=8;
  out[o++]=vrc24RegCmd&0xff;
  out[o++]=vrc24Mirr&0xff;
  out[o++]=vrc24IrqLatch&0xff;
  out[o++]=vrc24IrqCounter&0xff;
  out[o++]=vrc24IrqPrescaler&0xff;
  out[o++]=(vrc24IrqPrescaler>>>8)&0xff;
  out[o++]=(vrc24IrqEnabled?1:0)|
           (vrc24IrqEnableAfterAck?2:0)|
           (vrc24IrqCycleMode?4:0)|
           (irqAssert.vrc?8:0);
  return out;
}

function vrc24LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<17||bytes[0]!==1)return false;
  let o=1;
  vrc24ConfigureWiring();
  vrc24Prg.set(bytes.subarray(o,o+2));o+=2;
  vrc24Chr.set(bytes.subarray(o,o+8));o+=8;
  vrc24RegCmd=bytes[o++];
  vrc24Mirr=bytes[o++];
  vrc24IrqLatch=bytes[o++];
  vrc24IrqCounter=bytes[o++];
  vrc24IrqPrescaler=bytes[o++]|(bytes[o++]<<8);
  const flags=bytes[o++];
  vrc24IrqEnabled=!!(flags&1);
  vrc24IrqEnableAfterAck=!!(flags&2);
  vrc24IrqCycleMode=!!(flags&4);
  irqAssert.vrc=!!(flags&8);
  vrc24SetMirroring(vrc24Mirr);
  chrIsRAM=false;
  return true;
}
