// --- NES CPU P Flags: Bit Editing with Modal ---

// The order: C Z I D B U V N, mapped to bits 0–7 (P0..P7)
const flagOrder = ["C", "Z", "I", "D", "B", "U", "V", "N"];

// Attach to all flag <td>s
function attachStatusFlagCellEvents() {
  for (let i = 0; i < 8; ++i) {
    const td = document.getElementById("P" + i);
    if (!td) continue;
    const flag = flagOrder[i];
    td.style.cursor = "pointer";

    // Hover: show true/false
    td.addEventListener("mouseenter", () => {
      const v = CPUregisters.P[flag];
      td.title = v ? "true" : "false";
    });
    td.addEventListener("mouseleave", () => {
      td.title = "";
    });

    // Double-click: edit modal
    td.addEventListener("dblclick", () => {
      openStatusFlagEditModal(flag, i);
    });
  }
}

function openStatusFlagEditModal(flag, bitIndex) {
  document.getElementById("status-flag-edit-modal")?.remove();
  const v = CPUregisters.P[flag];

  const modal = document.createElement("div");
  modal.id = "status-flag-edit-modal";
  modal.style = `
    position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;
    background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:#222;color:#fff;padding:2em 2em 1.2em 2em;border-radius:10px;box-shadow:0 2px 18px #000;">
      <h2 style="margin-top:0;margin-bottom:18px;">Edit Flag <span style="color:#FFD700;">${flag}</span> (P${bitIndex})</h2>
      <div style="font-size:1.1em;margin-bottom:16px;">
        Current: <b>${v ? "true" : "false"}</b> (${v})
      </div>
      <input id="status-flag-edit-input" style="font-size:1.2em;padding:6px;width:7em;" value="${v ? "1" : "0"}" />
      <button id="status-flag-edit-set" style="margin-left:1em;">Set</button>
      <button id="status-flag-edit-cancel" style="margin-left:1em;">Cancel</button>
      <div id="status-flag-edit-error" style="color:#FF6666;margin-top:0.9em;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const input = document.getElementById("status-flag-edit-input");
  input.select();

  document.getElementById("status-flag-edit-set").onclick = () => {
    let nv = input.value.trim();
    let val;
    if (nv === "1" || nv.toLowerCase() === "true") val = 1;
    else if (nv === "0" || nv.toLowerCase() === "false") val = 0;
    else {
      document.getElementById("status-flag-edit-error").textContent = "Enter 1/0 or true/false";
      input.focus();
      return;
    }
    CPUregisters.P[flag] = val;
    document.body.removeChild(modal);
    cpuStatusRegisterPopulate();
  };
  document.getElementById("status-flag-edit-cancel").onclick = () => {
    document.body.removeChild(modal);
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") document.getElementById("status-flag-edit-set").click();
    if (e.key === "Escape") document.getElementById("status-flag-edit-cancel").click();
  };
}

// Call this after your P flag table is present in the DOM:
attachStatusFlagCellEvents();
