// Namco 163 family.
// Mapper 19: Namco 129/163.
// Mapper 210: Namco 175 / Namco 340 cost-reduced variants.
// Splatterhouse: Wanpaku Graffiti is a Namco 340 game; many legacy dumps are
// incorrectly tagged mapper 19, so mapper 19 keeps the shared banking model.

let namcoChr=new Uint8Array(8);
let namcoNt=new Uint8Array(4);
let namcoPrg=new Uint8Array(3);
let namcoIrqCounter=0,namcoIrqEnable=false;
let namcoRam=new Uint8Array(0x80),namcoRamAddr=0,namcoRamAuto=false;
let namcoRamProtect=0;
let namco210Variant=0; // 0=N163, 1=N175, 2=N340
let namco175RamEnable=false;

function namcoInit(header){
  namcoChr.fill(0);namcoNt.fill(0xe0);namcoPrg.fill(0);
  namcoIrqCounter=0;namcoIrqEnable=false;irqAssert.namco=false;
  namcoRam.fill(0);namcoRamAddr=0;namcoRamAuto=false;namcoRamProtect=0;
  namco175RamEnable=false;
  if(mapperNumber===210){
    const sub=headerVersion===2?(header[8]>>>4):0;
    namco210Variant=sub===1?1:sub===2?2:(prgRamBattery?1:2);
  } else namco210Variant=0;
}

function namcoPrgRead(addr){
  addr&=0xffff;
  if(addr>=0x6000&&addr<0x8000){
    if(mapperNumber===210&&namco210Variant===2)return openBus.CPU&255;
    if(mapperNumber===210&&namco210Variant===1&&!namco175RamEnable)return openBus.CPU&255;
    return prgRam[(addr-0x6000)%prgRam.length]&255;
  }
  if(addr<0x8000)return openBus.CPU&255;
  const slot=(addr-0x8000)>>>13;
  if(slot<3)return mapperReadBank(prgRom,0x2000,namcoPrg[slot],addr&0x1fff);
  return mapperReadBank(prgRom,0x2000,mapperBankCount(prgRom,0x2000)-1,addr&0x1fff);
}

function namcoChrRead(addr){
  addr&=0x1fff;
  return mapperReadBank(CHR_ROM,0x400,namcoChr[addr>>>10],addr&0x3ff);
}

function namcoNtSelect(addr){
  return namcoNt[((addr-0x2000)>>>10)&3];
}
function namcoNtRead(addr){
  const off=addr&0x3ff;
  if(mapperNumber===210){
    return VRAM[mapNT(addr)]&255;
  }
  const sel=namcoNtSelect(addr);
  if(sel>=0xe0){
    const page=sel&1;
    return VRAM[(page<<10)|off]&255;
  }
  return mapperReadBank(CHR_ROM,0x400,sel,off);
}
function namcoNtWrite(addr,value){
  if(mapperNumber===210){VRAM[mapNT(addr)]=value&255;return;}
  const sel=namcoNtSelect(addr);
  if(sel>=0xe0)VRAM[((sel&1)<<10)|(addr&0x3ff)]=value&255;
}

function namcoSet340Mirroring(value){
  if(mapperNumber!==210||namco210Variant!==2)return;
  MIRRORING=['single0','vertical','single1','horizontal'][(value>>>6)&3];
}

