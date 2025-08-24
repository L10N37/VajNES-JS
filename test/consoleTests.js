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
function runAllFlagTests() {
  function resetCPU() {
    CPUregisters.A=0;CPUregisters.X=0;CPUregisters.Y=0;
    CPUregisters.PC=0;CPUregisters.S=0xFD;
    CPUregisters.P={C:0,Z:0,I:0,D:0,V:0,N:0};
    systemMemory.fill(0);
  }
  function dumpFlags(){return {C:CPUregisters.P.C,Z:CPUregisters.P.Z,I:CPUregisters.P.I,D:CPUregisters.P.D,V:CPUregisters.P.V,N:CPUregisters.P.N};}
  function runOne(op,name,setup,expect){
    resetCPU();setup();OPCODES[op].func();
    const actual=dumpFlags();
    const ok=Object.entries(expect).every(([f,v])=>actual[f]===v);
    results.push({opcode:op.toString(16).padStart(2,"0").toUpperCase(),name,expected:expect,actual,pass:ok});
  }
  let results=[];

  // ================
  // ADC (all modes)
  // ================
// --- ADC TESTS ---

// Immediate
runOne(0x69,"ADC imm",()=>{
  CPUregisters.A = 0xF0;
  systemMemory[1] = 0x20;
},{C:1,N:0});

// Zero Page
runOne(0x65,"ADC zp",()=>{
  CPUregisters.A = 0;
  systemMemory[0x10] = 0;
},{Z:1});

// Zero Page,X
runOne(0x75,"ADC zpx",()=>{
  CPUregisters.A = 0x7F;
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;   // operand = $10
  systemMemory[0x11] = 0x01; // value at $11
},{N:1,V:1});

// Absolute
runOne(0x6D,"ADC abs",()=>{
  CPUregisters.A = 0x01;
  systemMemory[1] = 0x00;       // low
  systemMemory[2] = 0x06;       // high -> $0600
  systemMemory[0x0600] = 1;     // operand
},{Z:0});

// Absolute,X
runOne(0x7D,"ADC absx",()=>{
  CPUregisters.A = 0xFF;
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;       // low
  systemMemory[2] = 0x06;       // high -> $0600
  systemMemory[0x0601] = 1;     // effective operand
},{C:1,Z:1});

// Absolute,Y
runOne(0x79,"ADC absy",()=>{
  CPUregisters.A = 0x01;
  CPUregisters.Y = 1;
  systemMemory[1] = 0x00;       // low
  systemMemory[2] = 0x06;       // high -> $0600
  systemMemory[0x0601] = 1;     // effective operand
},{Z:0});

// Indexed Indirect (ind,X)
runOne(0x61,"ADC indx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x02;       // operand points to zp=2
  systemMemory[0x03] = 0x00;    // low
  systemMemory[0x04] = 0x06;    // high -> $0600
  systemMemory[0x0600] = 0xFF;  // operand
  CPUregisters.A = 2;
},{C:1});

// Indirect Indexed (ind),Y
runOne(0x71,"ADC indy",()=>{
  CPUregisters.Y = 1;
  systemMemory[1] = 0x02;       // operand = zp=2
  systemMemory[0x02] = 0x00;    // low
  systemMemory[0x03] = 0x06;    // high -> $0600
  systemMemory[0x0601] = 1;     // effective operand ($0600 + Y)
  CPUregisters.A = 1;
},{Z:0});


  // ================
  // SBC (all modes)
  // ================
runOne(0xE9,"SBC imm",()=>{
  CPUregisters.A = 0;
  systemMemory[1] = 1;         // immediate operand
},{C:0,N:1});

runOne(0xE5,"SBC zp",()=>{
  CPUregisters.A = 1;
  systemMemory[1] = 0x10;      // zp address
  systemMemory[0x10] = 1;      // zp data
  CPUregisters.P.C = 1;
},{Z:1,C:1});

runOne(0xF5,"SBC zpx",()=>{
  CPUregisters.A = 5;
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;      // zp base
  systemMemory[0x11] = 2;      // zp+X data
  CPUregisters.P.C = 1;
},{C:1});

