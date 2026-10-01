// Minimal helper for FAST table content running in the simulator.
//
//   onFast((msg) => { ... })      every tool action: { type: 'fast-input', tool, id, ... }
//   const layout = await getLayout()   which tools exist and where (projection px), or null
//
// Messages arrive with window.postMessage from the simulator page, so this
// works even when the content is on a different site.

export function onFast(handler) {
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'fast-input') handler(e.data);
  });
}

export function getLayout(timeout = 1500) {
  return new Promise((resolve) => {
    const done = (v) => { window.removeEventListener('message', h); clearTimeout(timer); resolve(v); };
    const h = (e) => { if (e.data && e.data.type === 'fast-layout') done(e.data); };
    const timer = setTimeout(() => done(null), timeout);
    window.addEventListener('message', h);
    if (window.parent !== window) window.parent.postMessage({ type: 'fast-get-layout' }, '*');
  });
}

/** Speak text aloud: FAST experiences pair visuals with audio. */
export function say(text, lang = 'en-US') {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  speechSynthesis.speak(u);
}

/** A short tone, for rewards and feedback sounds. */
let audio;
export function beep(freq = 660, ms = 120, type = 'sine') {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch { /* audio blocked until a user gesture */ }
}
