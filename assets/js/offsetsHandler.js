
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

const OB_DONE = {
  T1:false, T2:false, T3:false, T4:false,
  T5:false, T6:false, T7:false, T8:false, T9:false
};

function _ob2(x){ return (x & 0xFF).toString(16).padStart(2, "0"); }
function _ob4(x){ return (x & 0xFFFF).toString(16).padStart(4, "0"); }
function _pc(){ return (CPUregisters && typeof CPUregisters.PC === "number") ? (CPUregisters.PC & 0xFFFF) : 0xFFFF; }
function _codeNow(){ return (typeof code === "number") ? (code & 0xFF) : 0xFF; }

function obResult(testId, pass, msg) {
  if (!debug.openBusTests) return;
  if (OB_DONE[testId]) return;
  OB_DONE[testId] = true;

  const style = pass
    ? "color:#00ff66;background:#052612;font-weight:bold;padding:2px 6px;border-radius:4px;"
    : "color:#ff3b3b;background:#2a0000;font-weight:bold;padding:2px 6px;border-radius:4px;";

  console.log(`%c[OPENBUS ${testId} ${pass ? "PASS" : "FAIL"}] %c${msg}`, style, "color:inherit;background:inherit;");
}

// ----------------- bus driver ring buffer -----------------
const BUSLOG = {
  buf: new Array(256),
  i: 0,
  n: 0,
  max: 256
};

function buslogPush(kind, pc, addr, busB, busA, raw, out, codeNow) {
  if (!debug.debugOpenBusT4Trace) return;
  const e = {
    kind,
    pc: pc & 0xFFFF,
    addr: addr & 0xFFFF,
    busB: busB & 0xFF,
    busA: busA & 0xFF,
    raw: raw & 0xFF,
    out: out & 0xFF,
    codeNow: codeNow & 0xFF
  };
  BUSLOG.buf[BUSLOG.i] = e;
  BUSLOG.i = (BUSLOG.i + 1) % BUSLOG.max;
  if (BUSLOG.n < BUSLOG.max) BUSLOG.n++;
}

function buslogDump(title, lastN=64) {
  if (!debug.debugOpenBusT4Trace) return;
  const count = Math.min(BUSLOG.n, lastN|0);
  console.log(`[OPENBUS BUSLOG] ${title} count=${count}`);
  const start = (BUSLOG.i - count + BUSLOG.max) % BUSLOG.max;
  for (let k = 0; k < count; k++) {
    const idx = (start + k) % BUSLOG.max;
    const e = BUSLOG.buf[idx];
    if (!e) continue;
    console.log(
      `[BUS] #${k} kind=${e.kind} pc=$${_ob4(e.pc)} addr=$${_ob4(e.addr)} ` +
      `codeNow=$${_ob2(e.codeNow)} busB=$${_ob2(e.busB)} raw=$${_ob2(e.raw)} out=$${_ob2(e.out)} busA=$${_ob2(e.busA)}`
    );
  }
}

// prints immediately when bus becomes $82
let _watch82Once = false;
function watchBus82(pc, addr, busB, busA, raw, out, codeNow) {
  if (!debug.debugOpenBusT4Trace) return;
  if (_watch82Once) return;

  const bA = busA & 0xFF;
  const bB = busB & 0xFF;

  if (bA !== 0x82) return;
  if (bB === 0x82) return;

  _watch82Once = true;
  console.log(
    `[OPENBUS WATCH] bus became $82 pc=$${_ob4(pc)} addr=$${_ob4(addr)} codeNow=$${_ob2(codeNow)} ` +
    `busB=$${_ob2(busB)} raw=$${_ob2(raw)} out=$${_ob2(out)} busA=$${_ob2(busA)}`
  );
  buslogDump("recent history before/at bus->82", 96);
}

// ----------------- T4 trace -----------------
const T4 = {
  active:false,
  entryPc:0,
  entryBus:0,
  wrote60:false,
  events:[],
  max:512
};

