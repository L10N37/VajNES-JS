
let debug = {
  oamDma: false,
  logging: false,
  videoTiming: false,
  openBusTests: false,
  openBusT4Trace: false
};

let openBus = {
    PPU: 0x00,
    CPU: 0x00,
    ppuDecayTimer: 0x00
};

breakPending = false;

let writeToggle = 0;
globalThis.writeToggle = writeToggle;

// Toggling rendering takes effect approximately 3-4 dots after the write. This delay is required by Battletoads to avoid a crash.
// would be smashing through test suites if i hadn't gone multicore, oof, cbf with a major refactor so some struggles with chunk by chunk on different cores
// https://www.nesdev.org/wiki/PPU_registers#Rendering_control

function _codeNow(){ return (typeof code === "number") ? (code & 0xFF) : 0xFF; }

// ----------------- PPU helpers -----------------
function chrRead(addr14) { return CHR_ROM[addr14 & 0x1FFF] & 0xFF; }

function mapNT(addr14) {
  const v   = (addr14 - 0x2000) & 0x0FFF;
  const off = v & 0x03FF;
  const nt  = (v >>> 10) & 0x03;

  switch (MIRRORING) {
    case "vertical":   return off | ((nt & 1) << 10);
    case "horizontal": return off | ((nt >>> 1) << 10);
    case "single0":    return off;
    case "single1":    return off | 0x400;
    case "four":       return (nt << 10) | off;
    default:           return off | ((nt >>> 1) << 10);
  }
}

function paletteIndex(addr14) {
  let p = addr14 & 0x1F;
  if ((p & 0x13) === 0x10) p &= ~0x10;
  return p;
}

