function dumpFrameBuffer() {
  console.debug("paletteIndexFrame =", "[" + paletteIndexFrame.join(",") + "]");
}

function renderFrameBuffer(){
  blitNESFramePaletteIndex(paletteIndexFrame, NES_W, NES_H);
}

function testDma(){
// fake systemMemory + OAM for testing
for (let i = 0; i < 0x800; i++) systemMemory[i] = i & 0xFF;

// clear OAM
for (let i = 0; i < 256; i++) OAM[i] = 0x00;

// call DMA from page 0x02 (so src=0x0200–0x02FF)
dmaTransfer(0x02);

// check: OAM[0..15] should now mirror systemMemory[0x0200..0x020F]
console.debug("OAM sample:", OAM.slice(0, 16));
console.debug("SRC sample:", Array.from(systemMemory.slice(0x200, 0x210)));

// check DMA cycles topped up
console.debug("Budget CPU:", Atomics.load(SHARED.CLOCKS, 0));
console.debug("Budget PPU:", Atomics.load(SHARED.CLOCKS, 1));
}

function debugDumpPPUFrame() {
  console.debug("%c[PPU Debug Frame Dump]", "background:#222; color:#0f0; font-weight:bold");
  for (let y = 0; y < NES_H; y++) {
    let line = "";
    let styles = [];
    for (let x = 0; x < NES_W; x++) {
      const idx = pixelColorIndex[y * NES_W + x];
      const color = getColorForNESByte(idx);
      line += "%c  "; // 2 spaces for "pixel"
      styles.push(`background:${color};`);
    }
    console.debug(line, ...styles);
  }
}

(function () {
  const W = typeof BASE_W !== 'undefined' ? BASE_W : 256;
  const H = typeof BASE_H !== 'undefined' ? BASE_H : 240;

  let _animRAF = 0, _phase = 0;

  // RGBA: 8 vertical color bars, phase shifts to animate
  function genRGBAFrame(w = W, h = H, phase = 0) {
    const buf = new Uint8ClampedArray(w * h * 4);
    const colors = [
      [255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0],
      [0, 255, 255], [0, 0, 255], [128, 0, 255], [255, 0, 255]
    ];
    const bars = colors.length;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const b = Math.floor((((x + phase) % w) * bars) / w);
        const off = (y * w + x) * 4;
        const c = colors[b];
        buf[off] = c[0]; buf[off + 1] = c[1]; buf[off + 2] = c[2]; buf[off + 3] = 255;
      }
    }
    return buf;
  }

  // Index: 16x16 checker-ish tiles, cycling palette indices 0..63
  // Requires _PAL_BYTES (64*4) already defined in your app.
  function genIndexFrame(w = W, h = H, phase = 0) {
    const buf = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // tile bands plus moving phase; wraps to 0..63
        buf[y * w + x] = (((x >> 4) + (y >> 4) + phase) & 63);
      }
    }
    return buf;
  }

  
/* ========================================================== */
// Screen tests

/*
testRGBAOnce() / testIndexOnce() for a static frame.

testRGBAAnim() / testIndexAnim() to see continuous updates.

stopTestAnim() to halt.

*/

  window.testRGBAOnce = function () {
    const frame = genRGBAFrame(W, H, 0);
    blitNESFrameRGBA(frame, W, H);
  };

  window.testIndexOnce = function () {
    const frame = genIndexFrame(W, H, 0);
    blitNESFramePaletteIndex(frame, W, H);
  };

  window.testRGBAAnim = function () {
    cancelAnimationFrame(_animRAF);
    const step = () => {
      const frame = genRGBAFrame(W, H, _phase);
      blitNESFrameRGBA(frame, W, H);
      _phase = (_phase + 2) % W;
      _animRAF = requestAnimationFrame(step);
    };
    step();
  };

  window.testIndexAnim = function () {
    cancelAnimationFrame(_animRAF);
    const step = () => {
      const frame = genIndexFrame(W, H, (_phase >> 4) & 63);
      blitNESFramePaletteIndex(frame, W, H);
      _phase = (_phase + 2) % (64 * 16);
      _animRAF = requestAnimationFrame(step);
    };
    step();
  };

  window.stopTestAnim = function () {
    cancelAnimationFrame(_animRAF);
  };
})();

