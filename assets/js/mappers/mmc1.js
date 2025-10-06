// ================= MMC1 Mapper =================

let PRG_BANK_LO = new Uint8Array(0x4000);
let PRG_BANK_HI = new Uint8Array(0x4000);

let shiftRegister = 0;
let shiftCount    = 0;
const SHIFT_MASK  = 0b11111;

let mmc1Control   = 0x0C;
let mmc1CHR0      = 0;
let mmc1CHR1      = 0;
let mmc1PRG       = 0;
let prgRamEnable  = true;

let mmc1Debugging = true;

// ----------------------------------------------------
// Safe helper for index clamping
// ----------------------------------------------------
function safeBank(b, total) {
  return Math.max(0, Math.min(b | 0, (total - 1) | 0));
}

// ----------------------------------------------------
// PRG bank update (kept as window copies for simplicity)
// ----------------------------------------------------
function updatePRGBanks() {
  const prgMode = (mmc1Control >> 2) & 0x03;
  const totalBanks = prgRom.length / 0x4000;
  const lastBank = totalBanks - 1;

  // 32 KB mode (00 or 01)
  if (prgMode === 0 || prgMode === 1) {
    const bank = (mmc1PRG & ~1) % totalBanks;
    const next = (bank + 1) % totalBanks;
    for (let i = 0; i < 0x4000; i++) {
      PRG_BANK_LO[i] = prgRom[(bank * 0x4000) + i];
      PRG_BANK_HI[i] = prgRom[(next * 0x4000) + i];
    }
    if (mmc1Debugging) console.debug(`[MMC1] PRG=32KB mode, banks ${bank}/${next}`);
  }

  // 16 KB mode fix first bank at $8000 (10)
  else if (prgMode === 2) {
    const bank = mmc1PRG % totalBanks;
    for (let i = 0; i < 0x4000; i++) {
      PRG_BANK_LO[i] = prgRom[i];  // first 16 KB fixed
      PRG_BANK_HI[i] = prgRom[(bank * 0x4000) + i];
    }
    if (mmc1Debugging) console.debug(`[MMC1] PRG=16KB fix first=0, switch $C000=${bank}`);
  }

  // 16 KB mode fix last bank at $C000 (11)
  else if (prgMode === 3) {
    const bank = mmc1PRG % totalBanks;
    for (let i = 0; i < 0x4000; i++) {
      PRG_BANK_LO[i] = prgRom[(bank * 0x4000) + i];
      PRG_BANK_HI[i] = prgRom[(lastBank * 0x4000) + i];
    }
    if (mmc1Debugging) console.debug(`[MMC1] PRG=16KB switch $8000=${bank}, fix last=${lastBank}`);
  }
}

// ----------------------------------------------------
// CHR bank update (writes SAB **bank numbers**, not arrays)
// ----------------------------------------------------
function updateCHRBanks() {
  const totalBanks = (CHR_ROM.length / 0x1000) | 0; // banks of 4KB
  const chrMode = (mmc1Control >> 4) & 0x01;

  if (totalBanks <= 0) {
    // No CHR available; keep banks at 0
    CHR_BANK_LO = 0;
    CHR_BANK_HI = 0;
    if (mmc1Debugging) console.debug(`[MMC1] CHR: no banks`);
    return;
  }

  if (chrMode === 0) {
    // 8KB mode: CHR0 even bank => pair (bank, bank+1)
    const bank = safeBank(mmc1CHR0 & ~1, totalBanks);
    const next = safeBank(bank + 1, totalBanks);
    // Inform PPU worker via SAB-backed aliases (bank numbers)
    CHR_BANK_LO = bank;
    CHR_BANK_HI = next;
    if (mmc1Debugging) console.debug(`[MMC1] CHR=8KB pair banks ${bank}/${next}`);
  } else {
    // 4KB mode: independent banks
    const bank0 = safeBank(mmc1CHR0, totalBanks);
    const bank1 = safeBank(mmc1CHR1, totalBanks);
    CHR_BANK_LO = bank0;
    CHR_BANK_HI = bank1;
    if (mmc1Debugging) console.debug(`[MMC1] CHR=4KB banks ${bank0}/${bank1}`);
  }
}

// ----------------------------------------------------
// Control + shift register behavior
// ----------------------------------------------------
function mmc1ApplyControl() {
  switch (mmc1Control & 0x03) {
    case 0: MIRRORING = "single0";    break;
    case 1: MIRRORING = "single1";    break;
    case 2: MIRRORING = "vertical";   break;
    case 3: MIRRORING = "horizontal"; break;
  }
  if (mmc1Debugging) console.debug(`[MMC1] MIRRORING=${MIRRORING}`);
  updatePRGBanks();
  updateCHRBanks();
}