// ----------------- CPU read dispatch -----------------
function checkReadOffset(address) {
  const addr = address & 0xFFFF;
  if (Breakpoints.enabled) bpCheckRead(addr);

  const busBefore = openBus.CPU & 0xFF;
  const codeNow = _codeNow();

  let raw = 0x00;

  if (addr < 0x2000) {
    raw = cpuRead(addr) & 0xFF;

  } else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);

    switch (reg) {
      case 0x2002: {

        if (currentScanline === 241 && currentDot === 0) {
          doNotSetVblank = true;
          nmiSuppression = true;
          nmiPending = 0;
          clearNmiEdge();
          if (debug.videoTiming) {
            console.debug(`%c[NMI/VBL cancelled] frame=${currentFrame} cpu=${cpuCycles} ppu=${ppuCycles} sl=${currentScanline} dot=${currentDot}`, "color:black;background:cyan;font-weight:bold;");
          }
        }

        if (currentScanline === 241 && (currentDot === 1 || currentDot === 2)) {
          if (debug.videoTiming) {
            console.debug(
              `%c[VBL clear path] frame=${currentFrame} cpu=${cpuCycles} ppu=${ppuCycles} sl=${currentScanline} dot=${currentDot} ` +
              `vblank=${(PPUSTATUS & 0x80) ? 1 : 0} nmiEdge=${(doesNmiEdgeExist())}`,
              "color:black;background:cyan;font-weight:bold;"
            );
          }
          clearNmiEdge();
          nmiPending = 0;
          nmiSuppression = true;
        }

        const obBefore = openBus.PPU & 0xFF;
        const stat     = PPUSTATUS & 0xFF;
        raw = ((stat & 0xE0) | (obBefore & 0x1F)) & 0xFF;

        PPUSTATUS &= ~0x80;

        writeToggle = 0;
        globalThis.writeToggle = writeToggle;

        openBus.PPU = raw;
        break;
      }

      // OAMDATA
      case 0x2004: {
        const oamAddr = OAMADDR & 0xFF;

        let v = OAM[oamAddr] & 0xFF;

        // Rule 3: attribute byte read masks bits 2..4
        if ((oamAddr & 3) === 2) v &= 0xE3;

        const scanline = currentScanline | 0;
        const dot = currentDot | 0;
        const visibleScanline = (scanline >= 0 && scanline <= 239);

        let result = v;

        if (renderingEnabled && visibleScanline) {
          if (dot >= 1 && dot <= 64) {
            // Rule 4: forced $FF
            result = 0xFF;
          } else if (dot >= 65 && dot <= 256) {
            // Rule 8: normal OAM read from the *current* OAM address
            // (address is changing every other PPU cycle)
            /*
            console.debug(
              `[RULE 8] dot=${dot} scanline=${scanline} OAMADDR=${oamAddr
                .toString(16)
                .padStart(2, "0")} value=0x${v.toString(16).padStart(2, "0")}`
            );
            */
            // result already = v
          } else if (dot >= 257 && dot <= 320) {
            // Rule 9: forced $FF
            result = 0xFF;
          }
          // dots 321–340: simple read (v)
        }

        openBus.PPU = result & 0xFF;
        openBus.ppuDecayTimer = 1789772;

        //console.debug("0b" + result.toString(2).padStart(8, "0"));
        return result;
      }

      case 0x2007: {
        const vv = VRAM_ADDR & 0x3FFF;
        const bufBefore = VRAM_DATA & 0xFF;
        let ret = 0x00;

        if (vv < 0x3F00) {
          ret = bufBefore;

          let newVal = 0x00;
          if (vv < 0x2000) {
            let chrAddr;
            if (mapperNumber === 1) {
              if (chrIsRAM) chrAddr = vv & (CHR_ROM.length - 1);
              else {
                const bankOffset = ((vv < 0x1000 ? CHR_BANK_LO : CHR_BANK_HI) << 12);
                chrAddr = (bankOffset + (vv & 0x0FFF)) & (CHR_ROM.length - 1);
              }
            } else {
              chrAddr = vv & (CHR_ROM.length - 1);
            }
            newVal = CHR_ROM[chrAddr] & 0xFF;
            VRAM_DATA = newVal;
          } else {
            const ntAddr = mapNT(vv) & 0x07FF;
            newVal = VRAM[ntAddr] & 0xFF;
            VRAM_DATA = newVal;
          }
        } else {
          const p = paletteIndex(vv);
          const palVal = PALETTE_RAM[p] & 0x3F;
          ret = (openBus.PPU & 0xC0) | palVal;

          const ntMirror = vv & 0x2FFF;
          if (ntMirror < 0x2000) {
            let chrAddr;
            if (mapperNumber === 1) {
              if (chrIsRAM) chrAddr = ntMirror & (CHR_ROM.length - 1);
              else {
                const bankOffset = ((ntMirror < 0x1000 ? CHR_BANK_LO : CHR_BANK_HI) << 12);
                chrAddr = (bankOffset + (ntMirror & 0x0FFF)) & (CHR_ROM.length - 1);
              }
            } else {
              chrAddr = ntMirror & (CHR_ROM.length - 1);
            }
            VRAM_DATA = CHR_ROM[chrAddr] & 0xFF;
          } else {
            const ntAddr = mapNT(ntMirror) & 0x07FF;
            VRAM_DATA = VRAM[ntAddr] & 0xFF;
          }
        }

        const inc = (PPUCTRL & 0x04) ? 32 : 1;
        VRAM_ADDR = (VRAM_ADDR + inc) & 0x3FFF;

        raw = ret & 0xFF;
        openBus.PPU = raw;
        break;
      }

      default:
        raw = openBus.PPU & 0xFF;
        break;
    }

  } else if (addr < 0x4020) {
    if (addr === 0x4016 || addr === 0x4017) {
      const bit = joypadRead(addr) & 1;
      raw = ((openBus.CPU & 0xFE) | bit) & 0xFF;
    } else {
      raw = apuRead(addr) & 0xFF;
    }

  } else if (addr < 0x6000) {
    raw = openBus.CPU & 0xFF;

  } else if (addr < 0x8000) {
    raw = (mapperNumber === 1)
      ? (mmc1CpuRead(addr) & 0xFF)
      : (prgRam[addr - 0x6000] & 0xFF);

  } else {
    raw = (mapperNumber === 1)
      ? (mmc1CpuRead(addr) & 0xFF)
      : (mapperReadPRG(addr) & 0xFF);
  }

  const out = cpuOpenBusFinalise(addr, raw, codeNow, false) & 0xFF;

  return out;
}