function t4Reset() {
  T4.active = false;
  T4.entryPc = 0;
  T4.entryBus = 0;
  T4.wrote60 = false;
  T4.events.length = 0;
}

function t4Push(kind, pc, addr, busB, raw, out, busA, codeNow) {
  if (!debug.debugOpenBusT4Trace) return;
  if (!T4.active) return;
  if (T4.events.length >= T4.max) return;
  T4.events.push({
    kind,
    pc: pc & 0xFFFF,
    addr: addr & 0xFFFF,
    busB: busB & 0xFF,
    raw: raw & 0xFF,
    out: out & 0xFF,
    busA: busA & 0xFF,
    codeNow: codeNow & 0xFF
  });
}

function t4Dump(reason) {
  if (!debug.debugOpenBusT4Trace) return;

  const curPC = _pc();
  const curCode = _codeNow();
  const curBus = openBus.CPU & 0xFF;

  console.log(
    `[OPENBUS T4 TRACE] reason=${reason} events=${T4.events.length} ` +
    `nowPC=$${_ob4(curPC)} nowCode=$${_ob2(curCode)} nowBus=$${_ob2(curBus)} ` +
    `entryPc=$${_ob4(T4.entryPc)} entryBus=$${_ob2(T4.entryBus)} wrote60=${T4.wrote60?1:0}`
  );

  for (let i = 0; i < T4.events.length; i++) {
    const e = T4.events[i];
    const tag = (e.kind === "RD") ? "T4_RD" : "T4_WR";
    if (e.kind === "RD") {
      console.log(
        `[${tag}] #${i} pc=$${_ob4(e.pc)} addr=$${_ob4(e.addr)} codeNow=$${_ob2(e.codeNow)} ` +
        `busB=$${_ob2(e.busB)} raw=$${_ob2(e.raw)} out=$${_ob2(e.out)} busA=$${_ob2(e.busA)}`
      );
    } else {
      console.log(
        `[${tag}] #${i} pc=$${_ob4(e.pc)} addr=$${_ob4(e.addr)} codeNow=$${_ob2(e.codeNow)} ` +
        `busB=$${_ob2(e.busB)} val=$${_ob2(e.raw)} busA=$${_ob2(e.busA)}`
      );
    }
  }

  buslogDump("recent history at T4 end", 128);
}

