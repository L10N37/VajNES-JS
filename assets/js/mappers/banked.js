// Additional cartridge boards used by common commercial NES games.
// Mapper 3 (CNROM), 9 (MMC2/PxROM), 10 (MMC4/FxROM),
// 11 (Color Dreams) and 66 (GxROM).
//
// All bank selections are kept against the full cartridge images loaded by
// readFile.js. Discrete boards emulate their ROM bus conflicts; MMC2/MMC4 do
// not have bus conflicts.

function mapperBankCount(bytes, bankSize) {
  return Math.max(1, Math.ceil(bytes.length / bankSize));
}
function mapperBankIndex(value, count) {
  value >>>= 0;
  return count ? value % count : 0;
}
function mapperReadBank(bytes, bankSize, bank, offset) {
  if (!bytes.length) return 0xFF;
  const count = mapperBankCount(bytes, bankSize);
  const b = mapperBankIndex(bank, count);
  return bytes[(b * bankSize + (offset % bankSize)) % bytes.length] & 0xFF;
}

// ---------------------------------------------------------------------------
// Mapper 3: CNROM
// ---------------------------------------------------------------------------
let cnromChrBank = 0;
let cnromBusConflicts = true;

function cnromInit(header) {
  cnromChrBank = 0;
  // NES 2.0: submapper 1 = no conflicts, 2 = AND-type conflicts.
  // Legacy iNES/default CNROM uses the original conflict behaviour.
  const sub = headerVersion === 2 ? (header[8] >>> 4) : 0;
  cnromBusConflicts = !(headerVersion === 2 && sub === 1);
}
function cnromRead(addr) {
  const off = (addr - 0x8000) & 0x7FFF;
  if (prgRom.length <= 0x4000) return prgRom[off & 0x3FFF] & 0xFF;
  return prgRom[off % prgRom.length] & 0xFF;
}
function cnromWrite(addr, value) {
  let v = value & 0xFF;
  if (cnromBusConflicts) v &= cnromRead(addr);
  cnromChrBank = mapperBankIndex(v, mapperBankCount(CHR_ROM, 0x2000));
}
function cnromChrRead(addr) {
  return mapperReadBank(CHR_ROM, 0x2000, cnromChrBank, addr & 0x1FFF);
}

// ---------------------------------------------------------------------------
// Mapper 11: Color Dreams
// ---------------------------------------------------------------------------
let colorDreamsPrgBank = 0;
let colorDreamsChrBank = 0;
function colorDreamsInit() {
  colorDreamsPrgBank = 0;
  colorDreamsChrBank = 0;
}
function colorDreamsRead(addr) {
  return mapperReadBank(prgRom, 0x8000, colorDreamsPrgBank, addr - 0x8000);
}
function colorDreamsWrite(addr, value) {
  // Discrete Color Dreams boards AND the write with the ROM byte.
  const v = (value & colorDreamsRead(addr)) & 0xFF;
  colorDreamsPrgBank = mapperBankIndex(v & 0x03, mapperBankCount(prgRom, 0x8000));
  colorDreamsChrBank = mapperBankIndex((v >>> 4) & 0x0F, mapperBankCount(CHR_ROM, 0x2000));
}
function colorDreamsChrRead(addr) {
  return mapperReadBank(CHR_ROM, 0x2000, colorDreamsChrBank, addr & 0x1FFF);
}

// ---------------------------------------------------------------------------
// Mapper 66: GxROM (GNROM/MHROM)
// ---------------------------------------------------------------------------
let gxromPrgBank = 0;
let gxromChrBank = 0;
function gxromInit() {
  gxromPrgBank = 0;
  gxromChrBank = 0;
}
function gxromRead(addr) {
  return mapperReadBank(prgRom, 0x8000, gxromPrgBank, addr - 0x8000);
}
function gxromWrite(addr, value) {
  // Standard GNROM/MHROM discrete boards have ROM bus conflicts.
  const v = (value & gxromRead(addr)) & 0xFF;
  gxromPrgBank = mapperBankIndex((v >>> 4) & 0x03, mapperBankCount(prgRom, 0x8000));
  gxromChrBank = mapperBankIndex(v & 0x03, mapperBankCount(CHR_ROM, 0x2000));
}
function gxromChrRead(addr) {
  return mapperReadBank(CHR_ROM, 0x2000, gxromChrBank, addr & 0x1FFF);
}


