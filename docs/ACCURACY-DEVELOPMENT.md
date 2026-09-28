# Accuracy development branch

Work lives on `accuracycoin-development`. Main is not changed or merged.
Base: `ed77b52c9cc93f2ec6c867ccc23157c6075c282e`.

## Measured result

| Build | Pass | Fail | Skipped |
| --- | ---: | ---: | ---: |
| Original main at the base commit | 99 | 45 | 0 |
| Previous development stage | 104 | 40 | 0 |
| This development stage | 106 | 38 | 0 |

All 104 previous passes are retained. Newly passing in this update: Frame Counter
IRQ and Controller Strobing. The first stage added Length Counter, Length Table,
Frame Counter 4-step, Frame Counter 5-step, and Controller Clocking.
All 29 focused core/audio tests pass. The suite completed at 108,100,035 cycles
and its own 144-test tally agreed with the runner. A Chromium smoke test loaded
AccuracyCoin, enabled audio, delivered nonzero finite PCM through the actual
AudioWorklet, and muted successfully with no page errors. Commercial-game
listening and browser/device coverage remain pending.

## Testing this build

Use a separate checkout so an existing working directory is not disturbed:

```sh
git clone --branch accuracycoin-development --single-branch https://github.com/L10N37/VajNES-JS.git VajNES-JS-accuracy
cd VajNES-JS-accuracy
node live-server.js
```

Open http://127.0.0.1:8080 and load your `.nes` file. Use a fresh page/load when
comparing versions. Save states remain incomplete in this emulator, including
APU/DMA and mapper state; they are not suitable for accuracy comparisons.
There is no separate deployed GitHub Pages build for this branch.

## Reproducing AccuracyCoin

Requires Node.js 22 or newer; no npm packages.

```sh
node --test tests/core.test.cjs tests/audio.test.cjs
git clone https://github.com/100thCoin/AccuracyCoin.git ../AccuracyCoin
git -C ../AccuracyCoin checkout 673ef550db296136d52229961e7d39366116882a
node tests/accuracycoin.cjs ../AccuracyCoin/AccuracyCoin.nes accuracy-report.json
```

The last command intentionally exits nonzero unless all 144 tests pass. For a
regression gate that tolerates recorded existing failures but rejects lost passes:

```sh
node tests/accuracycoin.cjs ../AccuracyCoin/AccuracyCoin.nes accuracy-report.json tests/results/current.json
```

The runner uses the production CPU/PPU/APU/mapper scripts. Only browser UI,
frame presentation, event handlers, and timers are stubbed. It boots the original
ROM, presses/releases Start through controller input, and runs up to a fixed 303.1
million CPU-cycle budget, stopping once all 144 results are complete. It does not patch ROM instructions, test selection,
result RAM, or emulated behaviour. The ROM SHA-256 is checked before reading its
pinned test tables. Every result includes its original raw byte and error code.
The suite's own completion/tally state must agree with the decoded results.
The five DRAW entries are excluded; skipped and unfinished tests are not passes.

This measures the specified test ROM, not complete NES compatibility or browser
performance. Mapper tests use synthetic cartridges; commercial-game playtesting
is still needed. The ROM is fetched from upstream and is not redistributed here.

## This update

- Separate frame status latch from the CPU IRQ line and sample IRQs per cycle.
- Preserve the first IRQ poll across taken branches and page crossings.
- Sample controller strobe on the APU clock phase.
- Correct indexed unstable-store dummy reads, timing and crossing address masks;
  their DMA interaction subtests still fail.
- Restart exhausted DMC samples and implement the saturating output DAC.
- Add the C++ renderer, WASM binary, browser controls and AudioWorklet transport.

## Earlier foundation

- Headless suite runner, before/after result files, and CI known-pass regression gate.
- NTSC APU length counters, length table, 4/5-step sequencing, delayed frame-counter
  reset, frame IRQ/status semantics, and channel-enable handling.
