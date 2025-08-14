ppuDebugLogging = true;

function checkReadOffset(address) {
  const addr = address & 0xFFFF;
  let value;

  if (addr < 0x2000) { // CPU RAM
    value = cpuRead(addr);
    // no logging
  }
  else if (addr < 0x4000) { // PPU registers (mirrored every 8)
    value = ppuRead(addr);

    if (ppuDebugLogging) {
      const base = 0x2000 + (addr & 0x0007);
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      const pcH = h16(CPUregisters.PC);
      switch (base) {
        case 0x2002: console.log(`[$2002 PPUSTATUS R] PC=${pcH} -> ${h8(value)} (vblank=${(value>>>7)&1})`); break;
        case 0x2007: console.log(`[$2007 PPUDATA   R] PC=${pcH} -> ${h8(value)}`); break;
        default:     console.log(`[PPU R] ${h16(base)} -> ${h8(value)}`); break;
      }
    }
  }
  else if (addr < 0x4020) { // APU & I/O
    value = apuRead(addr);

    if (debugLogging) {
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      if (addr === 0x4015) {
        console.log(`[APU $4015 R] -> ${h8(value)}`);
      } else if (addr === 0x4016 || addr === 0x4017) {
        console.log(`[CTRL ${h16(addr)} R] -> ${h8(value)}`);
      } else {
        console.log(`[APU/IO R] ${h16(addr)} -> ${h8(value)}`);
      }
    }
  }
  else if (addr < 0x6000) { // Expansion
    return cpuOpenBus & 0xFF;
    
  }
  else if (addr >= 0x8000 && addr <= 0xFFFF) { // PRG-ROM
    value = prgRom[addr - 0x8000];
    
  }
  else {
    return cpuOpenBus & 0xFF;
    
  }

  cpuOpenBus = value & 0xFF;
  return value & 0xFF;
}

function checkWriteOffset(address, value) {
  const addr = address & 0xFFFF;
  value = value & 0xFF; // enforce 8-bit

  if (addr < 0x2000) { // CPU RAM
    cpuWrite(addr, value);
    // no logging
  }
  else if (addr < 0x4000) { // PPU registers
    if (ppuDebugLogging) {
      const base = 0x2000 + (addr & 0x0007);
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      switch (base) {

        case 0x2000: console.log(`[$2000 PPUCTRL   W] ${h8(value)}`); break;
        case 0x2001: console.log(`[$2001 PPUMASK   W] ${h8(value)}`); break;
        case 0x2003: console.log(`[$2003 OAMADDR   W] ${h8(value)}`); break;
        case 0x2004: console.log(`[$2004 OAMDATA   W] ${h8(value)}`); break;
        case 0x2005: console.log(`[$2005 PPUSCROLL W] ${h8(value)} (toggle)`); break;
        case 0x2006: console.log(`[$2006 PPUADDR   W] ${h8(value)} (toggle)`); break;
        case 0x2007: console.log(`[$2007 PPUDATA   W] ${h8(value)}`); break;
        default:     console.log(`[PPU W] ${h16(base)} <= ${h8(value)}`); break;
      }
    }
    ppuWrite(addr, value);
  }
  else if (addr === 0x4014) { // OAM DMA (PPU-related, keep logging)
    if (ppuDebugLogging) {
      const h8  = v => "0x" + (v & 0xFF).toString(16).padStart(2, "0");
      const h16 = v => "0x" + (v & 0xFFFF).toString(16).padStart(4, "0");
      console.log(`[OAMDMA $4014 W] page=${h8(value)} src=${h16(value<<8)}..${h16((value<<8)|0xFF)}`);
    }
    dmaTransfer(value);
  }
  else if (addr < 0x4020) { // APU & I/O
    // writes are NOT logged per request
    apuWrite(addr, value);
  }
  else if (addr < 0x6000) { // Expansion
    cpuOpenBus = value & 0xFF; // not handled, still write value to openBus
    
  }
  else if (addr < 0x8000) { // PRG-RAM
    prgRam[addr - 0x6000] = value;
    
  }
  else if (addr <= 0xFFFF) { // PRG-ROM (test harness may poke here)
    prgRom[addr - 0x8000] = value;
    
  }

  cpuOpenBus = value & 0xFF;
}

