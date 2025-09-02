// ---- Breakpoints Core ----
const Breakpoints = {
  enabled: false,
  readAddrs: new Set(),
  writeAddrs: new Set(),
  opcodes: new Set(),
  once: false,
  logOnBreak: true,
  helpers: {
    vblankOnRead2002:  false,
    vblankOffRead2002: false,
    nmiEnableWrite2000:  false,
    nmiDisableWrite2000: false
  }
};

let bpStepOnce = false;
let bpModalEl = null;
let bpCheckRead  = () => {};
let bpCheckWrite = () => {};

// --- Core helpers ---
function breakHere(reason = "manual", ctx = {}) {
  if (!window.breakPending) {
    breakPending = true;
    debugLogging = true;
    console.warn(
      `%c[BREAK] ${reason}`,
      "background:gold;color:black;font-weight:bold;padding:2px 6px;border-radius:4px;",
      ctx
    );
    if (typeof openBreakpointModal === "function") openBreakpointModal();
  }
}

function __helpersReadArmed() {
  const h = Breakpoints.helpers;
  return h.vblankOnRead2002 || h.vblankOffRead2002;
}
function __helpersWriteArmed() {
  const h = Breakpoints.helpers;
  return h.nmiEnableWrite2000 || h.nmiDisableWrite2000;
}

function __hasAny() {
  return Breakpoints.readAddrs.size || Breakpoints.writeAddrs.size ||
         Breakpoints.opcodes.size   || __helpersReadArmed() || __helpersWriteArmed();
}

function __syncEnabled() {
  const prev = Breakpoints.enabled;
  Breakpoints.enabled = __hasAny();
  if (!Breakpoints.enabled) window.breakPending = false;
  if (prev !== Breakpoints.enabled) bpRebuildFastPaths();
  if (window.BreakpointUI && typeof BreakpointUI.refresh === "function") {
    BreakpointUI.refresh();
  }
}

function bpRebuildFastPaths() {
  const needRead  = Breakpoints.enabled && (Breakpoints.readAddrs.size  || __helpersReadArmed());
  const needWrite = Breakpoints.enabled && (Breakpoints.writeAddrs.size || __helpersWriteArmed());
  bpCheckRead  = needRead  ? __bpCheckRead_real  : () => {};
  bpCheckWrite = needWrite ? __bpCheckWrite_real : () => {};
}

// --- API ---
function bpOnce(on = true) { Breakpoints.once = !!on; }

function bpAddAddress(addr, {read=true, write=true} = {}) {
  addr &= 0xFFFF;
  if (read)  Breakpoints.readAddrs.add(addr);
  if (write) Breakpoints.writeAddrs.add(addr);
  __syncEnabled();
}
function bpRemoveAddress(addr) {
  addr &= 0xFFFF;
  Breakpoints.readAddrs.delete(addr);
  Breakpoints.writeAddrs.delete(addr);
  __syncEnabled();
}
function bpAddOpcode(op)    { Breakpoints.opcodes.add(op & 0xFF); __syncEnabled(); }
function bpRemoveOpcode(op) { Breakpoints.opcodes.delete(op & 0xFF); __syncEnabled(); }

function bpClearAll() {
  Breakpoints.readAddrs.clear();
  Breakpoints.writeAddrs.clear();
  Breakpoints.opcodes.clear();
  Object.keys(Breakpoints.helpers).forEach(k => Breakpoints.helpers[k] = false);
  __syncEnabled();
  window.debugLogging = false;
}

function bpConsumeStepOnce() {
  if (bpStepOnce) { bpStepOnce = false; return true; }
  return false;
}
function bpCheckOpcode(op, pc) {
  if (!Breakpoints.enabled) return;
  if (bpConsumeStepOnce()) return;
  op &= 0xFF; pc &= 0xFFFF;
  if (Breakpoints.opcodes.has(op)) {
    breakHere("OPCODE", { pc:`$${pc.toString(16).padStart(4,"0")}`, opcode:`$${op.toString(16).padStart(2,"0")}` });
    if (Breakpoints.once) bpClearAll();
  }
}

