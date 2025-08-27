// ---- Breakpoint System ----
const Breakpoints = {
  enabled: true,
  anyRead: false,
  anyWrite: false,
  readAddrs: new Set(),
  writeAddrs: new Set(),
  opcodes: new Set(),
  once: false,
  logOnBreak: true
};

let bpStepOnce = false; // lets one instruction run even if it matches an opcode breakpoint

function breakHere(reason = "manual", ctx = {}) {
  if (!breakPending) {
    breakPending = true;
    debugLogging = true;
    if (Breakpoints.logOnBreak) {
      console.warn(
        `%c[BREAK] ${reason}`,
        "background:gold;color:black;font-weight:bold;padding:2px 6px;border-radius:4px;",
        ctx
      );
    }
    openBreakpointModal();
  }
}

// public helpers
function bpEnable(on = true) { Breakpoints.enabled = !!on; if (!on) breakPending = false; bpRebuildFastPaths(); }
function bpOnce(on = true) { Breakpoints.once = !!on; }
function bpSetAny({ read = false, write = false } = {}) {
  Breakpoints.anyRead = !!read;
  Breakpoints.anyWrite = !!write;
  bpRebuildFastPaths();
}

function bpAddAddress(addr, { read = true, write = true } = {}) {
  addr = addr & 0xFFFF;
  if (read) Breakpoints.readAddrs.add(addr);
  if (write) Breakpoints.writeAddrs.add(addr);
  bpRebuildFastPaths();
}
function bpRemoveAddress(addr) {
  addr = addr & 0xFFFF;
  Breakpoints.readAddrs.delete(addr);
  Breakpoints.writeAddrs.delete(addr);
  bpRebuildFastPaths();
}

function bpAddOpcode(op) { Breakpoints.opcodes.add(op & 0xFF); }
function bpRemoveOpcode(op) { Breakpoints.opcodes.delete(op & 0xFF); }

function bpClearAll() {
  Breakpoints.readAddrs.clear();
  Breakpoints.writeAddrs.clear();
  Breakpoints.opcodes.clear();
  Breakpoints.anyRead = false;
  Breakpoints.anyWrite = false;
  bpRebuildFastPaths();
}

function bpAfterHit() {
  if (Breakpoints.once) bpClearAll();
}

// hot-path no-ops; swapped in when no read/write breakpoints are active
const __noop = () => {};

function __bpCheckRead_real(addr) {
  if (!Breakpoints.enabled) return;
  addr &= 0xFFFF;
  if (Breakpoints.anyRead || Breakpoints.readAddrs.has(addr)) {
    breakHere("READ", { addr: `$${addr.toString(16).padStart(4, "0")}` });
    bpAfterHit();
  }
}
function __bpCheckWrite_real(addr, value) {
  if (!Breakpoints.enabled) return;
  addr &= 0xFFFF; value &= 0xFF;
  if (Breakpoints.anyWrite || Breakpoints.writeAddrs.has(addr)) {
    breakHere("WRITE", {
      addr: `$${addr.toString(16).padStart(4, "0")}`,
      value: `$${value.toString(16).padStart(2, "0")}`
    });
    bpAfterHit();
  }
}

// these names are what your memory access code calls
let bpCheckRead  = __noop;
let bpCheckWrite = __noop;

function bpRebuildFastPaths() {
  const needRead  = Breakpoints.enabled && (Breakpoints.anyRead  || Breakpoints.readAddrs.size  > 0);
  const needWrite = Breakpoints.enabled && (Breakpoints.anyWrite || Breakpoints.writeAddrs.size > 0);
  bpCheckRead  = needRead  ? __bpCheckRead_real  : __noop;
  bpCheckWrite = needWrite ? __bpCheckWrite_real : __noop;
}
bpRebuildFastPaths();

// called from CPU step: skip once to allow stepping past opcode breakpoints
function bpConsumeStepOnce() {
  if (bpStepOnce) { bpStepOnce = false; return true; }
  return false;
}

// opcode check; call at start of instruction with (opcode, pc)
function bpCheckOpcode(opcode, pc) {
  if (!Breakpoints.enabled) return;
  if (bpConsumeStepOnce()) return; // step-over consumes one hit
  opcode &= 0xFF; pc &= 0xFFFF;
  if (Breakpoints.opcodes.has(opcode)) {
    breakHere("OPCODE", {
      pc: `$${pc.toString(16).padStart(4, "0")}`,
      opcode: `$${opcode.toString(16).padStart(2, "0")}`
    });
    bpAfterHit();
  }
}

// ---- Breakpoint Modal (global) ----
let bpModalEl = null;