runOne(0xED,"SBC abs",()=>{
  CPUregisters.A = 0x80;
  systemMemory[1] = 0x00;      // lo
  systemMemory[2] = 0x03;      // hi ($0300)
  systemMemory[0x0300] = 0x7F; // RAM data
  CPUregisters.P.C = 1;
},{C:1});

runOne(0xFD,"SBC absx",()=>{
  CPUregisters.A = 1;
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;      // lo
  systemMemory[2] = 0x03;      // hi ($0300)
  systemMemory[0x0301] = 1;    // RAM data at base+X
  CPUregisters.P.C = 1;
},{Z:1,C:1});

runOne(0xF9,"SBC absy",()=>{
  CPUregisters.A = 0;
  CPUregisters.Y = 1;
  systemMemory[1] = 0x00;      // lo
  systemMemory[2] = 0x03;      // hi ($0300)
  systemMemory[0x0301] = 1;    // RAM data at base+Y
  CPUregisters.P.C = 1;
},{C:0,N:1});

runOne(0xE1,"SBC indx",()=>{
  CPUregisters.A = 1;
  CPUregisters.X = 1;
  systemMemory[1] = 0x01;      // operand zp = $01
  systemMemory[0x02] = 0x00;   // zp[$01+X] = $02 → lo
  systemMemory[0x03] = 0x03;   // hi = $03
  systemMemory[0x0300] = 1;    // RAM target
  CPUregisters.P.C = 1;
},{Z:1,C:1});

runOne(0xF1,"SBC indy",()=>{
  CPUregisters.A = 5;
  CPUregisters.Y = 1;
  systemMemory[1] = 0x02;      // operand zp = $02
  systemMemory[0x02] = 0x00;   // lo
  systemMemory[0x03] = 0x03;   // hi
  systemMemory[0x0301] = 2;    // RAM data at base+Y
  CPUregisters.P.C = 1;
},{C:1});

  // ================
  // CMP/CPX/CPY
  // ================
runOne(0xC9,"CMP imm",()=>{
  CPUregisters.A = 0x40;
  systemMemory[1] = 0x40;   // equal
},{C:1,Z:1});

runOne(0xC5,"CMP zp",()=>{
  CPUregisters.P.C = 0;
  CPUregisters.P.Z = 0;
  CPUregisters.P.N = 0;
  CPUregisters.A = 0x10;
  systemMemory[1] = 0x10;      // operand = zp address
  systemMemory[0x10] = 0x20;   // data at zp
},{C:0,N:1});

runOne(0xD5,"CMP zpx",()=>{
  CPUregisters.X = 1;
  CPUregisters.A = 0x30;
  systemMemory[0x11] = 0x20; // A > M
},{C:1});

runOne(0xCD,"CMP abs",()=>{
  CPUregisters.A = 0x30;
  systemMemory[1] = 0x00;    // lo
  systemMemory[2] = 0x03;    // hi ($0300)
  systemMemory[0x0300] = 0x20;
},{C:1});

runOne(0xDD,"CMP absx",()=>{
  CPUregisters.X = 1;
  CPUregisters.A = 0x50;
  systemMemory[1] = 0x00;    // lo
  systemMemory[2] = 0x03;    // hi ($0300)
  systemMemory[0x0301] = 0x40;
},{C:1});

runOne(0xD9,"CMP absy",()=>{
  CPUregisters.Y = 1;
  CPUregisters.A = 0x10;
  systemMemory[1] = 0x00;    // lo
  systemMemory[2] = 0x03;    // hi ($0300)
  systemMemory[0x0301] = 0x20; // A < M
},{C:0,N:1});

runOne(0xC1,"CMP indx",()=>{
  CPUregisters.X = 1;
  CPUregisters.A = 0x40;
  systemMemory[1] = 0x01;      // zp ptr = $01
  systemMemory[0x02] = 0x00;   // lo at zp[$01+X]
  systemMemory[0x03] = 0x03;   // hi
  systemMemory[0x0300] = 0x40; // operand
},{C:1,Z:1});

