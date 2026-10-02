import { FAST, OPTIONS, defaultSrc } from './config.js';
import { TouchInjector } from './touch-injector.js';
import { ContentCapture } from './content-capture.js';
import { loadLayout, PRESETS } from './layouts.js';
import { FastModel } from './model.js';
import { FlatView } from './flat-view.js';
import { Net } from './net.js';

const $ = (sel) => document.querySelector(sel);
const frame = $('#content');
const space = $('#table-space');
const flatStage = $('#flat-stage');
const overlay = $('#overlay');
const srcInput = $('#src');
const layoutSelect = $('#layout');
const workSelect = $('#work');
const status = $('#status');
const shimUrl = new URL('./shim.js', import.meta.url).href;

const injector = new TouchInjector(frame);
const capture = new ContentCapture(frame, { mode: OPTIONS.capture, domFps: OPTIONS.domFps });
let view = OPTIONS.view === '3d' ? '3d' : 'flat';
let tableScene = null;
let model = null;
let flatView = null;
let layout = null;
let works = [];
let worksBase = location.href;
let current = null; // { id?, title?, description?, src, layout }
let scale = 1;

if (OPTIONS.embed) document.body.classList.add('embed');

// ---------------------------------------------------------------- multiplayer
//
// Everyone on the same ?room= shares one world: the same work and table
// style, each other's avatars, the stools, and every touch and tool action on
// the table (each player's browser runs its own copy of the content, fed the
// same input).

const params = new URLSearchParams(location.search);
const net = Net.available() ? new Net({ room: params.get('room') || 'lobby', name: params.get('name') || '' }) : null;
let applyingRemote = false;
const stoolStates = new Map(); // latest per stool, for when the 3D view starts later

// Touches: send ours, inject theirs under their own pointer keys.
const injectRaw = {};
for (const k of ['down', 'move', 'up']) {
  injectRaw[k] = injector[k].bind(injector);
  injector[k] = (key, x, y) => {
    injectRaw[k](key, x, y);
    if (net?.connected && !String(key).startsWith('r:')) net.send({ t: 'touch', k, key, x: Math.round(x ?? 0), y: Math.round(y ?? 0) });
  };
}

// Tool actions (buttons, dial, slider, toggle, tangibles, dice).
const TOOL_METHODS = ['press', 'release', 'dialBy', 'dialSettle', 'setSlider', 'settleSlider', 'flip', 'setPose', 'sendHome', 'setFace'];
function shareTools(m) {
  for (const name of TOOL_METHODS) {
    const orig = m[name].bind(m);
    m[name] = (...args) => {
      orig(...args);
      if (net?.connected && !applyingRemote) net.send({ t: 'tool', m: name, a: args });
    };
  }
  // A roll is random: share the face it landed on.
  const roll = m.roll.bind(m);
  m.roll = (id) => {
    roll(id);
    if (net?.connected && !applyingRemote) net.send({ t: 'tool', m: 'setFace', a: [id, m.get(id)?.state.face] });
  };
}

function sendScene() {
  if (!net?.connected || !current) return;
  net.send({ t: 'scene', work: { id: current.id, title: current.title, description: current.description, src: new URL(current.src, location.href).href, layout: current.layout }, furniture: $('#furniture').value });
}

if (net) {
  net.on('welcome', (m) => {
    // First one in the room: our scene becomes the room's.
    if (!m.cache.some((c) => c.t === 'scene')) sendScene();
  });
  net.on('scene', async (m) => {
    const w = m.work;
    const same = current && new URL(current.src, location.href).href === w.src && JSON.stringify(current.layout) === JSON.stringify(w.layout);
    applyingRemote = true;
    try {
      if (!same) await open(w);
      if (m.furniture && $('#furniture').value !== m.furniture) {
        $('#furniture').value = m.furniture;
        tableScene?.setFurniture(m.furniture);
      }
    } finally {
      applyingRemote = false;
    }
  });
  net.on('touch', (m) => injectRaw[m.k]?.(`r:${m.from}:${m.key}`, m.x, m.y));
  net.on('tool', (m) => {
    if (!model || !TOOL_METHODS.includes(m.m)) return;
    applyingRemote = true;
    try { model[m.m](...m.a); } finally { applyingRemote = false; }
  });
  net.on('stool', (m) => stoolStates.set(m.i, m));
  net.on('peers', () => updateStatus());
}

// ------------------------------------------------------------------ works

