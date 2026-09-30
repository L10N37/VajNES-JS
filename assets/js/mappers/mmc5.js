// Nintendo MMC5 / ExROM (mapper 5).
// Initial implementation targets commercial compatibility, especially
// Castlevania III: Dracula's Curse (PRG mode 2, 1 KiB CHR banks, scanline IRQ).
let mmc5PrgMode=3,mmc5ChrMode=3,mmc5ExramMode=0,mmc5NtMap=0;
let mmc5FillTile=0,mmc5FillAttr=0,mmc5ChrHigh=0;
let mmc5Protect1=0,mmc5Protect2=0;
let mmc5PrgBanks=new Uint8Array(5); // $5113-$5117
let mmc5ChrA=new Uint16Array(8),mmc5ChrB=new Uint16Array(4);
let mmc5Exram=new Uint8Array(0x400);
let mmc5IrqCompare=0,mmc5IrqEnable=false,mmc5IrqPending=false,mmc5InFrame=false,mmc5Scanline=0;
let mmc5MulA=0,mmc5MulB=0;

function mmc5Init(){
  mmc5PrgMode=3;mmc5ChrMode=3;mmc5ExramMode=0;mmc5NtMap=0;
  mmc5FillTile=mmc5FillAttr=mmc5ChrHigh=0;
  mmc5Protect1=mmc5Protect2=0;
  mmc5PrgBanks.fill(0);mmc5PrgBanks[4]=0xff;
  mmc5ChrA.fill(0);mmc5ChrB.fill(0);mmc5Exram.fill(0);
  mmc5IrqCompare=0;mmc5IrqEnable=false;mmc5IrqPending=false;mmc5InFrame=false;mmc5Scanline=0;
  mmc5MulA=mmc5MulB=0;
  irqAssert.mmc5=false;
}

function mmc5PrgRom8(bank,off){
  return mapperReadBank(prgRom,0x2000,bank&0x7f,off&0x1fff);
}
function mmc5PrgRamWritable(){return (mmc5Protect1&3)===2 && (mmc5Protect2&3)===1;}

function mmc5CpuRead(addr){
  addr&=0xffff;
  if(addr===0x5010 || addr===0x5015) {
    if(typeof NESAudio!=='undefined' && NESAudio.expansionRead)
      return NESAudio.expansionRead(cpuCycles,addr)&0xff;
    return 0;
  }
  if(addr===0x5204){
    const v=(mmc5IrqPending?0x80:0)|(mmc5InFrame?0x40:0);
    mmc5IrqPending=false;irqAssert.mmc5=false;return v;
  }
  if(addr===0x5205)return (mmc5MulA*mmc5MulB)&0xff;
  if(addr===0x5206)return ((mmc5MulA*mmc5MulB)>>>8)&0xff;
  if(addr>=0x5c00&&addr<=0x5fff)
    return mmc5ExramMode>=2?mmc5Exram[addr&0x3ff]:openBus.CPU&0xff;
  if(addr>=0x6000&&addr<0x8000)return prgRam[addr&0x1fff]&0xff;
  if(addr<0x8000)return openBus.CPU&0xff;

  const r14=mmc5PrgBanks[1],r15=mmc5PrgBanks[2],r16=mmc5PrgBanks[3],r17=mmc5PrgBanks[4];
  let bank=0;
  switch(mmc5PrgMode&3){
    case 0: bank=(r17&0x7c)+((addr-0x8000)>>>13);break;
    case 1: bank=addr<0xc000?(r15&0x7e)+((addr-0x8000)>>>13):(r17&0x7e)+((addr-0xc000)>>>13);break;
    case 2:
      if(addr<0xc000)bank=(r15&0x7e)+((addr-0x8000)>>>13);
      else if(addr<0xe000)bank=r16&0x7f;
      else bank=r17&0x7f;
      break;
    default:
      bank=addr<0xa000?r14&0x7f:addr<0xc000?r15&0x7f:addr<0xe000?r16&0x7f:r17&0x7f;
      break;
  }
  const value=mmc5PrgRom8(bank,addr);
  if(typeof NESAudio!=='undefined' && NESAudio.expansionObserveRead)
    NESAudio.expansionObserveRead(cpuCycles,addr,value);
  return value;
}

