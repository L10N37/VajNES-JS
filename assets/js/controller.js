let JoypadRegister = {
  JOYPAD1: 0x00,  // $4016, usually bit 0 only
  JOYPAD2: 0x00   // $4017, usually bit 0 only
};

const joypadRegisterNames = {
  0x4016: 'JOYPAD1', // writes here control when to read out both controllers registers (from $4016/ $4017)
  0x4017: 'JOYPAD2'  // shared offsets, refer to comments in APU.js, write -> routed to APU, read -> joypad2
};

// --- Joypad Latch/Shift State ---
let joypadStrobe = 0;       // Current strobe value (0 or 1)
let joypad1State = 0;       // Latched shift register for controller 1
let joypad2State = 0;       // Latched shift register for controller 2

// --- Joypad Write Handler ---
// Writing to $4016 (bit 0) latches controller shift registers if transitioning from 1 to 0
function joypadWrite(address, value) {
  if (address === 0x4016) {
    let oldStrobe = joypadStrobe;
    joypadStrobe = value & 1;            // Only bit 0 matters
    cpuOpenBus = value & 0xFF;           // Update open bus (test ROMs check this)
    // On a transition from 1 to 0, latch current button state into shift registers
    if (oldStrobe && !joypadStrobe) {
      joypad1State = pollController1();  // Replace with your actual poll function
      joypad2State = pollController2();  // Replace with your actual poll function
    }
    // $4016 also written for expansion hardware, but we ignore that for vanilla NES
    JoypadRegister.JOYPAD1 = value & 0xFF;
  }
  // $4017 writes are typically routed to APU (see APU handler), but could store for completeness:
  else if (address === 0x4017) {
    cpuOpenBus = value & 0xFF;
    JoypadRegister.JOYPAD2 = value & 0xFF;
  }
}

// --- Joypad Read Handler ---
// Reads from $4016 and $4017 shift out one bit at a time from their respective shift registers
function joypadRead(address, pad = null) {
  let result = 0x40; // Bits 6 and 7 are open bus or unused (bit 6 = 0 on NES)
  if (address === 0x4016) {
    // Controller 1, shift out next bit or keep highest bit latched if strobe is high
    if (joypadStrobe) {
      result |= pollController1() & 1;
    } else {
      result |= joypad1State & 1;
      joypad1State = (joypad1State >> 1) | 0x80; // Set to 1 to simulate open bus on further reads
    }
    cpuOpenBus = result;
    return result;
  }
  if (address === 0x4017) {
    // Controller 2, same logic
    if (joypadStrobe) {
      result |= pollController2() & 1;
    } else {
      result |= joypad2State & 1;
      joypad2State = (joypad2State >> 1) | 0x80;
    }
    cpuOpenBus = result;
    return result;
  }
  // If not 4016 or 4017, just return open bus for safety
  return cpuOpenBus;
}

// --- Dummy poll functions, TODO, want controller support and translucent btn overlay for phones/ tablets
// Should return 8 bits, one for each button (A, B, Select, Start, Up, Down, Left, Right), bit 0 = A.
function pollController1() {
  
  return 0x00;
}
function pollController2() {
  
  return 0x00;
}
