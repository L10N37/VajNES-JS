// --- Mapping: Table row label → global PPU register variable name + max value ---
const ppuRegMap = {
  "PPU [CTRL1]":      { varName: "PPUCTRL",     max: 0xFF },
  "PPU [CTRL2]":      { varName: "PPUMASK",     max: 0xFF },
  "PPU [SR]":         { varName: "PPUSTATUS",   max: 0xFF },
  "SPR-RAM [ADDR]":   { varName: "OAMADDR",     max: 0xFF },
  "SPR-RAM [I/O]":    { varName: "OAMDATA",     max: 0xFF },
  "VRAM [ADDR1]":     { varName: "ADDR_HIGH",   max: 0xFF },
  "VRAM [ADDR2]":     { varName: "ADDR_LOW",    max: 0xFF },
  "VRAM [I/O]":       { varName: "VRAM_DATA",   max: 0xFF }
};

// --- Attach hover & double-click events to PPU register rows ---
function attachPPURegisterRowEvents() {
  document.querySelectorAll("td.addressClass").forEach(td => {
    const rowLabel = td.textContent.trim();
    const regInfo = ppuRegMap[rowLabel];
    if (!regInfo) return;

    // --- Hover: show hex in tooltip ---
    td.parentElement.addEventListener("mouseenter", function() {
      const v = globalThis[regInfo.varName]; // read shared accessor directly
      td.parentElement.title = rowLabel + ": " + hexTwo(v);
    });
    td.parentElement.addEventListener("mouseleave", function() {
      td.parentElement.title = "";
    });

    // --- Double-click: modal to edit ---
    td.parentElement.addEventListener("dblclick", function() {
      openPPURegisterEditModal(rowLabel);
    });
  });
}

// --- Modal to edit PPU register value ---
function openPPURegisterEditModal(label) {
  document.getElementById("ppu-reg-edit-modal")?.remove();

  const { varName, max } = ppuRegMap[label];
  const v = globalThis[varName];
  const modal = document.createElement("div");
  modal.id = "ppu-reg-edit-modal";
  modal.style = `
    position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;
    background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:#222;color:#fff;padding:2em 2em 1.2em 2em;border-radius:10px;box-shadow:0 2px 18px #000;">
      <h2 style="margin-top:0;margin-bottom:18px;">Edit PPU Register <span style="color:#FFD700;">${label}</span></h2>
      <div style="font-size:1.1em;margin-bottom:16px;">
        Current: <b>${hexTwo(v, 2)}</b> (${v})
      </div>
      <input id="ppu-reg-edit-input" style="font-size:1.2em;padding:6px;width:7em;" value="${hexTwo(v,2)}" />
      <button id="ppu-reg-edit-set" style="margin-left:1em;">Set</button>
      <button id="ppu-reg-edit-cancel" style="margin-left:1em;">Cancel</button>
      <div id="ppu-reg-edit-error" style="color:#FF6666;margin-top:0.9em;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  // Focus input
  const input = document.getElementById("ppu-reg-edit-input");
  input.select();

  // Set/cancel handlers
  document.getElementById("ppu-reg-edit-set").onclick = () => {
    let nv = input.value.trim();
    if (/^\$[0-9A-F]+$/i.test(nv)) nv = parseInt(nv.slice(1), 16);
    else if (/^0x[0-9A-F]+$/i.test(nv)) nv = parseInt(nv, 16);
    else if (/^\d+$/.test(nv)) nv = parseInt(nv, 10);
    else nv = NaN;

    if (isNaN(nv) || nv < 0 || nv > max) {
      document.getElementById("ppu-reg-edit-error").textContent = "Invalid value";
      input.focus();
      return;
    }

    globalThis[varName] = nv; // write directly to shared accessor
    document.body.removeChild(modal);
    ppuRegisterBitsPopulate();
  };

  document.getElementById("ppu-reg-edit-cancel").onclick = () => {
    document.body.removeChild(modal);
  };

  input.onkeydown = (e) => {
    if (e.key === "Enter") document.getElementById("ppu-reg-edit-set").click();
    if (e.key === "Escape") document.getElementById("ppu-reg-edit-cancel").click();
  };
}

// After table insertion
attachPPURegisterRowEvents();