// ---------------------------------------------------------------------------
// Mapper 79: AVE NINA-03 / NINA-06
// ---------------------------------------------------------------------------
let nina79PrgBank = 0;
let nina79ChrBank = 0;

function nina79Init() {
  nina79PrgBank = 0;
  nina79ChrBank = 0;
}

function nina79RegisterSelected(addr) {
  // NINA-03/06 decode: 010x xxx1 xxxx xxxx
  return (addr & 0xE100) === 0x4100;
}

function nina79Write(addr, value) {
  if (!nina79RegisterSelected(addr)) return false;
  nina79PrgBank = mapperBankIndex((value >>> 3) & 0x01, mapperBankCount(prgRom, 0x8000));
  nina79ChrBank = mapperBankIndex(value & 0x07, mapperBankCount(CHR_ROM, 0x2000));
  return true;
}

function nina79Read(addr) {
  return mapperReadBank(prgRom, 0x8000, nina79PrgBank, addr - 0x8000);
}

function nina79ChrRead(addr) {
  return mapperReadBank(CHR_ROM, 0x2000, nina79ChrBank, addr & 0x1FFF);
}

// ---------------------------------------------------------------------------
// Mapper 9/10: Nintendo MMC2 / MMC4
// ---------------------------------------------------------------------------
let mmc24PrgBank = 0;
let mmc24ChrFD0 = 0, mmc24ChrFE0 = 0;
let mmc24ChrFD1 = 0, mmc24ChrFE1 = 0;
let mmc24Latch0 = 0xFE, mmc24Latch1 = 0xFE;

function mmc24Init() {
  mmc24PrgBank = 0;
  mmc24ChrFD0 = mmc24ChrFE0 = 0;
  mmc24ChrFD1 = mmc24ChrFE1 = 0;
  mmc24Latch0 = mmc24Latch1 = 0xFE;
}
function mmc24Read(addr) {
  addr &= 0xFFFF;
  if (mapperNumber === 9) {
    const count = mapperBankCount(prgRom, 0x2000);
    let bank;
    if (addr < 0xA000) bank = mmc24PrgBank;
    else bank = Math.max(0, count - 3) + ((addr - 0xA000) >>> 13);
    return mapperReadBank(prgRom, 0x2000, bank, addr & 0x1FFF);
  }
  // MMC4: selected 16 KiB at $8000, fixed last 16 KiB at $C000.
  const count = mapperBankCount(prgRom, 0x4000);
  const bank = addr < 0xC000 ? mmc24PrgBank : count - 1;
  return mapperReadBank(prgRom, 0x4000, bank, addr & 0x3FFF);
}
function mmc24Write(addr, value) {
  addr &= 0xFFFF;
  value &= 0xFF;
  switch (addr & 0xF000) {
    case 0xA000:
      mmc24PrgBank = mapperBankIndex(value & 0x0F,
        mapperBankCount(prgRom, mapperNumber === 9 ? 0x2000 : 0x4000));
      break;
    case 0xB000: mmc24ChrFD0 = value & 0x1F; break;
    case 0xC000: mmc24ChrFE0 = value & 0x1F; break;
    case 0xD000: mmc24ChrFD1 = value & 0x1F; break;
    case 0xE000: mmc24ChrFE1 = value & 0x1F; break;
    case 0xF000: MIRRORING = (value & 1) ? "horizontal" : "vertical"; break;
  }
}
function mmc24ChrRead(addr) {
  addr &= 0x1FFF;
  const upper = (addr & 0x1000) !== 0;
  const bank = upper
    ? (mmc24Latch1 === 0xFD ? mmc24ChrFD1 : mmc24ChrFE1)
    : (mmc24Latch0 === 0xFD ? mmc24ChrFD0 : mmc24ChrFE0);
  // Latches change only after the triggering pattern byte has been read.
  const out = mapperReadBank(CHR_ROM, 0x1000, bank, addr & 0x0FFF);

  if (!upper) {
    if (addr >= 0x0FD8 && addr <= 0x0FDF) mmc24Latch0 = 0xFD;
    else if (addr >= 0x0FE8 && addr <= 0x0FEF) mmc24Latch0 = 0xFE;
  } else {
    if (addr >= 0x1FD8 && addr <= 0x1FDF) mmc24Latch1 = 0xFD;
    else if (addr >= 0x1FE8 && addr <= 0x1FEF) mmc24Latch1 = 0xFE;
  }
  return out;
}

