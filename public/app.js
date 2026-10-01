import { FAST, OPTIONS, defaultSrc } from './config.js';
import { TouchInjector } from './touch-injector.js';
import { ContentCapture } from './content-capture.js';

const $ = (sel) => document.querySelector(sel);
const frame = $('#content');
const wrap = $('#screen-wrap');
const flatStage = $('#flat-stage');
const overlay = $('#overlay');
const srcInput = $('#src');
const status = $('#status');
const mouseTouch = $('#mouse-touch');
const shimUrl = new URL('./shim.js', import.meta.url).href;

const injector = new TouchInjector(frame);
const capture = new ContentCapture(frame, { mode: OPTIONS.capture, domFps: OPTIONS.domFps });
let view = OPTIONS.view === '3d' ? '3d' : 'flat';
let tableScene = null;
let scale = 1;

// ------------------------------------------------------------------ content

function load(src) {
  srcInput.value = src;
  injector.cancelAll();
  frame.src = src;
  saveParams();
}

frame.addEventListener('load', () => {
  const doc = sameOriginDoc();
  if (doc && !frame.contentWindow.__fastsim) {
    // Not proxied through server.js: install the shim late. Good enough for
    // most content; injecting it before the page's own scripts is better.
    const s = doc.createElement('script');
    s.src = shimUrl;
    (doc.head || doc.documentElement).prepend(s);
  }
  capture.markDirty();
  updateStatus();
});

function sameOriginDoc() {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

function updateStatus() {
  const same = injector.available();
  document.body.classList.toggle('inject', same && mouseTouch.checked);
  const mode = view === '3d' && capture.mode ? ` · capture: ${capture.mode}` : '';
  status.innerHTML = same
    ? `${FAST.width}×${FAST.height} · ${FAST.diagInches}" · touch injection on${mode}`
    : `${FAST.width}×${FAST.height} · <span class="warn">cross-origin: no touch emulation or 3D</span>`;
}

$('#src-form').addEventListener('submit', (e) => {
  e.preventDefault();
  load(srcInput.value.trim() || defaultSrc());
});
mouseTouch.addEventListener('change', updateStatus);

// ---------------------------------------------------------------- flat view

function layoutFlat() {
  if (view !== 'flat') return;
  const fs = document.fullscreenElement;
  const pad = fs ? 0 : 56; // room for the drawn bezel/rim
  const w = flatStage.clientWidth - pad * 2;
  const h = flatStage.clientHeight - pad * 2;
  scale = Math.max(0.05, Math.min(w / FAST.width, h / FAST.height));
  const x = (flatStage.clientWidth - FAST.width * scale) / 2;
  const y = (flatStage.clientHeight - FAST.height * scale) / 2;
  wrap.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}
new ResizeObserver(layoutFlat).observe(flatStage);

// Mouse / real touchscreen -> touch events in the content.
//   drag            one finger
//   Shift + drag    two-finger pinch / rotate around where you pressed
//   Ctrl/Alt + drag two-finger pan
const gesture = { active: false };

function toContent(e) {
  const r = overlay.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}

overlay.addEventListener('pointerdown', (e) => {
  if (!injector.available()) return;
  overlay.setPointerCapture(e.pointerId);
  const p = toContent(e);
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    injector.down(`t${e.pointerId}`, p.x, p.y);
    return;
  }
  if (e.button !== 0) return;
  const two = e.shiftKey ? 'pinch' : e.ctrlKey || e.altKey ? 'pan' : null;
  Object.assign(gesture, { active: true, two, start: p });
  if (two) {
    const [a, b] = twoFinger(p);
    injector.down('m0', a.x, a.y);
    injector.down('m1', b.x, b.y);
  } else {
    injector.down('m0', p.x, p.y);
  }
  e.preventDefault();
});

overlay.addEventListener('pointermove', (e) => {
  const p = toContent(e);
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    injector.move(`t${e.pointerId}`, p.x, p.y);
    return;
  }
  if (!gesture.active) return;
  if (gesture.two) {
    const [a, b] = twoFinger(p);
    injector.move('m0', a.x, a.y);
    injector.move('m1', b.x, b.y);
  } else {
    injector.move('m0', p.x, p.y);
  }
});

