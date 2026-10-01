// State of every physical tool on the table, and the bridge that tells the
// content page about it. Both the flat view and the 3D/VR view drive this.
//
// Messages to the content (window.postMessage, works cross-origin):
//   { type: 'fast-layout', ... }  on load, and whenever the page posts { type: 'fast-get-layout' }
//   { type: 'fast-input', tool, id, ... }  for each tool action (see README)
// With same-origin content, tools that have a "key" also send real keydown/keyup events.

import { FAST } from './config.js';
import { resolvePlace, toPx } from './layouts.js';

const DEG = 180 / Math.PI;

export class FastModel extends EventTarget {
  constructor(layout, frame) {
    super();
    this.layout = layout;
    this.frame = frame;
    this.tools = new Map();
    this.keyMap = new Map();
    for (const def of layout.tools) {
      const pose = resolvePlace(def.place || {}, layout);
      const t = { def, pose, state: initialState(def, pose) };
      this.tools.set(def.id, t);
      if (def.type === 'buttons') def.buttons.forEach((b, i) => b.key && this.keyMap.set(b.key.toLowerCase(), { id: def.id, index: i }));
      if (def.type === 'dial' && def.keys) def.keys.forEach((k, i) => this.keyMap.set(k.toLowerCase(), { id: def.id, dir: i ? 1 : -1 }));
      if (def.type === 'toggle' && def.key) this.keyMap.set(def.key.toLowerCase(), { id: def.id });
    }
    this.onMessage = (e) => {
      if (e.source === this.frame.contentWindow && e.data?.type === 'fast-get-layout') this.announce();
    };
    window.addEventListener('message', this.onMessage);
  }

  dispose() {
    window.removeEventListener('message', this.onMessage);
  }

  get(id) {
    return this.tools.get(id);
  }

  changed(id) {
    this.dispatchEvent(new CustomEvent('change', { detail: { id } }));
  }

  // ---------------------------------------------------------------- buttons

  press(id, index = 0) {
    const t = this.tools.get(id);
    if (!t || t.state.pressed[index]) return;
    t.state.pressed[index] = true;
    const b = t.def.buttons[index];
    this.send({ tool: 'button', id, station: t.def.station, index, shape: b.shape, state: 'down' });
    if (b.key) this.key(b.key, 'keydown');
    this.changed(id);
  }

  release(id, index = 0) {
    const t = this.tools.get(id);
    if (!t || !t.state.pressed[index]) return;
    t.state.pressed[index] = false;
    const b = t.def.buttons[index];
    this.send({ tool: 'button', id, station: t.def.station, index, shape: b.shape, state: 'up' });
    if (b.key) this.key(b.key, 'keyup');
    this.changed(id);
  }

  // ------------------------------------------------------------------ dials

  /** Turn by deg (clockwise, seen from above). Emits one event per detent crossed. */
  dialBy(id, deg) {
    const t = this.tools.get(id);
    if (!t) return;
    const s = t.state, step = 360 / s.detents;
    s.angle += deg;
    const target = Math.round(s.angle / step);
    while (s.value !== target) {
      const dir = Math.sign(target - s.value);
      s.value += dir;
      this.send({ tool: 'dial', id, delta: dir, value: s.value, angle: mod360(s.value * step) });
      const k = t.def.keys?.[dir > 0 ? 1 : 0];
      if (k) { this.key(k, 'keydown'); this.key(k, 'keyup'); }
    }
    this.changed(id);
  }

  dialStep(id, dir) {
    const t = this.tools.get(id);
    if (!t) return;
    const step = 360 / t.state.detents;
    this.dialBy(id, (t.state.value + dir) * step - t.state.angle);
  }

  /** Let go of the knob: it clicks into the nearest detent. */
  dialSettle(id) {
    const t = this.tools.get(id);
    if (!t) return;
    t.state.angle = t.state.value * (360 / t.state.detents);
    this.changed(id);
  }

  // ---------------------------------------------------------- slider/toggle

  setSlider(id, v) {
    const t = this.tools.get(id);
    if (!t) return;
    const steps = t.def.steps || 0;
    v = Math.min(1, Math.max(0, v));
    t.state.pos = v;
    if (steps > 1) v = Math.round(v * (steps - 1)) / (steps - 1);
    if (Math.abs(v - t.state.value) > 0.002) {
      t.state.value = v;
      const msg = { tool: 'slider', id, value: round(v, 3) };
      if (steps > 1) msg.step = Math.round(v * (steps - 1));
      this.send(msg);
    }
    this.changed(id);
  }

  settleSlider(id) {
    const t = this.tools.get(id);
    if (!t) return;
    t.state.pos = t.state.value;
    this.changed(id);
  }

  flip(id) {
    const t = this.tools.get(id);
    if (!t) return;
    t.state.on = !t.state.on;
    this.send({ tool: 'toggle', id, on: t.state.on });
    if (t.def.key) { this.key(t.def.key, 'keydown'); this.key(t.def.key, 'keyup'); }
    this.changed(id);
  }

  // ------------------------------------------------------ tangibles & dice