function mmc1ShiftWrite(callback, value) {
  // Reset condition
  if (value & 0x80) {
    shiftRegister = 0;
    shiftCount = 0;
    mmc1Control = 0x0C; // Default after reset: PRG mode 3, CHR 8KB
    updatePRGBanks();
    updateCHRBanks();
    if (mmc1Debugging) console.debug(`[MMC1 RESET]`);
    return;
  }

  // Serial load (LSB first)
  shiftRegister >>= 1;
  shiftRegister |= (value & 1) << 4;
  shiftCount++;

  if (shiftCount === 5) {
    callback(shiftRegister & SHIFT_MASK);
    shiftRegister = 0;
    shiftCount = 0;
  }
}

// ----------------------------------------------------
// Write targets
// ----------------------------------------------------
function mmc1WriteControl(addr, value) {
  mmc1ShiftWrite((val) => {
    mmc1Control = val & 0x1F;
    if (mmc1Debugging) console.debug(`[MMC1 LATCH] CONTROL=$${val.toString(16)}`);
    mmc1ApplyControl();
  }, value);
}

function mmc1WriteCHR0(addr, value) {
  mmc1ShiftWrite((val) => {
    mmc1CHR0 = val & 0x1F;
    if (mmc1Debugging) console.debug(`[MMC1 LATCH] CHR0=$${val.toString(16)}`);
    updateCHRBanks();
  }, value);
}

function mmc1WriteCHR1(addr, value) {
  mmc1ShiftWrite((val) => {
    mmc1CHR1 = val & 0x1F;
    if (mmc1Debugging) console.debug(`[MMC1 LATCH] CHR1=$${val.toString(16)}`);
    updateCHRBanks();
  }, value);
}

function mmc1WritePRG(addr, value) {
  mmc1ShiftWrite((val) => {
    mmc1PRG = val & 0x1F;

    // Bit 4 of PRG register disables SRAM when set
    prgRamEnable = ((mmc1PRG & 0x10) === 0);

    if (mmc1Debugging) {
      console.debug(`[MMC1 LATCH] PRG=$${val.toString(16)} | SRAM ${prgRamEnable ? "ENABLED" : "DISABLED"}`);
    }

    updatePRGBanks();
  }, value);
}

// ----------------------------------------------------
// CPU interface
// ----------------------------------------------------
function mmc1CpuWrite(addr, value) {
  if (addr < 0x8000) {
    if (addr >= 0x6000 && prgRamEnable) {
      prgRam[addr - 0x6000] = value & 0xFF;
      if (mmc1Debugging) console.debug(`[MMC1] PRG-RAM write $${addr.toString(16)} <= $${value.toString(16)}`);
    }
    return;
  }
  if (addr < 0xA000) mmc1WriteControl(addr, value);
  else if (addr < 0xC000) mmc1WriteCHR0(addr, value);
  else if (addr < 0xE000) mmc1WriteCHR1(addr, value);
  else mmc1WritePRG(addr, value);
}

function mmc1CpuRead(addr) {
  if (addr >= 0x6000 && addr < 0x8000)
    return prgRamEnable ? (prgRam[addr - 0x6000] & 0xFF) : 0xFF;

  if (addr >= 0x8000 && addr < 0xC000)
    return PRG_BANK_LO[addr - 0x8000] & 0xFF;

  if (addr >= 0xC000)
    return PRG_BANK_HI[addr - 0xC000] & 0xFF;

  return 0xFF;
}

// ----------------------------------------------------
// PPU-facing CHR interface (CPU-side helpers only)
// NOTE: PPU worker must NOT call these; it uses SAB bank numbers directly.
// ----------------------------------------------------
function mmc1ChrRead(addr14) {
  // Bank numbers are provided via SAB-backed aliases: CHR_BANK_LO / CHR_BANK_HI
  const bankLo = CHR_BANK_LO | 0;
  const bankHi = CHR_BANK_HI | 0;

  if (addr14 < 0x1000)
    return CHR_ROM[(bankLo << 12) + addr14] & 0xFF;

  return CHR_ROM[(bankHi << 12) + (addr14 - 0x1000)] & 0xFF;
}

function mmc1ChrWrite(addr14, value) {
  if (!chrIsRAM) return;

  const bankLo = CHR_BANK_LO | 0;
  const bankHi = CHR_BANK_HI | 0;

  if (addr14 < 0x1000)
    CHR_ROM[(bankLo << 12) + addr14] = value & 0xFF;
  else
    CHR_ROM[(bankHi << 12) + (addr14 - 0x1000)] = value & 0xFF;
}

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
function mmc1Init(prg, chr) {
  prgRom = prg;
  CHR_ROM = chr;

  if (!prgRam) prgRam = new Uint8Array(0x2000); // 8KB fallback

  shiftRegister = 0;
  shiftCount    = 0;
  mmc1Control   = 0x0C;  // PRG mode 3, CHR 8KB
  mmc1CHR0      = 0;
  mmc1CHR1      = 0;
  mmc1PRG       = 0;
  prgRamEnable  = true;

  // Initialize banks visible to the PPU (SAB bank numbers)
  CHR_BANK_LO = 0;
  CHR_BANK_HI = (CHR_ROM.length >= 0x2000) ? 1 : 0;

  updatePRGBanks();
  updateCHRBanks();

  if (mmc1Debugging) console.debug("[MMC1] Initialized");
}