function endPointer(e) {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    injector.up(`t${e.pointerId}`);
    return;
  }
  if (!gesture.active) return;
  gesture.active = false;
  injector.up('m0');
  injector.up('m1');
}
overlay.addEventListener('pointerup', endPointer);
overlay.addEventListener('pointercancel', endPointer);
overlay.addEventListener('contextmenu', (e) => e.preventDefault());

function twoFinger(p) {
  const s = gesture.start;
  const dx = p.x - s.x, dy = p.y - s.y;
  if (gesture.two === 'pan') {
    return [{ x: s.x - 60 + dx, y: s.y + dy }, { x: s.x + 60 + dx, y: s.y + dy }];
  }
  const vx = 80 + dx, vy = dy;
  return [{ x: s.x - vx, y: s.y - vy }, { x: s.x + vx, y: s.y + vy }];
}

// Show where the simulated fingers are.
const dots = new Map();
injector.onContact((type, p) => {
  let d = dots.get(p.key);
  if (type === 'up') {
    d?.remove();
    dots.delete(p.key);
    return;
  }
  if (!d) {
    d = document.createElement('div');
    d.className = 'dot';
    overlay.appendChild(d);
    dots.set(p.key, d);
  }
  d.style.left = `${p.x}px`;
  d.style.top = `${p.y}px`;
});

// ------------------------------------------------------------------ 3D view

async function ensureScene() {
  if (!tableScene) {
    const { TableScene } = await import('./table-scene.js');
    tableScene = new TableScene($('#three-stage'), {
      capture, injector, frame,
      onReload: () => load(srcInput.value)
    });
  }
  return tableScene;
}

async function setView(v) {
  view = v;
  document.body.dataset.view = v;
  for (const b of document.querySelectorAll('[data-view-btn]')) b.setAttribute('aria-pressed', String(b.dataset.viewBtn === v));
  injector.cancelAll();
  if (v === '3d') {
    (await ensureScene()).start();
  } else {
    tableScene?.stop();
    layoutFlat();
  }
  saveParams();
  updateHint();
  updateStatus();
}

for (const b of document.querySelectorAll('[data-view-btn]')) {
  b.addEventListener('click', () => setView(b.dataset.viewBtn));
}

async function setupXRButtons() {
  const vr = $('#enter-vr'), ar = $('#enter-ar');
  if (!navigator.xr) {
    const why = window.isSecureContext ? 'WebXR not available in this browser' : 'WebXR needs HTTPS (or localhost)';
    vr.title = ar.title = why;
    return;
  }
  const [vrOk, arOk] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false)
  ]);
  vr.disabled = !vrOk;
  ar.disabled = !arOk;
  if (!vrOk) vr.title = 'No VR headset / immersive-vr support detected';
  if (!arOk) ar.title = 'Passthrough (immersive-ar) not supported here';
  const enter = async (mode) => {
    try {
      await setView('3d');
      await tableScene.enterXR(mode);
    } catch (err) {
      alert(`Could not start XR: ${err.message}`);
    }
  };
  vr.addEventListener('click', () => enter('immersive-vr'));
  ar.addEventListener('click', () => enter('immersive-ar'));
}

// ------------------------------------------------------------------- chrome

$('#fullscreen').addEventListener('click', () => {
  const stage = $('#stage');
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.();
});
document.addEventListener('fullscreenchange', layoutFlat);

function updateHint() {
  $('#hint').innerHTML = view === 'flat'
    ? 'Drag = one finger · <kbd>Shift</kbd>+drag = pinch/rotate · <kbd>Ctrl</kbd>/<kbd>Alt</kbd>+drag = two-finger pan · a touchscreen passes real multi-touch through'
    : 'Click/drag on the screen = finger · drag elsewhere = orbit · right-drag = pan · wheel = zoom · In VR: poke with your index finger, or pinch/trigger to use a ray';
}

function saveParams() {
  const q = new URLSearchParams(location.search);
  q.set('src', srcInput.value);
  q.set('view', view);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

// Handy from the devtools console.
window.fastSim = { injector, capture, get scene() { return tableScene; }, load, setView };

setInterval(updateStatus, 2000);
load(OPTIONS.src || defaultSrc());
setView(view);
setupXRButtons();