function createBreakpointModal() {
  const modal = document.createElement("div");
  modal.id = "bpModal";
  modal.style.cssText = "display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;color:#fff;padding:10px;border-radius:6px;z-index:9999;font-family:monospace;min-width:300px;";

  modal.innerHTML = `
    <h3 style="margin:0 0 6px 0;">Breakpoints</h3>
    <label><input type="checkbox" id="bpRead"> Reads</label>
    <label style="margin-left:8px;"><input type="checkbox" id="bpWrite"> Writes</label>
    <div style="margin:6px 0;">
      <select id="bpAddr">
        <option value="">-- address --</option>
        <option value="0x2000">PPUCTRL ($2000)</option>
        <option value="0x2001">PPUMASK ($2001)</option>
        <option value="0x2002">PPUSTATUS ($2002)</option>
        <option value="0x2003">OAMADDR ($2003)</option>
        <option value="0x2004">OAMDATA ($2004)</option>
        <option value="0x2005">PPUSCROLL ($2005)</option>
        <option value="0x2006">PPUADDR ($2006)</option>
        <option value="0x2007">PPUDATA ($2007)</option>
        <option value="0x4014">OAMDMA ($4014)</option>
        <option value="0x4016">JOY1 ($4016)</option>
        <option value="0x4017">JOY2/APUFRAME ($4017)</option>
      </select>
    </div>
    <div style="margin:6px 0;">
      <input type="text" id="bpOpcode" placeholder="opcode" size="8">
    </div>
    <div style="margin:6px 0;">
      <button id="bpSet">Set</button>
      <button id="bpClear" style="margin-left:6px;">Clear</button>
      <button id="bpClose" style="margin-left:6px;">Close</button>
    </div>
    <textarea id="bpList" rows="4" cols="40" readonly></textarea>
  `;

  document.body.appendChild(modal);
  bpModalEl = modal;

  function updateBpList() {
    if (!bpModalEl) return;
    const list = [];
    if (Breakpoints.anyRead) list.push("Any Read");
    if (Breakpoints.anyWrite) list.push("Any Write");
    Breakpoints.readAddrs.forEach(a => list.push(`Read $${a.toString(16).padStart(4,"0")}`));
    Breakpoints.writeAddrs.forEach(a => list.push(`Write $${a.toString(16).padStart(4,"0")}`));
    Breakpoints.opcodes.forEach(o => list.push(`Opcode $${o.toString(16).padStart(2,"0")}`));
    bpModalEl.querySelector("#bpList").value = list.join("\n");
  }

  window.openBreakpointModal = function() {
    if (!bpModalEl) return;
    bpModalEl.style.display = "block";
    updateBpList();
  };
  window.closeBreakpointModal = function() {
    if (!bpModalEl) return;
    bpModalEl.style.display = "none";
  };
  window.toggleBreakpointModal = function() {
    if (!bpModalEl) return;
    const show = (bpModalEl.style.display === "none" || !bpModalEl.style.display);
    bpModalEl.style.display = show ? "block" : "none";
    if (show) updateBpList();
  };

  bpModalEl.querySelector("#bpSet").onclick = () => {
    const read = bpModalEl.querySelector("#bpRead").checked;
    const write = bpModalEl.querySelector("#bpWrite").checked;
    const addr = bpModalEl.querySelector("#bpAddr").value;
    const opcodeStr = bpModalEl.querySelector("#bpOpcode").value.trim();

    if (read || write) {
      if (addr) {
        const val = parseInt(addr, 16);
        bpAddAddress(val, { read, write });
      } else {
        if (read) Breakpoints.anyRead = true;
        if (write) Breakpoints.anyWrite = true;
        bpRebuildFastPaths();
      }
    }

    if (opcodeStr) {
      const op = parseInt(opcodeStr.replace(/^0x/i, ""), 16);
      if (!isNaN(op)) bpAddOpcode(op);
    }

    bpEnable(true);
    updateBpList();
  };

  bpModalEl.querySelector("#bpClear").onclick = () => {
    bpClearAll();
    updateBpList();
    debugLogging = false;
  };

  bpModalEl.querySelector("#bpClose").onclick = () => {
    closeBreakpointModal();
  };

  window.addEventListener("keydown", e => {
    if (e.repeat) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.key.toLowerCase() === "b") toggleBreakpointModal();
  });

  window.BreakpointUI = { open: openBreakpointModal, close: closeBreakpointModal, toggle: toggleBreakpointModal, refresh: updateBpList };
}

// ---- Disassembler Window ----
let disasmWin = null;

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
      <span>U = Update Cycles</span><span>T = Theme</span><span>B = Breakpoints</span>
    </footer>
  `;

  win.mount(wrap);

  const html = document.documentElement;
  const rowsEl = wrap.querySelector("#rows");
  const viewEl = wrap.querySelector("#view");
  const themeBtn = wrap.querySelector("#theme-toggle");

  let currentTheme = html.getAttribute("data-theme") || "amber";
  function setTheme(name) {
    html.setAttribute("data-theme", name);
    themeBtn.textContent = "Theme: " + (name === "amber" ? "Green" : "Amber");
    currentTheme = name;
  }
  setTheme(currentTheme);
  themeBtn.onclick = () => setTheme(currentTheme === "amber" ? "green" : "amber");

  wrap.querySelector("#cycles-update").onclick = () => {
    const val = window.DebugCtl?.cpuCycles ?? "--";
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

  wrap.addEventListener("keydown", e => {
    if (e.repeat) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const k = e.key.toLowerCase();
    if (k === "r") window.DebugCtl?.run?.();
    else if (k === "p") window.DebugCtl?.pause?.();
    else if (k === "s") window.DebugCtl?.step?.();
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

// ---- Bootstrapping ----
document.addEventListener("DOMContentLoaded", () => {
  createBreakpointModal();
  const disasmBtn = document.getElementById("open-disasm");
  if (disasmBtn) disasmBtn.onclick = () => launchDisasmWindow();
});