//=======================================================
function opcodeTablePrint() {
  const opcodeRows = OPCODES.map((op, i) => ({
    OPC: "0x" + i.toString(16).padStart(2, "0").toUpperCase(),
    Handler: op.func ? op.func.name : "(none)",
    "PC+": op.pc,
    Cycles: op.cycles
  }));

  console.debug(
    "%c==== 6502 Unified Opcode Table (Branch ops highlighted) ====",
    "color:#fff;background:#222;font-size:1.2em;padding:4px;"
  );
  console.table(opcodeRows);
}
//====================================================

// worker side ppuBusRead test
function testPpuBusRead(){
// --- Fake backing arrays for test ---
const CHR_ROM     = new Uint8Array(0x2000); // 8KB
const VRAM        = new Uint8Array(0x0800); // 2KB
const PALETTE_RAM = new Uint8Array(0x20);   // 32B

// Seed with known values
for (let i = 0; i < CHR_ROM.length; i++) CHR_ROM[i] = 0xAA;
for (let i = 0; i < VRAM.length; i++) VRAM[i] = 0xBB;
for (let i = 0; i < PALETTE_RAM.length; i++) PALETTE_RAM[i] = 0x3C; // 6-bit max

// Write unique markers at a few spots
CHR_ROM[0x123] = 0x11;
VRAM[0x456 & 0x07FF] = 0x22;
PALETTE_RAM[0x0C] = 0x2A;   // normal entry
PALETTE_RAM[0x00] = 0x33;   // universal background

// --- The function under test ---
function ppuBusRead(addr) {
  addr &= 0x3FFF;

  if (addr < 0x2000) {
    return CHR_ROM[addr & 0x1FFF] & 0xFF;
  }
  if (addr >= 0x3F00) {
    let pal = addr & 0x1F;
    if ((pal & 0x13) === 0x10) pal &= ~0x10;
    return PALETTE_RAM[pal & 0x1F] & 0x3F;
  }
  return VRAM[(addr - 0x2000) & 0x07FF] & 0xFF;
}

// --- Tests ---
console.assert(ppuBusRead(0x0123) === 0x11, "Pattern table read failed");
console.assert(ppuBusRead(0x2456) === 0x22, "Nametable read failed");
console.assert(ppuBusRead(0x3F0C) === 0x2A, "Palette read failed");
console.assert(ppuBusRead(0x3F10) === 0x33, "Palette mirror $3F10 failed");

console.debug("All ppuBusRead tests passed!");
}