function mmc5CpuWrite(addr,value){
  addr&=0xffff;value&=0xff;
  if((addr>=0x5000&&addr<=0x5007) || addr===0x5010 || addr===0x5011 || addr===0x5015) {
    if(typeof NESAudio!=='undefined' && NESAudio.expansionWrite)
      NESAudio.expansionWrite(cpuCycles,addr,value);
    return;
  }
  if(addr>=0x5c00&&addr<=0x5fff){if(mmc5ExramMode!==3)mmc5Exram[addr&0x3ff]=value;return;}
  if(addr>=0x6000&&addr<0x8000){if(mmc5PrgRamWritable())prgRam[addr&0x1fff]=value;return;}
  switch(addr){
    case 0x5100:mmc5PrgMode=value&3;return;
    case 0x5101:mmc5ChrMode=value&3;return;
    case 0x5102:mmc5Protect1=value&3;return;
    case 0x5103:mmc5Protect2=value&3;return;
    case 0x5104:mmc5ExramMode=value&3;return;
    case 0x5105:mmc5NtMap=value;return;
    case 0x5106:mmc5FillTile=value;return;
    case 0x5107:mmc5FillAttr=value&3;return;
    case 0x5130:mmc5ChrHigh=value&3;return;
    case 0x5203:mmc5IrqCompare=value;return;
    case 0x5204:mmc5IrqEnable=!!(value&0x80);irqAssert.mmc5=mmc5IrqEnable&&mmc5IrqPending;return;
    case 0x5205:mmc5MulA=value;return;
    case 0x5206:mmc5MulB=value;return;
  }
  if(addr>=0x5113&&addr<=0x5117){mmc5PrgBanks[addr-0x5113]=value;return;}
  if(addr>=0x5120&&addr<=0x5127){mmc5ChrA[addr-0x5120]=((mmc5ChrHigh<<8)|value)&0x3ff;return;}
  if(addr>=0x5128&&addr<=0x512b){mmc5ChrB[addr-0x5128]=((mmc5ChrHigh<<8)|value)&0x3ff;return;}
}

function mmc5ChrBankFor(addr,sprite){
  const slot=(addr&0x1fff)>>>10;
  // With 8x8 sprites MMC5 uses the primary CHR register set for all fetches.
  // The separate background set is meaningful with 8x16 sprites.
  if(!sprite && !(PPUCTRL&0x20))sprite=true;
  const regs=sprite?mmc5ChrA:mmc5ChrB;
  if(sprite){
    if(mmc5ChrMode===3)return regs[slot];
    if(mmc5ChrMode===2)return (regs[(slot|1)]&~1)|(slot&1);
    if(mmc5ChrMode===1)return (regs[(slot|3)]&~3)|(slot&3);
    return (regs[7]&~7)|slot;
  }
  // BG registers repeat $5128-$512B across the 8 KiB pattern space.
  if(mmc5ChrMode===3)return regs[slot&3];
  if(mmc5ChrMode===2)return (regs[(slot>>1)&3]&~1)|(slot&1);
  if(mmc5ChrMode===1)return (regs[((slot>>2)&1)*3+3]&~3)|(slot&3);
  return (regs[3]&~7)|slot;
}
function mmc5ChrRead(addr,sprite=false){
  return mapperReadBank(CHR_ROM,0x400,mmc5ChrBankFor(addr,sprite),addr&0x3ff);
}

