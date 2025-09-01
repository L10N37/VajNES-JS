// Minimal NES joypad logic (just $4016/$4017), no systemMemory, joypad registers totally separate

let JoypadRegister = { JOYPAD1: 0x00, JOYPAD2: 0x00 };

//let joypadStrobe = 0; // $4016 bit 0, latching
//let joypad1State = 0; // Shift register for controller 1
//let joypad2State = 0; // Shift register for controller 2