  /**
   * Move a tangible/die. x, z in table-local metres, yaw in radians.
   * lifted = held up off the table (the camera loses it).
   */
  setPose(id, { x, z, yaw, lifted }) {
    const t = this.tools.get(id);
    if (!t) return;
    const s = t.state;
    if (x !== undefined) s.x = x;
    if (z !== undefined) s.z = z;
    if (yaw !== undefined) s.yaw = yaw;
    if (lifted !== undefined) s.lifted = lifted;
    const onImage = Math.abs(s.x) <= FAST.projW / 2 && Math.abs(s.z) <= FAST.projD / 2;
    const detected = onImage && !s.lifted;
    const p = toPx(s.x, s.z);
    const angle = mod360(-s.yaw * DEG);
    if (detected && !s.detected) {
      this.sendTangible(t, 'placed', p, angle);
    } else if (!detected && s.detected) {
      this.sendTangible(t, 'lifted', p, angle);
    } else if (detected && (Math.hypot(p.x - s.lastPx.x, p.y - s.lastPx.y) >= 1 || angleDiff(angle, s.lastAngle) >= 0.5)) {
      this.sendTangible(t, 'moved', p, angle);
    }
    s.detected = detected;
    this.changed(id);
  }

  sendTangible(t, state, p, angle) {
    const s = t.state;
    s.lastPx = p;
    s.lastAngle = angle;
    const msg = {
      tool: t.def.type === 'dice' ? 'dice' : 'tangible', id: t.def.id, marker: t.def.marker,
      kind: t.def.kind || (t.def.type === 'dice' ? 'dice' : 'puck'), state,
      x: Math.round(p.x), y: Math.round(p.y), angle: round(angle, 1)
    };
    if (t.def.type === 'dice') msg.face = s.face;
    this.send(msg);
  }

  /** Throw the die: it lands on a random face. */
  roll(id) {
    const t = this.tools.get(id);
    if (!t) return;
    t.state.face = 1 + Math.floor(Math.random() * 6);
    t.state.rolls++;
    if (t.state.detected) this.sendTangible(t, 'moved', toPx(t.state.x, t.state.z), t.state.lastAngle);
    this.changed(id);
  }

  sendHome(id) {
    const t = this.tools.get(id);
    if (!t) return;
    this.setPose(id, { x: t.pose.x, z: t.pose.z, yaw: t.pose.yaw, lifted: false });
  }

  // --------------------------------------------------------------- keyboard

  /** A key pressed on the simulator page. Returns true if a tool used it. */
  keyDown(key) {
    const m = this.keyMap.get(key.toLowerCase());
    if (!m) return false;
    const t = this.tools.get(m.id);
    if (t.def.type === 'buttons') this.press(m.id, m.index);
    else if (t.def.type === 'dial') this.dialStep(m.id, m.dir);
    else if (t.def.type === 'toggle') this.flip(m.id);
    return true;
  }

  keyUp(key) {
    const m = this.keyMap.get(key.toLowerCase());
    if (m && this.tools.get(m.id).def.type === 'buttons') this.release(m.id, m.index);
  }

  // ------------------------------------------------------------- messaging

  send(msg) {
    msg = { type: 'fast-input', ...msg, time: Math.round(performance.now()) };
    try {
      this.frame.contentWindow?.postMessage(msg, '*');
    } catch { /* frame gone */ }
    this.dispatchEvent(new CustomEvent('input', { detail: msg }));
  }

  /** Tell the content what is on the table, then where the tangibles are. */
  announce() {
    const tools = [];
    for (const { def, pose } of this.tools.values()) {
      const p = toPx(pose.x, pose.z);
      const { place, ...rest } = def;
      tools.push({ ...rest, x: Math.round(p.x), y: Math.round(p.y), angle: round(mod360(-pose.yaw * DEG), 1), edge: place?.edge ?? (place?.trayOf ? 'tray' : null) });
    }
    try {
      this.frame.contentWindow?.postMessage({
        type: 'fast-layout', version: 1, name: this.layout.name, pointer: this.layout.pointer,
        width: FAST.width, height: FAST.height, metersWide: FAST.projW, pxPerMeter: round(FAST.pxPerM, 2), tools
      }, '*');
    } catch { /* frame gone */ }
    for (const t of this.tools.values()) {
      if (t.state.detected) this.sendTangible(t, 'placed', toPx(t.state.x, t.state.z), mod360(-t.state.yaw * DEG));
    }
  }

  key(key, type) {
    try {
      const win = this.frame.contentWindow;
      const doc = this.frame.contentDocument;
      if (!doc) return;
      const target = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.body || doc.documentElement;
      target.dispatchEvent(new win.KeyboardEvent(type, { key, code: codeFor(key), bubbles: true, cancelable: true, composed: true, view: win }));
    } catch {
      // cross-origin: keys can't be synthesised, the postMessage still went out
    }
  }
}

function initialState(def, pose) {
  switch (def.type) {
    case 'buttons': return { pressed: def.buttons.map(() => false) };
    case 'dial': return { detents: def.detents || 12, angle: 0, value: 0 };
    case 'slider': return { value: def.value ?? 0, pos: def.value ?? 0 };
    case 'toggle': return { on: !!def.on };
    case 'tangible':
    case 'dice': {
      const onImage = Math.abs(pose.x) <= FAST.projW / 2 && Math.abs(pose.z) <= FAST.projD / 2;
      return {
        x: pose.x, z: pose.z, yaw: pose.yaw, lifted: false, detected: onImage,
        lastPx: toPx(pose.x, pose.z), lastAngle: mod360(-pose.yaw * DEG), face: 1, rolls: 0
      };
    }
    default: return {};
  }
}

function codeFor(key) {
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (key === ' ') return 'Space';
  return key;
}

const mod360 = (a) => ((a % 360) + 360) % 360;
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
