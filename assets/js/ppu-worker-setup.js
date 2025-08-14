// worker-side shared array buffer hookup

let SHARED = {};

// same alias setup as main thread
function setupMultiThreadVariables() {
    Object.defineProperties(globalThis, {
        PPUCTRL:     { get: () => SHARED.PPU_REGS[0],  set: v => { SHARED.PPU_REGS[0]  = v & 0xFF; } },
        PPUMASK:     { get: () => SHARED.PPU_REGS[1],  set: v => { SHARED.PPU_REGS[1]  = v & 0xFF; } },
        PPUSTATUS:   { get: () => SHARED.PPU_REGS[2],  set: v => { SHARED.PPU_REGS[2]  = v & 0xFF; } },
        OAMADDR:     { get: () => SHARED.PPU_REGS[3],  set: v => { SHARED.PPU_REGS[3]  = v & 0xFF; } },
        OAMDATA:     { get: () => SHARED.PPU_REGS[4],  set: v => { SHARED.PPU_REGS[4]  = v & 0xFF; } },
        SCROLL_X:    { get: () => SHARED.PPU_REGS[5],  set: v => { SHARED.PPU_REGS[5]  = v & 0xFF; } },
        SCROLL_Y:    { get: () => SHARED.PPU_REGS[6],  set: v => { SHARED.PPU_REGS[6]  = v & 0xFF; } },
        ADDR_HIGH:   { get: () => SHARED.PPU_REGS[7],  set: v => { SHARED.PPU_REGS[7]  = v & 0xFF; } },
        ADDR_LOW:    { get: () => SHARED.PPU_REGS[8],  set: v => { SHARED.PPU_REGS[8]  = v & 0xFF; } },
        t_lo:        { get: () => SHARED.PPU_REGS[9],  set: v => { SHARED.PPU_REGS[9]  = v & 0xFF; } },
        t_hi:        { get: () => SHARED.PPU_REGS[10], set: v => { SHARED.PPU_REGS[10] = v & 0xFF; } },
        fineX:       { get: () => SHARED.PPU_REGS[11], set: v => { SHARED.PPU_REGS[11] = v & 0xFF; } },
        writeToggle: { get: () => SHARED.PPU_REGS[12], set: v => { SHARED.PPU_REGS[12] = v & 0xFF; } },
        VRAM_DATA:   { get: () => SHARED.PPU_REGS[13], set: v => { SHARED.PPU_REGS[13] = v & 0xFF; } },
        BG_ntByte:   { get: () => SHARED.PPU_REGS[14], set: v => { SHARED.PPU_REGS[14] = v & 0xFF; } },
        BG_atByte:   { get: () => SHARED.PPU_REGS[15], set: v => { SHARED.PPU_REGS[15] = v & 0xFF; } },
        BG_tileLo:   { get: () => SHARED.PPU_REGS[16], set: v => { SHARED.PPU_REGS[16] = v & 0xFF; } },
        BG_tileHi:   { get: () => SHARED.PPU_REGS[17], set: v => { SHARED.PPU_REGS[17] = v & 0xFF; } },
        VRAM_ADDR:   { get: () => SHARED.VRAM_ADDR[0], set: v => { SHARED.VRAM_ADDR[0] = v & 0xFFFF; } }
    });

    Object.defineProperties(globalThis, {
        CHR_ROM:     { get: () => SHARED.CHR_ROM },
        VRAM:        { get: () => SHARED.VRAM },
        PALETTE_RAM: { get: () => SHARED.PALETTE_RAM },
        OAM:         { get: () => SHARED.OAM }
    });

    Object.defineProperties(globalThis, {
        cpuCycles: { get: () => SHARED.CLOCKS[0], set: v => { SHARED.CLOCKS[0] = v | 0; } },
        ppuCycles: { get: () => SHARED.CLOCKS[1], set: v => { SHARED.CLOCKS[1] = v | 0; } },

        cpuOpenBus: { get: () => SHARED.CPU_OPENBUS[0], set: v => { SHARED.CPU_OPENBUS[0] = v & 0xFF; } },

        nmiPending: { get: () => (SHARED.EVENTS[0] & 0b00000001) !== 0,
                      set: v => { v ? SHARED.EVENTS[0] |= 0b00000001 : SHARED.EVENTS[0] &= ~0b00000001; } },
        irqPending: { get: () => (SHARED.EVENTS[0] & 0b00000010) !== 0,
                      set: v => { v ? SHARED.EVENTS[0] |= 0b00000010 : SHARED.EVENTS[0] &= ~0b00000010; } }
    });
}

// get SABs from main thread and bind aliases
onmessage = (e) => {
    if (!e.data) return;

    const d = e.data;

    // SAB hookup
    if (d.SAB_CLOCKS) {
        SHARED.SAB_CLOCKS      = d.SAB_CLOCKS;
        SHARED.SAB_EVENTS      = d.SAB_EVENTS;
        SHARED.SAB_FRAME       = d.SAB_FRAME;
        SHARED.SAB_CPU_OPENBUS = d.SAB_CPU_OPENBUS;
        SHARED.SAB_PPU_REGS    = d.SAB_PPU_REGS;
        SHARED.SAB_CHR         = d.SAB_ASSETS.CHR_ROM;
        SHARED.SAB_VRAM        = d.SAB_ASSETS.VRAM;
        SHARED.SAB_PALETTE     = d.SAB_ASSETS.PALETTE_RAM;
        SHARED.SAB_OAM         = d.SAB_ASSETS.OAM;
        SHARED.SAB_VRAM_ADDR   = d.SAB_VRAM_ADDR;

        SHARED.CLOCKS      = new Int32Array(SHARED.SAB_CLOCKS);
        SHARED.EVENTS      = new Int32Array(SHARED.SAB_EVENTS);
        SHARED.FRAME       = new Int32Array(SHARED.SAB_FRAME);
        SHARED.CPU_OPENBUS = new Uint8Array(SHARED.SAB_CPU_OPENBUS);
        SHARED.PPU_REGS    = new Uint8Array(SHARED.SAB_PPU_REGS);
        SHARED.VRAM_ADDR   = new Uint16Array(SHARED.SAB_VRAM_ADDR);
        SHARED.CHR_ROM     = new Uint8Array(SHARED.SAB_CHR);
        SHARED.VRAM        = new Uint8Array(SHARED.SAB_VRAM);
        SHARED.PALETTE_RAM = new Uint8Array(SHARED.SAB_PALETTE);
        SHARED.OAM         = new Uint8Array(SHARED.SAB_OAM);

        setupMultiThreadVariables();

        postMessage({ type: 'ready' });
        return;
    }

    // ROM ready signal
    if (d.type === 'romReady') {
        romReady = true;
        startPump();
        return;
    }

    // PPU reset signal
    if (d.type === 'ppu-reset') {
        resetPPU();
        return;
    }
};