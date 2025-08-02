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


  // $4014 is OAMDMA (handled by PPU usually)

  // $4014 is OAMDMA (Object Attribute Memory Direct Memory Access) — write-only.
// Writing any value here triggers a 256-byte DMA transfer from CPU RAM $XX00–$XXFF
// to the PPU's internal sprite memory (OAM RAM).
//
//   - The value written is used as the high byte of the source address (i.e., value * 0x100).
//   - The CPU is stalled for either 513 or 514 cycles (see below).
//   - Cycle penalty: If the write occurs on an even CPU cycle, 513 cycles are consumed.
//                    If on an odd CPU cycle, 514 cycles are consumed.
//   - The CPU cannot execute instructions during the DMA transfer (except for reading from open bus).
//   - Not readable. Reading from $4014 yields open bus and serves no purpose.
//
// Example in emulator write handler:
//
//   function write4014(value) {
//     const startAddr = value << 8;
//     for (let i = 0; i < 256; i++) {
//       PPU_OAM[i] = systemMemory[startAddr + i];
//     }
//     // Simulate CPU cycle penalty
//     cpuCycles += (cpuCycles & 1) ? 513 : 514; // NES behavior depends on current cycle parity
//   }

// $4016-$4017 are also joypad

// $4016–$4017: Dual-purpose registers for Joypad (controller) and APU functionality.
//
// READS:
//   - $4016 (bits 0-3): Returns serial data from Joypad 1 (bits 0-3: A, B, Select, Start, Up, Down, Left, Right)
//   - $4017 (bits 0-3): Returns serial data from Joypad 2 (same bit layout)
//   - Some cartridges and expansion devices use bits 4-7 or these addresses for other hardware.
//
// WRITES:
//   - $4016 (bit 0): Controls strobe/latch for both controller ports.
//         • Writing 1 then 0 to bit 0 tells the controller hardware to latch current button states.
//         • After latching, repeated reads return each button in order (A, B, Select, Start, Up, Down, Left, Right).
//   - $4017 (write): Used by the APU as the "frame counter" control register. This controls the APU's frame sequencer for sound timing.
//         • Writing here affects audio timing but does NOT impact controller logic.
//
// OTHER NOTES:
//   - Typical emulators implement $4016 reads/writes for controller input and strobing, and $4017 writes for sound/frame sequencing.
//   - Reads from $4017 typically return controller 2 data, though some bits may be affected by expansion hardware.
//

};

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

// --- APU Write Handler ---
// Handles all writes to $4000-$4017 (excluding $4014, which is DMA and handled separately)

function apuWrite(address, value) {
  switch (address) {
    // --- Square 1 Registers ---
    case 0x4000: APUregister.SQ1_VOL = value;    break;
    case 0x4001: APUregister.SQ1_SWEEP = value;  break;
    case 0x4002: APUregister.SQ1_LO = value;     break;
    case 0x4003: APUregister.SQ1_HI = value;     break;

    // --- Square 2 Registers ---
    case 0x4004: APUregister.SQ2_VOL = value;    break;
    case 0x4005: APUregister.SQ2_SWEEP = value;  break;
    case 0x4006: APUregister.SQ2_LO = value;     break;
    case 0x4007: APUregister.SQ2_HI = value;     break;

    // --- Triangle Channel Registers ---
    case 0x4008: APUregister.TRI_LINEAR = value; break;
    case 0x400A: APUregister.TRI_LO = value;     break;
    case 0x400B: APUregister.TRI_HI = value;     break;

    // --- Noise Channel Registers ---
    case 0x400C: APUregister.NOISE_VOL = value;  break;
    case 0x400E: APUregister.NOISE_LO = value;   break;
    case 0x400F: APUregister.NOISE_HI = value;   break;

    // --- DMC Channel Registers ---
    case 0x4010: APUregister.DMC_FREQ = value;   break;
    case 0x4011: APUregister.DMC_RAW = value;    break;
    case 0x4012: APUregister.DMC_START = value;  break;
    case 0x4013: APUregister.DMC_LEN = value;    break;

    // --- Sound Channel Enable / Status ---
    case 0x4015: APUregister.SND_CHN = value;    break;

    // --- APU Frame Counter ($4017) ---
    // Controls frame sequencer and IRQ inhibit; see NESdev wiki for frame timing details.
    case 0x4017: APUregister.FRAME_CNT = value; break;

    // --- Controller strobe ($4016) and OAMDMA ($4014) are handled elsewhere! ---

    default:
      // Some expansion audio chips are mapped here on some mappers (not implemented).
      // Typically, just ignore unhandled writes in vanilla emulation.
      break;
  }
}

// --- APU Read Handler ---
// Handles all reads from $4000-$4017, only $4015 is readable on vanilla NES hardware

function apuRead(address) {
  switch (address) {
    case 0x4015:
      // $4015: Sound channel status
      // On a real NES, bits indicate active/ready status of each channel, and DMC IRQ/length state.
      // For most simple emulators, just return the current contents:
      // (Advanced: you may want to simulate bits 0-4 as channel enables, bit 6 DMC IRQ, bit 7 frame IRQ)
      return APUregister.SND_CHN;
    default:
      // All other addresses are open bus (return last value on the data bus), or $00 for simplicity.
      return 0x00;
  }
}


/*

will need rewrite when moving across to per tick from per step, accurately reproduced audio is a priority down the track
if left in current state, and continuing to PPU logic it would be 3:1 PPU to CPU tick ratio.

current state would be

example 1: CPU step completes, 5 ticks consumed, run 15 PPU ticks

example 2: CPU step completes, 2 ticks consumed + IRQ interrupt handling - 9 ticks, run 27 PPU ticks

example 3: CPU step completes, write to $4014, 513 ticks on top of 5 CPU ticks,  CPU is stalled and PPU does 518 * 3 
PPU ticks before completion and hand back to continue main logic

Apparently (I don't look at other/ study other emulator source code) this is fine for 99% of games and would pass
almost all timing sensitive tests

keeping in mind, this is super heavily debug/ in development code and would run like a 1970's diesel truck with
2 million kays on the clock. All debugging needs to be stripped and the UI likely needs to be separated/
moved across to only render / draw on call


*/