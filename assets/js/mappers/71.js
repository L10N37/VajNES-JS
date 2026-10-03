// Mapper 71: Camerica / Codemasters BF9093 and BF9097.
// Similar to UxROM: switchable 16 KiB at $8000-$BFFF, fixed last bank at
// $C000-$FFFF. BF9097 (NES 2.0 submapper 1) also supports one-screen
// mirroring control through $8000-$BFFF using bit 4.
//
// Standard BF9093 banking writes are decoded at $C000-$FFFF. The mapper has
// CHR RAM and no ordinary PRG-RAM window.
let mapper71Bank = 0;
let mapper71MirrorControl = false;

function mapper71Init(header) {
  mapper71Bank = 0;
  const nes2 = ((header[7] >> 2) & 3) === 2;
  mapper71MirrorControl = nes2 && ((header[8] >>> 4) === 1);
}

function mapper71Read(address) {
  const bankCount = Math.max(1, (prgRom.length / 0x4000) | 0);
  const bank = address < 0xC000 ? (mapper71Bank % bankCount) : (bankCount - 1);
  return prgRom[bank * 0x4000 + (address & 0x3FFF)] & 0xFF;
}

function mapper71Write(address, value) {
  address &= 0xFFFF;
  value &= 0xFF;

  if (mapper71MirrorControl && address >= 0x8000 && address < 0xC000) {
    MIRRORING = (value & 0x10) ? 'single1' : 'single0';
    return;
  }

  if (address >= 0xC000) {
    const bankCount = Math.max(1, (prgRom.length / 0x4000) | 0);
    mapper71Bank = (value & 0x0F) % bankCount;
  }
}

function mapper71SaveState() {
  return new Uint8Array([
    1,
    mapper71Bank & 0xFF,
    mapper71MirrorControl ? 1 : 0,
    MIRRORING === 'single1' ? 3 :
      MIRRORING === 'single0' ? 2 :
      MIRRORING === 'horizontal' ? 1 : 0
  ]);
}

function mapper71LoadState(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2) return false;
  let o = bytes[0] === 1 ? 1 : 0;
  const bankCount = Math.max(1, (prgRom.length / 0x4000) | 0);
  mapper71Bank = (bytes[o++] || 0) % bankCount;
  if (bytes.length > o) mapper71MirrorControl = !!bytes[o++];
  if (bytes.length > o) {
    MIRRORING = ['vertical','horizontal','single0','single1'][bytes[o] & 3];
  }
  return true;
}