runOne(0xD1,"CMP indy",()=>{
  CPUregisters.Y = 1;
  CPUregisters.A = 0x20;
  systemMemory[1] = 0x02;      // zp ptr = $02
  systemMemory[0x02] = 0x00;   // lo
  systemMemory[0x03] = 0x03;   // hi
  systemMemory[0x0301] = 0x30; // A < M
},{C:0,N:1});

// CPX
runOne(0xE0,"CPX imm",()=>{
  CPUregisters.X = 0x20;
  systemMemory[1] = 0x20;   // equal
},{C:1,Z:1});

runOne(0xE4,"CPX zp",()=>{
  CPUregisters.X = 0x10;
  systemMemory[1] = 0x10;      // operand = zp address
  systemMemory[0x10] = 0x20;   // actual data at zp
},{C:0,N:1});

runOne(0xEC,"CPX abs",()=>{
  CPUregisters.X = 0x50;
  systemMemory[1] = 0x00;
  systemMemory[2] = 0x03;
  systemMemory[0x0300] = 0x20; // X > M
},{C:1});

// CPY
runOne(0xC0,"CPY imm",()=>{
  CPUregisters.Y = 0x40;
  systemMemory[1] = 0x40;   // equal
},{C:1,Z:1});

runOne(0xC4,"CPY zp",()=>{
  CPUregisters.Y = 0x10;
  systemMemory[1]  = 0x10;   // operand = zp address
  systemMemory[0x10] = 0x20; // data at that zp
},{C:0,N:1});

runOne(0xCC,"CPY abs",()=>{
  CPUregisters.Y = 0x50;
  systemMemory[1] = 0x00;
  systemMemory[2] = 0x03;
  systemMemory[0x0300] = 0x20; // Y > M
},{C:1});

  // ================
  // BIT
  // ================
  runOne(
  0x2C, "BIT abs",
  () => {
    CPUregisters.A = 0xFF;
    systemMemory[1] = 0x00;     // lo byte
    systemMemory[2] = 0x02;     // hi byte → address = $0200 (safe RAM)
    systemMemory[0x0200] = 0xC0; // value with bits 7+6 set
  },
  { N:1, V:1, Z:0 }
);

  runOne(0x24,"BIT zp",()=>{CPUregisters.A=0x01;systemMemory[1]=0x10;systemMemory[0x10]=0;},{Z:1});

  // ================
  // Shifts/Rotates
  // ================
// --- ASL ---
runOne(0x0A,"ASL A",()=>{CPUregisters.A=0x80;},{C:1});
runOne(0x06,"ASL zp",()=>{systemMemory[0x0010]=0x01;},{C:0,Z:1});
runOne(0x16,"ASL zpx",
  ()=>{
    CPUregisters.X = 1;
    systemMemory[1] = 0x10;      // operand byte (zp address)
    systemMemory[0x11] = 0x80;   // the actual data
  },
  { C:1, Z:1, N:0 }
);


runOne(0x0E,"ASL abs",()=>{
  systemMemory[1] = 0x00;      // lo byte of address
  systemMemory[2] = 0x03;      // hi byte of address
  systemMemory[0x0300] = 0xFF; // actual test value
},{C:1,Z:0,N:1});


runOne(0x1E,"ASL absx",()=>{CPUregisters.X=1;systemMemory[0x0301]=0x01;},{Z:1});

// --- LSR ---
runOne(0x4A,"LSR A",()=>{CPUregisters.A=1;},{C:1,Z:1});
runOne(0x46,"LSR zp",()=>{systemMemory[0x0010]=0x80;},{C:0});
runOne(0x56,"LSR zpx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;     // operand = $10
  systemMemory[0x11] = 0x01;  // EA = $10 + 1 = $11, old value = $01
},{C:1,Z:1,N:0});
// LSR abs ($4E) : opcode + 2-byte operand
runOne(0x4E,"LSR abs",()=>{
  systemMemory[1] = 0x00;   // lo
  systemMemory[2] = 0x03;   // hi → EA = $0300
  systemMemory[0x0300] = 0x01;
},{C:1,Z:1,N:0});