function namcoWrite(addr,value){
  addr&=0xffff;value&=255;
  if(mapperNumber===19){
    if(addr>=0x4800&&addr<0x5000){
      namcoRam[namcoRamAddr]=value;
      if(namcoRamAuto&&namcoRamAddr<0x7f)namcoRamAddr++;
      return true;
    }
    if(addr>=0x5000&&addr<0x5800){
      namcoIrqCounter=(namcoIrqCounter&0x7f00)|value;irqAssert.namco=false;return true;
    }
    if(addr>=0x5800&&addr<0x6000){
      namcoIrqCounter=(namcoIrqCounter&0xff)|(value&0x7f)<<8;
      namcoIrqEnable=!!(value&0x80);irqAssert.namco=false;return true;
    }
  }
  if(addr>=0x6000&&addr<0x8000){
    if(mapperNumber===210&&namco210Variant===2)return true;
    if(mapperNumber===210&&namco210Variant===1&&!namco175RamEnable)return true;
    if(mapperNumber===19){
      const window=(addr-0x6000)>>>11;
      if(((namcoRamProtect>>>window)&1) || (namcoRamProtect&0xf0)!==0x40)return true;
    }
    prgRam[(addr-0x6000)%prgRam.length]=value;return true;
  }
  if(addr<0x8000)return false;
  if(addr<0xc000){
    namcoChr[(addr-0x8000)>>>11]=value;return true;
  }
  if(addr<0xe000){
    if(mapperNumber===19)namcoNt[(addr-0xc000)>>>11]=value;
    else if(namco210Variant===1&&addr<0xc800)namco175RamEnable=!!(value&1);
    return true;
  }
  if(addr<0xe800){
    namcoPrg[0]=value&0x3f;namcoSet340Mirroring(value);return true;
  }
  if(addr<0xf000){namcoPrg[1]=value&0x3f;return true;}
  if(addr<0xf800){namcoPrg[2]=value&0x3f;return true;}
  if(mapperNumber===19){
    namcoRamAddr=value&0x7f;namcoRamAuto=!!(value&0x80);namcoRamProtect=value;
    return true;
  }
  return true;
}

function namcoReadLow(addr){
  addr&=0xffff;
  if(mapperNumber===19&&addr>=0x4800&&addr<0x5000){
    const value=namcoRam[namcoRamAddr]&255;
    if(namcoRamAuto&&namcoRamAddr<0x7f)namcoRamAddr++;
    return value;
  }
  if(mapperNumber===19&&addr>=0x5000&&addr<0x5800)return namcoIrqCounter&255;
  if(mapperNumber===19&&addr>=0x5800&&addr<0x6000)return ((namcoIrqCounter>>>8)&0x7f)|(namcoIrqEnable?0x80:0);
  if(addr>=0x6000)return namcoPrgRead(addr);
  return openBus.CPU&255;
}

function namcoClockCpu(){
  if(mapperNumber!==19||!namcoIrqEnable)return;
  if(namcoIrqCounter<0x7fff)namcoIrqCounter++;
  if(namcoIrqCounter===0x7fff)irqAssert.namco=true;
}

function namcoSaveState(){
  const out=new Uint8Array(1+1+8+4+3+2+1+1+1+1+0x80);
  let o=0;out[o++]=1;out[o++]=namco210Variant&3;
  out.set(namcoChr,o);o+=8;out.set(namcoNt,o);o+=4;out.set(namcoPrg,o);o+=3;
  out[o++]=namcoIrqCounter&255;out[o++]=(namcoIrqCounter>>>8)&0x7f;
  out[o++]=(namcoIrqEnable?1:0)|(irqAssert.namco?2:0);
  out[o++]=namcoRamAddr&0x7f;out[o++]=namcoRamAuto?1:0;out[o++]=namcoRamProtect&255;
  out[o++]=namco175RamEnable?1:0;out.set(namcoRam,o);
  return out;
}
function namcoLoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<151||bytes[0]!==1)return false;
  let o=1;namco210Variant=bytes[o++]&3;namcoChr.set(bytes.subarray(o,o+8));o+=8;
  namcoNt.set(bytes.subarray(o,o+4));o+=4;namcoPrg.set(bytes.subarray(o,o+3));o+=3;
  namcoIrqCounter=bytes[o++]|(bytes[o++]<<8);const f=bytes[o++];
  namcoIrqEnable=!!(f&1);irqAssert.namco=!!(f&2);namcoRamAddr=bytes[o++]&0x7f;
  namcoRamAuto=!!bytes[o++];namcoRamProtect=bytes[o++];namco175RamEnable=!!bytes[o++];
  namcoRam.set(bytes.subarray(o,o+0x80));
  return true;
}