// ----------------- OpenBus test checks -----------------
function obCheckRead(addr, raw, out, busBefore, busAfter) {
  if (!debug.openBusTests) return;

  const pc = _pc();
  const codeNow = _codeNow();

  if (!OB_DONE.T1 && (addr === 0x5000 || addr === 0x4654)) {
    const pass = (out & 0xFF) !== 0x00;
    obResult("T1", pass, `pc=$${_ob4(pc)} code=$${_ob2(codeNow)} addr=$${_ob4(addr)} out=$${_ob2(out)} (expected != $00)`);
  }

  if (!OB_DONE.T2 && (addr === 0x5501 || addr === 0x4020 || addr === 0x5FFF)) {
    const expect = (addr >>> 8) & 0xFF;
    const pass = (out & 0xFF) === expect;
    obResult("T2", pass, `pc=$${_ob4(pc)} code=$${_ob2(codeNow)} addr=$${_ob4(addr)} out=$${_ob2(out)} expectHi=$${_ob2(expect)}`);
  }

  if (!OB_DONE.T3 && addr === 0x5108) {
    const expect = 0x50;
    const pass = (out & 0xFF) === expect;
    obResult("T3", pass, `pc=$${_ob4(pc)} code=$${_ob2(codeNow)} addr=$${_ob4(addr)} out=$${_ob2(out)} expect=$${_ob2(expect)} busBefore=$${_ob2(busBefore)}`);
  }

  if ((addr === 0x4016 || addr === 0x4017) && (!OB_DONE.T6 || !OB_DONE.T9)) {
    const pass = ((out & 0xFE) === (busBefore & 0xFE));
    const which = !OB_DONE.T6 ? "T6" : "T9";
    obResult(which, pass, `pc=$${_ob4(pc)} code=$${_ob2(codeNow)} addr=$${_ob4(addr)} busBefore=$${_ob2(busBefore)} out=$${_ob2(out)} (expected upper bits from bus)`);
  }

  if (!OB_DONE.T7 && addr === 0x4015) {
    const pass = (busAfter & 0xFF) === (busBefore & 0xFF);
    obResult("T7", pass, `pc=$${_ob4(pc)} code=$${_ob2(codeNow)} addr=$4015 busBefore=$${_ob2(busBefore)} busAfter=$${_ob2(busAfter)} (expected unchanged)`);
  }

  const inT4 = (pc >= 0x5600 && pc < 0x6000);
  const isFetch = ((addr & 0xFFFF) === (pc & 0xFFFF));

  if (!OB_DONE.T4 && inT4 && !T4.active) {
    T4.active = true;
    T4.entryPc = pc & 0xFFFF;
    T4.entryBus = busBefore & 0xFF;
    T4.wrote60 = false;
    buslogDump(`dump at T4 entry entryBus=$${_ob2(T4.entryBus)}`, 96);
  }

  if (T4.active && isFetch) {
    t4Push("RD", pc, addr, busBefore, raw, out, busAfter, codeNow);
  }

  if (!OB_DONE.T4 && T4.active && !inT4) {
    const pass = T4.wrote60 === true;
    if (!pass) {
      obResult("T4", false, `entryPc=$${_ob4(T4.entryPc)} entryBus=$${_ob2(T4.entryBus)} missing write($0056)=$60`);
      t4Dump("missing_write_0056_60");
    } else {
      obResult("T4", true, `entryPc=$${_ob4(T4.entryPc)} entryBus=$${_ob2(T4.entryBus)} saw write($0056)=$60`);
    }
    t4Reset();
  }
}

function obCheckWrite(addr, value, busBefore, busAfter) {
  if (!debug.openBusTests) return;

  const pc = _pc();
  const codeNow = _codeNow();

  if (T4.active) {
    t4Push("WR", pc, addr, busBefore, value & 0xFF, value & 0xFF, busAfter, codeNow);
  }

  if (T4.active && (addr & 0xFFFF) === 0x0056 && (value & 0xFF) === 0x60) {
    T4.wrote60 = true;
  }

  if (!OB_DONE.T8 && (addr & 0xFFFF) === 0x4015) {
    const pass = (busAfter & 0xFF) === (value & 0xFF);
    obResult("T8", pass, `pc=$${_ob4(pc)} code=$${_ob2(codeNow)} addr=$4015 value=$${_ob2(value)} busAfter=$${_ob2(busAfter)} (expected busAfter==value)`);
  }
}

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
  bpCheckRead(addr);

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

      case 0x2004: {

        
        const visibleScanlines = currentScanline >= 0 && currentScanline <= 329;
        const ffDots = currentDot >=1 && currentDot <= 64;
        const renderingEnabled = (PPUMASK & 0b00011000) !== 0;
        //4: Reads from $2004 during PPU cycles 1 to 64 of a visible scanline (with rendering enabled) should always read $FF.
        if (visibleScanlines && ffDots && renderingEnabled) return 0xFF;
        // 5: Reads from $2004 during PPU cycles 1 to 64 of a visible scanline (with rendering disabled) should do a regular read of $2004.
        if (visibleScanlines && ffDots && !renderingEnabled) {
        let oamAddr = OAMADDR & 0xFF;
        let v = OAM[oamAddr];
        return v & 0xFF;
        }

        let oamAddr = OAMADDR & 0xFF;
        let v = OAM[oamAddr];

        // Attribute byte of each sprite (02,06,0A,...): clear bits 2..4
        if ((oamAddr & 3) === 2) v &= 0xE3;

        return v & 0xFF;
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
  const busAfter = openBus.CPU & 0xFF;

  buslogPush("RD", _pc(), addr, busBefore, busAfter, raw, out, codeNow);
  watchBus82(_pc(), addr, busBefore, busAfter, raw, out, codeNow);

  obCheckRead(addr, raw, out, busBefore, busAfter);
  return out;
}

