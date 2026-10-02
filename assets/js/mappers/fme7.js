// Sunsoft FME-7 / 5A / 5B mapper (iNES 69).
// FME-7 mapper logic is shared by all three chips; 5B additionally exposes
// YM2149-style expansion audio through $C000/$E000.
let fme7Command=0;
let fme7Chr=new Uint8Array(8);
let fme7Prg=new Uint8Array(3); // $8000, $A000, $C000
let fme7Bank6000=0;
let fme7IrqCounter=0;
let fme7IrqCounterEnable=false;
let fme7IrqEnable=false;

function fme7Init(){
  fme7Command=0;
  for(let i=0;i<8;i++)fme7Chr[i]=i;
  fme7Prg.fill(0);
  fme7Bank6000=0;
  fme7IrqCounter=0;
  fme7IrqCounterEnable=false;
  fme7IrqEnable=false;
  irqAssert.fme7=false;
  chrIsRAM=false;
}

function fme7SetMirroring(value){
  switch(value&3){
    case 0:MIRRORING='vertical';break;
    case 1:MIRRORING='horizontal';break;
    case 2:MIRRORING='single0';break;
    case 3:MIRRORING='single1';break;
  }
}

function fme7ApplyCommand(value){
  value&=0xff;
  const cmd=fme7Command&0x0f;
  if(cmd<=7){
    fme7Chr[cmd]=value;
    return;
  }
  if(cmd===8){fme7Bank6000=value;return;}
  if(cmd>=9&&cmd<=11){fme7Prg[cmd-9]=value&0x3f;return;}
  if(cmd===12){fme7SetMirroring(value);return;}
  if(cmd===13){
    // Any IRQ-control write acknowledges a pending mapper IRQ.
    irqAssert.fme7=false;
    fme7IrqCounterEnable=!!(value&0x80);
    fme7IrqEnable=!!(value&0x01);
    return;
  }
  if(cmd===14){fme7IrqCounter=(fme7IrqCounter&0xff00)|value;return;}
  if(cmd===15){fme7IrqCounter=(fme7IrqCounter&0x00ff)|(value<<8);return;}
}

function fme7CpuWrite(addr,value){
  addr&=0xffff;value&=0xff;
  if(addr>=0x6000&&addr<0x8000){
    // R8: bit6 selects RAM; bit7 enables RAM. ROM mode ignores bit7.
    if((fme7Bank6000&0x40) && (fme7Bank6000&0x80))
      prgRam[(addr-0x6000)%Math.max(1,prgRam.length)]=value;
    return true;
  }
  if(addr<0x8000)return false;
  if(addr<0xa000){fme7Command=value&0x0f;return true;}
  if(addr<0xc000){fme7ApplyCommand(value);return true;}

  // Sunsoft 5B audio register select/data. On FME-7/5A these writes simply
  // have no audible effect; the mapper banking registers are only $8000/A000.
  if(addr<0xe000){
    if(typeof NESAudio!=='undefined'&&NESAudio.expansionWrite)
      NESAudio.expansionWrite(cpuCycles,addr,value);
    return true;
  }
  if(typeof NESAudio!=='undefined'&&NESAudio.expansionWrite)
    NESAudio.expansionWrite(cpuCycles,addr,value);
  return true;
}

function fme7CpuRead(addr){
  addr&=0xffff;
  if(addr>=0x6000&&addr<0x8000){
    if(fme7Bank6000&0x40){
      if(!(fme7Bank6000&0x80))return openBus.CPU&0xff;
      return prgRam[(addr-0x6000)%Math.max(1,prgRam.length)]&0xff;
    }
    return mapperReadBank(prgRom,0x2000,fme7Bank6000&0x3f,addr&0x1fff);
  }
  if(addr<0x8000)return openBus.CPU&0xff;
  if(addr<0xa000)return mapperReadBank(prgRom,0x2000,fme7Prg[0],addr&0x1fff);
  if(addr<0xc000)return mapperReadBank(prgRom,0x2000,fme7Prg[1],addr&0x1fff);
  if(addr<0xe000)return mapperReadBank(prgRom,0x2000,fme7Prg[2],addr&0x1fff);
  return mapperReadBank(prgRom,0x2000,mapperBankCount(prgRom,0x2000)-1,addr&0x1fff);
}

function fme7ChrRead(addr){
  addr&=0x1fff;
  const slot=addr>>>10;
  return mapperReadBank(CHR_ROM,0x400,fme7Chr[slot],addr&0x3ff);
}

function fme7ClockCpu(){
  if(!fme7IrqCounterEnable)return;
  if(fme7IrqCounter===0 && fme7IrqEnable)irqAssert.fme7=true;
  fme7IrqCounter=(fme7IrqCounter-1)&0xffff;
}

function fme7SaveState(){
  const out=new Uint8Array(1+1+8+3+1+2+1+1);
  let o=0;
  out[o++]=1;
  out[o++]=fme7Command&15;
  out.set(fme7Chr,o);o+=8;
  out.set(fme7Prg,o);o+=3;
  out[o++]=fme7Bank6000&255;
  out[o++]=fme7IrqCounter&255;
  out[o++]=(fme7IrqCounter>>>8)&255;
  out[o++]=(fme7IrqCounterEnable?1:0)|(fme7IrqEnable?2:0)|(irqAssert.fme7?4:0);
  out[o++]=MIRRORING==='horizontal'?0:MIRRORING==='vertical'?1:MIRRORING==='single0'?2:3;
  return out;
}

function fme7LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<18||bytes[0]!==1)return false;
  let o=1;
  fme7Command=bytes[o++]&15;
  fme7Chr.set(bytes.subarray(o,o+8));o+=8;
  fme7Prg.set(bytes.subarray(o,o+3));o+=3;
  fme7Bank6000=bytes[o++];
  fme7IrqCounter=bytes[o++]|(bytes[o++]<<8);
  const flags=bytes[o++];
  fme7IrqCounterEnable=!!(flags&1);
  fme7IrqEnable=!!(flags&2);
  irqAssert.fme7=!!(flags&4);
  fme7SetMirroring(bytes[o++]&3);
  return true;
}
