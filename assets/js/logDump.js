// Helper: produce a hex dump string with custom base address, optional marker array
function hexDumpToString(array, bytesPerRow = 16, baseAddress = 0x0000, markers = null) {
  const lines = [];
  const totalRows = Math.ceil(array.length / bytesPerRow);
  for (let row = 0; row < totalRows; row++) {
    const offset = (baseAddress + (row * bytesPerRow))
      .toString(16).toUpperCase()
      .padStart(4, '0');
    const rowBytes = Array.from(
      array.slice(row * bytesPerRow, (row + 1) * bytesPerRow),
      (b, idx) => {
        const mark = markers && markers[row * bytesPerRow + idx] ? '*' : ' ';
        return mark + '$' + b.toString(16).padStart(2, '0').toUpperCase();
      }
    ).join(' ');
    lines.push(`${offset}: ${rowBytes}`);
  }
  return lines.join('\n');
}

// Build full logical PPU address space $0000–$3FFF, returns {map, markers}
function buildFullPpuMapWithMarkers() {
  const ppuMap = new Uint8Array(0x4000);
  const markers = new Array(0x4000).fill(false);

  // $0000–$1FFF: Pattern tables
  if (chrRom && chrRom.length) {
    ppuMap.set(chrRom.slice(0, 0x2000), 0x0000);
  }

  // $2000–$2FFF: Nametable VRAM
  for (let addr = 0x2000; addr <= 0x2FFF; addr++) {
    ppuMap[addr] = systemMemoryVideo[addr & 0x07FF];
  }

  // $3000–$3EFF: Mirrors of $2000–$2EFF
  for (let addr = 0x3000; addr <= 0x3EFF; addr++) {
    ppuMap[addr] = ppuMap[addr - 0x1000];
  }

  // $3F00–$3F1F: Palette RAM (mirrored in VRAM)
  for (let i = 0; i < 0x20; i++) {
    const vramIndex = (0x3F00 + i) & 0x07FF;
    ppuMap[0x3F00 + i] = systemMemoryVideo[vramIndex];
    markers[0x3F00 + i] = true; // Mark palette bytes
  }

  // $3F20–$3FFF: Palette mirrors
  for (let addr = 0x3F20; addr <= 0x3FFF; addr++) {
    const val = ppuMap[0x3F00 + (addr & 0x1F)];
    ppuMap[addr] = val;
    markers[addr] = true; // Mark as palette mirror
  }

  return { ppuMap, markers };
}

document.getElementById('dumpState').addEventListener('click', () => {
  let dump = '';
  dump += '=== SYSTEM STATE DUMP ===\n\n';

  // 1) CPU Work RAM
  dump += '--- CPU Work RAM (systemMemory, base $8000) ---\n';
  dump += hexDumpToString(systemMemory, 16, 0x8000) + '\n\n';

  // 2) PPU Pattern Tables
  dump += '--- PPU Pattern Tables (CHR ROM/RAM, $0000–$1FFF) ---\n';
  if (chrRom && chrRom.length) {
    dump += hexDumpToString(chrRom, 16, 0x0000) + '\n\n';
  } else {
    dump += '[No CHR Data]\n\n';
  }

  // 3) VRAM physical
  dump += '--- PPU VRAM Physical (systemMemoryVideo, base $2000) ---\n';
  dump += hexDumpToString(systemMemoryVideo, 16, 0x2000) + '\n\n';

  // 4) Palette RAM
  dump += '--- PPU Palette RAM ($3F00–$3F1F, mirrored; actual storage in systemMemoryVideo) ---\n';
  const paletteData = [];
  for (let i = 0; i < 32; i++) {
    const vramIndex = (0x3F00 + i) & 0x07FF;
    paletteData.push(systemMemoryVideo[vramIndex]);
  }
  dump += hexDumpToString(paletteData, 16, 0x3F00) + '\n\n';

  // 5) PPU OAM
  dump += '--- PPU OAM (Sprite RAM, $0000–$00FF) ---\n';
  dump += hexDumpToString(PPU_OAM, 16, 0x0000) + '\n\n';

  // 6) Full logical PPU map
  dump += '--- FULL LOGICAL PPU ADDRESS SPACE ($0000–$3FFF, "*" = palette/mirror) ---\n';
  const { ppuMap, markers } = buildFullPpuMapWithMarkers();
  dump += hexDumpToString(ppuMap, 16, 0x0000, markers) + '\n\n';

  // 7) PPU Registers
  dump += '--- PPU Registers ---\n';
  for (const [k,v] of Object.entries(PPUregister)) {
    dump += `${k.padEnd(10)} : ${typeof v === 'number' 
      ? '$' + v.toString(16).toUpperCase().padStart(k==='VRAM_ADDR'?4:2,'0') 
      : v}\n`;
  }
  dump += '\n';

  // 8) CPU Bus / Cycles
  dump += '--- CPU Open Bus & Cycles ---\n';
  dump += `cpuOpenBus: $${cpuOpenBus.toString(16).toUpperCase().padStart(2,'0')} (last value on CPU data bus)\n`;
  dump += `cpuCycles : ${cpuCycles}\n\n`;

  // 9) CPU Registers
  dump += '--- CPU Registers ---\n';
  dump += `A  : $${CPUregisters.A.toString(16).toUpperCase().padStart(2,'0')}\n`;
  dump += `X  : $${CPUregisters.X.toString(16).toUpperCase().padStart(2,'0')}\n`;
  dump += `Y  : $${CPUregisters.Y.toString(16).toUpperCase().padStart(2,'0')}\n`;
  dump += `S  : $${CPUregisters.S.toString(16).toUpperCase().padStart(2,'0')}\n`;
  dump += `PC : $${CPUregisters.PC.toString(16).toUpperCase().padStart(4,'0')}\n\n`;

  // 10) CPU Flags
  dump += '--- CPU Status Flags ---\n';
  for (const [f,bit] of Object.entries(CPUregisters.P)) {
    dump += `${f.padEnd(2)} : ${bit}\n`;
  }
  dump += '\n';

  // 11) APU Registers
  dump += '--- APU Registers ---\n';
  for (const [k,v] of Object.entries(APUregister)) {
    dump += `${k.padEnd(12)} : $${v.toString(16).toUpperCase().padStart(2,'0')}\n`;
  }
  dump += '\n';

  // 12) Controllers
  dump += '--- Controller State ---\n';
  dump += `joypadStrobe : ${joypadStrobe}\n`;
  dump += `joypad1State : 0b${joypad1State.toString(2).padStart(8,'0')}\n`;
  dump += `joypad2State : 0b${joypad2State.toString(2).padStart(8,'0')}\n`;

  // Create blob & download
  const blob = new Blob([dump], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `nes_state_dump_${Date.now()}.txt`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
