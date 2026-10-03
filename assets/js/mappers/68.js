// Mapper 68: Sunsoft-4.
// Four 2 KiB CHR banks, switchable 16 KiB PRG at $8000, fixed last 16 KiB
// at $C000, optional CHR-ROM-backed nametables, and mapper mirroring control.

const mapper68Chr = new Uint8Array(4);
let mapper68Prg = 0;
let mapper68Nt1 = 0;
let mapper68Nt2 = 0;
let mapper68Mirror = 0;

function mapper68Init() {
  mapper68Chr[0]=0; mapper68Chr[1]=1; mapper68Chr[2]=2; mapper68Chr[3]=3;
  mapper68Prg=0; mapper68Nt1=0; mapper68Nt2=0; mapper68Mirror=0;
  chrIsRAM=false;
  mapper68ApplyMirroring();
}

function mapper68ApplyMirroring() {
  switch(mapper68Mirror & 3) {
    case 0: MIRRORING='vertical'; break;
    case 1: MIRRORING='horizontal'; break;
    case 2: MIRRORING='single0'; break;
    case 3: MIRRORING='single1'; break;
  }
}

function mapper68CpuRead(addr) {
  addr &= 0xffff;
  const banks=Math.max(1,Math.ceil(prgRom.length/0x4000));
  const bank=addr<0xc000 ? (mapper68Prg % banks) : (banks-1);
  return prgRom[bank*0x4000+(addr&0x3fff)]&0xff;
}

function mapper68CpuWrite(addr,value) {
  addr&=0xffff; value&=0xff;
  switch(addr & 0xf000) {
    case 0x8000: mapper68Chr[0]=value; break;
    case 0x9000: mapper68Chr[1]=value; break;
    case 0xa000: mapper68Chr[2]=value; break;
    case 0xb000: mapper68Chr[3]=value; break;
    case 0xc000: mapper68Nt1=value; break;
    case 0xd000: mapper68Nt2=value; break;
    case 0xe000: mapper68Mirror=value; mapper68ApplyMirroring(); break;
    case 0xf000: mapper68Prg=value&7; break;
    default: return false;
  }
  return true;
}

function mapper68ChrRead(addr) {
  addr &= 0x1fff;
  const slot=addr>>>11;
  const bankCount=Math.max(1,Math.ceil(CHR_ROM.length/0x800));
  const bank=mapper68Chr[slot]%bankCount;
  return CHR_ROM[bank*0x800+(addr&0x7ff)]&0xff;
}

function mapper68NtChrMode() {
  return !!(mapper68Mirror & 0x10);
}

function mapper68NtBank(addr) {
  const nt=((addr-0x2000)>>>10)&3;
  switch(mapper68Mirror&3) {
    case 0: return (nt&1) ? mapper68Nt2 : mapper68Nt1;
    case 1: return (nt<2) ? mapper68Nt1 : mapper68Nt2;
    case 2: return mapper68Nt1;
    case 3: return mapper68Nt2;
  }
  return mapper68Nt1;
}

function mapper68NtRead(addr) {
  addr=0x2000|((addr-0x2000)&0x0fff);
  if(!mapper68NtChrMode()) return VRAM[mapNT(addr)]&0xff;
  const bankCount=Math.max(1,Math.ceil(CHR_ROM.length/0x400));
  const bank=((mapper68NtBank(addr)|0x80)%bankCount+bankCount)%bankCount;
  return CHR_ROM[bank*0x400+(addr&0x3ff)]&0xff;
}

function mapper68NtWrite(addr,value) {
  if(!mapper68NtChrMode()) VRAM[mapNT(addr)]=value&0xff;
}

function mapper68SaveState(){
  return new Uint8Array([1,...mapper68Chr,mapper68Prg&255,mapper68Nt1&255,mapper68Nt2&255,mapper68Mirror&255]);
}
function mapper68LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<9||bytes[0]!==1)return false;
  mapper68Chr.set(bytes.subarray(1,5));
  mapper68Prg=bytes[5]; mapper68Nt1=bytes[6]; mapper68Nt2=bytes[7]; mapper68Mirror=bytes[8];
  mapper68ApplyMirroring(); return true;
}
