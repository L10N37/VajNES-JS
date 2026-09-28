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
