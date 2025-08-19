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
let opcodeRows = [];
for(let i=0; i<256; ++i) {
  opcodeRows.push({
    OPC: "0x" + i.toString(16).padStart(2, "0").toUpperCase(),
    Handler: opcodeFuncs[i] ? opcodeFuncs[i].name : "(none)",
    "PC+": opcodePcIncs[i],
    Cycles: opcodeCyclesInc[i],
  });
}

function opcodeTablePrint(){
console.debug("%c==== 6502 Opcode Table (Branch ops highlighted) ====", "color:#fff;background:#222;font-size:1.2em;padding:4px;");
console.table(opcodeRows);
}
//=======================================================