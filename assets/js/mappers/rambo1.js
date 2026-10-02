// Tengen RAMBO-1 (iNES 64) and 800037 variant (iNES 158).
// Mapper 158 routes CHR A17 to CIRAM A10, analogous to mapper 118/TLSROM.
let rambo1Select=0;
const rambo1Regs=new Uint8Array(16);
let rambo1IrqLatch=0;
let rambo1IrqCounter=0;
let rambo1IrqReload=false;
let rambo1IrqCpuMode=false;
let rambo1IrqEnabled=false;
let rambo1IrqDelay=0;
let rambo1CpuPrescaler=4;
let rambo1PrevA12=0;
let rambo1A12LowSince=0;

function rambo1FamilyActive(){
  return mapperNumber===64 || mapperNumber===158;
}

function rambo1Init(){
  rambo1Select=0;
  rambo1Regs.fill(0);
  rambo1Regs[6]=0;
  rambo1Regs[7]=1;
  rambo1Regs[15]=Math.max(0,mapperBankCount(prgRom,0x2000)-2)&0xff;
  rambo1IrqLatch=0;
  rambo1IrqCounter=0;
  rambo1IrqReload=false;
  rambo1IrqCpuMode=false;
  rambo1IrqEnabled=false;
  rambo1IrqDelay=0;
  rambo1CpuPrescaler=4;
  rambo1PrevA12=0;
  rambo1A12LowSince=typeof ppuCycles==='number'?ppuCycles:0;
  irqAssert.rambo=false;
}

function rambo1PrgBankForAddress(addr){
  addr&=0xffff;
  const p=!!(rambo1Select&0x40);
  if(addr<0xa000)return p?rambo1Regs[15]:rambo1Regs[6];
  if(addr<0xc000)return rambo1Regs[7];
  if(addr<0xe000)return p?rambo1Regs[6]:rambo1Regs[15];
  return mapperBankCount(prgRom,0x2000)-1;
}

function rambo1CpuRead(addr){
  addr&=0xffff;
  if(addr<0x8000)return openBus.CPU&0xff; // RAMBO-1 has no PRG RAM.
  return mapperReadBank(prgRom,0x2000,rambo1PrgBankForAddress(addr),addr&0x1fff);
}

function rambo1CpuWrite(addr,value){
  addr&=0xffff;value&=0xff;
  if(addr<0x8000)return false;
  switch(addr&0xe001){
    case 0x8000:
      rambo1Select=value;
      return true;
    case 0x8001: {
      const reg=rambo1Select&0x0f;
      if(reg<=9 || reg===15)rambo1Regs[reg]=value;
      return true;
    }
    case 0xa000:
      if(mapperNumber===64 && MIRRORING!=='four')
        MIRRORING=(value&1)?'horizontal':'vertical';
      return true;
    case 0xa001:
      return true; // no PRG-RAM control on RAMBO-1
    case 0xc000:
      rambo1IrqLatch=value;
      return true;
    case 0xc001:
      rambo1IrqCpuMode=!!(value&1);
      rambo1IrqCounter=0;
      rambo1IrqReload=true;
      rambo1CpuPrescaler=4;
      return true;
    case 0xe000:
      rambo1IrqEnabled=false;
      rambo1IrqDelay=0;
      irqAssert.rambo=false;
      return true;
    case 0xe001:
      rambo1IrqEnabled=true;
      return true;
  }
  return true;
}

function rambo1ChrBankForAddress(addr){
  addr&=0x1fff;
  const slot=addr>>>10;
  const invert=!!(rambo1Select&0x80);
  const oneK=!!(rambo1Select&0x20);
  let reg,second=false;

  if(!invert){
    if(slot===0)reg=0;
    else if(slot===1){reg=oneK?8:0;second=!oneK;}
    else if(slot===2)reg=1;
    else if(slot===3){reg=oneK?9:1;second=!oneK;}
    else reg=slot-2; // slots 4..7 -> R2..R5
  } else {
    if(slot<4)reg=slot+2; // slots 0..3 -> R2..R5
    else if(slot===4)reg=0;
    else if(slot===5){reg=oneK?8:0;second=!oneK;}
    else if(slot===6)reg=1;
    else {reg=oneK?9:1;second=!oneK;}
  }

  let bank=rambo1Regs[reg]&0xff;
  if(!oneK && (reg===0 || reg===1)){
    bank&=0xfe;
    if(second)bank=(bank+1)&0xff;
  }
  return bank;
}