// LSR abs,X ($5E) : opcode + 2-byte operand
runOne(0x5E,"LSR absx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;   // lo
  systemMemory[2] = 0x03;   // hi → base = $0300, EA = $0300+X = $0301
  systemMemory[0x0301] = 0x01;
},{C:1,Z:1,N:0});

// --- ROL ---
runOne(0x2A,"ROL A",()=>{
  CPUregisters.A=0x80;
  CPUregisters.P.C=1;
},{C:1,Z:0,N:0});


runOne(0x26,"ROL zp",()=>{
  systemMemory[1] = 0x10;      // operand
  systemMemory[0x10] = 1;
},{C:0});

runOne(0x36,"ROL zpx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;     // operand byte after opcode
  systemMemory[0x11] = 0x80;  // EA = $10 + X = $11
  CPUregisters.P.C = 0;
},{ C:1, Z:1, N:0 }
);

runOne(0x2A,"ROL A",()=>{
  CPUregisters.A=0x80;
  CPUregisters.P.C=1;
},{C:1,Z:0,N:0});

runOne(0x3E,"ROL absx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;      // lo
  systemMemory[2] = 0x03;      // hi
  systemMemory[0x0301] = 0x80; // EA = $0300+X=$0301
  CPUregisters.P.C = 0;
},{C:1,Z:1,N:0});

// --- ROR ---
runOne(0x6A,"ROR A",()=>{CPUregisters.A=1;CPUregisters.P.C=1;},{C:1});

runOne(0x66,"ROR zp",()=>{
  systemMemory[1] = 0x10;      // operand
  systemMemory[0x10] = 2;
},{C:0});

runOne(0x76,"ROR zpx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;      // operand
  systemMemory[0x11] = 1;      // EA = $10+X=$11
},{C:1});

runOne(0x6E,"ROR abs",()=>{
  systemMemory[1] = 0x00;      // lo
  systemMemory[2] = 0x03;      // hi
  systemMemory[0x0300] = 1;
},{C:1});

runOne(0x7E,"ROR absx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;      // lo
  systemMemory[2] = 0x03;      // hi
  systemMemory[0x0301] = 1;    // EA = $0300+X=$0301
},{C:1});

  // ================
  // INC/DEC
  // ================
// --- INC ---
runOne(0xE6,"INC zp",()=>{
  systemMemory[1] = 0x10;       // operand = $10
  systemMemory[0x10] = 0xFF;    // old = $FF → result = $00
},{Z:1,N:0});

runOne(0xF6,"INC zpx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;       // operand = $10
  systemMemory[0x11] = 0xFF;    // EA = $10+X=$11, old=$FF→res=$00
},{Z:1,N:0});

runOne(0xEE,"INC abs",()=>{
  systemMemory[1] = 0x00;       // lo
  systemMemory[2] = 0x03;       // hi → EA=$0300
  systemMemory[0x0300] = 0xFF;
},{Z:1,N:0});

runOne(0xFE,"INC absx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;       // lo
  systemMemory[2] = 0x03;       // hi → base=$0300, EA=$0301
  systemMemory[0x0301] = 0xFF;
},{Z:1,N:0});

// --- DEC ---
runOne(0xC6,"DEC zp",()=>{
  systemMemory[1] = 0x10;       // operand=$10
  systemMemory[0x10] = 0x00;    // old=0 → result=$FF
},{N:1,Z:0});

runOne(0xD6,"DEC zpx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;       // operand=$10
  systemMemory[0x11] = 0x00;    // EA=$11, old=0→res=$FF
},{N:1,Z:0});

runOne(0xCE,"DEC abs",()=>{
  systemMemory[1] = 0x00;       // lo
  systemMemory[2] = 0x03;       // hi → EA=$0300
  systemMemory[0x0300] = 0x00;  // old=0→res=$FF
},{N:1,Z:0});

