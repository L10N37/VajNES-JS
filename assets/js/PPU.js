// assets/js/PPU.js
// NES Picture Processing Unit (basic implementation)

// PPU registers object matching standard memory-mapped registers
window.PPUregisters = {
  PPUCTRL:      0x00, // $2000
  PPUMASK:      0x00, // $2001
  PPUSTATUS:    0x00, // $2002
  OAMADDR:      0x00, // $2003
  OAMDATA:      0x00, // $2004
  PPUSCROLL_X:  0x00, // first write to $2005
  PPUSCROLL_Y:  0x00, // second write to $2005
  PPUADDR_HIGH: 0x00, // first write to $2006
  PPUADDR_LOW:  0x00, // second write to $2006
  PPUDATA:      0x00  // $2007
};

// Array of PPU register keys in the order of your debug table rows
window.PPU_VARIABLES = ['PPUCTRL', 'PPUMASK', 'PPUSTATUS','OAMADDR', 'OAMDATA',
  'PPUSCROLL_X', 'PPUSCROLL_Y','PPUADDR_HIGH', 'PPUADDR_LOW','PPUDATA'
];

// Internal toggle bit for two-step registers (scroll and address)
let writeToggle = false;

// PPU read handler (mimics mirror and register behavior)
window.ppuRead = function(reg) {
  switch (reg) {
    case 0: // PPUCTRL
      return window.PPUregisters.PPUCTRL;
    case 1: // PPUMASK
      return window.PPUregisters.PPUMASK;
    case 2: // PPUSTATUS
      writeToggle = false; // clear toggle on status read
      return window.PPUregisters.PPUSTATUS;
    case 3: // OAMADDR
      return window.PPUregisters.OAMADDR;
    case 4: // OAMDATA
      return window.PPUregisters.OAMDATA;
    case 5: // PPUSCROLL
      // return X on first, Y on second
      return writeToggle ? window.PPUregisters.PPUSCROLL_Y
                         : window.PPUregisters.PPUSCROLL_X;
    case 6: // PPUADDR
      return writeToggle ? window.PPUregisters.PPUADDR_LOW
                         : window.PPUregisters.PPUADDR_HIGH;
    case 7: // PPUDATA
      return window.PPUregisters.PPUDATA;
    default:
      return 0;
  }
};

// PPU write handler
window.ppuWrite = function(reg, value) {
  switch (reg) {
    case 0: // PPUCTRL
      window.PPUregisters.PPUCTRL = value;
      break;
    case 1: // PPUMASK
      window.PPUregisters.PPUMASK = value;
      break;
    case 2: // PPUSTATUS (write ignored)
      break;
    case 3: // OAMADDR
      window.PPUregisters.OAMADDR = value;
      break;
    case 4: // OAMDATA
      window.PPUregisters.OAMDATA = value;
      break;
    case 5: // PPUSCROLL
      if (!writeToggle) {
        window.PPUregisters.PPUSCROLL_X = value;
      } else {
        window.PPUregisters.PPUSCROLL_Y = value;
      }
      writeToggle = !writeToggle;
      break;
    case 6: // PPUADDR
      if (!writeToggle) {
        window.PPUregisters.PPUADDR_HIGH = value;
      } else {
        window.PPUregisters.PPUADDR_LOW = value;
      }
      writeToggle = !writeToggle;
      break;
    case 7: // PPUDATA
      window.PPUregisters.PPUDATA = value;
      break;
  }
};
