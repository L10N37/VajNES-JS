// Minimal NES joypad logic (just $4016/$4017), no systemMemory, joypad registers totally separate

let JoypadRegister = { JOYPAD1: 0x00, JOYPAD2: 0x00 };

let joypadStrobe = 0; // $4016 bit 0, latching
let joypad1State = 0; // Shift register for controller 1
let joypad2State = 0; // Shift register for controller 2

// Latch controller shift registers on 1->0 transition
function joypadWrite(address, value) {
  if (address === 0x4016) {
    let oldStrobe = joypadStrobe;
    joypadStrobe = value & 1;
    cpuOpenBus = value;
    if (oldStrobe && !joypadStrobe) {
      joypad1State = pollController1();
      joypad2State = pollController2();
    }
    JoypadRegister.JOYPAD1 = value;
  } else if (address === 0x4017) {
    cpuOpenBus = value;
    JoypadRegister.JOYPAD2 = value;
  }
}

// Shift out button state on each read (A, B, Select, Start, Up, Down, Left, Right, in bit 0)
function joypadRead(address, pad = null) {
  let result = 0x40; // NES: bits 6 and 7 open bus/unused
  if (address === 0x4016) {
    result |= joypadStrobe ? (pollController1() & 1) : (joypad1State & 1);
    if (!joypadStrobe) joypad1State = (joypad1State >> 1) | 0x80;
    cpuOpenBus = result;
    return result;
  }
  if (address === 0x4017) {
    result |= joypadStrobe ? (pollController2() & 1) : (joypad2State & 1);
    if (!joypadStrobe) joypad2State = (joypad2State >> 1) | 0x80;
    cpuOpenBus = result;
    return result;
  }
  return cpuOpenBus;
}

//dummys
function pollController1() { return 0x00; }
function pollController2() { return 0x00; }