async function loadWorks() {
  try {
    const url = new URL(OPTIONS.works, location.href);
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    worksBase = url.href;
    works = (data.works || []).map((w) => ({ ...w, src: new URL(w.src, url).href }));
    if (data.title && !OPTIONS.embed) $('.brand').textContent = data.title;
  } catch {
    works = [];
  }
  // An embed pinned to one work shows just that work.
  workSelect.hidden = works.length === 0 || (OPTIONS.embed && !!OPTIONS.work);
  document.body.classList.toggle('has-works', works.length > 0);
  workSelect.replaceChildren(
    ...works.map((w) => new Option(w.title || w.id, w.id)),
    new Option('Custom URL…', '')
  );
}

workSelect.addEventListener('change', () => {
  const w = works.find((x) => x.id === workSelect.value);
  if (w) open(w);
  else {
    // Custom URL: start from a plain touch table, no tools.
    document.body.classList.add('custom');
    layoutSelect.value = 'touch';
    srcInput.select();
  }
});

/** Show a piece of work: content URL + the tools it uses. */
async function open(work) {
  current = work;
  document.body.classList.toggle('custom', !work.id);
  workSelect.value = work.id || '';
  srcInput.value = work.src;
  layoutSelect.value = typeof work.layout === 'string' && PRESETS[work.layout] ? work.layout : layoutSelect.value;
  layout = await loadLayout(work.layout || 'touch', worksBase).catch((err) => {
    alert(err.message);
    return loadLayout('touch');
  });

  model?.dispose();
  flatView?.dispose();
  injector.cancelAll();
  model = new FastModel(layout, frame);
  shareTools(model);
  flatView = new FlatView(space, $('#tools-layer'), model);
  injector.kind = layout.pointer === 'native' ? 'mouse' : 'touch';
  document.body.dataset.pointer = layout.pointer;
  tableScene?.setModel(model, layout.pointer);
  model.addEventListener('input', (e) => logInput(e.detail));

  $('#about').textContent = [work.title, work.description].filter(Boolean).join(' — ');
  // Read by shim.js inside the page as it loads: emulate a touchscreen device.
  window.__fastsimConfig = { touch: layout.pointer === 'touch' };
  frame.src = work.src;
  layoutFlat();
  updateHint();
  saveParams();
  if (!applyingRemote) sendScene();
}

$('#src-form').addEventListener('submit', (e) => {
  e.preventDefault();
  open({ src: srcInput.value.trim() || defaultSrc(), layout: layoutSelect.value });
});

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
  model?.announce();
  updateStatus();
});

