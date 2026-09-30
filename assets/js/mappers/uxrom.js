// Mapper 2: UNROM/UOROM. NES 2.0 submapper 1 has no bus conflicts;
// submapper 2 has AND-type conflicts. Legacy/unspecified defaults to conflicts.
let uxromBank = 0;
let uxromBusConflicts = true;
function uxromInit(header) {
  uxromBank=0;
  uxromBusConflicts=!(headerVersion===2 && (header[8]>>4)===1);
}
function uxromRead(address) {
  const count=prgRom.length/0x4000;
  const bank=address<0xC000?uxromBank:count-1;
  return prgRom[bank*0x4000+(address&0x3FFF)];
}
function uxromWrite(address,value) {
  if(uxromBusConflicts) value&=uxromRead(address);
  uxromBank=value&((prgRom.length/0x4000)-1);
}


function uxromSaveState(){
  return new Uint8Array([1,uxromBank&0xff,uxromBusConflicts?1:0]);
}
function uxromLoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<2)return false;
  let o=bytes[0]===1?1:0;
  const banks=Math.max(1,(prgRom.length/0x4000)|0);
  uxromBank=(bytes[o++]||0)%banks;
  if(bytes.length>o)uxromBusConflicts=!!bytes[o];
  return true;
}
