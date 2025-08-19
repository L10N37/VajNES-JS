// --- NES Mapper 0 (NROM) ---
// Mirrors 16KB PRG up to 32KB, or just copies 32KB PRG as is
// Always ends up with a flat 32KB PRG-ROM region at $8000-$FFFF
// Sets the reset vector for the CPU. No header export, just does its job.


chrIsRAM = false;

function mapper(nesHeader) {
  const prgBanks = nesHeader[4]; // 1 or 2 usually
  const chrBanks = nesHeader[5];
  const prgSize = prgBanks * 0x4000;
  const chrSize = chrBanks * 0x2000;

  // Always use a flat 32KB buffer for PRG-ROM (code/data)
  let flatPrg = new Uint8Array(0x8000);

  if (!prgRom || prgRom.length < prgSize)
    throw new Error("ROM file too small for header PRG count");

  if (prgBanks === 1) {
    // 16KB PRG: Mirror into both halves ($8000-$BFFF and $C000-$FFFF)
    flatPrg.set(prgRom.slice(0, 0x4000), 0x0000); // $8000
    flatPrg.set(prgRom.slice(0, 0x4000), 0x4000); // $C000
    console.debug("[Mapper] Mirrored 16KB PRG into 32KB region ($8000-$FFFF)");
  } else if (prgBanks === 2) {
    // 32KB PRG: just copy
    flatPrg.set(prgRom.slice(0, 0x8000), 0x0000);
    console.debug("[Mapper] Loaded 32KB PRG as is ($8000-$FFFF)");
  } else {
    throw new Error(`Unexpected PRG-ROM bank count: ${prgBanks}`);
  }

  // Now prgRom global is always 32KB, always flat
  prgRom = flatPrg;

  // CHR-ROM stays untouched (already global), no further mapping for Mapper 0

  // --- Set CPU reset vector from $FFFC-$FFFD (last 4 bytes of PRG region)
  const lo = prgRom[0x7FFC];
  const hi = prgRom[0x7FFD];
  CPUregisters.PC = (hi << 8) | lo;
  console.debug(`[Mapper] Reset Vector: $${CPUregisters.PC.toString(16).toUpperCase().padStart(4, "0")}`);
  console.debug("PC @ 0x" + CPUregisters.PC.toString(16).padStart(4, "0").toUpperCase());
}
