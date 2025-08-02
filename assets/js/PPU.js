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
  0x2000: "CTRL",         // PPUCTRL   - write
  0x2001: "MASK",         // PPUMASK   - write
  0x2002: "STATUS",       // PPUSTATUS - read
  0x2003: "OAMADDR",      // OAMADDR   - write
  0x2004: "OAMDATA",      // OAMDATA   - read/write
  0x2005: "SCROLL",       // PPUSCROLL - write x2 (toggle)
  0x2006: "ADDR",         // PPUADDR   - write x2 (toggle)
  0x2007: "VRAM_DATA"     // PPUDATA   - read/write
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
 * - Open bus and ghost write notes
 */

function ppuWrite(address, value) {
  // --- Register mirror logic: $2008-$3FFF mirrors $2000-$2007 every 8 bytes
  if (address >= 0x2008 && address <= 0x3FFF)
    address = 0x2000 + ((address - 0x2000) % 8);

  switch (address) {
    case 0x2000: // PPUCTRL (write-only)
      PPUregister.CTRL = value & 0xFF;
      // Ghost write: store to systemMemory for open bus emulation
      systemMemory[address] = value;
      return;
    case 0x2001: // PPUMASK (write-only)
      PPUregister.MASK = value & 0xFF;
      systemMemory[address] = value;
      return;
    case 0x2002: // PPUSTATUS (read-only)
      // Writes here are ignored on hardware but may affect open bus (not emulated here)
      return;
    case 0x2003: // OAMADDR (write-only)
      PPUregister.OAMADDR = value & 0xFF;
      systemMemory[address] = value;
      return;
    case 0x2004: // OAMDATA (read/write)
      // Write OAMDATA at OAMADDR, increments OAMADDR
      PPUregister.OAMDATA = value & 0xFF;
      systemMemory[address] = value; // Ghost for open bus
      // Write to OAM memory (typically at 0x200, but usually a separate array in more accurate emulators)
      // We'll assume OAM lives at systemMemory[0x0200–0x02FF]:
      systemMemory[0x200 + (PPUregister.OAMADDR & 0xFF)] = value & 0xFF;
      PPUregister.OAMADDR = (PPUregister.OAMADDR + 1) & 0xFF;
      return;
    case 0x2005: // PPUSCROLL (write x2, toggles between X and Y)
      if (!PPUregister.writeToggle) {
        PPUregister.SCROLL_X = value & 0xFF;
      } else {
        PPUregister.SCROLL_Y = value & 0xFF;
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      systemMemory[address] = value;
      return;
    case 0x2006: // PPUADDR (write x2, high then low)
      if (!PPUregister.writeToggle) {
        PPUregister.ADDR_HIGH = value & 0xFF;
        PPUregister.VRAM_ADDR = ((value & 0x3F) << 8) | (PPUregister.VRAM_ADDR & 0x00FF); // 14 bits
      } else {
        PPUregister.ADDR_LOW = value & 0xFF;
        PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR & 0x3F00) | (value & 0xFF);
      }
      PPUregister.writeToggle = !PPUregister.writeToggle;
      systemMemory[address] = value;
      return;
    case 0x2007: // PPUDATA (VRAM write)
      {
        let vAddr = PPUregister.VRAM_ADDR & 0x3FFF;
        // Palette mirroring: $3F10/$3F14/$3F18/$3F1C map to $3F00/$3F04/$3F08/$3F0C
        if ((vAddr & 0x3F00) === 0x3F00) {
          let paletteAddr = vAddr & 0x1F;
          if ([0x10, 0x14, 0x18, 0x1C].includes(paletteAddr))
            vAddr = (vAddr & ~0x10); // Mirror to $3F00/$3F04/$3F08/$3F0C
        }
        // VRAM write: systemMemory is used as backing for VRAM/palette
        systemMemory[vAddr] = value & 0xFF;
        PPUregister.VRAM_DATA = value & 0xFF; // Keep data buffer for open bus reads
        // Auto-increment VRAM_ADDR (by 1 or 32, depending on bit 2 of CTRL)
        const step = (PPUregister.CTRL & 0x04) ? 32 : 1;
        PPUregister.VRAM_ADDR = (PPUregister.VRAM_ADDR + step) & 0x3FFF;
        systemMemory[address] = value; // Ghost write for open bus
        return;
      }
    default:
      // Writes to mirrors/fallback areas (should never happen, but for completeness)
      systemMemory[address] = value;
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
      return status;
    case 0x2004: // OAMDATA (read/write)
      // Read OAMDATA at current OAMADDR, with glitch if during rendering/DMA (not emulated here)
      PPUregister.OAMDATA = systemMemory[0x200 + (PPUregister.OAMADDR & 0xFF)] & 0xFF;
      return PPUregister.OAMDATA;
    case 0x2007: // PPUDATA (read VRAM, buffer except palette RAM)
      {
        let vAddr = PPUregister.VRAM_ADDR & 0x3FFF;
        let readValue;
        // Palette mirroring: $3F10/$3F14/$3F18/$3F1C map to $3F00/$3F04/$3F08/$3F0C
        if ((vAddr & 0x3F00) === 0x3F00) {
          let paletteAddr = vAddr & 0x1F;
          if ([0x10, 0x14, 0x18, 0x1C].includes(paletteAddr))
            vAddr = (vAddr & ~0x10); // Mirror to $3F00/$3F04/$3F08/$3F0C
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
        return readValue;
      }
    // Open bus for write-only registers, or return last value for ghost bus
    case 0x2000: // PPUCTRL (write-only)
    case 0x2001: // PPUMASK (write-only)
    case 0x2003: // OAMADDR (write-only)
    case 0x2005: // PPUSCROLL (write-only)
    case 0x2006: // PPUADDR (write-only)
      // "Open bus" read: return last bus value (optional)
      // Could return 0xFF, 0x00, or systemMemory[address], or keep a global lastBusValue
      return systemMemory[address] ?? 0x00;
    default:
      // Reads from mirrors/fallback (shouldn't happen, just return open bus)
      return systemMemory[address] ?? 0x00;
  }
}
