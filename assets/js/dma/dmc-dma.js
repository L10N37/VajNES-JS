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

  // DMA request flag
  dmaRequest: false,

  // debug
  fetchCount: 0
};

function dmcRestartSample() {
  DMC.currentAddress = DMC.sampleAddress & 0xFFFF;
  DMC.bytesRemaining = DMC.sampleLength & 0xFFFF;
  DMC.bitsRemaining  = 8;

  console.log(
    "[DMC] restart",
    "addr=$" + DMC.currentAddress.toString(16).toUpperCase(),
    "len=", DMC.bytesRemaining,
    "timer=", DMC.timer,
    "cpuCycles=", cpuCycles
  );
}

function clockDMC() {
  if (!DMC.enabled) return;

  DMC.timer--;

  if (DMC.timer > 0) return;

  // reload timer
  DMC.timer = DMC.timerPeriod;

  // ---- bit clock ----
  DMC.bitsRemaining--;

  console.log(
    "[DMC] bit clock",
    "cpuCycles=", cpuCycles,
    "bitsRemaining=", DMC.bitsRemaining,
    "bytesRemaining=", DMC.bytesRemaining,
    "currentAddress=$" + DMC.currentAddress.toString(16).toUpperCase()
  );

  // ---- when byte empty → request DMA ----
  if (DMC.bitsRemaining === 0) {
    DMC.bitsRemaining = 8;

    if (DMC.bytesRemaining > 0) {
      DMC.dmaRequest = true;

      console.log(
        "[DMC] DMA REQUEST",
        "cpuCycles=", cpuCycles,
        "addr=$" + DMC.currentAddress.toString(16).toUpperCase(),
        "bytesRemaining=", DMC.bytesRemaining,
        "timerReload=", DMC.timerPeriod
      );
    }
  }
}

function dmcDoDMA() {
  if (!DMC.dmaRequest) return;

  DMC.dmaRequest = false;

  const addr = DMC.currentAddress & 0xFFFF;

  const busBefore = openBus.CPU;

  // 🔥 MUST use cpuRead (this drives open bus correctly)
  const value = cpuRead(addr) & 0xFF;

  const busAfter = openBus.CPU;

  DMC.fetchCount++;

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

  // ---- advance address ----
  DMC.currentAddress = (DMC.currentAddress + 1) & 0xFFFF;
  if (DMC.currentAddress === 0x0000) {
    DMC.currentAddress = 0x8000;
  }

  // ---- consume byte ----
  DMC.bytesRemaining--;

  // ---- sample end ----
  if (DMC.bytesRemaining === 0) {

    if (DMC.loop) {

      console.log(
        "[DMC] sample ended -> loop restart",
        "cpuCycles=", cpuCycles
      );

      dmcRestartSample();

    } else {

      if (DMC.irqEnabled) {
        irqAssert.dmcDma = true;

        console.log(
          "[DMC] sample ended -> IRQ ACTIVE_LOW",
          "cpuCycles=", cpuCycles
        );
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

  // 🔥 IMPORTANT: reload timer immediately
  DMC.timer = DMC.timerPeriod;

  console.log(
    "[DMC] 4010 write",
    "value=$" + value.toString(16).padStart(2, "0").toUpperCase(),
    "irqEnabled=", DMC.irqEnabled,
    "loop=", DMC.loop,
    "rateIndex=", DMC.rateIndex,
    "timerPeriod=", DMC.timerPeriod,
    "cpuCycles=", cpuCycles
  );

  // Clear IRQ line if IRQ disabled
  if (!DMC.irqEnabled) {
    irqAssert.dmcDma = false;
  }
}

function dmcSetSampleAddressFrom4012(value) {
  value &= 0xFF;

  // $C000 + (value << 6)
  DMC.sampleAddress = (0xC000 + (value << 6)) & 0xFFFF;

  console.log(
    "[DMC] 4012 write",
    "value=$" + value.toString(16).padStart(2, "0").toUpperCase(),
    "sampleAddress=$" + DMC.sampleAddress.toString(16).toUpperCase(),
    "cpuCycles=", cpuCycles
  );
}

function dmcSetSampleLengthFrom4013(value) {
  value &= 0xFF;

  // (value << 4) + 1
  DMC.sampleLength = ((value << 4) + 1) & 0xFFFF;

  console.log(
    "[DMC] 4013 write",
    "value=$" + value.toString(16).padStart(2, "0").toUpperCase(),
    "sampleLength=", DMC.sampleLength,
    "cpuCycles=", cpuCycles
  );
}

function dmcWrite4015(value) {
  value &= 0xFF;

  const wasEnabled = DMC.enabled;
  DMC.enabled = !!(value & 0x10);

  console.log(
    "[DMC] 4015 write",
    "value=$" + value.toString(16).padStart(2, "0").toUpperCase(),
    "enabled=", DMC.enabled,
    "wasEnabled=", wasEnabled,
    "bytesRemaining=", DMC.bytesRemaining,
    "cpuCycles=", cpuCycles
  );

  // ---- disable ----
  if (!DMC.enabled) {
    DMC.bytesRemaining = 0;
    DMC.dmaRequest = false;
    DMC.bitsRemaining = 8;
    return;
  }

  // ---- enable (edge-triggered restart) ----
  if (!wasEnabled && DMC.enabled) {

    // 🔥 DO NOT trigger DMA immediately
    // just prepare state

    DMC.currentAddress = DMC.sampleAddress & 0xFFFF;
    DMC.bytesRemaining = DMC.sampleLength & 0xFFFF;
    DMC.bitsRemaining  = 8;

    console.log(
      "[DMC] enabled -> prepare sample",
      "addr=$" + DMC.currentAddress.toString(16).toUpperCase(),
      "len=", DMC.bytesRemaining,
      "cpuCycles=", cpuCycles
    );
  }
}