- DMC sample fetches go through mapped cartridge memory rather than internal RAM.
- Missing bus reads on indexed undocumented read-modify-write instructions.
- Mapper 2 UNROM/UOROM: switchable lower 16 KiB PRG, fixed last bank, CHR RAM,
  and explicit NES 2.0 bus-conflict variants. Submapper 1 disables conflicts;
  submapper 2 enables them; legacy/unspecified defaults to conflicts.
- Full CHR bank allocation, early rejection of truncated/unsupported ROM sizes,
  trainer loading, and four-screen nametable RAM.
- MMC1 mirroring preserves CIRAM contents; rendering and CPU PPUDATA accesses
  share the same mapping. CHR ROM is read-only, CHR RAM is banked consistently,
  and serial-reset writes preserve control bits outside PRG mode.

Mapper 2 currently supports 32–256 KiB power-of-two PRG sizes with 8 KiB CHR RAM.
NES 2.0 extended ROM sizes are explicitly rejected. MMC1 board variants and MMC3
IRQ behaviour still need further work. Do not read this as full mapper coverage.

## C++ / WebAssembly audio

Click **Enable audio** before loading/resetting the ROM, then run the emulator.
Use the volume slider or **Mute audio**. Serve over localhost or HTTPS; opening
`index.html` directly cannot load the module/worklet. The compiled WASM is checked
in, so no compiler is needed to play. Enabling midway through a game seeds current
registers, but cannot recover past envelope/oscillator phase; reset for comparison.

The renderer implements both pulse channels (duty, envelopes, sweeps), triangle
linear counter and held DAC, noise LFSR modes, and the DMC 7-bit output DAC. It
uses nonlinear pulse/TND mixing, a 32-tap/256-phase windowed-sinc delta resampler,
and approximations of the 90 Hz/440 Hz high-pass and 14 kHz low-pass filters.
JS remains authoritative for CPU-visible length counters, frame sequencing,
DMC fetches and interrupts; C++ receives emulated-cycle events. The AudioWorklet
only consumes PCM. NTSC frame pacing carries instruction overshoot and includes
interrupt service cycles. Audio output does not clock the emulator.

Build from `audio/apu.cpp` with Zig 0.14.1 or Clang with wasm32/lld support:

```sh
ZIG=/path/to/zig sh audio/build.sh
# Or: CLANGXX=clang++ sh audio/build.sh
node --test tests/core.test.cjs tests/audio.test.cjs
g++ -O3 -ffp-contract=off tests/native-audio.cpp -o /tmp/vajnes-native-audio
node tests/native-wasm-parity.cjs /tmp/vajnes-native-audio
```

The mixed-channel trace matched all 23,998 native/WASM samples exactly on the
tested build. Tests also cover 44.1/48 kHz pulse pitch/sample counts, envelopes,
sweep negate, triangle gating, noise modes, DMC range, batching, worklet buffering,
and unchanged CPU/PPU/APU execution with the renderer attached.

This is experimental audio, not verified hardware-equivalent sound. DMC reader
startup, disable/timer behaviour, get/put arbitration and bus retries remain
inaccurate. A free-running/immediate-fetch attempt exposed an open-bus execution
crash and was withheld; the established DMA timing remains. No PAL or expansion
audio is implemented. Buffering can underrun on slow/background tabs; the browser
smoke observed one underrun and one queue reset during startup/load. Hardware
waveform comparison and listening tests are still needed. C++ alone does not
ensure accuracy.

## Remaining accuracy work

Use `tests/results/current.json` for the exact failures and error codes. Priorities:
DMC DMA get/put arbitration and read retries, interrupt polling/NMI hijacking,
unstable store opcodes, PPU register races, sprite/OAM evaluation and background
fetch bus behaviour. AccuracyCoin alone cannot validate audio fidelity.

References: https://github.com/100thCoin/AccuracyCoin,
https://www.nesdev.org/wiki/APU_Frame_Counter,
https://www.nesdev.org/wiki/APU_Length_Counter,
https://www.nesdev.org/wiki/UxROM,
https://www.nesdev.org/wiki/MMC1.
