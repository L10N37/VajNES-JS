// Mapper 7 (AMROM/ANROM/AOROM): 32 KiB PRG bank + one-screen CIRAM select.
// Legacy and NES 2.0 submapper 0/1 omit conflicts; submapper 2 ANDs ROM data.
let axromBank = 0;
let axromBusConflicts = false;
function axromInit(header) {
  axromBank=0;
  axromBusConflicts=headerVersion===2 && (header[8]>>>4)===2;
  MIRRORING='single0';
}
function axromRead(address) {
  return prgRom[axromBank*0x8000+(address&0x7fff)];
}
function axromWrite(address,value) {
  // Resolve conflicts against the old bank before changing either latch field.
  if(axromBusConflicts)value&=axromRead(address);
  axromBank=(value&7)&((prgRom.length/0x8000)-1);
  MIRRORING=value&0x10?'single1':'single0';
}