function rambo1ChrRead(addr){
  addr&=0x1fff;
  return mapperReadBank(CHR_ROM,0x400,rambo1ChrBankForAddress(addr),addr&0x3ff);
}

function mapper158NametableAddress(addr){
  const bank=rambo1ChrBankForAddress(addr&0x0fff);
  return (addr&0x03ff)|((bank&0x80)?0x0400:0);
}

function rambo1ClockIrqCounter(){
  if(rambo1IrqReload){
    rambo1IrqCounter=rambo1IrqLatch&0xff;
    if(rambo1IrqCounter!==0)rambo1IrqCounter|=1;
    rambo1IrqReload=false;
  } else if(rambo1IrqCounter===0) {
    rambo1IrqCounter=rambo1IrqLatch&0xff;
  } else {
    rambo1IrqCounter=(rambo1IrqCounter-1)&0xff;
  }
  if(rambo1IrqCounter===0 && rambo1IrqEnabled)
    rambo1IrqDelay=4;
}

function rambo1IrqAddress(addr){
  if(!rambo1FamilyActive() || rambo1IrqCpuMode)return;
  const high=(addr>>>12)&1;
  if(!high && rambo1PrevA12)rambo1A12LowSince=ppuCycles;
  if(high && !rambo1PrevA12 && ppuCycles-rambo1A12LowSince>=9)
    rambo1ClockIrqCounter();
  rambo1PrevA12=high;
}

function rambo1ClockCpu(){
  if(!rambo1FamilyActive())return;

  if(rambo1IrqDelay>0){
    rambo1IrqDelay--;
    if(rambo1IrqDelay===0 && rambo1IrqEnabled)irqAssert.rambo=true;
  }

  if(!rambo1IrqCpuMode)return;
  rambo1CpuPrescaler--;
  if(rambo1CpuPrescaler<=0){
    rambo1CpuPrescaler=4;
    rambo1ClockIrqCounter();
  }
}

// Shared PPU-address notification. Keep the existing MMC3 path byte-for-byte
// while allowing RAMBO-1's filtered A12 counter to observe the same bus.
function mapperChrIrqAddress(addr){
  if(mmc3FamilyActive())mmc3Irq(addr);
  else if(rambo1FamilyActive())rambo1IrqAddress(addr);
}

function rambo1SaveState(){
  const out=new Uint8Array(1+1+16+2+7+4);
  let o=0;
  out[o++]=1;
  out[o++]=rambo1Select&0xff;
  out.set(rambo1Regs,o);o+=16;
  out[o++]=rambo1IrqLatch&0xff;
  out[o++]=rambo1IrqCounter&0xff;
  out[o++]=rambo1IrqReload?1:0;
  out[o++]=rambo1IrqCpuMode?1:0;
  out[o++]=rambo1IrqEnabled?1:0;
  out[o++]=rambo1IrqDelay&0xff;
  out[o++]=rambo1CpuPrescaler&0xff;
  out[o++]=rambo1PrevA12?1:0;
  out[o++]=irqAssert.rambo?1:0;
  out[o++]=rambo1A12LowSince&0xff;
  out[o++]=(rambo1A12LowSince>>>8)&0xff;
  out[o++]=(rambo1A12LowSince>>>16)&0xff;
  out[o++]=(rambo1A12LowSince>>>24)&0xff;
  return out;
}

function rambo1LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<33||bytes[0]!==1)return false;
  let o=1;
  rambo1Select=bytes[o++];
  rambo1Regs.set(bytes.subarray(o,o+16));o+=16;
  rambo1IrqLatch=bytes[o++];
  rambo1IrqCounter=bytes[o++];
  rambo1IrqReload=!!bytes[o++];
  rambo1IrqCpuMode=!!bytes[o++];
  rambo1IrqEnabled=!!bytes[o++];
  rambo1IrqDelay=bytes[o++];
  rambo1CpuPrescaler=bytes[o++]||4;
  rambo1PrevA12=bytes[o++]&1;
  irqAssert.rambo=!!bytes[o++];
  rambo1A12LowSince=(bytes[o++]|(bytes[o++]<<8)|(bytes[o++]<<16)|(bytes[o++]<<24))>>>0;
  return true;
}
