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

      console.log("[SRAM] Loaded", bytes.length, "bytes");
    });

    document.body.appendChild(input);
    input.click();
  });

});