// --- Condition helpers ---
function __evalReadHelpers(addr) {
  if (addr === 0x2002) {
    const vb = (typeof window.PPUSTATUS === "number") && ((window.PPUSTATUS & 0x80) !== 0);
    if (Breakpoints.helpers.vblankOnRead2002 && vb)  { breakHere("READ $2002 (VBLANK=ON)");  if (Breakpoints.once) bpClearAll(); return true; }
    if (Breakpoints.helpers.vblankOffRead2002 && !vb){ breakHere("READ $2002 (VBLANK=OFF)"); if (Breakpoints.once) bpClearAll(); return true; }
  }
  return false;
}
function __evalWriteHelpers(addr, value) {
  if (addr === 0x2000) {
    const was = (typeof window.PPUCTRL === "number") && ((window.PPUCTRL & 0x80) !== 0);
    const now = ((value & 0x80) !== 0);
    if (Breakpoints.helpers.nmiEnableWrite2000 && !was && now)  { breakHere("WRITE $2000 (NMI 0→1)"); if (Breakpoints.once) bpClearAll(); return true; }
    if (Breakpoints.helpers.nmiDisableWrite2000 && was && !now) { breakHere("WRITE $2000 (NMI 1→0)"); if (Breakpoints.once) bpClearAll(); return true; }
  }
  return false;
}

// --- Fast paths ---
function __bpCheckRead_real(addr) {
  if (!Breakpoints.enabled) return;
  addr &= 0xFFFF;
  if (__helpersReadArmed() && addr >= 0x2000 && addr < 0x4000) {
    if (__evalReadHelpers(addr)) return;
  }
  if (Breakpoints.readAddrs.has(addr)) {
    breakHere("READ", { addr:`$${addr.toString(16).padStart(4,"0")}` });
    if (Breakpoints.once) bpClearAll();
  }
}

function __bpCheckWrite_real(addr, value) {
  if (!Breakpoints.enabled) return;
  addr &= 0xFFFF; value &= 0xFF;
  if (__helpersWriteArmed() && addr >= 0x2000 && addr < 0x4000) {
    if (__evalWriteHelpers(addr, value)) return;
  }
  if (Breakpoints.writeAddrs.has(addr)) {
    breakHere("WRITE", { addr:`$${addr.toString(16).padStart(4,"0")}`, value:`$${value.toString(16).padStart(2,"0")}` });
    if (Breakpoints.once) bpClearAll();
  }
}

