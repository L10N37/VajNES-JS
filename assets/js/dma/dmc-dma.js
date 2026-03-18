const DMC = {
  irqEnabled: false,
  loop: false,

  sampleAddress: 0,
  sampleLength: 0,
  currentAddress: 0,

  bytesRemaining: 0,
  enabled: false,

  rateIndex: 0,
  timerPeriod: 428,
  timer: 428,

  bitsRemaining: 8,
  dmaRequest: false,

  debug: true,
  logEveryFetch: true,
  fetchCount: 0
};

const DMC_RATE_TABLE = [
  428, 380, 340, 320,
  286, 254, 226, 214,
  190, 160, 142, 128,
  106, 85, 72, 54
];

function dmcLog(...args) {
  if (!DMC.debug) return;
  console.log("[DMC]", ...args);
}

function dmcSetControlFrom4010(value) {
  value &= 0xFF;

  DMC.irqEnabled = !!(value & 0x80);
  DMC.loop = !!(value & 0x40);
  DMC.rateIndex = value & 0x0F;
  DMC.timerPeriod = DMC_RATE_TABLE[DMC.rateIndex] | 0;

  if (DMC.timer <= 0 || !Number.isFinite(DMC.timer)) {
    DMC.timer = DMC.timerPeriod;
  }

  dmcLog(
    "4010 write",
    "value=$" + value.toString(16).toUpperCase().padStart(2, "0"),
    "irqEnabled=", DMC.irqEnabled,
    "loop=", DMC.loop,
    "rateIndex=", DMC.rateIndex,
    "timerPeriod=", DMC.timerPeriod,
    "cpuCycles=", cpuCycles
  );

  if (!DMC.irqEnabled) {
    irqAssert.dmcDma = false;
  }
}

function dmcSetSampleAddressFrom4012(value) {
  value &= 0xFF;
  DMC.sampleAddress = (0xC000 + (value << 6)) & 0xFFFF;

  dmcLog(
    "4012 write",
    "value=$" + value.toString(16).toUpperCase().padStart(2, "0"),
    "sampleAddress=$" + DMC.sampleAddress.toString(16).toUpperCase().padStart(4, "0"),
    "cpuCycles=", cpuCycles
  );
}

function dmcSetSampleLengthFrom4013(value) {
  value &= 0xFF;
  DMC.sampleLength = ((value << 4) + 1) & 0xFFFF;

  dmcLog(
    "4013 write",
    "value=$" + value.toString(16).toUpperCase().padStart(2, "0"),
    "sampleLength=", DMC.sampleLength,
    "cpuCycles=", cpuCycles
  );
}

function dmcRestartSample() {
  DMC.currentAddress = DMC.sampleAddress & 0xFFFF;
  DMC.bytesRemaining = DMC.sampleLength & 0xFFFF;
  DMC.bitsRemaining = 8;
  DMC.dmaRequest = false;
  DMC.timer = DMC.timerPeriod | 0;

  dmcLog(
    "restart",
    "currentAddress=$" + DMC.currentAddress.toString(16).toUpperCase().padStart(4, "0"),
    "bytesRemaining=", DMC.bytesRemaining,
    "bitsRemaining=", DMC.bitsRemaining,
    "timer=", DMC.timer,
    "timerPeriod=", DMC.timerPeriod,
    "cpuCycles=", cpuCycles
  );
}

function dmcWrite4015(value) {
  value &= 0xFF;

  const wasEnabled = DMC.enabled;
  DMC.enabled = !!(value & 0x10);

  // Disable
  if (!DMC.enabled) {
    DMC.bytesRemaining = 0;
    DMC.dmaRequest = false;
    DMC.bitsRemaining = 8;
    return;
  }

  // Enable
  if (!wasEnabled && DMC.enabled) {
    // 🔥 DO NOT immediately restart sample
    // just prepare state — let clockDMC trigger it later

    DMC.currentAddress = DMC.sampleAddress & 0xFFFF;
    DMC.bytesRemaining = DMC.sampleLength & 0xFFFF;

    // do NOT trigger DMA immediately
    DMC.dmaRequest = false;
    DMC.bitsRemaining = 8;

    // do NOT touch timer here
  }
}

function clockDMC() {
  if (!DMC.enabled) return;
  if (DMC.bytesRemaining === 0) return;
  if (DMC.dmaRequest) return;

  DMC.timer--;

  if (DMC.timer > 0) return;

  DMC.timer = DMC.timerPeriod | 0;

  DMC.bitsRemaining--;

  dmcLog(
    "bit clock",
    "cpuCycles=", cpuCycles,
    "bitsRemaining=", DMC.bitsRemaining,
    "bytesRemaining=", DMC.bytesRemaining,
    "currentAddress=$" + DMC.currentAddress.toString(16).toUpperCase().padStart(4, "0")
  );

  if (DMC.bitsRemaining > 0) return;

  DMC.bitsRemaining = 8;
  DMC.dmaRequest = true;

  dmcLog(
    "DMA REQUEST",
    "cpuCycles=", cpuCycles,
    "currentAddress=$" + DMC.currentAddress.toString(16).toUpperCase().padStart(4, "0"),
    "bytesRemaining=", DMC.bytesRemaining,
    "timerReload=", DMC.timer
  );
}

function dmcDoDMA() {
  if (!DMC.enabled) return false;
  if (!DMC.dmaRequest) return false;
  if (DMC.bytesRemaining === 0) {
    DMC.dmaRequest = false;
    return false;
  }

  DMC.dmaRequest = false;

  const addr = DMC.currentAddress & 0xFFFF;
  const busBefore = openBus.CPU & 0xFF;

  const value = cpuRead(addr) & 0xFF;

  DMC.fetchCount++;

  dmcLog(
    "DMA FETCH",
    "count=", DMC.fetchCount,
    "cpuCycles=", cpuCycles,
    "addr=$" + addr.toString(16).toUpperCase().padStart(4, "0"),
    "value=$" + value.toString(16).toUpperCase().padStart(2, "0"),
    "busBefore=$" + busBefore.toString(16).toUpperCase().padStart(2, "0"),
    "busAfter=$" + (openBus.CPU & 0xFF).toString(16).toUpperCase().padStart(2, "0"),
    "bytesRemainingBefore=", DMC.bytesRemaining
  );

  DMC.currentAddress = (addr + 1) & 0xFFFF;
  if (DMC.currentAddress === 0x0000) {
    DMC.currentAddress = 0x8000;
  }

  DMC.bytesRemaining--;

  if (!DMC.bytesRemaining) {
    if (DMC.loop) {
      dmcLog("sample ended -> loop restart", "cpuCycles=", cpuCycles);
      dmcRestartSample();
    } else if (DMC.irqEnabled) {
      irqAssert.dmcDma = true;
      dmcLog("sample ended -> IRQ ACTIVE_LOW", "cpuCycles=", cpuCycles);
    } else {
      dmcLog("sample ended -> no loop, no IRQ", "cpuCycles=", cpuCycles);
    }
  }

  return true;
}