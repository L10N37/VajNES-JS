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