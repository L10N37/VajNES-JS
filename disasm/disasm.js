function launchDisasmWindow() {
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
      return true; // ensure WinBox destroys, not hides
    }
  });

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <header class="bar" style="display: flex; align-items: center; justify-content: space-between;">
      <div style="display:flex;align-items:center;">
        <div class="title">DISASSEMBLER</div>
        <span id="cycles-wrap" style="margin-left:10px;">
          CPU Cycles: <span id="cycles-value">--</span>
          <button id="cycles-update" class="btn">Update</button>
        </span>
        <button id="csv-export" class="btn">Export CSV</button>
      </div>
      <button id="theme-toggle" class="btn" title="T">Theme: Amber</button>
    </header>

    <main id="view" class="viewport" tabindex="0" role="log" aria-live="polite">
      <table class="disasm">
        <thead>
          <tr class="hdr">
            <th class="col-pc">PC</th>
            <th class="col-opc">OPC</th>
            <th class="col-op">OP</th>
            <th class="col-mn">MNEMONIC</th>
            <th class="col-notes">NOTES</th>
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
      <span>U = Update Cycles</span><span>T = Theme</span>
    </footer>
  `;

  win.mount(wrap);

  const html = document.documentElement;
  const viewEl = wrap.querySelector("#view");
  const rowsEl = wrap.querySelector("#rows");
  const themeBtn = wrap.querySelector("#theme-toggle");

  // THEME TOGGLE
  let currentTheme = html.getAttribute("data-theme") || "amber";
  function setTheme(name) {
    html.setAttribute("data-theme", name);
    themeBtn.textContent = "Theme: " + (name === "amber" ? "Amber" : "Green");
    currentTheme = name;
  }
  themeBtn.onclick = () => setTheme(currentTheme === "amber" ? "green" : "amber");
  setTheme(currentTheme);

  // CPU CYCLE UPDATE
  wrap.querySelector("#cycles-update").onclick = () => {
    const val = window.DebugCtl?.cpuCycles ?? "--";
    wrap.querySelector("#cycles-value").textContent = val;
  };

  // CSV EXPORT
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

  // KEYBOARD SHORTCUTS
  window.addEventListener("keydown", e => {
    if (e.repeat) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const k = e.key.toLowerCase();
    if (k === "r") window.DebugCtl?.run?.();
    else if (k === "p") window.DebugCtl?.pause?.();
    else if (k === "s") window.DebugCtl?.step?.();
    else if (k === "u") document.querySelector("#cycles-update")?.click();
    else if (k === "t") document.querySelector("#theme-toggle")?.click();
  });

  // SCROLLABLE APPEND
  function appendDisasmRow(html) {
    if (!rowsEl || typeof html !== "string") return;
    rowsEl.insertAdjacentHTML("beforeend", html);
    while (rowsEl.children.length > 256) {
      rowsEl.removeChild(rowsEl.firstElementChild);
    }
    viewEl.scrollTop = viewEl.scrollHeight;
  }

  window.DISASM = { appendRow: appendDisasmRow };
  viewEl?.focus();
}

window.DebugCtl = window.DebugCtl || {};
DebugCtl.run = () => window.run();
DebugCtl.pause = () => window.pause();
DebugCtl.step = () => window.step();
Object.defineProperty(globalThis.DebugCtl, 'cpuCycles', {
  get: () => cpuCycles,
  configurable: true
});
