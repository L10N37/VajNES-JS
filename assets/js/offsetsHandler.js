// Routes all CPU reads/writes to their proper handler after folding for mirrors.
// Always update cpuOpenBus on every read/write.

function checkReadOffset(address) {
    const addr = foldMirrors(address);
    let value;

    if (addr < 0x2000) { // CPU RAM
        value = cpuRead(addr);
    }
    else if (addr < 0x4000) { // PPU registers
        value = ppuRead(addr);
    }
    else if (addr < 0x4020) { // APU & I/O
        value = apuRead(addr);
    }
    else if (addr < 0x6000) { // Expansion, mapper-dependent, treat as open bus by default
        value = openBusRead(addr);
    }
    else if (addr >= 0x8000 && addr <= 0xFFFF) { // ======== CARTRIDGE READING ========
    // strip off the $8000 base and pull straight from PRG-ROM buffer
    value = prgRom[addr - 0x8000];
    }
    else {
        value = openBusRead(addr);
    }

    // Always update open bus on every read
    cpuOpenBus = value & 0xFF;
    return value & 0xFF;
}

function checkWriteOffset(address, value) {
    const addr = foldMirrors(address);
    value = value & 0xFF; // enforce 8-bit

    if (addr < 0x2000) { // CPU RAM
        cpuWrite(addr, value);
    }
    else if (addr < 0x4000) { // PPU registers
        ppuWrite(addr, value);
    }
    else if (addr === 0x4014) { // OAM DMA
    dmaTransfer(value); // <--- DMA handler here}
    }
    else if (addr < 0x4020) { // APU & I/O
        apuWrite(addr, value);
    }
    else if (addr < 0x6000) { // Expansion, mapper-dependent
        openBusWrite(addr, value);
    }
    else if (addr < 0x8000) {          // PRG-RAM (GAME SAVES)
        prgRam[addr - 0x6000] = value;
    }
    else if (addr <= 0xFFFF) {         // PRG-ROM (for tests), probably not required
        prgRom[addr - 0x8000] = value;
    }
    // else do nothing

    // Always update open bus
    cpuOpenBus = value & 0xFF;
}

// Fallback open bus read/write handlers
function openBusRead(addr) { return cpuOpenBus; }
function openBusWrite(addr, value) { /* no-op */ }
