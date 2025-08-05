// Helper: produce a hex dump string
function hexDumpToString(array, bytesPerRow = 16) {
  const hexPrefix = '0x';
  const totalRows = Math.ceil(array.length / bytesPerRow);
  const lines = [];
  for (let row = 0; row < totalRows; row++) {
    const offset = (row * bytesPerRow).toString(16).padStart(6, '0');
    const rowBytes = Array.from(
      array.slice(row * bytesPerRow, (row + 1) * bytesPerRow),
      b => hexPrefix + b.toString(16).padStart(2, '0')
    ).join(' ');
    lines.push(`${offset}: ${rowBytes}`);
  }
  return lines.join('\n');
}

// Attach download on the Dump button
document.getElementById('dumpState').addEventListener('click', () => {
  let dump = '';
  dump += '=== SYSTEM STATE DUMP ===\n\n';

  // 1) CPU Work RAM
  dump += '--- CPU Work RAM (systemMemory) ---\n';
  dump += hexDumpToString(systemMemory) + '\n\n';

  // 2) PPU VRAM
  dump += '--- PPU VRAM (systemMemoryVideo) ---\n';
  dump += hexDumpToString(systemMemoryVideo) + '\n\n';

  // 3) PPU Registers
  dump += '--- PPU Registers ---\n';
  for (const [k,v] of Object.entries(PPUregister)) {
    dump += `${k.padEnd(10)} : ${typeof v === 'number' 
      ? '0x' + v.toString(16).padStart(k==='VRAM_ADDR'?4:2,'0') 
      : v}\n`;
  }
  dump += '\n';

  // 4) CPU open bus & cycles
  dump += '--- CPU Open Bus & Cycles ---\n';
  dump += `cpuOpenBus: 0x${cpuOpenBus.toString(16).padStart(2,'0')}\n`;
  dump += `cpuCycles : ${cpuCycles}\n\n`;

  // 5) CPU Registers
  dump += '--- CPU Registers ---\n';
  dump += `A  : 0x${CPUregisters.A.toString(16).padStart(2,'0')}\n`;
  dump += `X  : 0x${CPUregisters.X.toString(16).padStart(2,'0')}\n`;
  dump += `Y  : 0x${CPUregisters.Y.toString(16).padStart(2,'0')}\n`;
  dump += `S  : 0x${CPUregisters.S.toString(16).padStart(2,'0')}\n`;
  dump += `PC : 0x${CPUregisters.PC.toString(16).padStart(4,'0')}\n\n`;

  // 6) CPU Flags
  dump += '--- CPU Status Flags ---\n';
  for (const [f,bit] of Object.entries(CPUregisters.P)) {
    dump += `${f.padEnd(2)} : ${bit}\n`;
  }
  dump += '\n';

  // 7) APU Registers
  dump += '--- APU Registers ---\n';
  for (const [k,v] of Object.entries(APUregister)) {
    dump += `${k.padEnd(12)} : 0x${v.toString(16).padStart(2,'0')}\n`;
  }
  dump += '\n';

  // 8) Controller State
  dump += '--- Controller State ---\n';
  dump += `joypadStrobe : ${joypadStrobe}\n`;
  dump += `joypad1State : 0b${joypad1State.toString(2).padStart(8,'0')}\n`;
  dump += `joypad2State : 0b${joypad2State.toString(2).padStart(8,'0')}\n`;

  // Create blob & prompt download
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