// --- CPU writes to PPU registers ---
function ppuWrite(addr, value) {
  addr &= 0x3FFF;
  if (addr >= 0x2000 && addr < 0x4000) addr = 0x2000 + (addr & 0x7);
  value &= 0xFF;

  switch (addr) {
    case 0x2000: { // PPUCTRL
      PPUCTRL = value;
      // t = (t & 0xF3FF) | ((value & 0x03) << 10)
      let t = ((t_hi << 8) | t_lo) & 0xFFFF;
      t = (t & 0xF3FF) | ((value & 0x03) << 10);
      t_hi = (t >>> 8) & 0xFF;
      t_lo = t & 0xFF;
      break;
    }
    case 0x2001: { // PPUMASK
      PPUMASK = value;
      break;
    }
    case 0x2003: { // OAMADDR
      OAMADDR = value;
      break;
    }
    case 0x2004: { // OAMDATA
      OAM[OAMADDR] = value & 0xFF;
      OAMADDR = (OAMADDR + 1) & 0xFF;
      break;
    }
    case 0x2005: { // PPUSCROLL
      let t = ((t_hi << 8) | t_lo) & 0xFFFF;
      if ((writeToggle & 1) === 0) {
        // First write: fine X + coarse X
        SCROLL_X = value & 0xFF;
        fineX = value & 0x07;
        t = (t & ~0x001F) | ((value >>> 3) & 0x1F);
      } else {
        // Second write: fine Y + coarse Y
        SCROLL_Y = value & 0xFF;
        t = (t & ~(0x7000 | 0x03E0))
          | ((value & 0x07) << 12)
          | (((value >>> 3) & 0x1F) << 5);
      }
      t_hi = (t >>> 8) & 0xFF;
      t_lo = t & 0xFF;
      writeToggle = (writeToggle ^ 1) & 0xFF;
      break;
    }
    case 0x2006: { // PPUADDR
      let t = ((t_hi << 8) | t_lo) & 0xFFFF;
      if ((writeToggle & 1) === 0) {
        ADDR_HIGH = value & 0xFF;
        t = (t & 0x00FF) | ((value & 0x3F) << 8);
      } else {
        ADDR_LOW = value & 0xFF;
        t = (t & 0x7F00) | (value & 0xFF);
        VRAM_ADDR = t & 0x3FFF;
      }
      t_hi = (t >>> 8) & 0xFF;
      t_lo = t & 0xFF;
      writeToggle = (writeToggle ^ 1) & 0xFF;
      break;
    }
    case 0x2007: { // PPUDATA
      ppuBusWrite(VRAM_ADDR & 0x3FFF, value & 0xFF);
      const step = (PPUCTRL & 0x04) ? 32 : 1;
      VRAM_ADDR = (VRAM_ADDR + step) & 0x3FFF;
      break;
    }
  }
}

// --- CPU reads from PPU registers ---
function ppuRead(addr) {
  addr &= 0x3FFF;
  if (addr >= 0x2000 && addr < 0x4000) addr = 0x2000 + (addr & 0x7);

  switch (addr) {
    case 0x2002: { // PPUSTATUS
      const val = PPUSTATUS & 0xFF;
      // clear VBlank bit on read
      PPUSTATUS = val & ~0x80;
      writeToggle = 0; // reset toggle
      return val;
    }
    case 0x2004: { // OAMDATA
      return OAM[OAMADDR & 0xFF] & 0xFF;
    }
    case 0x2007: { // PPUDATA
          const addrVRAM = VRAM_ADDR & 0x3FFF;
          let ret;
          if (addrVRAM < 0x3F00) {
            ret = VRAM_DATA & 0xFF;                 // buffered read
            VRAM_DATA = ppuBusRead(addrVRAM) & 0xFF; // refresh buffer
          } else {
            ret = ppuBusRead(addrVRAM) & 0xFF;       // palette reads are not buffered
            VRAM_DATA = ppuBusRead((addrVRAM - 0x1000) & 0x3FFF) & 0xFF;
          }
          const step = (PPUCTRL & 0x04) ? 32 : 1;
          VRAM_ADDR = (VRAM_ADDR + step) & 0x3FFF;
          return ret & 0xFF;
        }
      }

  return cpuOpenBus;
}