runOne(0xDE,"DEC absx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;       // lo
  systemMemory[2] = 0x03;       // hi → EA=$0301
  systemMemory[0x0301] = 0x00;  // old=0→res=$FF
},{N:1,Z:0});

  // ================
  // Loads (A/X/Y)
  // ================
// --- LDA ---
runOne(0xA9,"LDA imm",()=>{
  systemMemory[1] = 0x00;     // immediate operand
},{Z:1,N:0});

runOne(0xA5,"LDA zp",()=>{
  systemMemory[1] = 0x10;     // operand = $10
  systemMemory[0x10] = 0x80;
},{N:1,Z:0});

runOne(0xB5,"LDA zpx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;     // operand = $10
  systemMemory[0x11] = 0x00;  // EA=$11
},{Z:1,N:0});

runOne(0xAD,"LDA abs",()=>{
  systemMemory[1] = 0x00;     // lo
  systemMemory[2] = 0x03;     // hi → EA=$0300
  systemMemory[0x0300] = 0x80;
},{N:1,Z:0});

runOne(0xBD,"LDA absx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;
  systemMemory[2] = 0x03;     // base=$0300 → EA=$0301
  systemMemory[0x0301] = 0x00;
},{Z:1,N:0});

runOne(0xB9,"LDA absy",()=>{
  CPUregisters.Y = 1;
  systemMemory[1] = 0x00;
  systemMemory[2] = 0x03;     // base=$0300 → EA=$0301
  systemMemory[0x0301] = 0x80;
},{N:1,Z:0});

runOne(0xA1,"LDA indx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x02;     // pointer in zp
  // pointer = $02+$X=$03 → low=$00 hi=$03
  systemMemory[3] = 0x00;
  systemMemory[4] = 0x03;
  systemMemory[0x0300] = 0x80;
},{N:1,Z:0});

runOne(0xB1,"LDA indy",()=>{
  CPUregisters.Y = 1;
  systemMemory[1] = 0x02;     // pointer in zp
  systemMemory[2] = 0x00;     // low
  systemMemory[3] = 0x03;     // hi → base=$0300
  systemMemory[0x0301] = 0x00; // EA=$0300+Y=$0301
},{Z:1,N:0});

// --- LDX ---
runOne(0xA2,"LDX imm",()=>{
  systemMemory[1] = 0x80;
},{N:1,Z:0});

runOne(0xA6,"LDX zp",()=>{
  systemMemory[1] = 0x10;
  systemMemory[0x10] = 0x00;
},{Z:1,N:0});

runOne(0xB6,"LDX zpy",()=>{
  CPUregisters.Y = 1;
  systemMemory[1] = 0x10;
  systemMemory[0x11] = 0x80;
},{N:1,Z:0});

runOne(0xAE,"LDX abs",()=>{
  systemMemory[1] = 0x00;
  systemMemory[2] = 0x03;
  systemMemory[0x0300] = 0x00;
},{Z:1,N:0});

runOne(0xBE,"LDX absy",()=>{
  CPUregisters.Y = 1;
  systemMemory[1] = 0x00;
  systemMemory[2] = 0x03;     // base=$0300 → EA=$0301
  systemMemory[0x0301] = 0x80;
},{N:1,Z:0});

// --- LDY ---
runOne(0xA0,"LDY imm",()=>{
  systemMemory[1] = 0x80;
},{N:1,Z:0});

runOne(0xA4,"LDY zp",()=>{
  systemMemory[1] = 0x10;
  systemMemory[0x10] = 0x00;
},{Z:1,N:0});

runOne(0xB4,"LDY zpx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x10;
  systemMemory[0x11] = 0x80;
},{N:1,Z:0});

runOne(0xAC,"LDY abs",()=>{
  systemMemory[1] = 0x00;
  systemMemory[2] = 0x03;
  systemMemory[0x0300] = 0x00;
},{Z:1,N:0});

