// --- Register mapping for edit ---
const regMap = {
  "A": { prop: "A", max: 0xFF },
  "X": { prop: "X", max: 0xFF },
  "Y": { prop: "Y", max: 0xFF },
  "S": { prop: "S", max: 0xFF }
};

// --- Attach events to each register row (A/X/Y/S only) ---
function attachRegisterRowEvents() {
  document.querySelectorAll("td.addressClass").forEach(td => {
    const reg = td.textContent.trim();
    if (!regMap[reg]) return; // Skip PC, PCH, etc

    // --- Hover: show value in hex as tooltip ---
    td.parentElement.addEventListener("mouseenter", function() {
      const v = CPUregisters[regMap[reg].prop];
      td.parentElement.title = reg + ": " + hexTwo(v, reg === "S" ? 2 : 2);
    });
    td.parentElement.addEventListener("mouseleave", function() {
      td.parentElement.title = "";
    });

    // --- Double-click: show modal to edit ---
    td.parentElement.addEventListener("dblclick", function() {
      openRegisterEditModal(reg);
    });
  });
}

// --- Create & handle the modal ---
function openRegisterEditModal(reg) {
  // Remove any existing modal
  document.getElementById("reg-edit-modal")?.remove();

  const v = CPUregisters[regMap[reg].prop];
  const modal = document.createElement("div");
  modal.id = "reg-edit-modal";
  modal.style = `
    position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;
    background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:#222;color:#fff;padding:2em 2em 1.2em 2em;border-radius:10px;box-shadow:0 2px 18px #000;">
      <h2 style="margin-top:0;margin-bottom:18px;">Edit Register <span style="color:#FFD700;">${reg}</span></h2>
      <div style="font-size:1.1em;margin-bottom:16px;">
        Current: <b>${hexTwo(v, 2)}</b> (${v})
      </div>
      <input id="reg-edit-input" style="font-size:1.2em;padding:6px;width:7em;" value="${hexTwo(v,2)}" />
      <button id="reg-edit-set" style="margin-left:1em;">Set</button>
      <button id="reg-edit-cancel" style="margin-left:1em;">Cancel</button>
      <div id="reg-edit-error" style="color:#FF6666;margin-top:0.9em;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  // Focus input
  const input = document.getElementById("reg-edit-input");
  input.select();

  // Handle Set/Cancel
  document.getElementById("reg-edit-set").onclick = () => {
    let nv = input.value.trim();
    // Accept $xx or 0xXX or decimal
    if (/^\$[0-9A-F]+$/i.test(nv)) nv = parseInt(nv.slice(1), 16);
    else if (/^0x[0-9A-F]+$/i.test(nv)) nv = parseInt(nv, 16);
    else if (/^\d+$/.test(nv)) nv = parseInt(nv, 10);
    else nv = NaN;
    if (isNaN(nv) || nv < 0 || nv > regMap[reg].max) {
      document.getElementById("reg-edit-error").textContent = "Invalid value";
      input.focus();
      return;
    }
    CPUregisters[regMap[reg].prop] = nv;
    document.body.removeChild(modal);
    cpuRegisterBitsPopulate();
  };

  document.getElementById("reg-edit-cancel").onclick = () => {
    document.body.removeChild(modal);
  };

  input.onkeydown = (e) => {
    if (e.key === "Enter") document.getElementById("reg-edit-set").click();
    if (e.key === "Escape") document.getElementById("reg-edit-cancel").click();
  };
}

// call after table insertion
attachRegisterRowEvents();
