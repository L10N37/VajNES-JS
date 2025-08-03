// PPU hardware register variables, set and read by intercepted offset writes
let PPUregister = {
    CTRL:       0x00,  // $2000 - write-only
    MASK:       0x00,  // $2001 - write-only
    STATUS:     0x00,  // $2002 - read-only
    OAMADDR:    0x00,  // $2003
    OAMDATA:    0x00,  // $2004
    SCROLL_X:   0x00,  // first write to $2005
    SCROLL_Y:   0x00,  // second write to $2005
    ADDR_HIGH:  0x00,  // first write to $2006
    ADDR_LOW:   0x00,  // second write to $2006
    VRAM_ADDR:  0x0000,// current 15-bit address into PPU memory
    VRAM_DATA:  0x00,  // read buffer for $2007
    writeToggle: false // toggle between high/low writes (PPUSCROLL/PPUADDR)
  };

const PPU_REG_ADDRESSES = {
  0x2000: "PPUCTRL",    // $2000 - write
  0x2001: "PPUMASK",    // $2001 - write
  0x2002: "PPUSTATUS",  // $2002 - read
  0x2003: "OAMADDR",    // $2003 - write
  0x2004: "OAMDATA",    // $2004 - read/write
  0x2005: "PPUSCROLL",  // $2005 - write x2 (toggle)
  0x2006: "PPUADDR",    // $2006 - write x2 (toggle)
  0x2007: "PPUDATA"     // $2007 - read/write
};

let PPU_OAM = new Uint8Array(256); // Not part of systemMemory, declaring here as its stored in the PPU, but eh either, I-ther


/**
 * NES PPU Register/VRAM Access (Read/Write) — covers the main quirks:
 * - Register mirroring ($2000-$3FFF every 8 bytes)
 * - Two-write toggles for PPUADDR/PPUSCROLL
 * - OAMDATA, OAMADDR, and quirks during DMA and rendering
 * - VRAM buffering for $2007 reads
 * - Palette RAM mirroring ($3F00-$3FFF)
 * - PPUSTATUS side effects (VBlank clear, toggle reset)
 * - Open bus: reads from write-only/unmapped registers return last bus value (cpuOpenBus).
 */

function ppuWrite(address, value) {
  // --- Register mirror logic: $2008-$3FFF mirrors $2000-$2007 every 8 bytes
  let mirrorAddr = address; // Keep original for open bus/viewer/tests
  if (address >= 0x2008 && address <= 0x3FFF)
    address = 0x2000 + ((address - 0x2000) % 8);

  // Always write to both the mirror offset AND the base register
  systemMemory[mirrorAddr] = value;
  systemMemory[address]    = value;

  switch (address) {
    case 0x2000: // PPUCTRL (write-only)
      PPUregister.CTRL = value & 0xFF;
      cpuOpenBus = value & 0xFF; // Writes update the bus
      return;
    case 0x2001: // PPUMASK (write-only)
      PPUregister.MASK = value & 0xFF;
      cpuOpenBus = value & 0xFF;
      return;
    case 0x2002: // PPUSTATUS (read-only, no effect on write)
      return;
    case 0x2003: // OAMADDR (write-only)
      PPUregister.OAMADDR = value & 0xFF;
      cpuOpenBus = value & 0xFF;
      return;
    case 0x2004: // OAMDATA (read/write)
      PPUregister.OAMDATA = value & 0xFF;
      systemMemory[0x200 + (PPUregister.OAMADDR & 0xFF)] = value & 0xFF;
      PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF;
      cpuOpenBus = value & 0xFF;
      return;
    case 0x2005: // PPUSCROLL (write x2, toggles between X and Y)
      if (!PPUregister.writeToggle) {
        PPUregister.SCROLL_X = value & 0xFF;
      } else {
        PPUregister.SCROLL_Y = value & 0xFF;
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      cpuOpenBus = value & 0xFF;
      return;
    case 0x2006: // PPUADDR (write x2, high then low)
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value & 0xFF;
        PPUregister.VRAM_ADDR = ((value & 0x3F) << 8) | (PPUregister.VRAM_ADDR & 0x00FF);
      } else {
        PPUregister.ADDR_LOW = value & 0xFF;
        PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & 0x3F00) | (value & 0xFF);
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      cpuOpenBus = value & 0xFF;
      return;
    case 0x2007: // PPUDATA (VRAM write)
      {
        let vAddr = PPUregister.VRAM_ADDR & 0x3FFF;
        // VRAM write: systemMemory is used as backing for VRAM/palette
        systemMemory[vAddr] = value & 0xFF;
        PPUregister.VRAM_DATA = value & 0xFF; // Keep data buffer for open bus reads
        // Auto-increment VRAM_ADDR (by 1 or 32, depending on bit 2 of CTRL)
        const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
        PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
        systemMemory[0x2007] = value; // Write to register for test harnesses
        cpuOpenBus = value & 0xFF;
        return;
      }
    default:
      // Writes to mirrors/fallback areas (should never happen, but for completeness)
      return;
  }
}

