// all mirroring logic here, prefer to not just see mirrors as a central location but to have the offsets actually populated
// removes clutter and confusion to have it centralised

// CPU RAM mirroring: $0100–$1FFF (2KB mirrored every $0800, but exclude Zero Page)
function mirrorCPURAMWrite(address, value) {
    const base = address & 0x07FF;
    // Write to all mirrors
    for (let offset = 0; offset < 0x2000; offset += 0x0800) {
      systemMemory[base + offset] = value;
    }
  }

// PPU register mirroring: $2000–$3FFF (every 8 bytes)
function mirrorPPURegisterWrite(address, value) {
  const base = 0x2000 + ((address - 0x2000) % 8);
  if (address === base) {
    // Writing to base: write to all mirrors except the base itself
    for (let offset = 8; offset <= 0x3FF8; offset += 8) {
      systemMemory[base + offset] = value;
    }
  } else {
    // Writing to a mirror: write value to the base only
    systemMemory[base] = value;
  }
}

function mirrorPPUPaletteWrite(address, value) {
  // Mirror address to base palette range
  let paletteAddr = 0x3F00 + ((address - 0x3F00) % 0x20);

  // Alias certain entries
  if ([0x10, 0x14, 0x18, 0x1C].includes(paletteAddr & 0x1F)) {
    // Write to base ($3F00/$3F04/$3F08/$3F0C) as well
    let aliasAddr = paletteAddr & ~0x10;
    if (paletteAddr !== aliasAddr) systemMemory[aliasAddr] = value;
  }

  if (address !== paletteAddr) {
    // Write to base palette RAM if this was a mirror
    systemMemory[paletteAddr] = value;
  } else {
    // Writing to base: mirror to all mirrors
    for (let offset = 0x20; offset < 0x1000; offset += 0x20) {
      systemMemory[paletteAddr + offset] = value;
    }
  }
}

function mirrorPPUNametableWrite(address, value) {
  // $2000–$2FFF are real, $3000–$3EFF mirrors $2000–$2EFF
  let baseAddr = address;
  if (address >= 0x3000 && address <= 0x3EFF) {
    baseAddr = address - 0x1000; // Mirror down
    systemMemory[baseAddr] = value;
    return;
  }
  // If writing to base ($2000–$2EFF): mirror to $3000–$3EFF
  if (address >= 0x2000 && address <= 0x2EFF) {
    systemMemory[address + 0x1000] = value;
  }
}