function testByteAsFlag(){
//test any handler that is using a byte to represent P flags as bools were used
function resetCPUFlags() {
  CPUregisters.P.C = 0;
  CPUregisters.P.Z = 0;
  CPUregisters.P.I = 0;
  CPUregisters.P.D = 0;
  CPUregisters.P.V = 0;
  CPUregisters.P.N = 0;
}

function dumpFlags() {
  return {
    C: CPUregisters.P.C,
    Z: CPUregisters.P.Z,
    I: CPUregisters.P.I,
    D: CPUregisters.P.D,
    V: CPUregisters.P.V,
    N: CPUregisters.P.N,
  };
}

function runFlagTests() {
  let results = [];

  // --- ADC basic test ---
  resetCPUFlags();
  CPUregisters.A = 0x10;
  CPUregisters.P.C = 0; // clear carry
  checkWriteOffset(0x00, 0x20);
  CPUregisters.PC = 0x0000;
  checkWriteOffset(CPUregisters.PC + 1, 0x00);
  // emulate LDA immediate, then ADC with ZP
  CPUregisters.A = 0x10;
  let val = checkReadOffset(0x00);
  let result = CPUregisters.A + val + CPUregisters.P.C;
  CPUregisters.A = result & 0xFF;
  CPUregisters.P.C = +(result > 0xFF);
  CPUregisters.P.Z = +((CPUregisters.A & 0xFF) === 0);
  CPUregisters.P.N = (CPUregisters.A >> 7) & 1;
  results.push({ test: "ADC 0x10 + 0x20", A: CPUregisters.A, flags: dumpFlags() });

  // --- Zero flag ---
  resetCPUFlags();
  CPUregisters.A = 0x00;
  CPUregisters.P.Z = +(CPUregisters.A === 0);
  results.push({ test: "Zero flag", flags: dumpFlags() });

  // --- Negative flag ---
  resetCPUFlags();
  CPUregisters.A = 0x80; // set high bit
  CPUregisters.P.N = (CPUregisters.A >> 7) & 1;
  results.push({ test: "Negative flag", flags: dumpFlags() });

  // --- Carry from ROR ---
  resetCPUFlags();
  checkWriteOffset(0x10, 0x01); // low bit set
  let val2 = checkReadOffset(0x10);
  CPUregisters.P.C = val2 & 1;
  val2 = (val2 >> 1) | (0 << 7); // oldCarry = 0
  checkWriteOffset(0x10, val2);
  results.push({ test: "ROR carry set", mem: checkReadOffset(0x10), flags: dumpFlags() });

  // --- Overflow from ADC ---
  resetCPUFlags();
  CPUregisters.A = 0x7F;
  let addVal = 0x01;
  let res = CPUregisters.A + addVal + CPUregisters.P.C;
  CPUregisters.P.V = +(((~(CPUregisters.A ^ addVal) & (CPUregisters.A ^ res)) & 0x80) !== 0);
  results.push({ test: "ADC overflow (0x7F + 0x01)", result: res & 0xFF, flags: dumpFlags() });

  console.table(results);
}

runFlagTests();
}