function ppuRead(address) {
  // --- Register mirror logic: $2008-$3FFF mirrors $2000-$2007 every 8 bytes
  if (address >= 0x2008 && address <= 0x3FFF)
    address = 0x2000 + ((address - 0x2000) % 8);

  switch (address) {
    case 0x2002: // PPUSTATUS (read-only, clears VBlank and writeToggle)
      const status = PPUregister.STATUS;
      PPUregister.STATUS &= 0x7F; // Clear VBlank flag (bit 7)
      PPUregister.writeToggle = false; // Reset toggle for $2005/$2006
      cpuOpenBus = status; // Update open bus value
      return status;
    case 0x2004: // OAMDATA (read/write)
      // Read OAMDATA at current OAMADDR, with glitch if during rendering/DMA (not emulated here)
      PPUregister.OAMDATA = systemMemory[0x200 + (PPUregister.OAMADDR & 0xFF)] & 0xFF;
      cpuOpenBus = PPUregister.OAMDATA; // Update open bus value
      return PPUregister.OAMDATA;
    case 0x2007: // PPUDATA (read VRAM, buffer except palette RAM)
      {
        let vAddr = PPUregister.VRAM_ADDR & 0x3FFF;
        let readValue;
        // Palette mirroring: $3F10/$3F14/$3F18/$3F1C mirror to $3F00/$3F04/$3F08/$3F0C
        if ((vAddr & 0x3F00) === 0x3F00) {
          let paletteAddr = vAddr & 0x1F;
          if ([0x10, 0x14, 0x18, 0x1C].includes(paletteAddr))
            vAddr = (vAddr & ~0x10);
          // Reads from palette RAM are immediate, no buffer
          readValue = systemMemory[vAddr] & 0xFF;
          PPUregister.VRAM_DATA = systemMemory[vAddr] & 0xFF; // Update buffer anyway (minor quirk)
        } else {
          // All other reads are buffered
          readValue = PPUregister.VRAM_DATA;
          PPUregister.VRAM_DATA = systemMemory[vAddr] & 0xFF;
        }
        // Auto-increment VRAM_ADDR (by 1 or 32, depending on bit 2 of CTRL)
        const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
        PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
        cpuOpenBus = readValue; // Update open bus value
        return readValue;
      }
    // For write-only registers, **do NOT update cpuOpenBus**—just return it:
    case 0x2000: // PPUCTRL (write-only)
    case 0x2001: // PPUMASK (write-only)
    case 0x2003: // OAMADDR (write-only)
    case 0x2005: // PPUSCROLL (write-only)
    case 0x2006: // PPUADDR (write-only)
      // Open bus: return the last bus value, do NOT update
      return cpuOpenBus;
    default:
      // Reads from mirrors/fallback: just return open bus
      return cpuOpenBus;
  }
}