// Raw PPU memory fetch (no $2007 buffering rules here)
// $0000–$1FFF: pattern tables (CHR)
// $2000–$2FFF: nametables (VRAM, mirrored to $3EFF)
// $3F00–$3F1F: palette RAM (with $3F10/$14/$18/$1C mirroring)

/*
function ppuBusRead(addr) {
  addr &= 0x3FFF;

  // Pattern tables
  if (addr < 0x2000) {
    return CHR_ROM[addr] & 0xFF;
  }

  // Palette RAM + mirrors
  if (addr >= 0x3F00) {
    let pal = addr & 0x1F;
    // $3F10,14,18,1C mirror $3F00,04,08,0C
    if ((pal & 0x13) === 0x10) pal &= ~0x10;
    return PALETTE_RAM[pal] & 0x3F; // palette uses 6 bits
  }

  // Nametables (2 KB, mirrored every 2 KB over $2000–$2FFF)
  return VRAM[(addr - 0x2000) & 0x07FF] & 0xFF;
}
*/

// --- PPU bus write ---
// Raw PPU memory store (no $2007 buffering rules here)
function ppuBusWrite(addr, value) {
  addr  &= 0x3FFF;
  value &= 0xFF;

  // Pattern tables (CHR): only writable if CHR is RAM
  if (addr < 0x2000) {
    if (typeof chrIsRAM !== "undefined" && chrIsRAM) {
      CHR_ROM[addr] = value & 0xFF;
    }
    return;
  }

  // Palette RAM + mirrors
  if (addr >= 0x3F00) {
    let pal = addr & 0x1F;
    // $3F10,14,18,1C mirror $3F00,04,08,0C
    if ((pal & 0x13) === 0x10) pal &= ~0x10;

    const palVal = value & 0x3F; // 6-bit color
    PALETTE_RAM[pal] = palVal;

    if (ppuDebugLogging) {
      const type = pal < 0x10 ? "BG" : "SPR";
      const slot = pal % 4;
      console.log(
        `[PPU PALETTE W] ${type} palette ${Math.floor(pal / 4)}, colour ${slot} ` +
        `($${(0x3F00 + pal).toString(16).toUpperCase().padStart(4, "0")}) <= ` +
        `$${palVal.toString(16).toUpperCase().padStart(2, "0")}`
      );
    }
    return;
  }

  // Nametables (2 KB, mirrored)
  VRAM[(addr - 0x2000) & 0x07FF] = value & 0xFF;
}

function cpuRead(addr) {
              // fold mirrors to base
  let val = systemMemory[addr & 0x7FF];
  cpuOpenBus = val;
  return val;
}
function cpuWrite(addr, value) {
  systemMemory[addr & 0x7FF] = value & 0xFF;
  cpuOpenBus = value & 0xFF;
}