const PPU_WRITE_GATE_CYCLES = 29658;

// ----------------- CPU write dispatch -----------------
function checkWriteOffset(address, value) {
  const addr = address & 0xFFFF;
  value &= 0xFF;
  if (Breakpoints.enabled) bpCheckWrite(addr, value);

/*
  if (addr === 0x2004 && (currentScanline === 261) && currentDot >= 315) {
  console.log(
    `DBG $2004 prerender near dot321: DOT=${currentDot} ` +
    `MASKnow=${(PPUMASK & 0xFF).toString(16)} ` +
    `MASKe=${(PPUMASK_effective & 0xFF).toString(16)}`
  );
}
*/

  const busBefore = openBus.CPU & 0xFF;
  const codeNow = _codeNow();

  if (addr < 0x2000) {
    cpuWrite(addr, value);

  } else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);

    // for reset flag behaviour
    const gateThis =
    (//reg === 0x2000 || // PPUCTRL
    //reg === 0x2001 || // PPUMASK
    reg === 0x2002 || // PPUSTATUS
    reg === 0x2003 || // OAMADDR
    //reg === 0x2004 || // OAMDATA
    reg === 0x2005 || // PPUSCROLL
    reg === 0x2006 || // PPUADDR
    reg === 0x2007);  // PPUDATA


    if (gateThis && (cpuCycles < PPU_WRITE_GATE_CYCLES)) {
      cpuOpenBusFinalise(addr, value, codeNow, true);

      return;
    }

    switch (reg) {

      // PPUCTRL
      case 0x2000: {
        const wasEN = (PPUCTRL & 0x80) !== 0;
        PPUCTRL = value;

        // --- IMPORTANT PART ---
        // Bits 0–1 of $2000 are nametable select.
        // They map to bits 10–11 of t, which are bits 2–3 of t_hi.
        //
        // t_hi bit mapping:
        //   bit0 -> t8  (coarse Y)
        //   bit1 -> t9  (coarse Y)
        //   bit2 -> t10 (nametable bit 0)
        //   bit3 -> t11 (nametable bit 1)
        //   bit4 -> t12 (fine Y bit 0)
        //   bit5 -> t13 (fine Y bit 1)
        //   bit6 -> t14 (fine Y bit 2)
        //   bit7 -> unused/0
        //
        // So: clear bits 2–3, then OR in new nametable bits.
        t_hi = (t_hi & 0b11110011) | ((value & 0b00000011) << 2);
        // ----------------------

        function setNmiEdge() {
          PPU_FRAME_FLAGS |= 0b00000100;
        }

        const nowEN = (value & 0x80) !== 0;
        if (!wasEN && nowEN && (PPUSTATUS & 0x80)) {
          setNmiEdge();
        }
        break;
      }

      // PPUMASK
      case 0x2001: {
        const newMask = value & 0xFF;

        // CPU-visible mask updates immediately
        PPUMASK = newMask;

        // Only rendering bits are delayed (bits 3–4)
        const oldRender = PPUMASK_effective & 0x18;
        const newRender = newMask & 0x18;

        if (oldRender !== newRender) {
          const LATCH_DELAY_DOTS = 3;      // ~3 PPU dots
          const now = ppuCycles | 0;

          ppumaskPending = true;
          ppumaskPendingValue = newMask;   // latch full byte
          ppumaskApplyAtPpuCycles = (now + LATCH_DELAY_DOTS) | 0;
        }

        break;
      }

      // OAMADDR
      case 0x2003: OAMADDR = value & 0xFF; break;

      // OAMDATA
      case 0x2004: {
        const slotBefore = OAMADDR & 0xFF;
        const v = value & 0xFF;

        const isVisible   = currentScanline >= 0 && currentScanline <= 239;
        const isPreRender = currentScanline === 261;

        // === PASS TEST 6/7/A RULES ===
        // Only block when rendering is enabled AND on render lines.
        if (renderingEnabled && (isVisible || isPreRender)) {
          // MUST clear low 2 bits (Test A requirement)
          OAMADDR = ((OAMADDR + 4) & 0xFC) & 0xFF;
          break; // do NOT write OAM
        }

        // Normal behavior when rendering disabled OR not in render lines:
        OAM[slotBefore] = v;
        OAMADDR = (OAMADDR + 1) & 0xFF;
        break;
      }

      // PPUSCROLL
      case 0x2005: {
        let t = ((t_hi << 8) | t_lo) & 0x7FFF;
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
        globalThis.writeToggle = writeToggle;
        break;
      }

      // PPUADDR
      case 0x2006:
        if (writeToggle === 0) {
          // high byte of t (bits 8–14)
          t_hi = value & 0x3F;      // keep it 0b0yyyyNNY
          writeToggle = 1;
        } else {
          // low byte of t (bits 0–7)
          t_lo = value & 0xFF;
          VRAM_ADDR = (((t_hi << 8) | t_lo) & 0x3FFF);
          writeToggle = 0;
        }
        globalThis.writeToggle = writeToggle;
        break;
        
      // PPUDATA
      case 0x2007: {
        const v = VRAM_ADDR & 0x3FFF;

        if (v < 0x2000) {
          if (mapperNumber === 1) {
            if (chrIsRAM) CHR_ROM[v & 0x1FFF] = value;
            else mmc1ChrWrite(v & 0x1FFF, value);
          } else if (chrIsRAM) {
            CHR_ROM[v & 0x1FFF] = value;
          }
        } else if (v < 0x3F00) {
          const ntAddr = mapNT(v) & 0x07FF;
          VRAM[ntAddr] = value;
        } else {
          const p = paletteIndex(v);
          PALETTE_RAM[p] = value & 0x3F;
        }

        const inc = (PPUCTRL & 0x04) ? 32 : 1;
        VRAM_ADDR = (VRAM_ADDR + inc) & 0x3FFF;
        break;
      }

      default:
        break;
    }

    openBus.PPU = value & 0xFF;

  } 
  
  else if (addr === 0x4014) {

    dmaTransfer(value);
  } 
  
  else if (addr === 0x4016) {
    joypadWrite(addr, value);

  } else if (addr === 0x4017) {
    APUregister.FRAME_CNT = value;
    return openBus.CPU;

  } else if (addr < 0x4020) {
    apuWrite(addr, value);

  } else if (addr < 0x8000) {
    if (mapperNumber === 1) mmc1CpuWrite(addr, value);
    else prgRam[addr - 0x6000] = value & 0xFF;

  } else {
    if (addr < 0xFFFA) {
      if (mapperNumber === 1) mmc1CpuWrite(addr, value);
      else mapperWritePRG(addr, value);
    }
  }

  cpuOpenBusFinalise(addr, value, codeNow, true);
}

