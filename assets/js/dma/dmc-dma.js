const DMC = {
  outputLevel: 0,
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
  dmaBusy: false,
  dmaAt: 0,

  // debug
  fetchCount: 0
};

const DMC_INITIAL_STATE = {...DMC};
function resetDMC() {Object.assign(DMC,DMC_INITIAL_STATE);irqAssert.dmcDma=false;}

function dmcRestartSample() {
  DMC.currentAddress = DMC.sampleAddress & 0xFFFF;
  DMC.bytesRemaining = DMC.sampleLength & 0xFFFF;

  if (debug.dmcDma) {
    globalThis.NES_DEBUG_LOGGING && console.log(
      "[DMC] restart",
      "addr=$" + DMC.currentAddress.toString(16).toUpperCase(),
      "len=", DMC.bytesRemaining,
      "cpuCycles=", cpuCycles
    );
  }
}

// The output divider and shift register continue running when sample reads stop.
function clockDMC() {
  DMC.timer--;

  if (DMC.timer >= 0) return;

  // correct reload (fixes 429 bug)
  DMC.timer = DMC.timerPeriod - 1;

  // ---- output unit ----
  if (!DMC.silence) {
    if(DMC.shiftRegister&1) {if(DMC.outputLevel<=125)DMC.outputLevel+=2;}
    else if(DMC.outputLevel>=2)DMC.outputLevel-=2;
    if(typeof NESAudio!=="undefined") NESAudio.dmc(cpuCycles,DMC.outputLevel);
    DMC.shiftRegister >>= 1;
  }

  DMC.bitsRemaining--;

  // ---- debug (optional, still gated) ----
  if (debug.dmcDma) {
    globalThis.NES_DEBUG_LOGGING && console.log(
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
        globalThis.NES_DEBUG_LOGGING && console.log("[DMC] shift reload from buffer");
      }

    } else {
      DMC.silence = true;

      if (debug.dmcDma) {
        globalThis.NES_DEBUG_LOGGING && console.log("[DMC] SILENCE (no sample buffer)");
      }
    }

    // ---- request DMA ----
    if (DMC.bytesRemaining > 0 && !DMC.sampleBufferFull) {
      DMC.dmaRequest = true;
      // Reload halts use put cycles (even in this power-on alignment).
      DMC.dmaAt = cpuCycles + (cpuCycles & 1);

      if (debug.dmcDma) {
        globalThis.NES_DEBUG_LOGGING && console.log(
          "[DMC] DMA REQUEST",
          "cpuCycles=", cpuCycles,
          "addr=$" + DMC.currentAddress.toString(16).toUpperCase()
        );
      }
    }
  }
}

function dmcDoDMA(haltedAddress = CPUregisters.PC) {
  if (!DMC.dmaRequest) return;

  DMC.dmaRequest = false;
  DMC.dmaBusy = true;
  // Halt and dummy cycles repeat the CPU read. A get must land on the
  // APU's get phase; writes never enter this function. Controller /OE stays
  // asserted through the dummy cycles, so they do not clock additional bits.
  checkReadOffset(haltedAddress);
  consumeCycle();
  if(haltedAddress!==0x4016 && haltedAddress!==0x4017)checkReadOffset(haltedAddress);
  consumeCycle();
  if(!(cpuCycles&1)) {
    if(haltedAddress!==0x4016 && haltedAddress!==0x4017)checkReadOffset(haltedAddress);
    consumeCycle();
  }

  const addr = DMC.currentAddress & 0xFFFF;

  const busBefore = openBus.CPU;
  const value = checkReadOffset(addr) & 0xFF;
  const busAfter = openBus.CPU;

  DMC.sampleBuffer = value;
  DMC.sampleBufferFull = true;
  // A buffer-empty event during this fetch does not need a second fetch.
  DMC.dmaRequest = false;

  DMC.fetchCount++;

  if (debug.dmcDma) {
    globalThis.NES_DEBUG_LOGGING && console.log(
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
        globalThis.NES_DEBUG_LOGGING && console.log("[DMC] sample ended -> loop restart");
      }

      dmcRestartSample();

    } else {

      if (DMC.irqEnabled) {
        irqAssert.dmcDma = true;

        if (debug.dmcDma) {
          globalThis.NES_DEBUG_LOGGING && console.log("[DMC] sample ended -> IRQ ACTIVE_LOW");
        }
      }
    }
  }
  consumeCycle();
  DMC.dmaBusy = false;
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
  // The rate write changes the next divider reload, not its current phase.

  if (debug.dmcDma) {
    globalThis.NES_DEBUG_LOGGING && console.log(
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
    globalThis.NES_DEBUG_LOGGING && console.log(
      "[DMC] 4012 write",
      "sampleAddress=$" + DMC.sampleAddress.toString(16).toUpperCase()
    );
  }
}

function dmcSetSampleLengthFrom4013(value) {
  value &= 0xFF;

  DMC.sampleLength = ((value << 4) + 1) & 0xFFFF;

  if (debug.dmcDma) {
    globalThis.NES_DEBUG_LOGGING && console.log(
      "[DMC] 4013 write",
      "sampleLength=", DMC.sampleLength
    );
  }
}

function dmcWrite4015(value) {
  value &= 0xFF;

  DMC.enabled = !!(value & 0x10);

  if (debug.dmcDma) {
    globalThis.NES_DEBUG_LOGGING && console.log(
      "[DMC] 4015 write",
      "enabled=", DMC.enabled,
      "bytesRemaining=", DMC.bytesRemaining
    );
  }

  if (!DMC.enabled) {
    DMC.bytesRemaining = 0;
    DMC.dmaRequest = false;
    return;
  }

  if (DMC.bytesRemaining === 0) {

    DMC.currentAddress = DMC.sampleAddress & 0xFFFF;
    DMC.bytesRemaining = DMC.sampleLength & 0xFFFF;

    if(!DMC.sampleBufferFull) {
      DMC.dmaRequest = true;
      // First load halts on the get phase of the second following APU cycle.
      DMC.dmaAt = cpuCycles + ((cpuCycles&1)?4:3);
    }

    if (debug.dmcDma) {
      globalThis.NES_DEBUG_LOGGING && console.log(
        "[DMC] enabled -> prepare sample",
        "addr=$" + DMC.currentAddress.toString(16).toUpperCase(),
        "len=", DMC.bytesRemaining
      );
    }
  }
}
