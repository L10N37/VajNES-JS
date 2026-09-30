#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# ZIG=/path/to/zig audio/build.sh, or CLANGXX=clang++ audio/build.sh
if [ -n "${ZIG:-}" ]; then
  "$ZIG" c++ -target wasm32-freestanding -O3 -nostdlib -fno-builtin -fno-exceptions -fno-rtti audio/apu.cpp -Wl,--no-entry -Wl,--export=audio_reset -Wl,--export=audio_lengths -Wl,--export=audio_dmc -Wl,--export=audio_quarter -Wl,--export=audio_half -Wl,--export=audio_write -Wl,--export=audio_advance -Wl,--export=audio_available -Wl,--export=audio_pop -Wl,--export=audio_overruns -Wl,--export=audio_debug -Wl,--initial-memory=2097152 -Wl,--max-memory=2097152 -o assets/js/audio/apu.wasm
else
  "${CLANGXX:-clang++}" --target=wasm32 -O3 -nostdlib -fno-builtin -fno-exceptions -fno-rtti audio/apu.cpp -Wl,--no-entry -Wl,--export=audio_reset -Wl,--export=audio_lengths -Wl,--export=audio_dmc -Wl,--export=audio_quarter -Wl,--export=audio_half -Wl,--export=audio_write -Wl,--export=audio_advance -Wl,--export=audio_available -Wl,--export=audio_pop -Wl,--export=audio_overruns -Wl,--export=audio_debug -Wl,--initial-memory=2097152 -Wl,--max-memory=2097152 -o assets/js/audio/apu.wasm
fi