function mmc5NtSource(addr){
  const nt=((addr-0x2000)>>>10)&3;
  return (mmc5NtMap>>(nt*2))&3;
}
function mmc5NametableRead(addr){
  addr=0x2000|((addr-0x2000)&0xfff);
  const off=addr&0x3ff,src=mmc5NtSource(addr);
  if(src===0)return VRAM[off]&0xff;
  if(src===1)return VRAM[0x400|off]&0xff;
  if(src===2)return mmc5ExramMode<2?mmc5Exram[off]&0xff:0;
  if(off<0x3c0)return mmc5FillTile;
  return (mmc5FillAttr*0x55)&0xff;
}
function mmc5NametableWrite(addr,value){
  const off=addr&0x3ff,src=mmc5NtSource(addr);
  if(src===0)VRAM[off]=value;
  else if(src===1)VRAM[0x400|off]=value;
  else if(src===2&&mmc5ExramMode<2)mmc5Exram[off]=value;
}
function mmc5ClockScanline(scanline){
  if(scanline<0||scanline>239)return;
  if(!mmc5InFrame){mmc5InFrame=true;mmc5Scanline=0;}
  else mmc5Scanline=(mmc5Scanline+1)&0xff;
  if(mmc5IrqCompare!==0&&mmc5Scanline===mmc5IrqCompare){
    mmc5IrqPending=true;if(mmc5IrqEnable)irqAssert.mmc5=true;
  }
}
function mmc5EndFrame(){mmc5InFrame=false;mmc5Scanline=0;irqAssert.mmc5=false;}


function mmc5SaveState(){
  const out=new Uint8Array(1+8+5+16+8+0x400);
  let o=0;
  out[o++]=1;
  out[o++]=mmc5PrgMode&3;out[o++]=mmc5ChrMode&3;out[o++]=mmc5ExramMode&3;out[o++]=mmc5NtMap&255;
  out[o++]=mmc5FillTile&255;out[o++]=mmc5FillAttr&3;out[o++]=mmc5ChrHigh&3;
  out[o++]=((mmc5Protect1&3)<<2)|(mmc5Protect2&3);
  out.set(mmc5PrgBanks,o);o+=5;
  for(let i=0;i<8;i++){out[o++]=mmc5ChrA[i]&255;out[o++]=(mmc5ChrA[i]>>>8)&3;}
  for(let i=0;i<4;i++){out[o++]=mmc5ChrB[i]&255;out[o++]=(mmc5ChrB[i]>>>8)&3;}
  out[o++]=mmc5IrqCompare&255;out[o++]=mmc5IrqEnable?1:0;out[o++]=mmc5IrqPending?1:0;out[o++]=mmc5InFrame?1:0;
  out[o++]=mmc5Scanline&255;out[o++]=mmc5MulA&255;out[o++]=mmc5MulB&255;out[o++]=irqAssert.mmc5?1:0;
  out.set(mmc5Exram,o);
  return out;
}
function mmc5LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<1+8+5+16+8+0x400||bytes[0]!==1)return false;
  let o=1;
  mmc5PrgMode=bytes[o++]&3;mmc5ChrMode=bytes[o++]&3;mmc5ExramMode=bytes[o++]&3;mmc5NtMap=bytes[o++];
  mmc5FillTile=bytes[o++];mmc5FillAttr=bytes[o++]&3;mmc5ChrHigh=bytes[o++]&3;
  const p=bytes[o++];mmc5Protect1=(p>>>2)&3;mmc5Protect2=p&3;
  mmc5PrgBanks.set(bytes.subarray(o,o+5));o+=5;
  for(let i=0;i<8;i++)mmc5ChrA[i]=(bytes[o++]|((bytes[o++]&3)<<8))&0x3ff;
  for(let i=0;i<4;i++)mmc5ChrB[i]=(bytes[o++]|((bytes[o++]&3)<<8))&0x3ff;
  mmc5IrqCompare=bytes[o++];mmc5IrqEnable=!!bytes[o++];mmc5IrqPending=!!bytes[o++];mmc5InFrame=!!bytes[o++];
  mmc5Scanline=bytes[o++];mmc5MulA=bytes[o++];mmc5MulB=bytes[o++];irqAssert.mmc5=!!bytes[o++];
  mmc5Exram.set(bytes.subarray(o,o+0x400));
  return true;
}
