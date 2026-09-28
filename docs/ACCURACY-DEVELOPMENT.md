# Accuracy development branch

Work lives on `accuracycoin-development`. Main is not changed or merged.
Base: `ed77b52c9cc93f2ec6c867ccc23157c6075c282e`.

## Measured result

| Build | Pass | Fail | Skipped |
| --- | ---: | ---: | ---: |
| Original main at the base commit | 99 | 45 | 0 |
| This development stage | 104 | 40 | 0 |

All 99 original passes are retained. Newly passing: Length Counter, Length Table,
Frame Counter 4-step, Frame Counter 5-step, and Controller Clocking.
The 12 focused core regression tests also pass. The suite completed and its own
144-test tally agreed with the runner. Browser/game playtesting is still pending.

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
node --test tests/core.test.cjs
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
ROM, presses/releases Start through controller input, and runs a fixed 303.1
million CPU-cycle budget. It does not patch ROM instructions, test selection,
result RAM, or emulated behaviour. The ROM SHA-256 is checked before reading its
pinned test tables. Every result includes its original raw byte and error code.
The suite's own completion/tally state must agree with the decoded results.
The five DRAW entries are excluded; skipped and unfinished tests are not passes.

This measures the specified test ROM, not complete NES compatibility or browser
performance. Mapper tests use synthetic cartridges; commercial-game playtesting
is still needed. The ROM is fetched from upstream and is not redistributed here.

## Implemented in this stage

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

## Audio direction

The APU work here is timing/status groundwork, **not a finished audio engine**.
No C++/WebAssembly audio module or AudioWorklet output has been added yet.

The intended design is a C++ APU compiled to WebAssembly, with all CPU writes,
reads, DMA requests, IRQ changes and sample generation synchronized to emulated
CPU cycles. CPU-visible behaviour must stay on the emulator timeline; an
AudioWorklet should consume buffered samples rather than clocking a second APU
from wall time. This also avoids IRQ timing depending on audio device latency.

Next audio work: pulse envelopes/sweeps, triangle linear counter, noise LFSR,
DMC output/DMA arbitration, nonlinear mixing, band-limited resampling, analogue
filtering, and AudioWorklet buffering. Native and WASM builds should run the same
register-trace tests, followed by waveform/frequency and listening comparisons.
C++ offers implementation/performance options; it does not itself ensure accuracy.

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