// all ops that touch p flags test
function runFlagSuite() {
  function resetFlags() {
    CPUregisters.P.C = 0;
    CPUregisters.P.Z = 0;
    CPUregisters.P.I = 0;
    CPUregisters.P.D = 0;
    CPUregisters.P.V = 0;
    CPUregisters.P.N = 0;
  }

  function dumpFlags() {
    return {
      C: CPUregisters.P.C,
      Z: CPUregisters.P.Z,
      I: CPUregisters.P.I,
      D: CPUregisters.P.D,
      V: CPUregisters.P.V,
      N: CPUregisters.P.N,
    };
  }

  let results = [];

  // --- Arithmetic/Logic ---
  resetFlags(); CPUregisters.A = 0x10; let r = 0x10 + 0x20; CPUregisters.A = r & 0xFF;
  CPUregisters.P.C = +(r > 0xFF); CPUregisters.P.Z = +(CPUregisters.A === 0); CPUregisters.P.N = (CPUregisters.A >> 7) & 1;
  results.push({ test: "ADC basic", A: CPUregisters.A, flags: dumpFlags() });

  resetFlags(); CPUregisters.A = 0x00; let r2 = CPUregisters.A - 0x01; CPUregisters.A = r2 & 0xFF;
  CPUregisters.P.C = +(r2 >= 0); CPUregisters.P.Z = +(CPUregisters.A === 0); CPUregisters.P.N = (CPUregisters.A >> 7) & 1;
  results.push({ test: "SBC basic", A: CPUregisters.A, flags: dumpFlags() });

  resetFlags(); CPUregisters.A = 0x40; let cmp = CPUregisters.A - 0x40;
  CPUregisters.P.C = +(cmp >= 0); CPUregisters.P.Z = +(cmp === 0); CPUregisters.P.N = (cmp >> 7) & 1;
  results.push({ test: "CMP equal", flags: dumpFlags() });

  // --- Shifts / Rotates ---
  resetFlags(); let v = 0x80; CPUregisters.P.C = (v >> 7) & 1; v = (v << 1) & 0xFF; CPUregisters.P.N = (v >> 7) & 1; CPUregisters.P.Z = +(v === 0);
  results.push({ test: "ASL carry out", val: v, flags: dumpFlags() });

  resetFlags(); let v2 = 0x01; CPUregisters.P.C = v2 & 1; v2 >>= 1; CPUregisters.P.N = (v2 >> 7) & 1; CPUregisters.P.Z = +(v2 === 0);
  results.push({ test: "LSR carry out", val: v2, flags: dumpFlags() });

  resetFlags(); let v3 = 0x80; let oldC = CPUregisters.P.C; CPUregisters.P.C = (v3 >> 7) & 1; v3 = ((v3 << 1) & 0xFF) | oldC; CPUregisters.P.N = (v3 >> 7) & 1; CPUregisters.P.Z = +(v3 === 0);
  results.push({ test: "ROL with carry", val: v3, flags: dumpFlags() });

  resetFlags(); let v4 = 0x01; let oldC2 = CPUregisters.P.C; CPUregisters.P.C = v4 & 1; v4 = (v4 >> 1) | (oldC2 << 7); CPUregisters.P.N = (v4 >> 7) & 1; CPUregisters.P.Z = +(v4 === 0);
  results.push({ test: "ROR with carry", val: v4, flags: dumpFlags() });

  // --- Logic ops ---
  resetFlags(); CPUregisters.A = 0xFF; let andVal = CPUregisters.A & 0x00; CPUregisters.P.Z = +(andVal === 0); CPUregisters.P.N = (andVal >> 7) & 1;
  results.push({ test: "AND zero", flags: dumpFlags() });

  resetFlags(); CPUregisters.A = 0x0F; let eorVal = CPUregisters.A ^ 0xFF; CPUregisters.P.Z = +(eorVal === 0); CPUregisters.P.N = (eorVal >> 7) & 1;
  results.push({ test: "EOR result", flags: dumpFlags() });

  resetFlags(); CPUregisters.A = 0xF0; let oraVal = CPUregisters.A | 0x0F; CPUregisters.P.Z = +(oraVal === 0); CPUregisters.P.N = (oraVal >> 7) & 1;
  results.push({ test: "ORA result", flags: dumpFlags() });

  // --- BIT test ---
  resetFlags(); let mem = 0xC0; CPUregisters.A = 0xC0; let bitRes = CPUregisters.A & mem;
  CPUregisters.P.Z = +(bitRes === 0); CPUregisters.P.N = (mem >> 7) & 1; CPUregisters.P.V = (mem >> 6) & 1;
  results.push({ test: "BIT set NV", flags: dumpFlags() });

  // --- Increments/Decrements ---
  resetFlags(); CPUregisters.X = 0xFF; CPUregisters.X = (CPUregisters.X + 1) & 0xFF; CPUregisters.P.Z = +(CPUregisters.X === 0); CPUregisters.P.N = (CPUregisters.X >> 7) & 1;
  results.push({ test: "INX wrap to 0", X: CPUregisters.X, flags: dumpFlags() });

  resetFlags(); CPUregisters.Y = 0x01; CPUregisters.Y = (CPUregisters.Y - 1) & 0xFF; CPUregisters.P.Z = +(CPUregisters.Y === 0); CPUregisters.P.N = (CPUregisters.Y >> 7) & 1;
  results.push({ test: "DEY to zero", Y: CPUregisters.Y, flags: dumpFlags() });

  // --- Transfers ---
  resetFlags(); CPUregisters.A = 0x80; CPUregisters.X = CPUregisters.A; CPUregisters.P.Z = +(CPUregisters.X === 0); CPUregisters.P.N = (CPUregisters.X >> 7) & 1;
  results.push({ test: "TAX sets N", X: CPUregisters.X, flags: dumpFlags() });

  // --- Status flag control ---
  resetFlags(); CPUregisters.P.C = 1; results.push({ test: "SEC set C", flags: dumpFlags() });
  resetFlags(); CPUregisters.P.C = 0; results.push({ test: "CLC clear C", flags: dumpFlags() });
  resetFlags(); CPUregisters.P.V = 0; results.push({ test: "CLV clear V", flags: dumpFlags() });
  resetFlags(); CPUregisters.P.D = 1; results.push({ test: "SED set D", flags: dumpFlags() });

  console.table(results);
}

//=======================================================================+++++===============

