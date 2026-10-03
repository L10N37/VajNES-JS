// Konami VRC3 (iNES mapper 73).
// Switchable 16 KiB PRG at $8000, fixed final 16 KiB at $C000,
// 8 KiB WRAM, CHR RAM, and a 16-bit/8-bit cycle IRQ counter.

let vrc3PrgBank=0;
let vrc3IrqAutoEnable=false;
let vrc3Irq8BitMode=false;
let vrc3IrqEnabled=false;
let vrc3IrqReload=0;
let vrc3IrqCounter=0;

function vrc3Init(){
  vrc3PrgBank=0;
  vrc3IrqAutoEnable=false;
  vrc3Irq8BitMode=false;
  vrc3IrqEnabled=false;
  vrc3IrqReload=0;
  vrc3IrqCounter=0;
  irqAssert.vrc=false;
  chrIsRAM=true;
}

function vrc3CpuRead(addr){
  addr&=0xffff;
  if(addr>=0x6000&&addr<0x8000)return prgRam[addr-0x6000]&0xff;
  if(addr<0x8000)return openBus.CPU&0xff;
  if(addr<0xc000)return mapperReadBank(prgRom,0x4000,vrc3PrgBank,addr&0x3fff);
  return mapperReadBank(prgRom,0x4000,mapperBankCount(prgRom,0x4000)-1,addr&0x3fff);
}

function vrc3CpuWrite(addr,value){
  addr&=0xffff;
  value&=0xff;

  if(addr>=0x6000&&addr<0x8000){
    prgRam[addr-0x6000]=value;
    return;
  }
  if(addr<0x8000)return;

  switch(addr&0xf000){
    case 0x8000:
      vrc3IrqReload=(vrc3IrqReload&0xfff0)|(value&0x0f);
      return;
    case 0x9000:
      vrc3IrqReload=(vrc3IrqReload&0xff0f)|((value&0x0f)<<4);
      return;
    case 0xa000:
      vrc3IrqReload=(vrc3IrqReload&0xf0ff)|((value&0x0f)<<8);
      return;
    case 0xb000:
      vrc3IrqReload=(vrc3IrqReload&0x0fff)|((value&0x0f)<<12);
      return;
    case 0xc000:
      vrc3Irq8BitMode=!!(value&4);
      vrc3IrqAutoEnable=!!(value&1);
      vrc3IrqEnabled=!!(value&2);
      if(vrc3IrqEnabled){
        if(vrc3Irq8BitMode)
          vrc3IrqCounter=(vrc3IrqCounter&0xff00)|(vrc3IrqReload&0xff);
        else
          vrc3IrqCounter=vrc3IrqReload;
      }
      irqAssert.vrc=false;
      return;
    case 0xd000:
      irqAssert.vrc=false;
      vrc3IrqEnabled=vrc3IrqAutoEnable;
      return;
    case 0xf000:
      vrc3PrgBank=value;
      return;
  }
}

function vrc3ClockCpu(){
  if(!vrc3IrqEnabled)return;
  if(vrc3Irq8BitMode){
    const low=vrc3IrqCounter&0xff;
    if(low===0xff){
      vrc3IrqCounter=(vrc3IrqCounter&0xff00)|(vrc3IrqReload&0xff);
      irqAssert.vrc=true;
    }else{
      vrc3IrqCounter=(vrc3IrqCounter&0xff00)|((low+1)&0xff);
    }
  }else{
    if(vrc3IrqCounter===0xffff){
      vrc3IrqCounter=vrc3IrqReload;
      irqAssert.vrc=true;
    }else{
      vrc3IrqCounter=(vrc3IrqCounter+1)&0xffff;
    }
  }
}

function vrc3SaveState(){
  const out=new Uint8Array(8);
  out[0]=1;
  out[1]=vrc3PrgBank&255;
  out[2]=vrc3IrqReload&255;
  out[3]=(vrc3IrqReload>>>8)&255;
  out[4]=vrc3IrqCounter&255;
  out[5]=(vrc3IrqCounter>>>8)&255;
  out[6]=(vrc3IrqAutoEnable?1:0)|(vrc3Irq8BitMode?2:0)|(vrc3IrqEnabled?4:0)|(irqAssert.vrc?8:0);
  out[7]=0;
  return out;
}

function vrc3LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<7||bytes[0]!==1)return false;
  vrc3PrgBank=bytes[1];
  vrc3IrqReload=bytes[2]|(bytes[3]<<8);
  vrc3IrqCounter=bytes[4]|(bytes[5]<<8);
  const f=bytes[6];
  vrc3IrqAutoEnable=!!(f&1);
  vrc3Irq8BitMode=!!(f&2);
  vrc3IrqEnabled=!!(f&4);
  irqAssert.vrc=!!(f&8);
  chrIsRAM=true;
  return true;
}