const PPU_WRITE_GATE_CYCLES = 29658;

// ----------------- CPU write dispatch -----------------
function checkWriteOffset(address, value) {
  const addr = address & 0xFFFF;
  value &= 0xFF;
  bpCheckWrite(addr, value);

  const busBefore = openBus.CPU & 0xFF;
  const codeNow = _codeNow();

  if (addr < 0x2000) {
    cpuWrite(addr, value);

  } else if (addr < 0x4000) {
    const reg = 0x2000 + (addr & 0x7);

    // for reset flag behaviour, $2004 is left out in deliberation
    const gateThis =
    (reg === 0x2000 || // PPUCTRL
    reg === 0x2001 || // PPUMASK
    reg === 0x2002 || // PPUSTATUS
    reg === 0x2003 || // OAMADDR
    //reg === 0x2004 || // OAMDATA
    reg === 0x2005 || // PPUSCROLL
    reg === 0x2006 || // PPUADDR
    reg === 0x2007);  // PPUDATA


    if (gateThis && (cpuCycles < PPU_WRITE_GATE_CYCLES)) {
      cpuOpenBusFinalise(addr, value, codeNow, true);
      const busAfterGate = openBus.CPU & 0xFF;

      buslogPush("WR", _pc(), addr, busBefore, busAfterGate, value, value, codeNow);
      watchBus82(_pc(), addr, busBefore, busAfterGate, value, value, codeNow);

      obCheckWrite(addr, value, busBefore, busAfterGate);
      return;
    }

    switch (reg) {
      case 0x2000: {
        const wasEN = (PPUCTRL & 0x80) !== 0;
        PPUCTRL = value;

        const nowEN = (value & 0x80) !== 0;
        if (!wasEN && nowEN && (PPUSTATUS & 0x80)) {
          PPU_FRAME_FLAGS |= 0b00000100;
        }
        break;
      }

      case 0x2001: PPUMASK = value; break;
      case 0x2003: OAMADDR = value & 0xFF; break;

      case 0x2004: {
        const slot = OAMADDR & 0xFF;
        const v = value & 0xFF;

        OAM[slot] = v;
        OAMADDR = (OAMADDR + 1) & 0xFF; // auto-increment after write

        if (debug.oamDma) {
          // Filter out DMA fill noise ($FF)
          if (v !== 0xFF) {
            console.log(
              `2004 write: OAM[${slot.toString(16).padStart(2,'0')}] = ${v.toString(16).padStart(2,'0')}`
            );
          }
        }
        break;
      }

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

      case 0x2006:
        if (writeToggle === 0) { t_hi = value & 0x3F; writeToggle = 1; }
        else { t_lo = value & 0xFF; VRAM_ADDR = (((t_hi << 8) | t_lo) & 0x3FFF); writeToggle = 0; }
        globalThis.writeToggle = writeToggle;
        break;

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
  const busAfter = openBus.CPU & 0xFF;

  buslogPush("WR", _pc(), addr, busBefore, busAfter, value, value, codeNow);
  watchBus82(_pc(), addr, busBefore, busAfter, value, value, codeNow);

  obCheckWrite(addr, value, busBefore, busAfter);
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
  if (address === 0x4016) {
    const strobe = joypadStrobe & 1;
    const bit = strobe ? (pollController1() & 1) : (joypad1State & 1);
    if (!strobe) joypad1State = ((joypad1State >> 1) | 0x80) & 0xFF;
    return bit & 1;
  }

  if (address === 0x4017) {
    const strobe = joypadStrobe & 1;
    const bit = strobe ? (pollController2() & 1) : (joypad2State & 1);
    if (!strobe) joypad2State = ((joypad2State >> 1) | 0x80) & 0xFF;
    return bit & 1;
  }

  return 0;
}
