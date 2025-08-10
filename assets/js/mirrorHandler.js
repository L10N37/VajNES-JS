// mirror logic, fold mirrored offsets down to base offset so they're all seen as one

function foldMirrors(address) {
    // 1. CPU RAM ($0000-$1FFF, mirrored every $800)
    if (address >= 0x0000 && address <= 0x1FFF)
        return address & 0x07FF;

    // 2. PPU registers ($2000-$3FFF, mirrored every $8)
    if (address >= 0x2000 && address <= 0x3FFF)
        return 0x2000 + ((address - 0x2000) % 8);

    /*
    // 3. Palette RAM ($3F00-$3FFF, mirrored every $20 with aliasing)
    if (address >= 0x3F00 && address <= 0x3FFF) {
        let palAddr = 0x3F00 + (address & 0x1F);
        // Aliasing: $3F10/$3F14/$3F18/$3F1C mirror $3F00/$3F04/$3F08/$3F0C
        if ((palAddr & 0x13) === 0x10)
            palAddr &= ~0x10;
        return palAddr;
    }
*/
    // 4. APU and I/O ($4000-$401F): not mirrored, pass through

    // 5. Cartridge space ($4020-$FFFF): not mirrored, pass through

    // 6. Everything else (open bus)
    return address;
}
