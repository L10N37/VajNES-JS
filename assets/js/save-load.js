// =====================================
// SRAM SAVE / LOAD DROPDOWN
// =====================================

document.addEventListener("DOMContentLoaded", () => {

  // -----------------------------
  // Grab SRAM button
  // -----------------------------
  const SRAM = document.getElementById("SRAM");
  if (!SRAM) {
    console.error("[SRAM] Button with id='SRAM' not found");
    return;
  }

  // -----------------------------
  // Create dropdown menu
  // -----------------------------
  const menu = document.createElement("div");
  menu.id = "sram-dropdown";

  Object.assign(menu.style, {
    position: "absolute",
    display: "none",
    background: "#222",
    border: "1px solid #555",
    padding: "4px",
    zIndex: 99999
  });

  const saveBtn = document.createElement("div");
  saveBtn.textContent = "Save";
  saveBtn.style.padding = "4px";
  saveBtn.style.cursor = "pointer";

  const loadBtn = document.createElement("div");
  loadBtn.textContent = "Load";
  loadBtn.style.padding = "4px";
  loadBtn.style.cursor = "pointer";

  menu.appendChild(saveBtn);
  menu.appendChild(loadBtn);
  document.body.appendChild(menu);

  // -----------------------------
  // Toggle menu on SRAM click
  // -----------------------------
  SRAM.addEventListener("click", (e) => {
    e.stopPropagation();

    const rect = SRAM.getBoundingClientRect();
    menu.style.left = rect.left + "px";
    menu.style.top = rect.bottom + "px";

    menu.style.display =
      menu.style.display === "none" ? "block" : "none";
  });

  // -----------------------------
  // Click outside closes menu
  // -----------------------------
  document.addEventListener("click", () => {
    menu.style.display = "none";
  });

  // =====================================
  // SAVE SRAM (.sav raw bytes)
  // =====================================
  saveBtn.addEventListener("click", () => {
    menu.style.display = "none";

    if (typeof prgRam === "undefined" || !(prgRam instanceof Uint8Array)) {
      alert("prgRam is missing or not a Uint8Array");
      return;
    }

    let filename = prompt("Save SRAM as:", "save.sav");
    if (!filename) return;

    if (!filename.toLowerCase().endsWith(".sav")) {
      filename += ".sav";
    }

    const blob = new Blob([prgRam], {
      type: "application/octet-stream"
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  });

  // =====================================
  // LOAD SRAM (.sav raw bytes)
  // =====================================
  loadBtn.addEventListener("click", () => {
    menu.style.display = "none";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sav";
    input.style.display = "none";

    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".sav")) {
        alert("Only .sav files allowed");
        return;
      }

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Copy bytes into existing SRAM
      const len = Math.min(bytes.length, prgRam.length);
      prgRam.set(bytes.subarray(0, len));

      // Optional zero-fill remainder
      if (bytes.length < prgRam.length) {
        prgRam.fill(0, bytes.length);
      }

      console.debug("[SRAM] Loaded", bytes.length, "bytes");
    });

    document.body.appendChild(input);
    input.click();
  });

});


// save states
/*
save states of

systemMemory 
prgRam

cpu registers

let CPUregisters = {
  A: 0x00,
  X: 0x00,
  Y: 0x00,
  // initialized to 0xFF on power-up or reset?
  // https://www.nesdev.org/wiki/Stack
  S: 0xFD,
  PC: 0x8000, // got sick of loading a dummy rom/ setting in console/ setting in the GUI, lets just start with this
  P: {
      C: 0,    // Carry
      Z: 0,    // Zero
      I: 0,    // Interrupt Disable
      D: 0,    // Decimal Mode
      V: 0,    // Overflow
      N: 0     // Negative
  }
};

cpuCycles
ppuCycles

nmi edges need restoring (PPU_FRAME_FLAGS & 0b00000100)
nmiPending needs restoring
irqPending needs restoring
cpuStallFlag
VRAM
OAM
PALETTE_RAM
nmiSuppression
VRAM_ADDR
doNotSetVblank
CHR_BANK_LO
CHR_BANK_HI
VRAM_DATA
BG_ntByte
BG_atByte
BG_tileLo
BG_tileHi
PPUCTRL
PPUMASK
PPUSTATUS
OAMADDR
OAMDATA -> # this is a PPU register name, causing confusion actually. We want all the OAM DMA stuff saved and restored, and in future DMC DMA stuff. We can save and restore this if we actually use the register to hold values
SCROLL_X
SCROLL_Y
ADDR_HIGH
ADDR_LOW
t_lo
t_hi
fineX
# add mapper variables and scanline / dot/ frame
*/

