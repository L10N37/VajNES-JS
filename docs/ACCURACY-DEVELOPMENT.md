# Accuracy development branch

Work lives on `accuracycoin-development`. Main is not changed or merged.
Base: `ed77b52c9cc93f2ec6c867ccc23157c6075c282e`.

## Measured result

| Build | Pass | Fail | Skipped |
| --- | ---: | ---: | ---: |
| Original main at the base commit | 99 | 45 | 0 |
| Previous development stage | 104 | 40 | 0 |
| Audio development stage | 106 | 38 | 0 |
| MMC3/video/RF stage | 107 | 37 | 0 |

All 106 previous passes are retained. **NMI Timing** now passes AccuracyCoin.
The earlier stages added seven passes over main. The current ROM completed at
108100043 cycles, with its own 144-test tally agreeing with the runner.

| Additional upstream suite | Before | Now |
| --- | ---: | ---: |
| `mmc3_test_2`: normal Sharp MMC3 tests 1–5 | 1/5 | 5/5 |
| `ppu_vbl_nmi`: all ten single tests | 8/10 | 10/10 |

`6-MMC3_alt` intentionally expects another chip's incompatible zero-reload IRQ
semantics. It still reports failure 2 under the selected Sharp behaviour, and the
regression gate verifies that outcome. This is **15/16 actual passes**, not 16/16.
Reports include the untouched ROM hashes, status codes and diagnostic text.

All **38** core/audio/RF unit tests pass. Browser checks confirmed nonzero RF
noise after a gesture, RF silence while running a ROM, and WASM/AudioWorklet PCM
output with no page errors. Game audio has also been reported working by the
user. Commercial MMC3 game compatibility still needs user playtesting.

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
node --test tests/core.test.cjs tests/audio.test.cjs tests/rf-audio.test.cjs
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

## MMC3, video timing and RF update

- MMC3 IRQ enable is separate from its pending output. `$E001` enables future
  IRQs; `$E000` disables/acknowledges. Latch writes do not immediately assert.
- A12 filtering uses elapsed PPU clocks (a nine-dot low interval), rather than
  counting function calls. Rendering drives the external fetch-address sequence,
  including empty sprite slots and trailing nametable reads. Internal palette
  lookups and bulk sprite evaluation do not create false mapper clocks.
- `$2006` writes and `$2007` increments also drive A12; counting works with
  rendering disabled. Normal Sharp zero-reload IRQ behaviour is implemented.
- MMC3 CHR RAM is allocated, banked and writable. PRG RAM enable/protection,
  bank modes, CPU bus reads and mapper reset now have regression coverage.
- MMC3 sprite patterns are read in their fetch slots, allowing bank changes
  between sprite evaluation and fetch to affect the data actually drawn.
- NMI capture/polling is CPU-cycle driven instead of deferred by a whole
  instruction. Short onset pulses can be cancelled before capture, and rendering
  is sampled ahead of the odd-frame skipped dot.
- RF static resumes from pointer/keyboard gestures. Repeated CPU mute requests
  schedule only one fade; old cleanup cannot stop a newly started source, and
  reopening the display after game output does not introduce RF noise.

The A12 low-time filter is a dot-level approximation; precise M2 phase-dependent
edge cases, MMC3A/alternate zero-reload behaviour, MMC6 RAM, MC-ACC, TQROM and
other board-specific variants are not implemented here. Passing these tests is
not a claim that every MMC3 game or every mapper variant works.

Reproduce the extra ROM suites (no ROM modification, up to 36 million cycles
per ROM; the result protocol is read from cartridge RAM):

```sh
git clone https://github.com/christopherpow/nes-test-roms.git ../nes-test-roms
git -C ../nes-test-roms checkout 95d8f621ae55cee0d09b91519a8989ae0e64753b
node tests/blargg.cjs ../nes-test-roms blargg-report.json
node --test tests/core.test.cjs tests/audio.test.cjs tests/rf-audio.test.cjs
```

RF noise requires a browser gesture; click or press a key while the no-signal
screen is visible. It is stopped when emulation runs. Enable game audio with the
separate **Enable audio** button as before.

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
NES 2.0 extended ROM sizes are explicitly rejected. MMC1 and MMC3 board variants still need further work. Do not read this as full mapper coverage.

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
node --test tests/core.test.cjs tests/audio.test.cjs tests/rf-audio.test.cjs
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
