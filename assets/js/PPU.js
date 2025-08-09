// PPU Registers
let PPUregister = {
  CTRL:      0x00, // $2000
  MASK:      0x00, // $2001
  STATUS:    0x00, // $2002
  OAMADDR:   0x00, // $2003
  OAMDATA:   0x00, // $2004
  SCROLL_X:  0x00, // $2005 (first write)
  SCROLL_Y:  0x00, // $2005 (second write)
  ADDR_HIGH: 0x00, // $2006 (first write)
  ADDR_LOW:  0x00, // $2006 (second write)
  VRAM_ADDR: 0x0000, // 15-bit current VRAM address
  VRAM_DATA: 0x00, // Read buffer for $2007
  writeToggle: false
};

function dmaTransfer(value) {
    // value = page number (upper 8 bits of source address)
    let start = value << 8; // $XX00

    // Copy 256 bytes from CPU RAM to OAM
    for (let i = 0; i < 256; ++i) {
        // NES hardware: Only RAM ($0000–$07FF) is directly DMA'able. Mirroring applies.
        PPU_OAM[i] = systemMemory[(start + i) & 0x7FF];
    }

    // Add correct cycle penalty:
    // If CPU is on an **odd** cycle, penalty = 514 cycles
    // If CPU is on an **even** cycle, penalty = 513 cycles
    cpuCycles += (cpuCycles & 1) ? 514 : 513;
}

// VRAM: $0000–$1FFF (pattern tables, usually ROM, sometimes RAM)
window.ppuCHR = new Uint8Array(0x2000);

// Nametables: $2000–$2FFF (2KB, mirrors handled externally for 4-screen, etc)
window.ppuNT = new Uint8Array(0x1000); // Nametable RAM (standard NES: 2KB mirrored)

// Palette RAM: $3F00–$3F1F
window.ppuPalette = new Uint8Array(0x20);

// OAM (sprite memory)
let PPU_OAM = new Uint8Array(256);

// Handles all writes to PPU registers ($2000–$2007 only, receive base/ folded address)
function ppuWrite(addr, value) {
  value &= 0xFF;
  switch (addr) {
    case 0x2000: PPUregister.CTRL = value;      cpuOpenBus = value; break;
    case 0x2001: PPUregister.MASK = value;      cpuOpenBus = value; break;


    case 0x2002: /* read-only */ 
    //window.alert("attempt made to write to PPU status (read only register)"); 
    
    //PPUregister.STATUS = value; // for test suite only
    
    break;




    case 0x2003: PPUregister.OAMADDR = value;   cpuOpenBus = value; break;
    case 0x2004:
      PPU_OAM[PPUregister.OAMADDR] = value;
      PPUregister.OAMDATA = value;
      PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF;
      cpuOpenBus = value;
      break;
    case 0x2005:
      if (!PPUregister.writeToggle) PPUregister.SCROLL_X = value;
      else                          PPUregister.SCROLL_Y = value;
      PPUregister.writeToggle = !PPUregister.writeToggle;
      cpuOpenBus = value;
      break;
    case 0x2006:
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value;
        PPUregister.VRAM_ADDR = ((value & 0x3F) << 8) | (PPUregister.VRAM_ADDR & 0xFF);
      } else {
        PPUregister.ADDR_LOW = value;
        PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & 0x3F00) | value;
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      cpuOpenBus = value;
      break;
    case 0x2007: {
      let v = PPUregister.VRAM_ADDR & 0x3FFF;
      if      (v < 0x2000)  ppuCHR[v] = value; // CHR-ROM/RAM
      else if (v < 0x3F00)  ppuNT[v & 0x0FFF] = value; // Nametables
      else if (v < 0x4000) {
        let palAddr = v & 0x1F;
        if ([0x10, 0x14, 0x18, 0x1C].includes(palAddr)) palAddr &= ~0x10;
        ppuPalette[palAddr] = value;
      }
      // VRAM increment: 1 or 32
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      cpuOpenBus = value;
      break;
    }
    default: break;
  }
}

// Handles all reads from PPU registers ($2000–$2007 only, receive base/ folded address)
function ppuRead(addr) {
  switch (addr) {
    case 0x2002: { // PPUSTATUS
      let status = PPUregister.STATUS;
      PPUregister.STATUS &= 0x7F;
      PPUregister.writeToggle = false;
      cpuOpenBus = status;
      return status;
    }
    case 0x2004: { // OAMDATA
      let val = PPU_OAM[PPUregister.OAMADDR];
      cpuOpenBus = val;
      return val;
    }
    case 0x2007: {
      let v = PPUregister.VRAM_ADDR & 0x3FFF, ret;
      if      (v < 0x2000) { ret = PPUregister.VRAM_DATA; PPUregister.VRAM_DATA = ppuCHR[v]; }
      else if (v < 0x3F00) { ret = PPUregister.VRAM_DATA; PPUregister.VRAM_DATA = ppuNT[v & 0x0FFF]; }
      else if (v < 0x4000) {
        let palAddr = v & 0x1F;
        if ([0x10, 0x14, 0x18, 0x1C].includes(palAddr)) palAddr &= ~0x10;
        ret = ppuPalette[palAddr];
        PPUregister.VRAM_DATA = ppuPalette[palAddr];
      }
      // VRAM increment: 1 or 32
      const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
      PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
      cpuOpenBus = ret;
      return ret;
    }
    // All other registers return open bus (including write-only regs)
    default:
      return cpuOpenBus;
  }
}
