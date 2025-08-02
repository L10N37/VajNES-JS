let JoypadRegister = {
  JOYPAD1: 0x00,  // $4016, usually bit 0 only
  JOYPAD2: 0x00   // $4017, usually bit 0 only
};

const joypadRegisterNames = {
  0x4016: 'JOYPAD1', // writes here control when to read out both controllers registers (from $4016/ $4017)
  0x4017: 'JOYPAD2'  // shared offsets, refer to comments in APU.js, write -> routed to APU, read -> joypad2
};