// Shared dispatch used by CPU and PPU paths.
function extraMapperReadPRG(addr) {
  switch (mapperNumber) {
    case 3: return cnromRead(addr);
    case 9:
    case 10: return mmc24Read(addr);
    case 11: return colorDreamsRead(addr);
    case 66: return gxromRead(addr);
    case 79: return nina79Read(addr);
    default: return null;
  }
}
function extraMapperWritePRG(addr, value) {
  switch (mapperNumber) {
    case 3: cnromWrite(addr,value); return true;
    case 9:
    case 10: mmc24Write(addr,value); return true;
    case 11: colorDreamsWrite(addr,value); return true;
    case 66: gxromWrite(addr,value); return true;
    default: return false;
  }
}
function cartridgeChrRead(addr) {
  addr &= 0x1FFF;
  switch (mapperNumber) {
    case 1: return mmc1ChrRead(addr) & 0xFF;
    case 3: return cnromChrRead(addr);
    case 4:
    case 118:
    case 119: return mapper4_chr_read(addr) & 0xFF;
    case 5: return mmc5ChrRead(addr,false) & 0xFF;
    case 9:
    case 10: return mmc24ChrRead(addr);
    case 11: return colorDreamsChrRead(addr);
    case 19:
    case 210: return namcoChrRead(addr);
    case 66: return gxromChrRead(addr);
    case 79: return nina79ChrRead(addr);
    case 24:
    case 26: return vrc6ChrRead(addr);
    case 69: return fme7ChrRead(addr);
    default: return CHR_ROM[addr % Math.max(1,CHR_ROM.length)] & 0xFF;
  }
}


function extraMapperMirrorCode(){
  return MIRRORING==='vertical'?0:MIRRORING==='horizontal'?1:MIRRORING==='single0'?2:3;
}
function extraMapperLoadMirror(code){
  MIRRORING=['vertical','horizontal','single0','single1'][code&3];
}
function extraMapperSaveState(mapperId=mapperNumber){
  switch(mapperId|0){
    case 3:return new Uint8Array([1,cnromChrBank&0xff,cnromBusConflicts?1:0]);
    case 9:case 10:return new Uint8Array([1,mmc24PrgBank&0xff,mmc24ChrFD0&0xff,mmc24ChrFE0&0xff,
      mmc24ChrFD1&0xff,mmc24ChrFE1&0xff,mmc24Latch0&0xff,mmc24Latch1&0xff,extraMapperMirrorCode()]);
    case 11:return new Uint8Array([1,colorDreamsPrgBank&0xff,colorDreamsChrBank&0xff]);
    case 66:return new Uint8Array([1,gxromPrgBank&0xff,gxromChrBank&0xff]);
    case 79:return new Uint8Array([1,nina79PrgBank&0xff,nina79ChrBank&0xff]);
    default:return new Uint8Array(0);
  }
}
function extraMapperLoadState(mapperId,bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length)return false;
  let o=bytes[0]===1?1:0;
  switch(mapperId|0){
    case 3:
      cnromChrBank=mapperBankIndex(bytes[o++]||0,mapperBankCount(CHR_ROM,0x2000));
      if(bytes.length>o)cnromBusConflicts=!!bytes[o];
      return true;
    case 9:case 10:
      if(bytes.length<o+7)return false;
      mmc24PrgBank=bytes[o++];mmc24ChrFD0=bytes[o++];mmc24ChrFE0=bytes[o++];
      mmc24ChrFD1=bytes[o++];mmc24ChrFE1=bytes[o++];mmc24Latch0=bytes[o++];mmc24Latch1=bytes[o++];
      if(bytes.length>o)extraMapperLoadMirror(bytes[o]);
      return true;
    case 11:colorDreamsPrgBank=bytes[o++]||0;colorDreamsChrBank=bytes[o++]||0;return true;
    case 66:gxromPrgBank=bytes[o++]||0;gxromChrBank=bytes[o++]||0;return true;
    case 79:nina79PrgBank=bytes[o++]||0;nina79ChrBank=bytes[o++]||0;return true;
  }
  return false;
}