function sameOriginDoc() {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

let lastInput = '';
function logInput(m) {
  const { type, time, ...rest } = m;
  lastInput = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}:${v}`).join(' ');
  updateStatus();
}

function updateStatus() {
  const same = injector.available();
  // A page on another site can't receive simulated touches, so let the real
  // mouse / touchscreen reach it directly instead.
  document.body.classList.toggle('cross-origin', !same);
  const parts = [];
  if (!same) {
    parts.push(layout?.tools.length
      ? '<span class="warn">other site: tools still work, but no 3D image</span>'
      : '<span class="warn">other site: your mouse goes straight to the page; for touch emulation and 3D, serve it through the dev server (see README)</span>');
  }
  if (view === '3d' && same && capture.mode) parts.push(`capture: ${capture.mode}`);
  if (net) parts.push(net.connected ? `👥 ${net.peers.size + 1} in “${escapeHtml(net.room)}”` : '<span class="warn">multiplayer: connecting…</span>');
  if (lastInput) parts.push(`<code>${escapeHtml(lastInput)}</code>`);
  status.innerHTML = parts.join(' · ');
}

// ---------------------------------------------------------------- flat view

function layoutFlat() {
  if (view !== 'flat') return;
  const pad = document.fullscreenElement ? 0 : 12;
  const top = OPTIONS.embed ? 56 : pad; // room for the floating toolbar
  const w = flatStage.clientWidth - pad * 2;
  const h = flatStage.clientHeight - pad - top;
  const sw = flatView?.spaceW ?? FAST.width, sh = flatView?.spaceH ?? FAST.height;
  scale = Math.max(0.05, Math.min(w / sw, h / sh));
  const x = (flatStage.clientWidth - sw * scale) / 2;
  const y = top + (h - sh * scale) / 2;
  space.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}
new ResizeObserver(layoutFlat).observe(flatStage);

// Touch layouts: mouse / real touchscreen -> touch events in the content.
//   drag            one finger
//   Shift + drag    two-finger pinch / rotate around where you pressed
//   Ctrl/Alt + drag two-finger pan
const gesture = { active: false };

function toContent(e) {
  const r = overlay.getBoundingClientRect();
  const s = r.width / FAST.width;
  return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
}

overlay.addEventListener('pointerdown', (e) => {
  if (layout?.pointer !== 'touch' || !injector.available()) return;
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

// The overlay is on top of the page, so pass the mouse wheel through: scroll
// whatever is under the pointer (handy on desktop, though a table has no wheel).
overlay.addEventListener('wheel', (e) => {
  const doc = sameOriginDoc();
  if (!doc) return;
  e.preventDefault();
  const p = toContent(e);
  const target = doc.elementFromPoint(p.x, p.y) || doc.documentElement;
  const win = frame.contentWindow;
  const ev = new win.WheelEvent('wheel', {
    bubbles: true, cancelable: true, composed: true, view: win,
    clientX: p.x, clientY: p.y, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode
  });
  if (!target.dispatchEvent(ev)) return;
  for (let n = target; n; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if ((/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) || (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth)) {
      n.scrollBy(e.deltaX, e.deltaY);
      return;
    }
  }
  doc.scrollingElement?.scrollBy(e.deltaX, e.deltaY);
}, { passive: false });

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

// Keyboard drives the tools that have keys (quiz buttons 1-4, dial ←/→ …).
// In 3D, other keys walk you around: WASD / arrow keys (Shift to hurry).
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey) return;
  if (!e.repeat && model?.keyDown(e.key)) { e.preventDefault(); return; }
  if (view === '3d' && tableScene?.setKey(e.key, true)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  model?.keyUp(e.key);
  tableScene?.setKey(e.key, false);
});
window.addEventListener('blur', () => tableScene?.keys.clear());

// ------------------------------------------------------------------ 3D view

async function ensureScene() {
  if (!tableScene) {
    const { TableScene } = await import('./table-scene.js');
    tableScene = new TableScene($('#three-stage'), {
      capture, injector, frame,
      onReload: () => current && open(current)
    });
    tableScene.setFurniture($('#furniture').value);
    if (model) tableScene.setModel(model, layout.pointer);
    if (net) {
      tableScene.setNet(net);
      for (const m of stoolStates.values()) tableScene.physics.applyRemote(m);
    }
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

const furnitureSelect = $('#furniture');
furnitureSelect.value = OPTIONS.furniture === 'plinth' ? 'plinth' : 'stools';
furnitureSelect.addEventListener('change', () => {
  tableScene?.setFurniture(furnitureSelect.value);
  saveParams();
  sendScene();
});

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
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
document.addEventListener('fullscreenchange', layoutFlat);

function updateHint() {
  const p = layout?.pointer;
  const hasTools = !!layout?.tools.length;
  const tools = 'Buttons: click or keys · dial: drag around, scroll or ←/→ · objects: drag onto the table, scroll to rotate, double-click to put back';
  const surface = p === 'touch'
    ? 'Drag = one finger · <kbd>Shift</kbd>+drag = pinch/rotate · <kbd>Ctrl</kbd>+drag = two-finger pan · a touchscreen passes real multi-touch through'
    : p === 'native' ? 'The mouse goes straight to the page' : 'The projected image itself is not touch-sensitive';
  $('#hint').innerHTML = view === 'flat'
    ? (hasTools ? `${tools} · ${surface}` : surface)
    : hasTools
      ? 'Drag tools to use them · drag elsewhere to orbit, right-drag to pan, wheel to zoom · VR: poke buttons, pinch to grab, turn or slide'
      : 'Click/drag on the screen = finger · drag elsewhere to orbit, right-drag to pan, wheel to zoom · VR: touch the screen with your index finger, or pinch to use a ray';
}

function saveParams() {
  const q = new URLSearchParams(location.search);
  for (const k of ['work', 'src', 'layout']) q.delete(k);
  if (current?.id) q.set('work', current.id);
  else if (current) {
    q.set('src', current.src);
    if (typeof current.layout === 'string') q.set('layout', current.layout);
  }
  q.set('view', view);
  if ($('#furniture').value !== 'stools') q.set('furniture', $('#furniture').value);
  else q.delete('furniture');
  history.replaceState(null, '', `${location.pathname}?${q}`);
  const full = new URLSearchParams(q);
  full.delete('embed');
  $('#open-full').href = `${location.pathname}?${full}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Handy from the devtools console.
window.fastSim = { injector, capture, net, get model() { return model; }, get scene() { return tableScene; }, open, setView };

setInterval(updateStatus, 2000);
await loadWorks();
const startWork = OPTIONS.src
  ? { src: OPTIONS.src, layout: OPTIONS.layout || 'touch' }
  : works.find((w) => w.id === OPTIONS.work) || works[0] || { src: defaultSrc(), layout: OPTIONS.layout || 'sandbox' };
await open(startWork);
net?.connect(); // after our own start-up, so a shared room's scene wins
setView(view);
setupXRButtons();
