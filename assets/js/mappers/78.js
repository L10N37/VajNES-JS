// Mapper 78: Irem 74HC161/32 / Jaleco JF-16.
// $8000-$FFFF latch format: CCCC M PPP
//   bits 0-2: switchable 16 KiB PRG bank at $8000-$BFFF
//   bit 3: mirroring select
//   bits 4-7: 8 KiB CHR bank
//
// NES 2.0 submapper 3 is Holy Diver: bit 3 selects H/V mirroring
// (0=horizontal, 1=vertical). Submapper 1 is Uchuusen Cosmo Carrier:
// bit 3 selects one-screen A/B. Legacy Holy Diver dumps conventionally
// use the iNES four-screen flag as the board-variant marker.
let mapper78PrgBank=0;
let mapper78ChrBank=0;
let mapper78HolyDiver=false;

function mapper78Init(header){
  mapper78PrgBank=0;
  mapper78ChrBank=0;
  const sub=headerVersion===2 ? (header[8]>>>4) : 0;
  mapper78HolyDiver=headerVersion===2 ? sub===3 : !!(header[6]&0x08);
  // Legacy Holy Diver dumps use the iNES four-screen flag to identify the
  // H/V-wired variant; the board itself still uses ordinary 2 KiB CIRAM.
  if(mapper78HolyDiver && VRAM.length!==0x800)VRAM=new Uint8Array(0x800);
  mapper78ApplyMirroring(0);
}

function mapper78ApplyMirroring(bit){
  if(mapper78HolyDiver)
    MIRRORING=bit?'vertical':'horizontal';
  else
    MIRRORING=bit?'single1':'single0';
}

function mapper78Read(addr){
  addr&=0xffff;
  if(addr<0x8000)return openBus.CPU&0xff;
  if(addr<0xc000)
    return mapperReadBank(prgRom,0x4000,mapper78PrgBank,addr&0x3fff);
  return mapperReadBank(prgRom,0x4000,mapperBankCount(prgRom,0x4000)-1,addr&0x3fff);
}

function mapper78Write(addr,value){
  addr&=0xffff;
  if(addr<0x8000)return;
  value&=0xff;
  // Discrete 74HC161/32 boards resolve ROM bus conflicts by ANDing the CPU
  // write with the byte currently driven by PRG ROM.
  value&=mapper78Read(addr);
  mapper78PrgBank=mapperBankIndex(value&0x07,mapperBankCount(prgRom,0x4000));
  mapper78ChrBank=mapperBankIndex((value>>>4)&0x0f,mapperBankCount(CHR_ROM,0x2000));
  mapper78ApplyMirroring((value>>>3)&1);
}

function mapper78ChrRead(addr){
  return mapperReadBank(CHR_ROM,0x2000,mapper78ChrBank,addr&0x1fff);
}

function mapper78SaveState(){
  return new Uint8Array([
    1,
    mapper78PrgBank&0xff,
    mapper78ChrBank&0xff,
    mapper78HolyDiver?1:0,
    MIRRORING==='vertical'?0:MIRRORING==='horizontal'?1:MIRRORING==='single0'?2:3
  ]);
}

function mapper78LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<4||bytes[0]!==1)return false;
  mapper78PrgBank=bytes[1];
  mapper78ChrBank=bytes[2];
  mapper78HolyDiver=!!bytes[3];
  if(bytes.length>=5)
    MIRRORING=['vertical','horizontal','single0','single1'][bytes[4]&3];
  return true;
}
