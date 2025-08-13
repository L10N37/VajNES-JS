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

// Pretty-print PPUregister (flat + BG block)
function dumpPPUregister(reg) {
  const lines = [];
  const hex8  = v => '$' + (v & 0xFF).toString(16).toUpperCase().padStart(2,'0');
  const hex16 = v => '$' + (v & 0xFFFF).toString(16).toUpperCase().padStart(4,'0');

  lines.push('CTRL      : ' + hex8(reg.CTRL));
  lines.push('MASK      : ' + hex8(reg.MASK));
  lines.push('STATUS    : ' + hex8(reg.STATUS));
  lines.push('OAMADDR   : ' + hex8(reg.OAMADDR));
  lines.push('SCROLL_X  : ' + hex8(reg.SCROLL_X));
  lines.push('SCROLL_Y  : ' + hex8(reg.SCROLL_Y));
  lines.push('ADDR_HIGH : ' + hex8(reg.ADDR_HIGH));
  lines.push('ADDR_LOW  : ' + hex8(reg.ADDR_LOW));
  lines.push('VRAM_ADDR : ' + hex16(reg.VRAM_ADDR));
  lines.push('t         : ' + hex16(reg.t));
  lines.push('fineX     : ' + String(reg.fineX));
  lines.push('writeToggle: ' + String(reg.writeToggle));
  lines.push('VRAM_DATA : ' + hex8(reg.VRAM_DATA));
  lines.push('BG: {');
  lines.push('  bgShiftLo: ' + hex16(reg.BG.bgShiftLo));
  lines.push('  bgShiftHi: ' + hex16(reg.BG.bgShiftHi));
  lines.push('  atShiftLo: ' + hex16(reg.BG.atShiftLo));
  lines.push('  atShiftHi: ' + hex16(reg.BG.atShiftHi));
  lines.push('  ntByte   : ' + hex8(reg.BG.ntByte));
  lines.push('  atByte   : ' + hex8(reg.BG.atByte));
  lines.push('  tileLo   : ' + hex8(reg.BG.tileLo));
  lines.push('  tileHi   : ' + hex8(reg.BG.tileHi));
  lines.push('}');
  return lines.join('\n');
}

