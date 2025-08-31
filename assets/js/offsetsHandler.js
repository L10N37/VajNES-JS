// now internally toggled with breakpoints
let debugLogging = false;

breakPending = false;

// writeToggle is an internal PPU latch but implemented here on CPU core, globalThis for logdump
globalThis.writeToggle = 0;

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
    cpuOpenBus = value & 0xFF;
    return value & 0xFF;
  }

  else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);
    switch (reg) {

      case 0x2002: { // PPUSTATUS
        const obBefore = cpuOpenBus & 0xFF;
        value = PPUSTATUS & 0xFF;
        PPUSTATUS &= ~0x80;       // clear V
        writeToggle = 0;          // latch reset
        if (debugLogging) console.debug(`[R $2002 PPUSTATUS] val=$${value.toString(16)} busBefore=$${obBefore.toString(16)} toggle->0`);
        // Open-bus effect: high 3 from bus, low 5 from status
        cpuOpenBus = ((obBefore & 0xE0) | (value & 0x1F)) & 0xFF;
        return value & 0xFF;
      }

      case 0x2004: { // OAMDATA
        value = OAM[OAMADDR & 0xFF] & 0xFF;
        if (debugLogging) console.debug(`[R $2004 OAMDATA] val=$${value.toString(16)} OAMADDR=$${(OAMADDR&0xFF).toString(16)}`);
        break;
      }

      case 0x2007: { // PPUDATA
        const v = VRAM_ADDR & 0x3FFF;
        const bufBefore = VRAM_DATA & 0xFF;
        let ret;

        if (v < 0x3F00) {
          // Non-palette: buffered
          ret = bufBefore;
          if (v < 0x2000) {
            VRAM_DATA = chrRead(v & 0x1FFF) & 0xFF;
          } else {
            VRAM_DATA = VRAM[mapNT(v)] & 0xFF;
          }
        } else {
          // Palette: direct, but still refill buffer from $2Fxx
          const p = paletteIndex(v);
          ret = (PALETTE_RAM[p] & 0x3F) & 0xFF;
          const ntMirror = v & 0x2FFF;
          if (ntMirror < 0x2000) {
            VRAM_DATA = chrRead(ntMirror & 0x1FFF) & 0xFF;
          } else {
            VRAM_DATA = VRAM[mapNT(ntMirror)] & 0xFF;
          }
        }

        const inc = (PPUCTRL & 0x04) ? 32 : 1;
        VRAM_ADDR = (VRAM_ADDR + inc) & 0x3FFF;
        value = ret & 0xFF;

        if (debugLogging) {
          console.debug(
            `[R $2007 PPUDATA] v=$${v.toString(16)} val=$${value.toString(16)} ` +
            `bufBefore=$${bufBefore.toString(16)} bufAfter=$${(VRAM_DATA&0xFF).toString(16)} inc=${inc}`
          );
        }

        // Open-bus effect: bus becomes returned byte
        cpuOpenBus = value & 0xFF;
        return value & 0xFF;
      }

      default: {
        value = cpuOpenBus & 0xFF;
        if (debugLogging) console.debug(`[R PPU-OPENBUS] $${reg.toString(16)} -> $${value.toString(16)}`);
        break;
      }
    }
  }

  else if (addr < 0x4020) {
    value = (addr === 0x4016 || addr === 0x4017) ? joypadRead(addr) : apuRead(addr);
    if (debugLogging) console.debug(`[R IO] $${addr.toString(16)} -> $${(value&0xFF).toString(16)}`);
  }

  else if (addr < 0x6000) {
    value = cpuOpenBus & 0xFF;
    if (debugLogging) console.debug(`[R EXP] $${addr.toString(16)} -> $${value.toString(16)}`);
  }

  else if (addr < 0x8000) {
    value = prgRam[addr - 0x6000] & 0xFF;
    if (debugLogging) console.debug(`[R PRG-RAM] $${addr.toString(16)} -> $${value.toString(16)}`);
  }

  else {
    value = mapperReadPRG(addr) & 0xFF;
    if (debugLogging) console.debug(`[R PRG-ROM] $${addr.toString(16)} -> $${value.toString(16)}`);
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
    return;
  }

  else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);
    const idx = reg & 0x7;

    switch (reg) {

      case 0x2000: { // PPUCTRL
        const wasEN = (PPUCTRL & 0x80) !== 0;
        PPUCTRL = value & 0xFF;
        if (debugLogging) console.debug(`[W $2000 PPUCTRL] val=$${value.toString(16)} wasEN=${wasEN?1:0}`);

        // NMI edge marker bookkeeping (unchanged from your version)
        const nowEN = (value & 0x80) !== 0;
        if (!wasEN && nowEN && (PPUSTATUS & 0x80)) {
          const frame = SHARED?.SYNC ? Atomics.load(SHARED.SYNC, 4) : 0;
          const sl    = SHARED?.SYNC ? Atomics.load(SHARED.SYNC, 2) : 0;
          const dot   = SHARED?.SYNC ? Atomics.load(SHARED.SYNC, 3) : 0;
          const edgeMarker = ((frame & 0xFFFF) << 16) | ((sl & 0x1FF) << 7) | (dot & 0x7F);
          SHARED?.SYNC && Atomics.store(SHARED.SYNC, 6, edgeMarker);
          if (debugLogging) console.debug(`[PPUCTRL NMI EDGE] frame=${frame} sl=${sl} dot=${dot}`);
        }
        if (!(value & 0x80)) {
          SHARED?.SYNC && Atomics.store(SHARED.SYNC, 6, 0);
        }
        break;
      }

      case 0x2001: { // PPUMASK
        PPUMASK = value & 0xFF;
        if (debugLogging) console.debug(`[W $2001 PPUMASK] val=$${value.toString(16)}`);
        break;
      }

      case 0x2003: { // OAMADDR
        OAMADDR = value & 0xFF;
        if (debugLogging) console.debug(`[W $2003 OAMADDR] val=$${value.toString(16)}`);
        break;
      }

      case 0x2004: { // OAMDATA
        if (debugLogging) console.debug(`[W $2004 OAMDATA] val=$${value.toString(16)} @OAMADDR=$${(OAMADDR&0xFF).toString(16)}`);
        OAM[OAMADDR & 0xFF] = value;
        OAMADDR = (OAMADDR + 1) & 0xFF;
        break;
      }

      case 0x2005: { // PPUSCROLL
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
        if (debugLogging) console.debug(`[W $2005 PPUSCROLL] ${step} val=$${value.toString(16)} t=$${t.toString(16)} toggle=${writeToggle}`);
        break;
      }

      case 0x2006: { // PPUADDR
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
        if (debugLogging) console.debug(`[W $2006 PPUADDR] ${step} val=$${value.toString(16)} VRAM_ADDR=$${VRAM_ADDR.toString(16)} toggle=${writeToggle}`);
        break;
      }

      case 0x2007: { // PPUDATA
        const v = VRAM_ADDR & 0x3FFF;
        const inc = (PPUCTRL & 0x04) ? 32 : 1;
        if (v < 0x2000) {
          if (typeof mapperChrWrite === "function") { mapperChrWrite(v & 0x1FFF, value); }
          else { CHR_ROM[v & 0x1FFF] = value; }
        } else if (v < 0x3F00) {
          VRAM[mapNT(v)] = value;
        } else {
          const idx  = paletteIndex(v);
          const val6 = value & 0x3F;
          if (PALETTE_RAM[idx] !== val6) PALETTE_RAM[idx] = val6;
          if ((idx & 0x03) === 0) {
            if (idx !== 0x00 && PALETTE_RAM[0x00] !== val6) PALETTE_RAM[0x00] = val6;
            if (idx !== 0x04 && PALETTE_RAM[0x04] !== val6) PALETTE_RAM[0x04] = val6;
            if (idx !== 0x08 && PALETTE_RAM[0x08] !== val6) PALETTE_RAM[0x08] = val6;
            if (idx !== 0x0C && PALETTE_RAM[0x0C] !== val6) PALETTE_RAM[0x0C] = val6;
          }
        }
        VRAM_ADDR = (VRAM_ADDR + inc) & 0x3FFF;
        if (debugLogging) console.debug(`[W $2007 PPUDATA] v=$${v.toString(16)} val=$${value.toString(16)} inc=${inc} v_after=$${VRAM_ADDR.toString(16)}`);
        break;
      }
    }

    // ---- inline open-bus drive for PPU writes (no helper) ----
    // Masks: [ $2000=0x68, $2001=0xE7, $2002(read-only), $2003=0xFF, $2004=0xFF*, $2005=0x7F?, $2006=0xFF, $2007=0xFF ]
    // Special case for $2004 when OAMADDR%4==2 -> 0xE3
    let andMask;
    if (idx === 0) andMask = 0x68;
    else if (idx === 1) andMask = 0xE7;
    else if (idx === 4) andMask = ((OAMADDR & 3) === 2) ? 0xE3 : 0xFF;
    else if (idx === 5) andMask = 0x7F;
    else andMask = 0xFF;

    const before = cpuOpenBus & 0xFF;
    cpuOpenBus = ((before & ~andMask) | (value & andMask)) & 0xFF;
    if (debugLogging) {
      console.debug(
        `[BUS WRITE $${reg.toString(16)}] val=$${value.toString(16).padStart(2,"0")} and=$${andMask.toString(16).padStart(2,"0")} ` +
        `bus_before=$${before.toString(16).padStart(2,"0")} -> bus_after=$${cpuOpenBus.toString(16).padStart(2,"0")}`
      );
    }
    return;
  }

  else if (addr === 0x4014) { dmaTransfer(value); if (debugLogging) console.debug(`[W $4014 OAMDMA] val=$${value.toString(16)}`); }
  else if (addr === 0x4016) { joypadWrite(addr, value); if (debugLogging) console.debug(`[W $4016 JOY] val=$${value.toString(16)}`); }
  else if (addr === 0x4017) { APUregister.FRAME_CNT = value; cpuOpenBus = value; if (debugLogging) console.debug(`[W $4017 APUFCNT] val=$${value.toString(16)}`); }
  else if (addr < 0x4020)   { apuWrite(addr, value); if (debugLogging) console.debug(`[W APU] $${addr.toString(16)} val=$${value.toString(16)}`); }
  else if (addr < 0x6000)   { cpuOpenBus = value; if (debugLogging) console.debug(`[W EXP] $${addr.toString(16)} val=$${value.toString(16)}`); }
  else if (addr < 0x8000)   { prgRam[addr - 0x6000] = value; if (debugLogging) console.debug(`[W PRG-RAM] $${addr.toString(16)} val=$${value.toString(16)}`); }
  else {
    if (addr >= 0xFFFA) { if (debugLogging) console.warn(`[W BLOCKED VEC] $${addr.toString(16)} val=$${value.toString(16)}`); return; }
    mapperWritePRG(addr, value);
    if (debugLogging) console.debug(`[W PRG-ROM] $${addr.toString(16)} val=$${value.toString(16)}`);
  }

  cpuOpenBus = value & 0xFF;
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
  // causes a fail on CPU_DUMMY_WRITES_OAM test rom
  //prgRom[addr - 0x8000] = value;
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
