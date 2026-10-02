// Flat view: the projected image (live iframe) seen from above, with the
// physical tools drawn around and on it as interactive HTML.

import { FAST } from './config.js';
import { SHAPES, isPlain, PLAIN_BORDER } from './layouts.js';

const M = FAST.pxPerM; // CSS px (at 1:1) per metre

export class FlatView {
  constructor(space, layer, model) {
    this.space = space;
    this.layer = layer;
    this.model = model;
    this.els = new Map();
    this.plain = isPlain(model.layout);
    this.rim = Math.round((this.plain ? PLAIN_BORDER : FAST.border) * M);
    this.spaceW = FAST.width + 2 * this.rim;
    this.spaceH = FAST.height + 2 * this.rim;
    space.classList.toggle('plain', this.plain);
    space.style.width = `${this.spaceW}px`;
    space.style.height = `${this.spaceH}px`;
    space.style.setProperty('--rim', `${this.rim}px`);
    space.style.setProperty('--m', `${M}px`);
    this.build();
    this.onChange = (e) => this.update(e.detail.id);
    model.addEventListener('change', this.onChange);
  }

  dispose() {
    this.model.removeEventListener('change', this.onChange);
    this.layer.replaceChildren();
  }

  /** Table-space px of a table-local position in metres. */
  px(x, z) {
    return { x: this.rim + FAST.width / 2 + x * M, y: this.rim + FAST.height / 2 + z * M };
  }

  /** Pointer event -> table-local metres. */
  toTable(e) {
    const r = this.space.getBoundingClientRect();
    const s = r.width / this.spaceW;
    const px = (e.clientX - r.left) / s, py = (e.clientY - r.top) / s;
    return { x: (px - this.rim - FAST.width / 2) / M, z: (py - this.rim - FAST.height / 2) / M };
  }

  place(el, x, z, yaw, w, h) {
    const p = this.px(x, z);
    el.style.width = `${w * M}px`;
    el.style.height = `${h * M}px`;
    el.style.left = `${p.x - (w * M) / 2}px`;
    el.style.top = `${p.y - (h * M) / 2}px`;
    el.style.transform = `rotate(${-yaw}rad)`;
  }

  build() {
    // Fixed furniture first, movable tangibles last so they stay on top.
    const tools = [...this.model.tools.values()].sort((a, b) => movable(a) - movable(b));
    for (const t of tools) {
      const fn = this[`build_${t.def.type}`];
      if (!fn) continue;
      const el = fn.call(this, t);
      el.classList.add('tool', `tool-${t.def.type}`);
      el.dataset.id = t.def.id;
      this.layer.appendChild(el);
      this.els.set(t.def.id, el);
      this.update(t.def.id);
    }
  }

  update(id) {
    const t = this.model.get(id);
    const el = this.els.get(id);
    if (!t || !el) return;
    const s = t.state;
    switch (t.def.type) {
      case 'buttons':
        el.querySelectorAll('.btn').forEach((b, i) => b.classList.toggle('down', s.pressed[i]));
        break;
      case 'dial':
        el.querySelector('.knob').style.transform = `rotate(${s.angle}deg)`;
        break;
      case 'slider':
        el.querySelector('.thumb').style.left = `${s.pos * 100}%`;
        break;
      case 'toggle':
        el.classList.toggle('on', s.on);
        break;
      case 'tangible':
      case 'dice': {
        const [w, h] = tangibleSize(t.def);
        this.place(el, s.x, s.z, s.yaw, w, h);
        el.classList.toggle('detected', s.detected);
        if (t.def.type === 'dice') el.querySelector('.face').innerHTML = pips(s.face);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- builders

  build_buttons(t) {
    const n = t.def.buttons.length;
    const el = div('box');
    this.place(el, t.pose.x, t.pose.z, t.pose.yaw, n * 0.065 + 0.02, 0.09);
    t.def.buttons.forEach((b, i) => {
      const btn = div('btn');
      btn.innerHTML = shapeSvg(b.shape, b.color || SHAPES[b.shape] || '#ccc');
      const hint = [b.label, b.key && keyName(b.key)].filter(Boolean).join(' · ');
      if (hint) btn.appendChild(div('key', hint));
      btn.title = `${b.shape}${b.key ? ` (key ${keyName(b.key)})` : ''}`;
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId);
        this.model.press(t.def.id, i);
        e.preventDefault();
      });
      const up = () => this.model.release(t.def.id, i);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      el.appendChild(btn);
    });
    return el;
  }