document.getElementById('dumpState').addEventListener('click', () => {
  // Toggle giant logical PPU dump
  const includeFullPpuMap = false;

  let dump = '';
  dump += '=== SYSTEM STATE DUMP ===\n\n';

  // 1) CPU RAM (fixed base to $0000)
  dump += '--- CPU RAM (systemMemory, base $0000) ---\n';
  dump += hexDumpToString(systemMemory, 16, 0x0000) + '\n\n';

  // 2) PRG ROM (mapped typically at CPU $8000-$FFFF)
  dump += '--- PRG ROM (prgRom, base $8000) ---\n';
  if (typeof prgRom !== 'undefined' && prgRom && prgRom.length) {
    dump += hexDumpToString(prgRom, 16, 0x8000) + '\n\n';
  } else {
    dump += '[No PRG ROM]\n\n';
  }

  // 3) PPU Pattern Tables
  dump += '--- PPU Pattern Tables (CHR ROM/RAM, $0000–$1FFF) ---\n';
  if (SHARED.CHR_ROM && SHARED.CHR_ROM.length) {
    dump += hexDumpToString(SHARED.CHR_ROM, 16, 0x0000) + '\n\n';
  } else {
    dump += '[No CHR Data]\n\n';
  }

  // 4) VRAM physical ($2000 base)
  dump += '--- PPU VRAM Physical (SHARED.VRAM, base $2000) ---\n';
  dump += hexDumpToString(SHARED.VRAM, 16, 0x2000) + '\n\n';

  // 5) Palette RAM (print from SHARED.PALETTE_RAM directly)
  dump += '--- PPU Palette RAM (SHARED.PALETTE_RAM, $3F00–$3F1F) ---\n';
  if (SHARED.PALETTE_RAM && SHARED.PALETTE_RAM.length === 0x20) {
    dump += hexDumpToString(SHARED.PALETTE_RAM, 16, 0x3F00) + '\n\n';
  } else {
    // fallback: mirror from VRAM if SHARED.PALETTE_RAM not used
    const paletteData = [];
    for (let i = 0; i < 32; i++) {
      const vramIndex = (0x3F00 + i) & 0x07FF;
      paletteData.push(SHARED.VRAM[vramIndex]);
    }
    dump += hexDumpToString(paletteData, 16, 0x3F00) + '  [from VRAM mirror]\n\n';
  }

  // 6) PPU OAM
  dump += '--- PPU OAM (Sprite RAM, $0000–$00FF) ---\n';
  dump += hexDumpToString(PPU_OAM, 16, 0x0000) + '\n\n';

  // 7) (Optional) FULL logical PPU map — trimmed by default
  if (includeFullPpuMap) {
    const ppuMap = new Uint8Array(0x4000);
    const markers = new Array(0x4000).fill(false);

    if (SHARED.CHR_ROM && SHARED.CHR_ROM.length) {
      ppuMap.set(SHARED.CHR_ROM.slice(0, 0x2000), 0x0000);
    }
    for (let addr = 0x2000; addr <= 0x2FFF; addr++) {
      ppuMap[addr] = SHARED.VRAM[addr & 0x07FF];
    }
    for (let addr = 0x3000; addr <= 0x3EFF; addr++) {
      ppuMap[addr] = ppuMap[addr - 0x1000];
    }
    for (let i = 0; i < 0x20; i++) {
      const vramIndex = (0x3F00 + i) & 0x07FF;
      ppuMap[0x3F00 + i] = SHARED.VRAM[vramIndex];
      markers[0x3F00 + i] = true;
    }
    for (let addr = 0x3F20; addr <= 0x3FFF; addr++) {
      const val = ppuMap[0x3F00 + (addr & 0x1F)];
      ppuMap[addr] = val;
      markers[addr] = true;
    }
    dump += '--- FULL LOGICAL PPU ADDRESS SPACE ($0000–$3FFF, "*" = palette/mirror) ---\n';
    dump += hexDumpToString(ppuMap, 16, 0x0000, markers) + '\n\n';
  }

  // 8) PPU Registers
  dump += '--- PPU Registers ---\n';
  dump += dumpPPUregister(PPUregister) + '\n\n';

  // 9) CPU Bus / Cycles
  dump += '--- CPU Open Bus & Cycles ---\n';
  dump += `cpuOpenBus: $${cpuOpenBus.toString(16).toUpperCase().padStart(2,'0')} (last value on CPU data bus)\n`;
  dump += `cpuCycles : ${cpuCycles}\n\n`;

  // 10) CPU Registers
  dump += '--- CPU Registers ---\n';
  dump += `A  : $${CPUregisters.A.toString(16).toUpperCase().padStart(2,'0')}\n`;
  dump += `X  : $${CPUregisters.X.toString(16).toUpperCase().padStart(2,'0')}\n`;
  dump += `Y  : $${CPUregisters.Y.toString(16).toUpperCase().padStart(2,'0')}\n`;
  dump += `S  : $${CPUregisters.S.toString(16).toUpperCase().padStart(2,'0')}\n`;
  dump += `PC : $${CPUregisters.PC.toString(16).toUpperCase().padStart(4,'0')}\n\n`;

  // 11) CPU Flags
  dump += '--- CPU Status Flags ---\n';
  for (const [f,bit] of Object.entries(CPUregisters.P)) {
    dump += `${f.padEnd(2)} : ${bit}\n`;
  }
  dump += '\n';

  // 12) APU Registers
  dump += '--- APU Registers ---\n';
  for (const [k,v] of Object.entries(APUregister)) {
    dump += `${k.padEnd(12)} : $${v.toString(16).toUpperCase().padStart(2,'0')}\n`;
  }
  dump += '\n';

  // 13) Controllers
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