// --- APU Write Handler ---
// Handles all writes to $4000-$4017 (excluding $4014, which is DMA and handled separately in offsetsHandler.js)
function apuWrite(address, value) {
  switch (address) {
    // --- Square 1 Registers ---
    case 0x4000: APUregister.SQ1_VOL = value;   cpuOpenBus = value & 0xFF;; break;
    case 0x4001: APUregister.SQ1_SWEEP = value; cpuOpenBus = value & 0xFF;; break;
    case 0x4002: APUregister.SQ1_LO = value;    cpuOpenBus = value & 0xFF;; break;
    case 0x4003: APUregister.SQ1_HI = value;    cpuOpenBus = value & 0xFF;; break;

    // --- Square 2 Registers ---
    case 0x4004: APUregister.SQ2_VOL = value;   cpuOpenBus = value & 0xFF;; break;
    case 0x4005: APUregister.SQ2_SWEEP = value; cpuOpenBus = value & 0xFF;; break;
    case 0x4006: APUregister.SQ2_LO = value;    cpuOpenBus = value & 0xFF;; break;
    case 0x4007: APUregister.SQ2_HI = value;    cpuOpenBus = value & 0xFF;; break;

    // --- Triangle Channel Registers ---
    case 0x4008: APUregister.TRI_LINEAR = value; cpuOpenBus = value & 0xFF;; break;
    case 0x400A: APUregister.TRI_LO = value;     cpuOpenBus = value & 0xFF;; break;
    case 0x400B: APUregister.TRI_HI = value;     cpuOpenBus = value & 0xFF;; break;

    // --- Noise Channel Registers ---
    case 0x400C: APUregister.NOISE_VOL = value;  cpuOpenBus = value & 0xFF;; break;
    case 0x400E: APUregister.NOISE_LO = value;   cpuOpenBus = value & 0xFF;; break;
    case 0x400F: APUregister.NOISE_HI = value;   cpuOpenBus = value & 0xFF;; break;

    // --- DMC Channel Registers ---
    case 0x4010: APUregister.DMC_FREQ = value;   cpuOpenBus = value & 0xFF;; break;
    case 0x4011: APUregister.DMC_RAW = value;    cpuOpenBus = value & 0xFF;; break;
    case 0x4012: APUregister.DMC_START = value;  cpuOpenBus = value & 0xFF;; break;
    case 0x4013: APUregister.DMC_LEN = value;    cpuOpenBus = value & 0xFF;; break;

    // --- Sound Channel Enable / Status ---
    case 0x4015: APUregister.SND_CHN = value;    cpuOpenBus = value & 0xFF;; break;

    // --- APU Frame Counter ($4017) ---
    case 0x4017: APUregister.FRAME_CNT = value;  cpuOpenBus = value & 0xFF;; break;

    // --- Controller Strobe ($4016) ---
    case 0x4016: 
      // This is a dual-purpose register: writing here controls joypad strobe (handled in controller.js),
      // but writing still updates open bus (needed for test ROMs).
      cpuOpenBus = value & 0xFF;;
      // If you want to call your joypadWrite here:
      if (typeof joypadWrite === 'function') joypadWrite(address, value);
      break;

    // --- $4014 (OAMDMA) handled elsewhere! ---
    default:
      // Do not update cpuOpenBus for unmapped or unused addresses
      break;
  }
}

// --- APU Read Handler ---
// Handles all reads from $4000-$4017, only $4015 is readable on vanilla NES hardware
function apuRead(address) {
  switch (address) {
    case 0x4015:
      // $4015: Sound channel status
      cpuOpenBus = APUregister.SND_CHN; // Update open bus with value read
      return APUregister.SND_CHN;

    // Joypad reads controller.js
    //case 0x4016:
    //case 0x4017:

    default:
      // All other addresses are open bus (return last value on the data bus)
      return cpuOpenBus;
  }
}

// Latch controller shift registers on 1->0 transition
function joypadWrite(address, value) {
  if (address === 0x4016) {
    let oldStrobe = joypadStrobe;
    joypadStrobe = value & 1;
    cpuOpenBus = value & 0xFF;;
    if (oldStrobe && !joypadStrobe) {
      joypad1State = pollController1();
      joypad2State = pollController2();
    }
    JoypadRegister.JOYPAD1 = value;
  } else if (address === 0x4017) {
    cpuOpenBus = value & 0xFF;;
    JoypadRegister.JOYPAD2 = value;
  }
}

// Shift out button state on each read (A, B, Select, Start, Up, Down, Left, Right, in bit 0)
function joypadRead(address, pad = null) {
  let result = 0x40; // NES: bits 6 and 7 open bus/unused
  if (address === 0x4016) {
    result |= joypadStrobe ? (pollController1() & 1) : (joypad1State & 1);
    if (!joypadStrobe) joypad1State = (joypad1State >> 1) | 0x80;
    cpuOpenBus = result;
    return result;
  }
  if (address === 0x4017) {
    result |= joypadStrobe ? (pollController2() & 1) : (joypad2State & 1);
    if (!joypadStrobe) joypad2State = (joypad2State >> 1) | 0x80;
    cpuOpenBus = result;
    return result;
  }
  return cpuOpenBus;
}