  build_dial(t) {
    const el = div('plate');
    this.place(el, t.pose.x, t.pose.z, t.pose.yaw, 0.12, 0.12);
    const knob = div('knob');
    knob.appendChild(div('notch'));
    el.append(knob, div('arrows', '⟲ ⟳'));
    if (t.def.keys) el.title = `Drag around or scroll · keys ${t.def.keys.map(keyName).join(' / ')}`;
    let last = null;
    const angleOf = (e) => {
      const r = knob.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * (180 / Math.PI);
    };
    knob.addEventListener('pointerdown', (e) => {
      knob.setPointerCapture(e.pointerId);
      last = angleOf(e);
      e.preventDefault();
    });
    knob.addEventListener('pointermove', (e) => {
      if (last === null) return;
      const a = angleOf(e);
      const d = ((a - last + 540) % 360) - 180;
      last = a;
      this.model.dialBy(t.def.id, d);
    });
    const end = () => {
      if (last === null) return;
      last = null;
      this.model.dialSettle(t.def.id);
    };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.model.dialStep(t.def.id, e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    return el;
  }

  build_slider(t) {
    const len = t.def.length ?? 0.2;
    const el = div('slider');
    this.place(el, t.pose.x, t.pose.z, t.pose.yaw, len + 0.04, 0.06);
    const track = div('track');
    const thumb = div('thumb');
    track.appendChild(thumb);
    el.appendChild(track);
    const set = (e) => {
      const r = track.getBoundingClientRect();
      // Works at any rotation: project onto the track direction.
      const a = -t.pose.yaw;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const along = (e.clientX - cx) * Math.cos(a) + (e.clientY - cy) * Math.sin(a);
      const scale = this.space.getBoundingClientRect().width / this.spaceW;
      this.model.setSlider(t.def.id, 0.5 + along / (len * M * scale));
    };
    let drag = false;
    el.addEventListener('pointerdown', (e) => { drag = true; el.setPointerCapture(e.pointerId); set(e); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => drag && set(e));
    const end = () => { drag = false; this.model.settleSlider(t.def.id); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    return el;
  }

  build_toggle(t) {
    const el = div('toggle');
    this.place(el, t.pose.x, t.pose.z, t.pose.yaw, 0.08, 0.06);
    el.appendChild(div('lever'));
    if (t.def.key) el.title = `Click or key ${keyName(t.def.key)}`;
    el.addEventListener('click', () => this.model.flip(t.def.id));
    return el;
  }

  build_tray(t) {
    const el = div('tray');
    this.place(el, t.pose.x, t.pose.z, t.pose.yaw, t.def.length ?? 0.6, 0.09);
    return el;
  }

  build_mark(t) {
    const r = t.def.radius ?? 0.05;
    const el = div('mark');
    this.place(el, t.pose.x, t.pose.z, t.pose.yaw, 2 * r, 2 * r);
    if (t.def.arrow) el.appendChild(div('arrow'));
    return el;
  }

  build_tangible(t) {
    const el = div(t.def.kind === 'window' ? 'window' : 'puck');
    el.style.setProperty('--c', t.def.color || '#ddd');
    if (t.def.image) {
      // The object's picture on top of the puck, zoomed in on the subject.
      const c = { zoom: 1.5, x: 0.5, y: 0.46, ...t.def.crop };
      el.classList.add('has-image');
      el.style.backgroundImage = `url("${t.def.image}")`;
      el.style.backgroundSize = `${c.zoom * 100}% auto`;
      el.style.backgroundPosition = `${c.x * 100}% ${c.y * 100}%`;
    }
    el.appendChild(div('label', t.def.label ?? `#${t.def.marker}`));
    this.makeDraggable(el, t);
    return el;
  }

  build_dice(t) {
    const el = div('die');
    el.appendChild(div('face'));
    this.makeDraggable(el, t, () => this.model.roll(t.def.id));
    return el;
  }

  makeDraggable(el, t, onTap) {
    let grab = null;
    el.title = 'Drag to move · scroll to rotate · double-click to put back';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const p = this.toTable(e);
      grab = { dx: t.state.x - p.x, dz: t.state.z - p.z, sx: e.clientX, sy: e.clientY, moved: false };
      el.classList.add('held');
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!grab) return;
      if (Math.hypot(e.clientX - grab.sx, e.clientY - grab.sy) > 4) grab.moved = true;
      const p = this.toTable(e);
      this.model.setPose(t.def.id, { x: p.x + grab.dx, z: p.z + grab.dz, lifted: false });
    });
    const end = () => {
      if (!grab) return;
      el.classList.remove('held');
      if (!grab.moved) onTap?.();
      grab = null;
      const s = t.state;
      if (Math.abs(s.x) > FAST.projW / 2 + FAST.border || Math.abs(s.z) > FAST.projD / 2 + FAST.border) {
        this.model.sendHome(t.def.id); // dropped off the table
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => this.model.sendHome(t.def.id));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.model.setPose(t.def.id, { yaw: t.state.yaw - Math.sign(e.deltaY) * (Math.PI / 12) });
    }, { passive: false });
  }
}

export function tangibleSize(def) {
  if (def.type === 'dice') return [0.035, 0.035];
  if (def.kind === 'window') return [def.width ?? 0.15, def.depth ?? 0.1];
  const d = def.diameter ?? 0.07;
  return [d, d];
}

function movable(t) {
  return t.def.type === 'tangible' || t.def.type === 'dice' ? 1 : 0;
}

function div(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

function keyName(k) {
  return { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space' }[k] || k.toUpperCase();
}

export function shapeSvg(shape, color) {
  const body = {
    diamond: '<polygon points="50,6 94,50 50,94 6,50"/>',
    circle: '<circle cx="50" cy="50" r="44"/>',
    square: '<rect x="10" y="10" width="80" height="80" rx="6"/>',
    triangle: '<polygon points="50,8 94,88 6,88"/>'
  }[shape] || '<circle cx="50" cy="50" r="44"/>';
  return `<svg viewBox="0 0 100 100" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="3">${body}</svg>`;
}

function pips(n) {
  const at = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[n];
  return Array.from({ length: 9 }, (_, i) => `<i${at.includes(i) ? ' class="on"' : ''}></i>`).join('');
}