// ----------------- CPU RAM helpers -----------------
function cpuRead(addr) {
  addr &= 0xFFFF;
  const val = systemMemory[addr & 0x7FF] & 0xFF;
  return val;
}

function cpuWrite(addr, value) {
  addr &= 0xFFFF;
  value &= 0xFF;
  systemMemory[addr & 0x7FF] = value;
}

// ----------------- mapper PRG -----------------
function mapperReadPRG(addr) { return prgRom[addr - 0x8000]; }
function mapperWritePRG(addr, value) {}

// ----------------- APU -----------------
function apuWrite(address, value) {
  switch (address) {
    case 0x4000: APUregister.SQ1_VOL = value;    break;
    case 0x4001: APUregister.SQ1_SWEEP = value;  break;
    case 0x4002: APUregister.SQ1_LO = value;     break;
    case 0x4003: APUregister.SQ1_HI = value;     break;

    case 0x4004: APUregister.SQ2_VOL = value;    break;
    case 0x4005: APUregister.SQ2_SWEEP = value;  break;
    case 0x4006: APUregister.SQ2_LO = value;     break;
    case 0x4007: APUregister.SQ2_HI = value;     break;

    case 0x4008: APUregister.TRI_LINEAR = value; break;
    case 0x400A: APUregister.TRI_LO = value;     break;
    case 0x400B: APUregister.TRI_HI = value;     break;

    case 0x400C: APUregister.NOISE_VOL = value;  break;
    case 0x400E: APUregister.NOISE_LO = value;   break;
    case 0x400F: APUregister.NOISE_HI = value;   break;

    case 0x4010: APUregister.DMC_FREQ = value;   break;
    case 0x4011: APUregister.DMC_RAW = value;    break;
    case 0x4012: APUregister.DMC_START = value;  break;
    case 0x4013: APUregister.DMC_LEN = value;    break;

    case 0x4015: APUregister.SND_CHN = value;    break;
    case 0x4017: APUregister.FRAME_CNT = value;  break;

    default:
      break;
  }
}

