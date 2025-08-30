let debugLogging = false;
console.debug(
  `%c DEBUG LOGGING (toggle debugLogging): ${debugLogging ? "ON" : "OFF"} `,
  `background:${debugLogging ? "limegreen" : "crimson"}; color:white; font-weight:bold; padding:2px 6px; border-radius:4px;`
);

breakPending = false;

// writeToggle is an internal PPU latch but implemented here on CPU core, globalThis for logdump
globalThis.writeToggle = 0;

// Mapper should tell us mirroring; fall back to horizontal if not available.
let MIRRORING = (typeof mapperGetMirroring === "function")
  ? mapperGetMirroring()
  : "horizontal";

// Pattern table read (CHR ROM/RAM). For CHR-RAM writes, add mapperChrWrite handler.
function chrRead(addr14) {
  return CHR_ROM[addr14 & 0x1FFF] & 0xFF;
}

// Nametable address mapper
function mapNT(addr14) {
  const v   = (addr14 - 0x2000) & 0x0FFF; // normalize to 4KB nametable space
  const off = v & 0x03FF;                 // offset within NT
  const nt  = (v >>> 10) & 0x03;          // which nametable

  switch (MIRRORING) {
    case "vertical":   return off | ((nt & 1) << 10);   // NT0=NT2, NT1=NT3
    case "horizontal": return off | ((nt >>> 1) << 10); // NT0=NT1, NT2=NT3
    case "single0":    return off;                      // all map to NT0
    case "single1":    return off | 0x400;              // all map to NT1
    case "four":       return (nt << 10) | off;         // true 4-screen
    default:           return off | ((nt >>> 1) << 10); // fallback → horizontal
  }
}

// Palette index normalizer: folds mirrors into base
function paletteIndex(addr14) {
  let p = addr14 & 0x1F;
  // $3F10/$14/$18/$1C mirror $3F00/$04/$08/$0C
  if ((p & 0x13) === 0x10) p &= ~0x10;
  return p;
}
function checkReadOffset(address) {
  const addr = address & 0xFFFF;
  let value;

  bpCheckRead(addr);

  if (addr < 0x2000) {
    value = cpuRead(addr);

  }

  else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);
    switch (reg) {
      case 0x2002: { // PPUSTATUS
        value = PPUSTATUS;
        PPUSTATUS &= ~0x80;
        writeToggle = 0;
        if (debugLogging) console.debug(`[READ PPUSTATUS] $2002 -> ${value.toString(16).padStart(2,"0")}`);
        break;
      }
      case 0x2004: { // OAMDATA
        value = OAM[OAMADDR & 0xFF];
        if (debugLogging) console.debug(`[READ OAMDATA] $2004 -> ${value.toString(16).padStart(2,"0")}`);
        break;
      }
      case 0x2007: { // PPUDATA
        const v = VRAM_ADDR & 0x3FFF;
        let ret;
        if (v < 0x2000) {
          ret = VRAM_DATA;
          VRAM_DATA = chrRead(v);
        } else if (v < 0x3F00) {
        ret = VRAM_DATA;
        VRAM_DATA = VRAM[mapNT(v)] & 0xFF;  // load next into buffer
                
        } else {
          const p = paletteIndex(v);
          ret = PALETTE_RAM[p] & 0x3F;
          const ntMirror = (v - 0x1000) & 0x3FFF;
          VRAM_DATA = (ntMirror < 0x2000)
            ? chrRead(ntMirror)
            : (VRAM[mapNT(ntMirror)] & 0xFF);
        }
        const inc = (PPUCTRL & 0x04) ? 32 : 1;
        VRAM_ADDR = (VRAM_ADDR + inc) & 0x3FFF;
        value = ret;
        if (debugLogging) console.debug(`[READ PPUDATA] $2007 -> ${value.toString(16).padStart(2,"0")}`);
        break;
      }
      default: {
        value = cpuOpenBus;
        if (debugLogging) console.debug(`[READ PPU-OPENBUS] $${reg.toString(16)} -> ${value.toString(16).padStart(2,"0")}`);
        break;
      }
    }
  }

  else if (addr < 0x4020) {
    value = (addr === 0x4016 || addr === 0x4017) ? joypadRead(addr) : apuRead(addr);
    if (debugLogging) console.debug(`[READ IO] $${addr.toString(16)} -> ${value.toString(16).padStart(2,"0")}`);
  }

  else if (addr < 0x6000) {
    value = cpuOpenBus;
    if (debugLogging) console.debug(`[READ EXPANSION] $${addr.toString(16)} -> ${value.toString(16).padStart(2,"0")}`);
  }

  else if (addr < 0x8000) {
    value = prgRam[addr - 0x6000];
    if (debugLogging) console.debug(`[READ PRG-RAM] $${addr.toString(16)} -> ${value.toString(16).padStart(2,"0")}`);
  }

  else {
    value = mapperReadPRG(addr);
    if (debugLogging) console.debug(`[READ PRG-ROM] $${addr.toString(16)} -> ${value.toString(16).padStart(2,"0")}`);
  }

  cpuOpenBus = value & 0xFF;
  return value & 0xFF;
}


