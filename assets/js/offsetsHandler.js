// now internally toggled with breakpoints
let debugLogging = false;
let debugVideoTiming = false;
let ppuOpenBus = 0x00;
let decayTimer = 0;
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

  // --- $0000–$1FFF: CPU internal RAM mirrors ---
  if (addr < 0x2000) {
    value = cpuRead(addr) & 0xFF;
    cpuOpenBus = value;
    return value;
  }

  // --- $2000–$3FFF: PPU registers (mirrored every 8) ---
  else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);

    switch (reg) {
      case 0x2002: { // PPUSTATUS
        const sl    = SHARED.SYNC[2] | 0;
        const dot   = SHARED.SYNC[3] | 0;
        const frame = SHARED.SYNC[4] | 0;

        if (sl === 241 && dot === 0) { // one PPU clock before set
          doNotSetVblank = true;
          nmiSuppression = true;

          if (debugVideoTiming){
          console.debug(`%c[NMI/VBL cancelled] frame=${fr} cpu=${cpuCycles} ppu=${ppuCycles} sl=${sl} dot=${dot}`,
            "color:black;background:cyan;font-weight:bold;");
          }

        }

        if (sl === 241 && (dot === 1 || dot === 2)) { // same/one later

          if (debugVideoTiming){
          console.debug(`%c[VBL clear path] frame=${fr} cpu=${cpuCycles} ppu=${ppuCycles} sl=${sl} dot=${dot} ` +
                        `vblank=${(PPUSTATUS & 0x80)?1:0} nmiEdge=${(PPU_FRAME_FLAGS & 0b00000100)?1:0}`,
                        "color:black;background:cyan;font-weight:bold;");
          }

          PPU_FRAME_FLAGS &= ~0b00000100;
          nmiPending = 0;
          nmiSuppression = true;
        }

        const obBefore = ppuOpenBus & 0xFF;
        const stat     = PPUSTATUS & 0xFF;
        const ret = ((stat & 0xE0) | (obBefore & 0x1F)) & 0xFF;

        const wasVBlank = (stat & 0x80) !== 0;
        PPUSTATUS &= ~0x80;   // clear VBL
        writeToggle = 0;      // reset $2005/$2006 latch

        ppuOpenBus = ret;
        cpuOpenBus = ret;

        if (wasVBlank && debugVideoTiming){
          console.debug("2002 Vblank clear:", cpuCycles, "Frame:", fr);
        }
        
        return ret;
      }

      case 0x2004: { // OAMDATA (read)
        value = OAM[OAMADDR & 0xFF] & 0xFF;
        ppuOpenBus = value;
        cpuOpenBus = value;
        if (debugLogging) console.debug(`[R $2004 OAMDATA] val=$${value.toString(16)} OAMADDR=$${(OAMADDR&0xFF).toString(16)}`);
        break;
      }

      case 0x2007: { // PPUDATA (read)
        const v = VRAM_ADDR & 0x3FFF;
        const bufBefore = VRAM_DATA & 0xFF;
        let ret = 0x00;

        // -----------------------------------
        // Pattern / nametable region (< $3F00)
        // -----------------------------------
        if (v < 0x3F00) {
          ret = bufBefore; // buffered read

          let newVal;

          if (v < 0x2000) {
            // -------------------------------
            // CHR region ($0000–$1FFF)
            // -------------------------------
            let chrAddr;

            if (mapperNumber === 1) {
              if (chrIsRAM) {
                // CHR-RAM: ignore MMC1 banks, just wrap around
                chrAddr = v & (CHR_ROM.length - 1);
              } else {
                // CHR-ROM: apply MMC1 4 KB bank logic
                const bankOffset =
                  (v < 0x1000 ? CHR_BANK_LO : CHR_BANK_HI) << 12;
                chrAddr = (bankOffset + (v & 0x0FFF)) & (CHR_ROM.length - 1);
              }
            } else {
              // NROM or other simple mappers
              chrAddr = v & (CHR_ROM.length - 1);
            }

            newVal = CHR_ROM[chrAddr] & 0xFF;
            VRAM_DATA = newVal;

            if (newVal === 0xFF && chrAddr >= 0x0FF0) {
              console.warn(
                `[CHR $FF READ] v=$${v.toString(16)} chrAddr=$${chrAddr.toString(
                  16
                )} len=${CHR_ROM.length} chrIsRAM=${chrIsRAM}`
              );
            }
          } else {
            // -------------------------------
            // Nametable region ($2000–$2FFF)
            // -------------------------------
            const ntAddr = mapNT(v) & 0x07FF;
            newVal = VRAM[ntAddr] & 0xFF;
            VRAM_DATA = newVal;
          }
        }

        // -----------------------------------
        // Palette region ($3F00–$3FFF)
        // -----------------------------------
        else {
          const p = paletteIndex(v);
          const palVal = PALETTE_RAM[p] & 0x3F;
          ret = (ppuOpenBus & 0xC0) | palVal;

          // fill buffer from mirrored nametable region
          const ntMirror = v & 0x2FFF;
          if (ntMirror < 0x2000) {
            let chrAddr;
            if (mapperNumber === 1) {
              if (chrIsRAM) {
                chrAddr = ntMirror & (CHR_ROM.length - 1);
              } else {
                const bankOffset =
                  (ntMirror < 0x1000 ? CHR_BANK_LO : CHR_BANK_HI) << 12;
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

        // -----------------------------------
        // Increment VRAM address
        // -----------------------------------
        const inc = (PPUCTRL & 0x04) ? 32 : 1;
        VRAM_ADDR = (VRAM_ADDR + inc) & 0x3FFF;

        const out = ret & 0xFF;
        ppuOpenBus = out;
        cpuOpenBus = out;

        if (debugLogging) {
          console.debug(
            `[R $2007] v=$${v.toString(16).padStart(4, "0")} out=$${out
              .toString(16)
              .padStart(2, "0")} bufBefore=$${bufBefore
              .toString(16)
              .padStart(2, "0")} bufAfter=$${(VRAM_DATA & 0xff)
              .toString(16)
              .padStart(2, "0")} inc=${inc} chrIsRAM=${chrIsRAM}`
          );
        }

        return out;
      }

      default: { // write-only regs mirror bus
        value = ppuOpenBus & 0xFF;
        if (debugLogging) console.debug(`[R PPU-OPENBUS] $${reg.toString(16)} -> $${value.toString(16)}`);
        break;
      }
    }

    cpuOpenBus = value & 0xFF;
    return value & 0xFF;
  }

  // --- $4000–$401F: APU / I/O ---
  else if (addr < 0x4020) {
    if (addr === 0x4016 || addr === 0x4017) {
      const bit = (joypadRead(addr) & 1);
      value = (cpuOpenBus & 0xFE) | bit;
    } else {
      value = apuRead(addr) & 0xFF;
    }
    if (debugLogging) console.debug(`[R IO] $${addr.toString(16)} -> $${(value & 0xFF).toString(16)}`);
  }

  // --- $4020–$5FFF: expansion ---
  else if (addr < 0x6000) {
    value = cpuOpenBus & 0xFF;
    if (debugLogging) console.debug(`[R EXP] $${addr.toString(16)} -> $${value.toString(16)}`);
  }

  // --- $6000–$7FFF: PRG-RAM (mapper dependent) ---
  else if (addr < 0x8000) {
    value = (mapperNumber === 1)
      ? (mmc1CpuRead(addr) & 0xFF)
      : (prgRam[addr - 0x6000] & 0xFF);
    if (debugLogging) console.debug(`[R PRG-RAM] $${addr.toString(16)} -> $${value.toString(16)}`);
  }

  // --- $8000–$FFFF: PRG-ROM (mapper dependent) ---
  else {
    value = (mapperNumber === 1)
      ? (mmc1CpuRead(addr) & 0xFF)
      : (mapperReadPRG(addr) & 0xFF);
    if (debugLogging) console.debug(`[R PRG-ROM] $${addr.toString(16)} -> $${value.toString(16)}`);
  }

  cpuOpenBus = value & 0xFF;
  return value & 0xFF;
}

// gate threshold from power-on to when PPU registers actually start working
const PPU_WRITE_GATE_CYCLES = 29658;

function checkWriteOffset(address, value) {
  const addr = address & 0xFFFF;
  value &= 0xFF;
  bpCheckWrite(addr, value);

  // --- $0000–$1FFF: CPU RAM mirrors ---
  if (addr < 0x2000) { 
    cpuWrite(addr, value);
    return;
  }

  // --- $2000–$3FFF: PPU registers (mirrored every 8) ---
  else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);

    // block early writes to 2000/2001/2005/2006 until gate threshold
    const gateThis = (reg === 0x2000 || reg === 0x2001 || reg === 0x2005 || reg === 0x2006);
    if (gateThis && (cpuCycles < PPU_WRITE_GATE_CYCLES)) {
      if (debugLogging) console.debug(`[PPU-GATE] Ignored write $${reg.toString(16)} val=$${value.toString(16)} @${cpuCycles}`);
      return;
    }

    switch (reg) {
      case 0x2000: { // PPUCTRL
        const wasEN = (PPUCTRL & 0x80) !== 0;
        PPUCTRL = value;
        if (debugLogging) console.debug(`[W $2000 PPUCTRL] val=$${value.toString(16)} wasEN=${wasEN?1:0}`);
        const nowEN = (value & 0x80) !== 0;
        if (!wasEN && nowEN && (PPUSTATUS & 0x80)) {
        const sl    = SHARED.SYNC[2] | 0;
        const dot   = SHARED.SYNC[3] | 0;
        const frame = SHARED.SYNC[4] | 0;
          PPU_FRAME_FLAGS |= 0b00000100;
        if (debugVideoTiming) console.debug(`[PPUCTRL NMI EDGE] frame=${fr} sl=${sl} dot=${dot}`);
        }
        break;
      }

      case 0x2001: { // PPUMASK
        PPUMASK = value;
        if (debugLogging) console.debug(`[W $2001 PPUMASK] val=$${value.toString(16)}`);
        break;
      }

      case 0x2003: { // OAMADDR
        OAMADDR = value;
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
        let t = ((t_hi << 8) | t_lo) & 0x7FFF;        // keep 15-bit v/t space
        if (writeToggle === 0) {
          SCROLL_X = value;
          fineX = value & 0x07;                       // x (fine)
          t = (t & ~0x001F) | ((value >>> 3) & 0x1F); // coarse X
          writeToggle = 1;
        } else {
          SCROLL_Y = value;
          t = (t & ~(0x7000 | 0x03E0))                // clear fineY/coarseY
            | ((value & 0x07) << 12)                  // fine Y
            | (((value >>> 3) & 0x1F) << 5);          // coarse Y
          writeToggle = 0;
        }
        t_hi = (t >>> 8) & 0xFF;
        t_lo = t & 0xFF;
        break;
      }

      case 0x2006: { // PPUADDR
        if (writeToggle === 0) {
          t_hi = value & 0x3F;                        // t[8..13]
          writeToggle = 1;
        } else {
          t_lo = value & 0xFF;                        // t[0..7]
          VRAM_ADDR = ((t_hi << 8) | t_lo);           // v=t immediately (keep bit14)
          writeToggle = 0;
        }
        break;
      }
      
      case 0x2007: { // PPUDATA (write)
        const v = VRAM_ADDR & 0x3FFF;

        // ------------------------------
        // Pattern table / CHR region
        // ------------------------------
        if (v < 0x2000) {
          if (mapperNumber === 1) {
            // Mapper 1: CHR may be RAM or ROM
            if (chrIsRAM) {
              CHR_ROM[v & 0x1FFF] = value;
            } else {
              mmc1ChrWrite(v & 0x1FFF, value);
            }
          } else if (chrIsRAM) {
            // Simple mappers: CHR-RAM only
            CHR_ROM[v & 0x1FFF] = value;
          }

          if (debugLogging) {
            console.debug(
              `[W $2007 CHR] v=$${v.toString(16).padStart(4, "0")} val=$${value
                .toString(16)
                .padStart(2, "0")} chrIsRAM=${chrIsRAM}`
            );
          }
        }

        // ------------------------------
        // Nametable region
        // ------------------------------
        else if (v < 0x3F00) {
          const ntAddr = mapNT(v) & 0x07FF;
          VRAM[ntAddr] = value;

          if (debugLogging) {
            console.debug(
              `[W $2007 NT] v=$${v.toString(16).padStart(4, "0")} mapped=$${ntAddr
                .toString(16)
                .padStart(4, "0")} val=$${value
                .toString(16)
                .padStart(2, "0")} mirr=${MIRRORING}`
            );
          }
        }

        // ------------------------------
        // Palette region
        // ------------------------------
        else {
          let p = v & 0x1F;
          if ((p & 0x13) === 0x10) p &= ~0x10;
          PALETTE_RAM[p] = value & 0x3F;

          if (debugLogging) {
            console.debug(
              `[W $2007 PAL] v=$${v.toString(16).padStart(4, "0")} pIdx=${p
                .toString(16)
                .padStart(2, "0")} val=$${value.toString(16).padStart(2, "0")}`
            );
          }
        }

        // ------------------------------
        // Increment VRAM address
        // ------------------------------
        const inc = (PPUCTRL & 0x04) ? 32 : 1;
        VRAM_ADDR = (VRAM_ADDR + inc) & 0x3FFF;
        break;
      }

  }

    ppuOpenBus = value;
    cpuOpenBus = value;
    return;
  }

  // --- $4014/$4016/$4017 and APU/IO ---
  else if (addr === 0x4014) { dmaTransfer(value); }
  else if (addr === 0x4016) { joypadWrite(addr, value); }
  else if (addr === 0x4017) { APUregister.FRAME_CNT = value; cpuOpenBus = value; }
  else if (addr < 0x4020)   { apuWrite(addr, value); }

  // --- $4020–$5FFF: expansion ---
  else if (addr < 0x6000)   { cpuOpenBus = value; }

  // --- $6000–$7FFF: PRG-RAM (mapper dependent) ---
  else if (addr < 0x8000) {
    if (mapperNumber === 1) {
      mmc1CpuWrite(addr, value); // MMC1 handles PRG-RAM enabling
    } else {
      prgRam[addr - 0x6000] = value & 0xFF; // NROM
    }
  }

  // --- $8000–$FFFF: PRG area (mapper dependent) ---
  else {
    if (addr >= 0xFFFA) return; // don't touch vectors
    if (mapperNumber === 1) {
      mmc1CpuWrite(addr, value);
    } else {
      mapperWritePRG(addr, value); // NROM: usually no-op
    }
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

// ================= NES Joypad (P1 keyboard) — no globalThis, with debug =================

// Internal state (module/file scope)
let joypadStrobe = 0;      // $4016 bit0
let joypad1Buttons = 0x00; // live button mask (polled on latch)
let joypad2Buttons = 0x00; // reserved (P2)
let joypad1State   = 0x00; // latched & shifted by reads
let joypad2State   = 0x00; // latched & shifted by reads

// Bit layout (LSB → MSB): A, B, Select, Start, Up, Down, Left, Right
const NES_BUTTON = {
  A: 0, B: 1, Select: 2, Start: 3, Up: 4, Down: 5, Left: 6, Right: 7
};

// Keyboard → buttons (layout-independent via e.code)
const codeToButtonP1 = {
  KeyX: NES_BUTTON.A,           // A = X
  KeyZ: NES_BUTTON.B,           // B = Z
  Backspace: NES_BUTTON.Select, // Select = Backspace
  Enter: NES_BUTTON.Start,      // Start = Enter
  NumpadEnter: NES_BUTTON.Start,
  ArrowUp: NES_BUTTON.Up,
  ArrowDown: NES_BUTTON.Down,
  ArrowLeft: NES_BUTTON.Left,
  ArrowRight: NES_BUTTON.Right
};

// Bind keyboard once (no globals)
let _kbBound = false;
(function bindJoypadKeyboardOnce(){
  if (_kbBound) return;
  _kbBound = true;

const kbdHandler = (isDown) => (e) => {
  const btn = codeToButtonP1[e.code];
  if (btn === undefined) return;

  if (isDown) {
    joypad1Buttons |= (1 << btn);

    /*
    if (e.code === "KeyX") {
      perFrameStep = true;
      if (debugLogging) {
        console.debug("[STEP] armed via KeyX (perFrameStep = true)");
      }
    }
    */
   
  } else {
    joypad1Buttons &= ~(1 << btn);
  }

  if (debugLogging) {
    console.debug(
      "[JOY]", isDown ? "keydown" : "keyup",
      e.code, "P1:", joypad1Buttons.toString(2, 2).padStart(8, "0")
    );
  }

  e.preventDefault();
};


  window.addEventListener("keydown", kbdHandler(true),  { passive: false });
  window.addEventListener("keyup",   kbdHandler(false), { passive: false });
})();

// Pollers (what gets latched on $4016 falling edge)
function pollController1() { return joypad1Buttons & 0xFF; }
function pollController2() { return joypad2Buttons & 0xFF; }

// Latch helpers
function latchIfFallingEdge(oldStrobe, newStrobe) {
  // NES: when strobe goes 1→0, copy live buttons into 8-bit shift regs
  if (oldStrobe && !newStrobe) {
    joypad1State = pollController1();
    joypad2State = pollController2();
    if (debugLogging) {
      console.debug(
        "[JOY] LATCH P1:", joypad1State.toString(2).padStart(8, "0"),
        "P2:", joypad2State.toString(2).padStart(8, "0")
      );
    }
  }
}

// ---- CPU <-> Joypad I/O ----

// $4016/$4017 write
function joypadWrite(address, value) {
  value &= 0xFF;

  if (address === 0x4016) {
    const old = joypadStrobe & 1;
    const now = value & 1;
    joypadStrobe = now;

    // open bus mirrors written value
    cpuOpenBus = value & 0xFF;

    latchIfFallingEdge(old, now);

    // mirror (for your debug/inspection)
    JoypadRegister.JOYPAD1 = value;

    if (debugLogging) {
      console.debug(`[W $4016 JOY] val=$${value.toString(16).padStart(2,"0")} strobe=${now}`);
    }

  } else if (address === 0x4017) {
    // You keep strobe behavior unified (matches your previous code)
    joypadStrobe = value & 1;
    cpuOpenBus = value & 0xFF;
    JoypadRegister.JOYPAD2 = value;

    if (debugLogging) {
      console.debug(`[W $4017 JOY] val=$${value.toString(16).padStart(2,"0")} strobe=${joypadStrobe}`);
    }
  }
}

// $4016/$4017 read (bit0 = serial stream; bit6 open bus commonly high)
function joypadRead(address) {
  let result = 0x40; // keep bit6 set like your core

  if (address === 0x4016) {
    const strobe = joypadStrobe & 1;

    // strobe=1 → read live A repeatedly; strobe=0 → shift latched bits LSB-first
    const bit = strobe ? (pollController1() & 1) : (joypad1State & 1);
    result |= bit;

    if (!strobe) joypad1State = ((joypad1State >> 1) | 0x80) & 0xFF;

    cpuOpenBus = result & 0xFF;

    if (debugLogging) {
      console.debug(
        `[R $4016 JOY] -> $${result.toString(16).padStart(2,"0")} ` +
        `P1_shift=${joypad1State.toString(2).padStart(8,"0")}`
      );
    }
    return result & 0xFF;
  }

  if (address === 0x4017) {
    const strobe = joypadStrobe & 1;
    const bit = strobe ? (pollController2() & 1) : (joypad2State & 1);
    result |= bit;

    if (!strobe) joypad2State = ((joypad2State >> 1) | 0x80) & 0xFF;

    cpuOpenBus = result & 0xFF;

    if (debugLogging) {
      console.debug(
        `[R $4017 JOY] -> $${result.toString(16).padStart(2,"0")} ` +
        `P2_shift=${joypad2State.toString(2).padStart(8,"0")}`
      );
    }
    return result & 0xFF;
  }

  // unmapped: return bus
  return cpuOpenBus & 0xFF;
}
