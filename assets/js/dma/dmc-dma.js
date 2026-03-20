const DMC = {
  irqEnabled: false,
  loop: false,

  sampleAddress: 0,
  sampleLength: 0,

  currentAddress: 0,
  bytesRemaining: 0,

  enabled: false,

  // timing
  timer: 0,
  timerPeriod: 428,
  rateIndex: 0,

  // output unit
  bitsRemaining: 8,
  shiftRegister: 0,
  silence: true,

  // sample buffer
  sampleBuffer: 0,
  sampleBufferFull: false,

  // DMA request flag
  dmaRequest: false,

  // debug
  fetchCount: 0
};

function dmcRestartSample() {
  DMC.currentAddress = DMC.sampleAddress & 0xFFFF;
  DMC.bytesRemaining = DMC.sampleLength & 0xFFFF;

  if (debug.dmcDma) {
    console.log(
      "[DMC] restart",
      "addr=$" + DMC.currentAddress.toString(16).toUpperCase(),
      "len=", DMC.bytesRemaining,
      "cpuCycles=", cpuCycles
    );
  }
}

function clockDMC() {
  if (!DMC.enabled) return;

  DMC.timer--;

  if (DMC.timer >= 0) return;

  // correct reload (fixes 429 bug)
  DMC.timer = DMC.timerPeriod - 1;

  // ---- output unit ----
  if (!DMC.silence) {
    DMC.shiftRegister >>= 1;
  }

  DMC.bitsRemaining--;

  // ---- debug (optional, still gated) ----
  if (debug.dmcDma) {
    console.log(
      "[DMC] bit clock",
      "cpuCycles=", cpuCycles,
      "bitsRemaining=", DMC.bitsRemaining,
      "bytesRemaining=", DMC.bytesRemaining,
      "bufferFull=", DMC.sampleBufferFull
    );
  }

  // ---- reload shift register ----
  if (DMC.bitsRemaining === 0) {
    DMC.bitsRemaining = 8;

    if (DMC.sampleBufferFull) {
      DMC.shiftRegister = DMC.sampleBuffer;
      DMC.sampleBufferFull = false;
      DMC.silence = false;

      if (debug.dmcDma) {
        console.log("[DMC] shift reload from buffer");
      }

    } else {
      DMC.silence = true;

      if (debug.dmcDma) {
        console.log("[DMC] SILENCE (no sample buffer)");
      }
    }

    // ---- request DMA ----
    if (DMC.bytesRemaining > 0 && !DMC.sampleBufferFull) {
      DMC.dmaRequest = true;

      if (debug.dmcDma) {
        console.log(
          "[DMC] DMA REQUEST",
          "cpuCycles=", cpuCycles,
          "addr=$" + DMC.currentAddress.toString(16).toUpperCase()
        );
      }
    }
  }
}

function dmcDoDMA() {
  if (!DMC.dmaRequest) return;

  DMC.dmaRequest = false;

  // DMC steals 4 CPU cycles
  consumeCycle();
  consumeCycle();
  consumeCycle();
  consumeCycle();

  const addr = DMC.currentAddress & 0xFFFF;

  const busBefore = openBus.CPU;
  const value = cpuRead(addr) & 0xFF;
  const busAfter = openBus.CPU;

  DMC.sampleBuffer = value;
  DMC.sampleBufferFull = true;

  DMC.fetchCount++;

  if (debug.dmcDma) {
    console.log(
      "[DMC] DMA FETCH",
      "count=", DMC.fetchCount,
      "cpuCycles=", cpuCycles,
      "addr=$" + addr.toString(16).toUpperCase(),
      "value=$" + value.toString(16).padStart(2, "0").toUpperCase(),
      "busBefore=$" + (busBefore ?? 0).toString(16).toUpperCase(),
      "busAfter=$" + (busAfter ?? 0).toString(16).toUpperCase(),
      "bytesRemainingBefore=", DMC.bytesRemaining
    );
  }

  // ---- advance address ----
  DMC.currentAddress = (DMC.currentAddress + 1) & 0xFFFF;
  if (DMC.currentAddress === 0x0000) {
    DMC.currentAddress = 0x8000;
  }

  DMC.bytesRemaining--;

  // ---- sample end ----
  if (DMC.bytesRemaining === 0) {

    if (DMC.loop) {

      if (debug.dmcDma) {
        console.log("[DMC] sample ended -> loop restart");
      }

      dmcRestartSample();

    } else {

      if (DMC.irqEnabled) {
        irqAssert.dmcDma = true;

        if (debug.dmcDma) {
          console.log("[DMC] sample ended -> IRQ ACTIVE_LOW");
        }
      }
    }
  }
}

function dmcSetControlFrom4010(value) {
  value &= 0xFF;

  DMC.irqEnabled = !!(value & 0x80);
  DMC.loop       = !!(value & 0x40);
  DMC.rateIndex  = value & 0x0F;

  const DMC_RATE_TABLE = [
    428, 380, 340, 320,
    286, 254, 226, 214,
    190, 160, 142, 128,
    106,  85,  72,  54
  ];

  DMC.timerPeriod = DMC_RATE_TABLE[DMC.rateIndex];
  DMC.timer = DMC.timerPeriod - 1;

  if (debug.dmcDma) {
    console.log(
      "[DMC] 4010 write",
      "rateIndex=", DMC.rateIndex,
      "timerPeriod=", DMC.timerPeriod
    );
  }

  if (!DMC.irqEnabled) {
    irqAssert.dmcDma = false;
  }
}

function dmcSetSampleAddressFrom4012(value) {
  value &= 0xFF;

  DMC.sampleAddress = (0xC000 + (value << 6)) & 0xFFFF;

  if (debug.dmcDma) {
    console.log(
      "[DMC] 4012 write",
      "sampleAddress=$" + DMC.sampleAddress.toString(16).toUpperCase()
    );
  }
}

function dmcSetSampleLengthFrom4013(value) {
  value &= 0xFF;

  DMC.sampleLength = ((value << 4) + 1) & 0xFFFF;

  if (debug.dmcDma) {
    console.log(
      "[DMC] 4013 write",
      "sampleLength=", DMC.sampleLength
    );
  }
}

function dmcWrite4015(value) {
  value &= 0xFF;

  const wasEnabled = DMC.enabled;
  DMC.enabled = !!(value & 0x10);

  if (debug.dmcDma) {
    console.log(
      "[DMC] 4015 write",
      "enabled=", DMC.enabled,
      "bytesRemaining=", DMC.bytesRemaining
    );
  }

  if (!DMC.enabled) {
    DMC.bytesRemaining = 0;
    DMC.dmaRequest = false;
    DMC.sampleBufferFull = false;
    DMC.silence = true;
    DMC.bitsRemaining = 8;
    return;
  }

  if (!wasEnabled && DMC.enabled) {

    DMC.currentAddress = DMC.sampleAddress & 0xFFFF;
    DMC.bytesRemaining = DMC.sampleLength & 0xFFFF;

    DMC.bitsRemaining = 8;
    DMC.sampleBufferFull = false;
    DMC.silence = true;
    DMC.timer = DMC.timerPeriod - 1;

    if (debug.dmcDma) {
      console.log(
        "[DMC] enabled -> prepare sample",
        "addr=$" + DMC.currentAddress.toString(16).toUpperCase(),
        "len=", DMC.bytesRemaining
      );
    }
  }
}

/*
  DMC DAC output (delta counter ±2)
  Then APU mixer integration
)
  */