function checkWriteOffset(address, value) {
  const addr = address & 0xFFFF;
  value &= 0xFF;

  bpCheckWrite(addr, value);

  if (addr < 0x2000) {
    cpuWrite(addr, value);

  } else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);

    switch (reg) {
      // --- PPUCTRL ---
      case 0x2000: {
        const wasEnabled = (PPUCTRL & 0x80) !== 0;
        PPUCTRL = value;

        const nowEnabled = (value & 0x80) !== 0;
        const vblankNow = (SHARED.SYNC)
          ? Atomics.load(SHARED.SYNC, 5)
          : ((PPUSTATUS >>> 7) & 1);

        if (!nowEnabled) {
          Atomics.store(SHARED.SYNC, 6, 0);
        }

        if (!wasEnabled && nowEnabled && vblankNow) {
          const frame = Atomics.load(SHARED.SYNC, 4);
          const sl    = Atomics.load(SHARED.SYNC, 2);
          const dot   = Atomics.load(SHARED.SYNC, 3);
          const edgeMarker =
            ((frame & 0xFFFF) << 16) |
            ((sl    & 0x1FF)  << 7 ) |
            ( dot   & 0x7F);
          Atomics.store(SHARED.SYNC, 6, edgeMarker);
        }

        break;
      }

      // --- PPUMASK ---
      case 0x2001: {
        PPUMASK = value;
        break;
      }

      // --- OAMADDR ---
      case 0x2003: {
        OAMADDR = value;
        break;
      }

      // --- OAMDATA ---
      case 0x2004: {
        OAM[OAMADDR] = value;
        OAMADDR = (OAMADDR + 1) & 0xFF;
        break;
      }
      
      // --- PPUSCROLL ---
      case 0x2005: {

        //breakHere();

        let t = ((t_hi << 8) | t_lo) & 0x3FFF;
        const step = (writeToggle === 0) ? "hi" : "lo";

        if (writeToggle === 0) {
          SCROLL_X = value;
          fineX = value & 0x07;
          t = (t & ~0x001F) | ((value >>> 3) & 0x1F);
          writeToggle = 1;
        } else {
          SCROLL_Y = value;
          t = (t & ~(0x7000 | 0x03E0))
            | ((value & 0x07) << 12)
            | (((value >>> 3) & 0x1F) << 5);
          writeToggle = 0;
        }

        t_hi = (t >>> 8) & 0xFF;
        t_lo = t & 0xFF;

        if (debugLogging) {
          console.debug(
            `[WRITE PPUSCROLL] step=${step} ` +
            `t=$${t.toString(16).padStart(4,"0")} ` +
            `SCROLL_X=${SCROLL_X} SCROLL_Y=${SCROLL_Y}`
          );
        }
        break;
      }

      // --- PPUADDR ---
      case 0x2006: {
        let t = ((t_hi << 8) | t_lo) & 0x3FFF;
        const step = (writeToggle === 0) ? "hi" : "lo";

        if (writeToggle === 0) {
          t = (t & 0x00FF) | ((value & 0x3F) << 8);
          writeToggle = 1;
        } else {
          t = (t & 0x3F00) | value;
          VRAM_ADDR = t & 0x3FFF;
          writeToggle = 0;
        }

        t_hi = (t >>> 8) & 0xFF;
        t_lo = t & 0xFF;

        if (debugLogging) {
          console.debug(
            `[WRITE PPUADDR] step=${step} ` +
            `t=$${t.toString(16).padStart(4,"0")} ` +
            `VRAM_ADDR=$${VRAM_ADDR.toString(16).padStart(4,"0")} ` +
            `(writeToggle=${writeToggle})`
          );
        }
        break;
      }

      // --- PPUDATA ---
      case 0x2007: {
        const v = VRAM_ADDR & 0x3FFF;

        if (v < 0x2000) {
          if (typeof mapperChrWrite === "function") {
            mapperChrWrite(v & 0x1FFF, value);
          } else {
            CHR_ROM[v & 0x1FFF] = value;
          }
        } else if (v < 0x3F00) {
          VRAM[mapNT(v)] = value;
        } else {
          // --- Palette write ($3F00–$3F1F) ---
          const idx  = paletteIndex(v);     // folds $3F10/$14/$18/$1C to $3F00/$04/$08/$0C
          const val6 = value & 0x3F;

          // Write only if changed (avoid redundant stores)
          if (PALETTE_RAM[idx] !== val6) {
            PALETTE_RAM[idx] = val6;
          }

          // Keep the universal BG quartet (0x00, 0x04, 0x08, 0x0C) in sync
          if ((idx & 0x03) === 0) {
            if (idx !== 0x00 && PALETTE_RAM[0x00] !== val6) PALETTE_RAM[0x00] = val6;
            if (idx !== 0x04 && PALETTE_RAM[0x04] !== val6) PALETTE_RAM[0x04] = val6;
            if (idx !== 0x08 && PALETTE_RAM[0x08] !== val6) PALETTE_RAM[0x08] = val6;
            if (idx !== 0x0C && PALETTE_RAM[0x0C] !== val6) PALETTE_RAM[0x0C] = val6;
          }

          if (debugLogging) {
            console.debug(
              `%c[PALETTE WRITE] PC=$${CPUregisters.PC.toString(16).padStart(4,"0")} ` +
              `VRAM=$${v.toString(16).padStart(4,"0")} idx=${idx} <= $${value.toString(16).padStart(2,"0")}`,
              "color: violet; font-weight:bold;"
            );
          }
        }

        const inc = (PPUCTRL & 0x04) ? 32 : 1;
        VRAM_ADDR = (VRAM_ADDR + inc) & 0x3FFF;

        if (debugLogging) {
          console.debug(
            `[CPU->PPU] PC=$${CPUregisters.PC.toString(16).padStart(4,"0")} ` +
            `A=$${CPUregisters.A.toString(16).padStart(2,"0")} ` +
            `-> VRAM[$${v.toString(16).padStart(4,"0")}]=$${value.toString(16).padStart(2,"0")}`
          );
        }
        break;
      }

    }

  } else if (addr === 0x4014) {
    dmaTransfer(value);
    if (debugLogging) console.debug(`[WRITE OAMDMA] $4014 <= $${value.toString(16).padStart(2,"0")}`);

  } else if (addr === 0x4016) {
    joypadWrite(addr, value);
    if (debugLogging) console.debug(`[WRITE JOY] $4016 <= $${value.toString(16).padStart(2,"0")}`);

  } else if (addr === 0x4017) {
    APUregister.FRAME_CNT = value;
    cpuOpenBus = value;
    if (debugLogging) console.debug(`[WRITE APU FRAME_CNT] $4017 <= $${value.toString(16).padStart(2,"0")}`);

  } else if (addr < 0x4020) {
    apuWrite(addr, value);
    if (debugLogging) console.debug(`[WRITE APU] $${addr.toString(16)} <= $${value.toString(16).padStart(2,"0")}`);

  } else if (addr < 0x6000) {
    cpuOpenBus = value;
    if (debugLogging) console.debug(`[WRITE EXPANSION] $${addr.toString(16)} <= $${value.toString(16).padStart(2,"0")}`);

  } else if (addr < 0x8000) {
    prgRam[addr - 0x6000] = value;
    if (debugLogging) console.debug(`[WRITE PRG-RAM] $${addr.toString(16)} <= $${value.toString(16).padStart(2,"0")}`);

  } else {
    if (addr >= 0xFFFA) {
      if (debugLogging) console.warn(`[WRITE BLOCKED: VECTOR] $${addr.toString(16)} <= $${value.toString(16).padStart(2,"0")}`);
      return;
    }
    //mapperWritePRG(addr, value);
    if (debugLogging) console.debug(`[WRITE PRG-ROM] $${addr.toString(16)} <= $${value.toString(16).padStart(2,"0")}`);
  }

  cpuOpenBus = value;
}