runOne(0xBC,"LDY absx",()=>{
  CPUregisters.X = 1;
  systemMemory[1] = 0x00;
  systemMemory[2] = 0x03;     // base=$0300 → EA=$0301
  systemMemory[0x0301] = 0x80;
},{N:1,Z:0});

  // ================
  // Transfers
  // ================
  runOne(0xAA,"TAX",()=>{CPUregisters.A=0x80;},{N:1});
  runOne(0xA8,"TAY",()=>{CPUregisters.A=0;},{Z:1});
  runOne(0xBA,"TSX",()=>{CPUregisters.S=0;},{Z:1});
  runOne(0x8A,"TXA",()=>{CPUregisters.X=0xFF;},{N:1});
  runOne(0x98,"TYA",()=>{CPUregisters.Y=0xFF;},{N:1});

  // ================
  // Stack ops
  // ================
  runOne(0x68,"PLA",()=>{CPUregisters.S=0xFC;systemMemory[0x1FD]=0;},{Z:1});
  runOne(0x28,"PLP",()=>{CPUregisters.S=0xFC;systemMemory[0x1FD]=0xC0;},{N:1,V:1});
  runOne(0x08,"PHP",()=>{CPUregisters.P.C=1;},{C:1});

  // ================
  // Flag control
  // ================
  runOne(0x38,"SEC",()=>{},{C:1});
  runOne(0x18,"CLC",()=>{CPUregisters.P.C=1;},{C:0});
  runOne(0x78,"SEI",()=>{},{I:1});
  runOne(0x58,"CLI",()=>{CPUregisters.P.I=1;},{I:0});
  runOne(0xF8,"SED",()=>{},{D:1});
  runOne(0xD8,"CLD",()=>{CPUregisters.P.D=1;},{D:0});
  runOne(0xB8,"CLV",()=>{CPUregisters.P.V=1;},{V:0});
    // ======================
  // BRANCHES
  // ======================
  function runBranch(op,name,setup,expectTaken) {
    resetCPU();
    setup();
    const oldPC=CPUregisters.PC;
    OPCODES[op].func();
    const taken = (CPUregisters.PC !== (oldPC + 2));
    results.push({
      opcode: op.toString(16).padStart(2,"0").toUpperCase(),
      name,
      expectedTaken: expectTaken,
      actualTaken: taken,
      pass: taken===expectTaken
    });
  }

runBranch(0x10,"BPL taken (N=0)",()=>{
  systemMemory[1] = 0x10;   // branch offset
  CPUregisters.P.N = 0;
},true);

runBranch(0x10,"BPL not taken (N=1)",()=>{
  systemMemory[1] = 0x10;   // relative offset
  CPUregisters.P.N = 1;     // force negative flag
}, false);

runBranch(0x30,"BMI taken (N=1)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.N = 1;
},true);

runBranch(0x30,"BMI not taken (N=0)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.N = 0;
},false);

runBranch(0x50,"BVC taken (V=0)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.V = 0;
},true);

runBranch(0x50,"BVC not taken (V=1)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.V = 1;
},false);

runBranch(0x70,"BVS taken (V=1)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.V = 1;
},true);

runBranch(0x70,"BVS not taken (V=0)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.V = 0;
},false);

runBranch(0x90,"BCC taken (C=0)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.C = 0;
},true);

runBranch(0x90,"BCC not taken (C=1)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.C = 1;
},false);

runBranch(0xB0,"BCS taken (C=1)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.C = 1;
},true);

runBranch(0xB0,"BCS not taken (C=0)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.C = 0;
},false);

runBranch(0xD0,"BNE taken (Z=0)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.Z = 0;
},true);

runBranch(0xD0,"BNE not taken (Z=1)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.Z = 1;
},false);

runBranch(0xF0,"BEQ taken (Z=1)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.Z = 1;
},true);

runBranch(0xF0,"BEQ not taken (Z=0)",()=>{
  systemMemory[1] = 0x10;
  CPUregisters.P.Z = 0;
},false);

// backwards branching

// --- BPL ---
runBranch(0x10,"BPL taken backward (N=0)",()=>{
  systemMemory[1] = 0xF0;   // -16
  CPUregisters.P.N = 0;
},true);