// =====================================
// SAVE STATE SAVE / LOAD DROPDOWN (RAW .state)
// Button id: "saveState"
// =====================================

document.addEventListener("DOMContentLoaded", () => {

  // -----------------------------
  // Grab SaveState button
  // -----------------------------
  const saveStateBtn = document.getElementById("saveState");
  if (!saveStateBtn) {
    console.error("[SaveState] Button with id='saveState' not found");
    return;
  }

  // -----------------------------
  // Create dropdown menu
  // -----------------------------
  const menu = document.createElement("div");
  menu.id = "savestate-dropdown";

  Object.assign(menu.style, {
    position: "absolute",
    display: "none",
    background: "#222",
    border: "1px solid #555",
    padding: "4px",
    zIndex: 99999,
    color: "#fff",
    fontFamily: "sans-serif",
    fontSize: "14px",
    minWidth: "110px"
  });

  const saveBtn = document.createElement("div");
  saveBtn.textContent = "Save";
  Object.assign(saveBtn.style, { padding: "6px", cursor: "pointer" });

  const loadBtn = document.createElement("div");
  loadBtn.textContent = "Load";
  Object.assign(loadBtn.style, { padding: "6px", cursor: "pointer" });

  saveBtn.addEventListener("mouseenter", () => saveBtn.style.background = "#333");
  saveBtn.addEventListener("mouseleave", () => saveBtn.style.background = "transparent");
  loadBtn.addEventListener("mouseenter", () => loadBtn.style.background = "#333");
  loadBtn.addEventListener("mouseleave", () => loadBtn.style.background = "transparent");

  menu.appendChild(saveBtn);
  menu.appendChild(loadBtn);
  document.body.appendChild(menu);

  // -----------------------------
  // Toggle menu on SaveState click
  // -----------------------------
  saveStateBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    const rect = saveStateBtn.getBoundingClientRect();
    menu.style.left = rect.left + "px";
    menu.style.top = rect.bottom + "px";

    menu.style.display = (menu.style.display === "none") ? "block" : "none";
  });

  // -----------------------------
  // Click outside closes menu
  // -----------------------------
  document.addEventListener("click", () => {
    menu.style.display = "none";
  });

  // ==========================================================
  // RAW STATE FORMAT
  // ----------------------------------------------------------
  // File layout:
  //   MAGIC: 8 bytes  "NESSTv01"
  //   Sections repeating:
  //     TAG:  4 bytes ASCII (e.g. "SYSM", "PRGR", "CPUR", ...)
  //     LEN:  uint32 LE (payload length)
  //     DATA: raw bytes
  //
  // This avoids collisions and is easy to extend.
  // ==========================================================

  const MAGIC = "NESSTv01"; // 8 bytes

  // ---- pack/unpack helpers ----
  function u32ToBytesLE(n) {
    const b = new Uint8Array(4);
    b[0] = (n >>> 0) & 0xFF;
    b[1] = (n >>> 8) & 0xFF;
    b[2] = (n >>> 16) & 0xFF;
    b[3] = (n >>> 24) & 0xFF;
    return b;
  }

  function bytesToU32LE(arr, off) {
    return (arr[off] |
      (arr[off + 1] << 8) |
      (arr[off + 2] << 16) |
      (arr[off + 3] << 24)) >>> 0;
  }

  function tagToBytes(tag4) {
    if (!tag4 || tag4.length !== 4) throw new Error("TAG must be 4 chars");
    const b = new Uint8Array(4);
    b[0] = tag4.charCodeAt(0) & 0xFF;
    b[1] = tag4.charCodeAt(1) & 0xFF;
    b[2] = tag4.charCodeAt(2) & 0xFF;
    b[3] = tag4.charCodeAt(3) & 0xFF;
    return b;
  }

  function bytesToTag(arr, off) {
    return String.fromCharCode(arr[off], arr[off + 1], arr[off + 2], arr[off + 3]);
  }

  function num8(n) {
    const b = new Uint8Array(1);
    b[0] = (n >>> 0) & 0xFF;
    return b;
  }

  function num16LE(n) {
    const b = new Uint8Array(2);
    b[0] = (n >>> 0) & 0xFF;
    b[1] = (n >>> 8) & 0xFF;
    return b;
  }

  function num32LE(n) {
    return u32ToBytesLE(n >>> 0);
  }

  function bool1(v) {
    return num8(v ? 1 : 0);
  }

  // ---- CPU flags pack/unpack (C Z I D V N into bits) ----
  function packCPUFlags(P) {
    // Bit layout you control. Keep it consistent for load.
    // We'll map:
    // bit0 C, bit1 Z, bit2 I, bit3 D, bit6 V, bit7 N (classic-ish)
    let f = 0;
    f |= (P.C ? 1 : 0) << 0;
    f |= (P.Z ? 1 : 0) << 1;
    f |= (P.I ? 1 : 0) << 2;
    f |= (P.D ? 1 : 0) << 3;
    f |= (P.V ? 1 : 0) << 6;
    f |= (P.N ? 1 : 0) << 7;
    return f & 0xFF;
  }

  function unpackCPUFlags(byte) {
    return {
      C: (byte >> 0) & 1,
      Z: (byte >> 1) & 1,
      I: (byte >> 2) & 1,
      D: (byte >> 3) & 1,
      V: (byte >> 6) & 1,
      N: (byte >> 7) & 1
    };
  }

  // ---- section builder ----
  function buildSection(tag4, payloadBytes) {
    if (!(payloadBytes instanceof Uint8Array)) {
      throw new Error("payload must be Uint8Array for tag " + tag4);
    }
    const tag = tagToBytes(tag4);
    const len = u32ToBytesLE(payloadBytes.length);
    const out = new Uint8Array(4 + 4 + payloadBytes.length);
    out.set(tag, 0);
    out.set(len, 4);
    out.set(payloadBytes, 8);
    return out;
  }

  function concatBytes(chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function asciiBytes(str) {
    const b = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xFF;
    return b;
  }

  // ==========================================================
  // MAPPER STUBS (Mapper 0 works "by doing nothing special")
  // You can expand later without changing the file format.
  // ==========================================================

  function getMapperIdSafe() {
    // Adjust this to however you store it
    // e.g. window.mapperId, currentMapper, cartridge.mapper, etc.
    if (typeof mapperId !== "undefined") return mapperId | 0;
    if (typeof currentMapper !== "undefined") return currentMapper | 0;
    if (typeof cartridge !== "undefined" && cartridge && typeof cartridge.mapper !== "undefined") return cartridge.mapper | 0;
    return 0; // assume mapper 0 if unknown
  }

  function saveMapperState(mapperIdValue) {
    // For now:
    // Mapper 0: no extra state besides memory you already save (prgRam/systemMemory/etc)
    // Others: stub empty until you implement them.
    switch (mapperIdValue | 0) {
      case 0:
        return new Uint8Array(0);
      default:
        // stub - no-op for now
        return new Uint8Array(0);
    }
  }

  function loadMapperState(mapperIdValue, bytes) {
    // For now: no-op
    switch (mapperIdValue | 0) {
      case 0:
        return;
      default:
        // stub
        return;
    }
  }

  // ==========================================================
  // BUILD STATE BYTES
  // ==========================================================

  function buildStateBytes() {

    // ---- sanity checks (fail fast, helpful errors) ----
    if (typeof systemMemory === "undefined" || !(systemMemory instanceof Uint8Array)) {
      alert("systemMemory missing or not a Uint8Array");
      return null;
    }
    if (typeof prgRam === "undefined" || !(prgRam instanceof Uint8Array)) {
      alert("prgRam missing or not a Uint8Array");
      return null;
    }
    if (typeof CPUregisters === "undefined" || !CPUregisters || !CPUregisters.P) {
      alert("CPUregisters missing (or CPUregisters.P missing)");
      return null;
    }

    // These are expected arrays in your notes — if some are not arrays in your codebase, adjust here.
    const mustBeU8 = [
      ["VRAM", (typeof VRAM !== "undefined" ? VRAM : undefined)],
      ["OAM", (typeof OAM !== "undefined" ? OAM : undefined)],
      ["PALETTE_RAM", (typeof PALETTE_RAM !== "undefined" ? PALETTE_RAM : undefined)]
    ];

    for (const [name, ref] of mustBeU8) {
      if (typeof ref === "undefined" || !(ref instanceof Uint8Array)) {
        alert(name + " missing or not a Uint8Array");
        return null;
      }
    }

    const mapper = getMapperIdSafe();

    // ---- CPU register payload (fixed layout) ----
    // A X Y S (1 each), PC (2), FLAGS (1)
    const cpuReg = new Uint8Array(1 + 1 + 1 + 1 + 2 + 1);
    let i = 0;
    cpuReg[i++] = CPUregisters.A & 0xFF;
    cpuReg[i++] = CPUregisters.X & 0xFF;
    cpuReg[i++] = CPUregisters.Y & 0xFF;
    cpuReg[i++] = CPUregisters.S & 0xFF;
    const pc = CPUregisters.PC & 0xFFFF;
    cpuReg.set(num16LE(pc), i); i += 2;
    cpuReg[i++] = packCPUFlags(CPUregisters.P);

    // ---- scalar payload (lots of your globals) ----
    // We store as tagged sections per variable so you can reorder safely later.

    const chunks = [];

    // MAGIC at start (not a section)
    chunks.push(asciiBytes(MAGIC));

    // Core memory dumps
    chunks.push(buildSection("SYSM", systemMemory));  // systemMemory
    chunks.push(buildSection("PRGR", prgRam));        // prgRam

    // CPU regs + timing
    chunks.push(buildSection("CPUR", cpuReg));

    chunks.push(buildSection("CYC0", num32LE((typeof cpuCycles !== "undefined" ? cpuCycles : 0) >>> 0)));
    chunks.push(buildSection("CYC1", num32LE((typeof ppuCycles !== "undefined" ? ppuCycles : 0) >>> 0)));

    // CPU/IRQ/NMI related
    chunks.push(buildSection("NMIF", num8((typeof PPU_FRAME_FLAGS !== "undefined" ? PPU_FRAME_FLAGS : 0) & 0xFF)));
    chunks.push(buildSection("NMIP", bool1(typeof nmiPending !== "undefined" ? nmiPending : false)));
    chunks.push(buildSection("IRQP", bool1(typeof irqPending !== "undefined" ? irqPending : false)));
    chunks.push(buildSection("STAL", num32LE((typeof cpuStallFlag !== "undefined" ? cpuStallFlag : 0) >>> 0)));

    chunks.push(buildSection("CPUB", num8((typeof openBus.CPU !== "undefined" ? openBus.CPU : 0) & 0xFF)));
    chunks.push(buildSection("PPUB", num8((typeof openBus.PPU !== "undefined" ? openBus.PPU : 0) & 0xFF)));
    chunks.push(buildSection("RUNN", bool1(typeof cpuRunning !== "undefined" ? cpuRunning : true)));

    // PPU memory
    chunks.push(buildSection("VRAM", VRAM));
    chunks.push(buildSection("OAMM", OAM));
    chunks.push(buildSection("PALR", PALETTE_RAM));

    // PPU internal latches/state (scalars)
    chunks.push(buildSection("NMIS", bool1(typeof nmiSuppression !== "undefined" ? nmiSuppression : false)));
    chunks.push(buildSection("VADD", num16LE((typeof VRAM_ADDR !== "undefined" ? VRAM_ADDR : 0) & 0xFFFF)));
    chunks.push(buildSection("DVBL", bool1(typeof doNotSetVblank !== "undefined" ? doNotSetVblank : false))); // fixed name
    chunks.push(buildSection("WTGL", bool1(typeof writeToggle !== "undefined" ? writeToggle : false)));        // added

    chunks.push(buildSection("CBLO", num8((typeof CHR_BANK_LO !== "undefined" ? CHR_BANK_LO : 0) & 0xFF)));
    chunks.push(buildSection("CBHI", num8((typeof CHR_BANK_HI !== "undefined" ? CHR_BANK_HI : 0) & 0xFF)));

    chunks.push(buildSection("VDAT", num8((typeof VRAM_DATA !== "undefined" ? VRAM_DATA : 0) & 0xFF)));

    chunks.push(buildSection("BNTB", num8((typeof BG_ntByte !== "undefined" ? BG_ntByte : 0) & 0xFF)));
    chunks.push(buildSection("BATB", num8((typeof BG_atByte !== "undefined" ? BG_atByte : 0) & 0xFF)));
    chunks.push(buildSection("BTLO", num8((typeof BG_tileLo !== "undefined" ? BG_tileLo : 0) & 0xFF)));
    chunks.push(buildSection("BTHI", num8((typeof BG_tileHi !== "undefined" ? BG_tileHi : 0) & 0xFF)));

    chunks.push(buildSection("PCTL", num8((typeof PPUCTRL !== "undefined" ? PPUCTRL : 0) & 0xFF)));
    chunks.push(buildSection("PMSK", num8((typeof PPUMASK !== "undefined" ? PPUMASK : 0) & 0xFF)));
    chunks.push(buildSection("PSTA", num8((typeof PPUSTATUS !== "undefined" ? PPUSTATUS : 0) & 0xFF)));

    chunks.push(buildSection("OADR", num8((typeof OAMADDR !== "undefined" ? OAMADDR : 0) & 0xFF)));
    chunks.push(buildSection("ODAT", num8((typeof OAMDATA !== "undefined" ? OAMDATA : 0) & 0xFF)));

    chunks.push(buildSection("SCRX", num8((typeof SCROLL_X !== "undefined" ? SCROLL_X : 0) & 0xFF)));
    chunks.push(buildSection("SCRY", num8((typeof SCROLL_Y !== "undefined" ? SCROLL_Y : 0) & 0xFF)));

    chunks.push(buildSection("ADRH", num8((typeof ADDR_HIGH !== "undefined" ? ADDR_HIGH : 0) & 0xFF)));
    chunks.push(buildSection("ADRL", num8((typeof ADDR_LOW !== "undefined" ? ADDR_LOW : 0) & 0xFF)));

    chunks.push(buildSection("T_LO", num8((typeof t_lo !== "undefined" ? t_lo : 0) & 0xFF)));
    chunks.push(buildSection("T_HI", num8((typeof t_hi !== "undefined" ? t_hi : 0) & 0xFF)));
    chunks.push(buildSection("FINX", num8((typeof fineX !== "undefined" ? fineX : 0) & 0xFF)));

    // Mapper section (stub for now)
    chunks.push(buildSection("MAPR", num32LE(mapper >>> 0)));
    chunks.push(buildSection("MST0", saveMapperState(mapper)));

    return concatBytes(chunks);
  }

  // ==========================================================
  // APPLY STATE BYTES (RESTORE EVERYTHING)
  // ==========================================================

  function applyStateBytes(fileBytes) {
    if (!(fileBytes instanceof Uint8Array)) throw new Error("applyStateBytes expects Uint8Array");

    // MAGIC check
    if (fileBytes.length < 8) {
      alert("Invalid .state file (too small)");
      return false;
    }
    const magicStr = String.fromCharCode(
      fileBytes[0], fileBytes[1], fileBytes[2], fileBytes[3],
      fileBytes[4], fileBytes[5], fileBytes[6], fileBytes[7]
    );
    if (magicStr !== MAGIC) {
      alert("Invalid .state file (bad magic)");
      return false;
    }

    let off = 8;

    let mapperFromFile = 0;
    let mapperStateBytes = new Uint8Array(0);

    while (off + 8 <= fileBytes.length) {
      const tag = bytesToTag(fileBytes, off); off += 4;
      const len = bytesToU32LE(fileBytes, off); off += 4;

      if (off + len > fileBytes.length) {
        alert("Corrupt .state file (section overruns file): " + tag);
        return false;
      }

      const payload = fileBytes.subarray(off, off + len);
      off += len;

      switch (tag) {
        case "SYSM": {
          if (typeof systemMemory === "undefined" || !(systemMemory instanceof Uint8Array)) return false;
          const L = Math.min(payload.length, systemMemory.length);
          systemMemory.set(payload.subarray(0, L));
          if (payload.length < systemMemory.length) systemMemory.fill(0, payload.length);
        } break;

        case "PRGR": {
          if (typeof prgRam === "undefined" || !(prgRam instanceof Uint8Array)) return false;
          const L = Math.min(payload.length, prgRam.length);
          prgRam.set(payload.subarray(0, L));
          if (payload.length < prgRam.length) prgRam.fill(0, payload.length);
        } break;

        case "CPUR": {
          if (payload.length < 7) return false;
          CPUregisters.A = payload[0] & 0xFF;
          CPUregisters.X = payload[1] & 0xFF;
          CPUregisters.Y = payload[2] & 0xFF;
          CPUregisters.S = payload[3] & 0xFF;
          CPUregisters.PC = (payload[4] | (payload[5] << 8)) & 0xFFFF;
          CPUregisters.P = unpackCPUFlags(payload[6] & 0xFF);
        } break;

        case "CYC0": cpuCycles = bytesToU32LE(payload, 0) >>> 0; break;
        case "CYC1": ppuCycles = bytesToU32LE(payload, 0) >>> 0; break;

        case "NMIF": PPU_FRAME_FLAGS = payload[0] & 0xFF; break;
        case "NMIP": nmiPending = !!(payload[0] & 1); break;
        case "IRQP": irqPending = !!(payload[0] & 1); break;
        case "STAL": cpuStallFlag = bytesToU32LE(payload, 0) >>> 0; break;

        case "CPUB": openBus.CPU = payload[0] & 0xFF; break;
        case "PPUB": openBus.PPU = payload[0] & 0xFF; break;
        case "RUNN": cpuRunning = !!(payload[0] & 1); break;

        case "VRAM": {
          const L = Math.min(payload.length, VRAM.length);
          VRAM.set(payload.subarray(0, L));
          if (payload.length < VRAM.length) VRAM.fill(0, payload.length);
        } break;

        case "OAMM": {
          const L = Math.min(payload.length, OAM.length);
          OAM.set(payload.subarray(0, L));
          if (payload.length < OAM.length) OAM.fill(0, payload.length);
        } break;

        case "PALR": {
          const L = Math.min(payload.length, PALETTE_RAM.length);
          PALETTE_RAM.set(payload.subarray(0, L));
          if (payload.length < PALETTE_RAM.length) PALETTE_RAM.fill(0, payload.length);
        } break;

        case "NMIS": nmiSuppression = !!(payload[0] & 1); break;
        case "VADD": VRAM_ADDR = (payload[0] | (payload[1] << 8)) & 0xFFFF; break;

        case "DVBL": doNotSetVblank = !!(payload[0] & 1); break;  // fixed name
        case "WTGL": writeToggle = !!(payload[0] & 1); break;     // added

        case "CBLO": CHR_BANK_LO = payload[0] & 0xFF; break;
        case "CBHI": CHR_BANK_HI = payload[0] & 0xFF; break;

        case "VDAT": VRAM_DATA = payload[0] & 0xFF; break;

        case "BNTB": BG_ntByte = payload[0] & 0xFF; break;
        case "BATB": BG_atByte = payload[0] & 0xFF; break;
        case "BTLO": BG_tileLo = payload[0] & 0xFF; break;
        case "BTHI": BG_tileHi = payload[0] & 0xFF; break;

        case "PCTL": PPUCTRL = payload[0] & 0xFF; break;
        case "PMSK": PPUMASK = payload[0] & 0xFF; break;
        case "PSTA": PPUSTATUS = payload[0] & 0xFF; break;

        case "OADR": OAMADDR = payload[0] & 0xFF; break;
        case "ODAT": OAMDATA = payload[0] & 0xFF; break;

        case "SCRX": SCROLL_X = payload[0] & 0xFF; break;
        case "SCRY": SCROLL_Y = payload[0] & 0xFF; break;

        case "ADRH": ADDR_HIGH = payload[0] & 0xFF; break;
        case "ADRL": ADDR_LOW = payload[0] & 0xFF; break;

        case "T_LO": t_lo = payload[0] & 0xFF; break;
        case "T_HI": t_hi = payload[0] & 0xFF; break;
        case "FINX": fineX = payload[0] & 0xFF; break;

        case "MAPR": mapperFromFile = bytesToU32LE(payload, 0) | 0; break;
        case "MST0": mapperStateBytes = payload; break;

        default:
          // unknown section -> ignore (forward compatible)
          break;
      }
    }

    // Apply mapper-specific state (stub for now)
    loadMapperState(mapperFromFile, mapperStateBytes);

    return true;
  }

  // ==========================================================
  // UI: SAVE (.state)
  // ==========================================================

  saveBtn.addEventListener("click", () => {
    menu.style.display = "none";

    const bytes = buildStateBytes();
    if (!bytes) return;

    let filename = prompt("Save State as:", "save.state");
    if (!filename) return;

    if (!filename.toLowerCase().endsWith(".state")) {
      filename += ".state";
    }

    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  });

  // ==========================================================
  // UI: LOAD (.state)
  // ==========================================================

  loadBtn.addEventListener("click", () => {
    menu.style.display = "none";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".state";
    input.style.display = "none";

    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".state")) {
        alert("Only .state files allowed");
        return;
      }

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const ok = applyStateBytes(bytes);
      if (!ok) {
        console.warn("[SaveState] Load failed");
        return;
      }

      console.debug("[SaveState] Loaded", bytes.length, "bytes");

      // Optional: if your emulator needs a one-tick "loadState" flag, set it here
      // loadState = true;
    });

    document.body.appendChild(input);
    input.click();
  });

});
