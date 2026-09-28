// No-signal CRT-ish audio (white noise + filters + faint 50 Hz hum)
const NoSignalAudio = (() => {
  let ctx, master, hp, lp, notch;
  let noiseSrc, noiseGain, hum, humGain, hum2, hum2Gain;
  let enabled = false;     // actually playing now
  let pendingOn = false;   // requested to play, waiting for user gesture

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();

      master = ctx.createGain();
      master.gain.value = 0.0; // start muted; fade in on start()
      master.connect(ctx.destination);

      // Filters to shape the noise a bit like TV snow
      hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 120;
      lp = ctx.createBiquadFilter(); lp.type = "lowpass";  lp.frequency.value = 6500;
      notch = ctx.createBiquadFilter(); notch.type = "notch"; notch.frequency.value = 15625; notch.Q.value = 8;

      hp.connect(lp); lp.connect(notch); notch.connect(master);

      // If we get resumed later (via a user gesture), auto-start if requested
      ctx.onstatechange = () => {
        if (ctx.state === "running" && pendingOn && !enabled) internalStart();
      };
    }
  }

  function makeNoiseBuffer(durationSec = 2.1) {
    const length = Math.floor((ctx.sampleRate || 48000) * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1);
    return buffer;
  }

  function ensureHumStarted() {
    if (!hum) {
      hum = ctx.createOscillator(); hum.frequency.value = 50;
      humGain = ctx.createGain(); humGain.gain.value = 0.004;
      hum.connect(humGain).connect(master); hum.start();

      hum2 = ctx.createOscillator(); hum2.frequency.value = 100;
      hum2Gain = ctx.createGain(); hum2Gain.gain.value = 0.002;
      hum2.connect(hum2Gain).connect(master); hum2.start();
    }
  }

  function internalStart() {
    if (enabled) return;
    if (!ctx || ctx.state !== "running") { pendingOn = true; return; }

    ensureHumStarted();

    const buf = makeNoiseBuffer();
    noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buf;
    noiseSrc.loop = true;

    noiseGain = ctx.createGain(); noiseGain.gain.value = 0.5; // pre-filter level
    noiseSrc.connect(noiseGain).connect(hp);

    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0.06, now + 0.12);

    noiseSrc.start();
    enabled = true;
    pendingOn = false;
  }

  function internalStop() {
    pendingOn = false;
    if (!enabled) return;
    // Detach ownership immediately: CPU steps can request off millions of times.
    // An old fade callback must never stop a newly started source.
    enabled = false;
    const oldSource=noiseSrc,oldGain=noiseGain;
    noiseSrc=noiseGain=null;
    const now=ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value,now);
    master.gain.linearRampToValueAtTime(0,now+0.10);
    try {oldSource.stop(now+0.12);} catch {}
    setTimeout(()=>{
      try {oldSource.disconnect();} catch {}
      try {oldGain.disconnect();} catch {}
    },130);
  }

  async function initOnUserGesture() {
    if(!pendingOn && !enabled)return;
    ensureCtx();
    try {await ctx.resume();} catch {return;}
    if(pendingOn && ctx.state==='running')internalStart();
  }
  // Browsers require an actual gesture to resume a context. The previous public
  // unlock method had no event listener, so RF noise stayed suspended forever.
  document.addEventListener('pointerdown',initOnUserGesture,{capture:true});
  document.addEventListener('keydown',initOnUserGesture,{capture:true});

  // Public API
  return {
    setEnabled(on) {
      if (on) {
        ensureCtx();
        pendingOn = true;
        if (ctx.state === "running") internalStart(); // otherwise wait for gesture
      } else {
        internalStop();
      }
    },
    initOnUserGesture
  };
})();