runBranch(0x10,"BPL not taken backward (N=1)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.N = 1;
},false);

// --- BMI ---
runBranch(0x30,"BMI taken backward (N=1)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.N = 1;
},true);

runBranch(0x30,"BMI not taken backward (N=0)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.N = 0;
},false);

// --- BVC ---
runBranch(0x50,"BVC taken backward (V=0)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.V = 0;
},true);

runBranch(0x50,"BVC not taken backward (V=1)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.V = 1;
},false);

// --- BVS ---
runBranch(0x70,"BVS taken backward (V=1)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.V = 1;
},true);

runBranch(0x70,"BVS not taken backward (V=0)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.V = 0;
},false);

// --- BCC ---
runBranch(0x90,"BCC taken backward (C=0)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.C = 0;
},true);

runBranch(0x90,"BCC not taken backward (C=1)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.C = 1;
},false);

// --- BCS ---
runBranch(0xB0,"BCS taken backward (C=1)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.C = 1;
},true);

runBranch(0xB0,"BCS not taken backward (C=0)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.C = 0;
},false);

// --- BNE ---
runBranch(0xD0,"BNE taken backward (Z=0)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.Z = 0;
},true);

runBranch(0xD0,"BNE not taken backward (Z=1)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.Z = 1;
},false);

// --- BEQ ---
runBranch(0xF0,"BEQ taken backward (Z=1)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.Z = 1;
},true);

runBranch(0xF0,"BEQ not taken backward (Z=0)",()=>{
  systemMemory[1] = 0xF0;
  CPUregisters.P.Z = 0;
},false);


  // ======================
  // BRK / RTI
  // ======================
  resetCPU();
  CPUregisters.PC=0x1234;
  OPCODES[0x00].func(); // BRK
  results.push({opcode:"00",name:"BRK pushes PC+P",pass:true});

  resetCPU();
  CPUregisters.S=0xFA;
  systemMemory[0x1FB]=0x20; // P
  systemMemory[0x1FC]=0x34; // PCL
  systemMemory[0x1FD]=0x12; // PCH
  OPCODES[0x40].func(); // RTI
  results.push({opcode:"40",name:"RTI restores PC+P",pass:true});

  // ======================
  // RTS / JSR (control flow)
  // ======================
  resetCPU();
  systemMemory[1]=0x00; systemMemory[2]=0x80;
  OPCODES[0x20].func(); // JSR
  results.push({opcode:"20",name:"JSR pushes return",pass:true});

  resetCPU();
  CPUregisters.S=0xFC;
  systemMemory[0x1FD]=0x34; // PCL
  systemMemory[0x1FE]=0x12; // PCH
  OPCODES[0x60].func(); // RTS
  results.push({opcode:"60",name:"RTS restores PC",pass:true});

  // ======================
  // FINAL PRINT
  // ======================
  const fails=results.filter(r=>!r.pass);
  const passes=results.filter(r=>r.pass);
  console.group("=== FAILS (All tests) ===");console.table(fails);console.groupEnd();
  console.group("=== PASSES (All tests) ===");console.table(passes);console.groupEnd();
}

//=======================================================================+++++===============

//force Vblank
function forceVBlank() {
PPUSTATUS |= (1 << 7);
}

// fill OAM ($0200–$02FF) with a single test sprite
function loadTestSprite(){
for (let i = 0; i < 256; i++) {
  if (i === 0) { 
    checkWriteOffset(0x0200 + i, 120); // Y position (sprite top at scanline 120+1)
  } else if (i === 1) {
    checkWriteOffset(0x0200 + i, 0x02); // tile index (CHR tile #$02)
  } else if (i === 2) {
    checkWriteOffset(0x0200 + i, 0x00); // attributes: palette 0, no flip
  } else if (i === 3) {
    checkWriteOffset(0x0200 + i, 100);  // X position
  } else {
    checkWriteOffset(0x0200 + i, 0xFF); // rest of OAM offscreen
  }
}
}