// Mapper 206: Namco 108 / Tengen MIMIC-1 (DxROM family).
// Simplified predecessor of MMC3: fixed PRG/CHR modes, no IRQ, no mapper
// mirroring control, and no normal PRG-RAM.
//
// Registers are selected by writes to $8000-$9FFE even and populated by
// $8001-$9FFF odd. Address decoding mirrors through $FFFF via mask $E001.

let mapper206Select = 0;
const mapper206Regs = new Uint8Array(8);
let mapper206Unbanked32 = false;

function mapper206Init(header) {
  mapper206Select = 0;
  mapper206Regs.fill(0);
  mapper206Regs[6] = 0;
  mapper206Regs[7] = 1;

  // NES 2.0 submapper 1 denotes the 3407/3417/3451-style 32 KiB boards
  // whose PRG ROM is wired directly rather than through the bank outputs.
  const nes2 = ((header[7] >> 2) & 3) === 2;
  const submapper = nes2 ? (header[8] >>> 4) : 0;
  mapper206Unbanked32 = submapper === 1 && prgRom.length === 0x8000;
}

function mapper206Write(addr, value) {
  addr &= 0xffff;
  value &= 0xff;

  switch (addr & 0xe001) {
    case 0x8000:
      mapper206Select = value & 7;
      return true;

    case 0x8001: {
      const reg = mapper206Select & 7;
      if (reg <= 1) mapper206Regs[reg] = value & 0x3e;
      else if (reg <= 5) mapper206Regs[reg] = value & 0x3f;
      else mapper206Regs[reg] = value & 0x0f;
      return true;
    }
  }

  return false;
}

function mapper206PrgRead(addr) {
  addr &= 0xffff;

  if (mapper206Unbanked32)
    return prgRom[(addr - 0x8000) & 0x7fff] & 0xff;

  const bankSize = 0x2000;
  const bankCount = Math.max(1, Math.ceil(prgRom.length / bankSize));
  const last = bankCount - 1;
  const secondLast = Math.max(0, bankCount - 2);

  let bank;
  if (addr < 0xa000) bank = mapper206Regs[6] & 0x0f;
  else if (addr < 0xc000) bank = mapper206Regs[7] & 0x0f;
  else if (addr < 0xe000) bank = secondLast;
  else bank = last;

  bank %= bankCount;
  return prgRom[bank * bankSize + (addr & 0x1fff)] & 0xff;
}

function mapper206ChrRead(addr) {
  addr &= 0x1fff;

  let bank;
  if (addr < 0x0800)
    bank = (mapper206Regs[0] & 0x3e) + ((addr >>> 10) & 1);
  else if (addr < 0x1000)
    bank = (mapper206Regs[1] & 0x3e) + (((addr - 0x0800) >>> 10) & 1);
  else
    bank = mapper206Regs[2 + ((addr - 0x1000) >>> 10)] & 0x3f;

  const bankCount = Math.max(1, Math.ceil(CHR_ROM.length / 0x400));
  bank %= bankCount;
  return CHR_ROM[bank * 0x400 + (addr & 0x3ff)] & 0xff;
}

function mapper206SaveState() {
  const out = new Uint8Array(11);
  out[0] = 1;
  out[1] = mapper206Select & 7;
  out.set(mapper206Regs, 2);
  out[10] = mapper206Unbanked32 ? 1 : 0;
  return out;
}

function mapper206LoadState(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 10 || bytes[0] !== 1)
    return false;
  mapper206Select = bytes[1] & 7;
  mapper206Regs.set(bytes.subarray(2, 10));
  if (bytes.length > 10) mapper206Unbanked32 = !!bytes[10];
  return true;
}