function cpuRead(addr) {
  addr &= 0xFFFF;
  let val = systemMemory[addr & 0x7FF] & 0xFF;
  if (debugLogging) console.debug(`[READ CPU-RAM] $${addr.toString(16).padStart(4,"0")} -> ${val.toString(16).padStart(2,"0")}`);
  cpuOpenBus = val;
  return val;
}

function cpuWrite(addr, value) {
  addr &= 0xFFFF;
  value &= 0xFF;
  systemMemory[addr & 0x7FF] = value;
  if (debugLogging) console.debug(`[WRITE CPU-RAM] $${addr.toString(16).padStart(4,"0")} <= ${value.toString(16).padStart(2,"0")}`);
  cpuOpenBus = value;
}

function mapperReadPRG(addr) {
  return prgRom[addr - 0x8000];
}

function mapperWritePRG(addr, value) {
  // NROM PRG is read-only, but some test ROMs poke it
  prgRom[addr - 0x8000] = value;
}

function apuWrite(address, value) {
  switch (address) {
    case 0x4000: APUregister.SQ1_VOL = value;   cpuOpenBus = value; break;
    case 0x4001: APUregister.SQ1_SWEEP = value; cpuOpenBus = value; break;
    case 0x4002: APUregister.SQ1_LO = value;    cpuOpenBus = value; break;
    case 0x4003: APUregister.SQ1_HI = value;    cpuOpenBus = value; break;

    case 0x4004: APUregister.SQ2_VOL = value;   cpuOpenBus = value; break;
    case 0x4005: APUregister.SQ2_SWEEP = value; cpuOpenBus = value; break;
    case 0x4006: APUregister.SQ2_LO = value;    cpuOpenBus = value; break;
    case 0x4007: APUregister.SQ2_HI = value;    cpuOpenBus = value; break;

    case 0x4008: APUregister.TRI_LINEAR = value; cpuOpenBus = value; break;
    case 0x400A: APUregister.TRI_LO = value;     cpuOpenBus = value; break;
    case 0x400B: APUregister.TRI_HI = value;     cpuOpenBus = value; break;

    case 0x400C: APUregister.NOISE_VOL = value;  cpuOpenBus = value; break;
    case 0x400E: APUregister.NOISE_LO = value;   cpuOpenBus = value; break;
    case 0x400F: APUregister.NOISE_HI = value;   cpuOpenBus = value; break;

    case 0x4010: APUregister.DMC_FREQ = value;   cpuOpenBus = value; break;
    case 0x4011: APUregister.DMC_RAW = value;    cpuOpenBus = value; break;
    case 0x4012: APUregister.DMC_START = value;  cpuOpenBus = value; break;
    case 0x4013: APUregister.DMC_LEN = value;    cpuOpenBus = value; break;

    case 0x4015: APUregister.SND_CHN = value;    cpuOpenBus = value; break;
    case 0x4017: APUregister.FRAME_CNT = value;  cpuOpenBus = value; break;

    case 0x4016: 
      cpuOpenBus = value;
      if (typeof joypadWrite === "function") joypadWrite(address, value);
      break;

    default:
      break;
  }
}

function apuRead(address) {
  switch (address) {
    case 0x4015:
      cpuOpenBus = APUregister.SND_CHN;
      return APUregister.SND_CHN;
    default:
      return cpuOpenBus;
  }
}

function pollController1() {}
function pollController2() {}

function joypadWrite(address, value) {
  if (address === 0x4016) {
    let oldStrobe = joypadStrobe;
    joypadStrobe = value & 1;
    cpuOpenBus = value;
    if (oldStrobe && !joypadStrobe) {
      joypad1State = pollController1();
      joypad2State = pollController2();
    }
    JoypadRegister.JOYPAD1 = value;
  } else if (address === 0x4017) {
    joypadStrobe = value & 1;
    cpuOpenBus = value;
    JoypadRegister.JOYPAD2 = value;
  }
}

function joypadRead(address) {
  let result = 0x40; // bits 6 and 7 open bus
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
