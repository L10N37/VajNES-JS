console.log('[PPU-Worker] loaded');

/*
self.addEventListener('error', (e) => {
  console.error('[PPU-Worker ERROR]:', e.message, e);
});
self.addEventListener('messageerror', (e) => {
  console.error('[PPU-Worker MESSAGEERROR]:', e);
});
*/

let CLOCKS;

onmessage = (e) => {
  if (!e.data || !e.data.SAB_CLOCKS) {
    console.error('[PPU-Worker] Missing SAB_CLOCKS in message:', e.data);
    return;
  }
  CLOCKS = new Int32Array(e.data.SAB_CLOCKS);
  console.log('[PPU-Worker] got SAB_CLOCKS, starting log loop');
  logLoop();
};

function logLoop() {
  if (!CLOCKS) {
    console.warn('[PPU-Worker] CLOCKS not set yet');
    setTimeout(logLoop, 500);
    return;
  }
  const cpu = Atomics.load(CLOCKS, 0);
  const ppu = Atomics.load(CLOCKS, 1);
  console.log(`[PPU-Worker] cpu=${cpu} ppu=${ppu}`);
  setTimeout(logLoop, 500);
}
