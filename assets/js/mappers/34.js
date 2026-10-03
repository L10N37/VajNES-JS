// Mapper 34: Nintendo BNROM / AVE NINA-001.
// iNES mapper 34 is overloaded:
//   - CHR RAM carts: BNROM/BxROM, 32 KiB PRG bank selected by writes >= $8000.
//   - CHR ROM carts: AVE NINA-001, PRG bank at $7FFD and 4 KiB CHR banks
//     at $7FFE/$7FFF, with 8 KiB WRAM at $6000-$7FFC.
//
// BNROM uses discrete ROM bus conflicts. NINA-001 does not.
let mapper34Mode = 'bnrom';
let mapper34PrgBank = 0;
let mapper34Chr0 = 0;
let mapper34Chr1 = 1;

function mapper34Init(header) {
  mapper34Mode = header[5] ? 'nina' : 'bnrom';
  mapper34PrgBank = 0;
  mapper34Chr0 = 0;
  mapper34Chr1 = 1;
  chrIsRAM = mapper34Mode === 'bnrom';
}

function mapper34Read(address) {
  const bankCount = Math.max(1, Math.ceil(prgRom.length / 0x8000));
  const bank = mapper34PrgBank % bankCount;
  return prgRom[bank * 0x8000 + ((address - 0x8000) & 0x7FFF)] & 0xFF;
}

function mapper34Write(address, value) {
  address &= 0xFFFF;
  value &= 0xFF;

  if (mapper34Mode === 'nina') {
    if (address === 0x7FFD) {
      mapper34PrgBank = value;
      return true;
    }
    if (address === 0x7FFE) {
      mapper34Chr0 = value;
      return true;
    }
    if (address === 0x7FFF) {
      mapper34Chr1 = value;
      return true;
    }
    if (address >= 0x8000) {
      mapper34PrgBank = value;
      return true;
    }
    return false;
  }

  if (address >= 0x8000) {
    // BNROM/BxROM discrete boards have ROM bus conflicts.
    const effective = value & mapper34Read(address);
    const bankCount = Math.max(1, Math.ceil(prgRom.length / 0x8000));
    mapper34PrgBank = effective % bankCount;
    return true;
  }
  return false;
}

function mapper34ChrRead(address) {
  address &= 0x1FFF;
  if (mapper34Mode !== 'nina')
    return CHR_ROM[address] & 0xFF;

  const bank = address < 0x1000 ? mapper34Chr0 : mapper34Chr1;
  const bankCount = Math.max(1, Math.ceil(CHR_ROM.length / 0x1000));
  const b = bank % bankCount;
  return CHR_ROM[b * 0x1000 + (address & 0x0FFF)] & 0xFF;
}

function mapper34SaveState() {
  return new Uint8Array([
    1,
    mapper34Mode === 'nina' ? 1 : 0,
    mapper34PrgBank & 0xFF,
    mapper34Chr0 & 0xFF,
    mapper34Chr1 & 0xFF
  ]);
}

function mapper34LoadState(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return false;
  let o = bytes[0] === 1 ? 1 : 0;
  mapper34Mode = bytes[o++] ? 'nina' : 'bnrom';
  mapper34PrgBank = bytes[o++] || 0;
  mapper34Chr0 = bytes[o++] || 0;
  mapper34Chr1 = bytes.length > o ? bytes[o] : 1;
  chrIsRAM = mapper34Mode === 'bnrom';
  return true;
}