function apuRead(address) {
  switch (address) {
    case 0x4015: return APUregister.SND_CHN & 0xFF;
    default:     return openBus.CPU & 0xFF;
  }
}

// ----------------- Joypad -----------------
let joypadStrobe = 0;
let joypad1Buttons = 0x00;
let joypad2Buttons = 0x00;
let joypad1State   = 0x00;
let joypad2State   = 0x00;

const NES_BUTTON = { A:0, B:1, Select:2, Start:3, Up:4, Down:5, Left:6, Right:7 };

const codeToButtonP1 = {
  KeyX: NES_BUTTON.A,
  KeyZ: NES_BUTTON.B,
  Backspace: NES_BUTTON.Select,
  Enter: NES_BUTTON.Start,
  NumpadEnter: NES_BUTTON.Start,
  ArrowUp: NES_BUTTON.Up,
  ArrowDown: NES_BUTTON.Down,
  ArrowLeft: NES_BUTTON.Left,
  ArrowRight: NES_BUTTON.Right
};

let _kbBound = false;
(function bindJoypadKeyboardOnce(){
  if (_kbBound) return;
  _kbBound = true;

  const kbdHandler = (isDown) => (e) => {
    const btn = codeToButtonP1[e.code];
    if (btn === undefined) return;

    if (isDown) joypad1Buttons |= (1 << btn);
    else        joypad1Buttons &= ~(1 << btn);

    e.preventDefault();
  };

  window.addEventListener("keydown", kbdHandler(true),  { passive: false });
  window.addEventListener("keyup",   kbdHandler(false), { passive: false });
})();

function pollController1() { return joypad1Buttons & 0xFF; }
function pollController2() { return joypad2Buttons & 0xFF; }

function latchIfFallingEdge(oldStrobe, newStrobe) {
  if (oldStrobe && !newStrobe) {
    joypad1State = pollController1();
    joypad2State = pollController2();
  }
}

function joypadWrite(address, value) {
  value &= 0xFF;

  if (address === 0x4016) {
    const old = joypadStrobe & 1;
    const now = value & 1;
    joypadStrobe = now;
    latchIfFallingEdge(old, now);

    if (typeof JoypadRegister === "object" && JoypadRegister) {
      JoypadRegister.JOYPAD1 = value;
    }
    return;
  }

  if (address === 0x4017) {
    joypadStrobe = value & 1;
    if (typeof JoypadRegister === "object" && JoypadRegister) {
      JoypadRegister.JOYPAD2 = value;
    }
  }
}

function joypadRead(address) {
  let state, poll;

  if (address === 0x4016) {
    state = joypad1State;
    poll  = pollController1;
  } else if (address === 0x4017) {
    state = joypad2State;
    poll  = pollController2;
  } else {
    return 0; // Not a joypad port
  }

  const strobe = joypadStrobe & 1;

  // Bit coming from the controller shift register
  const bit = strobe ? (poll() & 1) : (state & 1);

  // Shift only when strobe = 0
  if (!strobe) {
    if (address === 0x4016) {
      joypad1State = ((state >> 1) | 0x80) & 0xFF;
    } else {
      joypad2State = ((state >> 1) | 0x80) & 0xFF;
    }
  }

  // Return full byte. Bit0 = controller, Bit6 = 1, others = 0.
  return (bit & 1) | 0x40;
}