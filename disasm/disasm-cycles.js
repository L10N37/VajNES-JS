const bc = new BroadcastChannel("nes-disasm");
let latestCycles = "--";

function updateCycles() {
  document.getElementById("cycles-value").textContent = latestCycles;
  // ask main thread to send us current value
  bc.postMessage({ type: "cycles.request" });
}

bc.onmessage = (e) => {
  if (e.data?.type === "cycles.update") {
    latestCycles = e.data.value;
    document.getElementById("cycles-value").textContent = latestCycles;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("cycles-update");
  if (btn) btn.addEventListener("click", updateCycles);

  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "u" || e.key === "U") {
      e.preventDefault();
      updateCycles();
    }
  });
});