// ---- Modal UI ----
function createBreakpointModal() {
  if (bpModalEl) return;
  const modal = document.createElement("div");
  modal.id = "bpModal";
  modal.style.cssText = "display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;color:#fff;padding:10px;border-radius:6px;z-index:9999;font-family:monospace;min-width:420px;";
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <h3 style="margin:0;">Breakpoints</h3>
      <span id="bpState" style="font-size:12px;opacity:.8;"></span>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin:6px 0;">
      <label><input type="checkbox" id="bpRead"> Read</label>
      <label><input type="checkbox" id="bpWrite"> Write</label>
      <select id="bpAddr">
        <option value="">-- address --</option>
        <option value="0x2000">$2000 PPUCTRL</option>
        <option value="0x2001">$2001 PPUMASK</option>
        <option value="0x2002">$2002 PPUSTATUS</option>
        <option value="0x2003">$2003 OAMADDR</option>
        <option value="0x2004">$2004 OAMDATA</option>
        <option value="0x2005">$2005 PPUSCROLL</option>
        <option value="0x2006">$2006 PPUADDR</option>
        <option value="0x2007">$2007 PPUDATA</option>
      </select>
      <button id="bpAdd">Add</button>
      <button id="bpDel">Remove</button>
    </div>
    <fieldset style="margin:8px 0;padding:6px;border:1px solid #555;">
      <legend>Helper Conditions</legend>
      <label><input type="checkbox" data-helper="vblankOnRead2002"> $2002 read when VBLANK=ON</label>
      <label><input type="checkbox" data-helper="vblankOffRead2002"> $2002 read when VBLANK=OFF</label>
      <label><input type="checkbox" data-helper="nmiEnableWrite2000"> $2000 write NMI 0→1</label>
      <label><input type="checkbox" data-helper="nmiDisableWrite2000"> $2000 write NMI 1→0</label>
      <div id="bpVblank" style="margin-top:6px;opacity:.8;">VBLANK: ?</div>
    </fieldset>
    <div style="display:flex;gap:6px;align-items:center;margin:6px 0;">
      <button id="bpClear">Clear All</button>
      <button id="bpClose">Close</button>
    </div>
    <textarea id="bpList" rows="6" cols="52" readonly style="width:100%;"></textarea>
  `;
  document.body.appendChild(modal);
  bpModalEl = modal;

  function refresh() {
    const list = [];
    Breakpoints.readAddrs.forEach(a => list.push(`Read  $${a.toString(16).padStart(4,"0")}`));
    Breakpoints.writeAddrs.forEach(a=> list.push(`Write $${a.toString(16).padStart(4,"0")}`));
    Breakpoints.opcodes.forEach(o   => list.push(`Opcode $${o.toString(16).padStart(2,"0")}`));
    Object.entries(Breakpoints.helpers).forEach(([k,v]) => { if (v) list.push(`Helper ${k}`); });

    bpModalEl.querySelector("#bpState").textContent = (Breakpoints.enabled ? "ENABLED" : "DISABLED");
    const vb = (typeof window.PPUSTATUS === "number" && (window.PPUSTATUS & 0x80)) ? "ON" : "OFF";
    bpModalEl.querySelector("#bpVblank").textContent = `VBLANK: ${vb}`;
    bpModalEl.querySelector("#bpList").value = list.length ? list.join("\n") : "(none)";

    bpModalEl.querySelectorAll("[data-helper]").forEach(cb => {
      const key = cb.getAttribute("data-helper");
      cb.checked = !!Breakpoints.helpers[key];
    });
  }

  window.openBreakpointModal  = () => { bpModalEl.style.display = "block"; refresh(); };
  window.closeBreakpointModal = () => { bpModalEl.style.display = "none"; };
  window.toggleBreakpointModal= () => {
    const show = (bpModalEl.style.display === "none" || !bpModalEl.style.display);
    bpModalEl.style.display = show ? "block" : "none";
    if (show) refresh();
  };

  window.BreakpointUI = { refresh };

  // wire controls
  modal.querySelector("#bpAdd").onclick = () => {
    const addrStr = modal.querySelector("#bpAddr").value;
    if (!addrStr) return;
    const addr = parseInt(addrStr, 16);
    if (isNaN(addr)) return;
    const rd = modal.querySelector("#bpRead").checked;
    const wr = modal.querySelector("#bpWrite").checked;
    if (!rd && !wr) return;
    bpAddAddress(addr, { read: rd, write: wr });
    refresh();
  };
  modal.querySelector("#bpDel").onclick = () => {
    const addrStr = modal.querySelector("#bpAddr").value;
    if (!addrStr) return;
    const addr = parseInt(addrStr, 16);
    if (!isNaN(addr)) bpRemoveAddress(addr);
    refresh();
  };
  modal.querySelector("#bpClear").onclick = () => { bpClearAll(); refresh(); };
  modal.querySelector("#bpClose").onclick = () => { closeBreakpointModal(); };

  modal.querySelectorAll("[data-helper]").forEach(cb => {
    cb.addEventListener("change", () => {
      const key = cb.getAttribute("data-helper");
      Breakpoints.helpers[key] = cb.checked;
      __syncEnabled();
      refresh();
    });
  });
}

// ---- Hotkey B ----
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (["input","textarea"].includes((e.target.tagName||"").toLowerCase())) return;
  if (e.key.toLowerCase() === "b") { createBreakpointModal(); toggleBreakpointModal(); }
});

// ---- Init ----
document.addEventListener("DOMContentLoaded", () => {
  createBreakpointModal();
  const disasmBtn = document.getElementById("open-disasm");
  if (disasmBtn) disasmBtn.onclick = () => launchDisasmWindow();
  __syncEnabled();
});


// ---- Disassembler Window ----
let disasmWin = null;

// ensure the global exists (no window.) — safe guard, won't redefine if present
if (typeof perFrameStep === "undefined") {
  // If not defined by host, default it so the UI won't crash.
  perFrameStep = false;
}

function launchDisasmWindow() {
  if (disasmWin) {
    disasmWin.focus();
    return;
  }

  disasmRunning = true;

  const win = new WinBox({
    title: "NES Disassembler",
    width: 720,
    height: 720,
    x: "center",
    y: "center",
    class: ["no-max", "no-min"],
    background: "#111",
    border: 0,
    onclose: () => {
      console.debug("Disassembler closed.");
      disasmRunning = false;
      disasmWin = null;
    }
  });

  disasmWin = win;

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <header class="bar">
      <div class="title">DISASSEMBLER</div>
      <span id="cycles-wrap" style="margin-left:10px;">
        CPU Cycles: <span id="cycles-value">--</span>
        <button id="cycles-update" class="btn">Update</button>
      </span>
      <span id="frame-step" style="margin-left:10px;opacity:.85;">Per-Frame (run): OFF</span>
      <button id="csv-export" class="btn">Export CSV</button>
      <button id="theme-toggle" class="btn"></button>
    </header>

    <main id="view" class="viewport" tabindex="0">
      <table class="disasm">
        <thead>
          <tr class="hdr">
            <th class="col-pc">PC</th><th class="col-opc">OPC</th><th class="col-op">OP</th>
            <th class="col-mn">MNEMONIC</th><th class="col-notes">NOTES</th>
            <th class="col-reg">A</th><th class="col-reg">X</th><th class="col-reg">Y</th>
            <th class="col-bit">C</th><th class="col-bit">Z</th><th class="col-bit">I</th>
            <th class="col-bit">D</th><th class="col-bit">V</th><th class="col-bit">N</th>
            <th class="col-reg">S</th>
          </tr>
          <tr class="sep"><td colspan="15"></td></tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <div class="scan" aria-hidden="true"></div>
    </main>

    <footer class="keybar">
      <span>R = Run</span><span>P = Pause</span><span>S = Step</span>
      <span>F = Per-Frame (run)</span><span>U = Update Cycles</span><span>T = Theme</span><span>B = Breakpoints</span>
    </footer>
  `;

  win.mount(wrap);

  const html = document.documentElement;
  const rowsEl = wrap.querySelector("#rows");
  const viewEl = wrap.querySelector("#view");
  const themeBtn = wrap.querySelector("#theme-toggle");
  const fsEl = wrap.querySelector("#frame-step");

  let currentTheme = html.getAttribute("data-theme") || "amber";
  function setTheme(name) {
    html.setAttribute("data-theme", name);
    themeBtn.textContent = "Theme: " + (name === "amber" ? "Green" : "Amber");
    currentTheme = name;
  }
  setTheme(currentTheme);
  themeBtn.onclick = () => setTheme(currentTheme === "amber" ? "green" : "amber");

  function updateFS() {
    if (!fsEl) return;
    fsEl.textContent = "Per-Frame (run): " + (perFrameStep ? "ON" : "OFF");
    fsEl.style.opacity = perFrameStep ? "1" : ".85";
  }
  updateFS();

  wrap.querySelector("#cycles-update").onclick = () => {
    const val = DebugCtl?.cpuCycles ?? "--";
    wrap.querySelector("#cycles-value").textContent = val;
  };

  wrap.querySelector("#csv-export").onclick = () => {
    const csv = Array.from(rowsEl.querySelectorAll("tr"))
      .map(row => Array.from(row.querySelectorAll("td")).map(td => td.textContent.trim()).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "disasm_log.csv";
    a.click();
  };

  // Keybinds inside the Disasm window
  wrap.addEventListener("keydown", e => {
    if (e.repeat) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const k = e.key.toLowerCase();
    if (k === "r") DebugCtl?.run?.();
    else if (k === "p") DebugCtl?.pause?.();
    else if (k === "s") DebugCtl?.step?.();
    else if (k === "f") { perFrameStep = !perFrameStep; updateFS(); }
    else if (k === "u") wrap.querySelector("#cycles-update")?.click();
    else if (k === "t") themeBtn?.click();
    else if (k === "escape" && disasmWin) disasmWin.close();
  });

  function appendDisasmRow(htmlRow) {
    if (!rowsEl || typeof htmlRow !== "string") return;
    rowsEl.insertAdjacentHTML("beforeend", htmlRow);
    while (rowsEl.children.length > 256) {
      rowsEl.removeChild(rowsEl.firstElementChild);
    }
    viewEl.scrollTop = viewEl.scrollHeight;
  }

  window.DISASM = { appendRow: appendDisasmRow };
  viewEl?.focus();
}


// ---- Debug control shim ----
window.DebugCtl = window.DebugCtl || {};
DebugCtl.run   = () => { bpStepOnce = false; window.run(); };
DebugCtl.pause = () => window.pause();
DebugCtl.step  = () => {
  bpStepOnce = true;      // allow exactly one instruction to run even if it's an opcode breakpoint
  cpuRunning = true;
  window.step();
  cpuRunning = false;
};
Object.defineProperty(globalThis.DebugCtl, 'cpuCycles', {
  get: () => cpuCycles,
  configurable: true
});
