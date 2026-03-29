const APU_REG_ADDRESSES = {
  0x4000: "SQ1_VOL",
  0x4001: "SQ1_SWEEP",
  0x4002: "SQ1_LO",
  0x4003: "SQ1_HI",
  0x4004: "SQ2_VOL",
  0x4005: "SQ2_SWEEP",
  0x4006: "SQ2_LO",
  0x4007: "SQ2_HI",
  0x4008: "TRI_LINEAR",
  0x400A: "TRI_LO",
  0x400B: "TRI_HI",
  0x400C: "NOISE_VOL",
  0x400E: "NOISE_LO",
  0x400F: "NOISE_HI",
  0x4010: "DMC_FREQ",
  0x4011: "DMC_RAW",
  0x4012: "DMC_START",
  0x4013: "DMC_LEN",
  0x4015: "SND_CHN",    // Write
  0x4017: "FRAME_CNT"   // Write

};

/*
console tested, no test suite 
------------------------------
checkWriteOffset(0x4000, 0x99)
undefined
checkReadOffset(0x4000)
153
*/


let APUregister = {
  SQ1_VOL:   0x00, // $4000
  SQ1_SWEEP: 0x00, // $4001
  SQ1_LO:    0x00, // $4002
  SQ1_HI:    0x00, // $4003
  SQ2_VOL:   0x00, // $4004
  SQ2_SWEEP: 0x00, // $4005
  SQ2_LO:    0x00, // $4006
  SQ2_HI:    0x00, // $4007
  TRI_LINEAR:0x00, // $4008
  TRI_LO:    0x00, // $400A
  TRI_HI:    0x00, // $400B
  NOISE_VOL: 0x00, // $400C
  NOISE_LO:  0x00, // $400E
  NOISE_HI:  0x00, // $400F
  DMC_FREQ:  0x00, // $4010
  DMC_RAW:   0x00, // $4011
  DMC_START: 0x00, // $4012
  DMC_LEN:   0x00, // $4013
  SND_CHN:   0x00, // $4015
  FRAME_CNT: 0x00, // $4017
};