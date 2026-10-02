// 3D models and interaction for the physical tools.
//
// Each tool has:
//   group      positioned in table-local space (top of the tabletop is y = 0)
//   targets    meshes that rays/mouse can hit
//   grab(ptr, hit) / drag(ptr) / release(ptr)   mouse, controller ray or hand pinch
//   reach(pointWorld)   distance if a pinch at that point would grab it, else null
//   poke(tipsWorld)     fingertip pokes (buttons, toggles)
//   wheel(dir)          mouse wheel over it
//   sync()              update visuals from the model
//
// A "ptr" is { kind: 'mouse' | 'ray' | 'pinch', ray?: THREE.Ray (world), point?: THREE.Vector3 (world), yaw?: number }.

import * as THREE from 'three';
import { FAST } from './config.js';
import { SHAPES } from './layouts.js';
import { tangibleSize } from './flat-view.js';

const TMP = new THREE.Vector3();
const PLANE = new THREE.Plane();
const UP = new THREE.Vector3(0, 1, 0);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

/** Point where ptr meets the horizontal plane at height y in obj's local frame. */
function planePoint(obj, ptr, y) {
  obj.updateMatrixWorld();
  if (ptr.point) {
    const p = obj.worldToLocal(TMP.copy(ptr.point));
    return new THREE.Vector3(p.x, y, p.z);
  }
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const ray = ptr.ray.clone().applyMatrix4(inv);
  PLANE.set(UP, -y);
  return ray.intersectPlane(PLANE, new THREE.Vector3());
}

class Tool {
  constructor(model, t) {
    this.model = model;
    this.t = t;
    this.id = t.def.id;
    this.group = new THREE.Group();
    this.group.position.set(t.pose.x, 0, t.pose.z);
    this.group.rotation.y = t.pose.yaw;
    this.targets = [];
  }
  target(mesh, data = {}) {
    mesh.userData = { tool: this, ...data };
    this.targets.push(mesh);
    return mesh;
  }
  grab() {}
  drag() {}
  release() {}
  reach() { return null; }
  poke() {}
  sync() {}
}

// ------------------------------------------------------------------ buttons

const CAP_H = 0.012, BOX_H = 0.035, TRAVEL = 0.006;

class ButtonsTool extends Tool {
  constructor(model, t) {
    super(model, t);
    const n = t.def.buttons.length;
    const box = new THREE.Mesh(new THREE.BoxGeometry(n * 0.065 + 0.02, BOX_H, 0.09), mat(0xf2f2f0, { roughness: 0.8 }));
    box.position.y = BOX_H / 2;
    this.group.add(box);
    this.caps = t.def.buttons.map((b, i) => {
      const geo = shapeGeometry(b.shape, 0.046, CAP_H);
      const cap = new THREE.Mesh(geo, mat(b.color || SHAPES[b.shape] || 0xcccccc, { roughness: 0.4 }));
      cap.position.set((i - (n - 1) / 2) * 0.065, BOX_H, -0.005);
      this.group.add(this.target(cap, { index: i }));
      return cap;
    });
    this.poked = this.caps.map(() => false);
    this.held = null;
  }
  grab(ptr, hit) {
    this.held = hit.object.userData.index;
    this.model.press(this.id, this.held);
  }
  release() {
    if (this.held !== null) this.model.release(this.id, this.held);
    this.held = null;
  }
  poke(tips) {
    this.caps.forEach((cap, i) => {
      const top = BOX_H + CAP_H;
      let inside = false, above = true;
      for (const tip of tips) {
        const p = this.group.worldToLocal(TMP.copy(tip));
        const near = Math.hypot(p.x - cap.position.x, p.z - cap.position.z) < 0.028;
        if (near && p.y < top + 0.006 && p.y > BOX_H - 0.03) inside = true;
        if (near && p.y < top + 0.016) above = false;
      }
      if (inside && !this.poked[i]) { this.poked[i] = true; this.model.press(this.id, i); }
      else if (this.poked[i] && above) { this.poked[i] = false; this.model.release(this.id, i); }
    });
  }
  sync() {
    const pressed = this.model.get(this.id).state.pressed;
    this.caps.forEach((cap, i) => { cap.position.y = BOX_H - (pressed[i] ? TRAVEL : 0); });
  }
}

function shapeGeometry(shape, size, height) {
  const s = new THREE.Shape(), r = size / 2;
  if (shape === 'circle') s.absarc(0, 0, r, 0, Math.PI * 2, false);
  else if (shape === 'square') { s.moveTo(-r * 0.85, -r * 0.85); s.lineTo(r * 0.85, -r * 0.85); s.lineTo(r * 0.85, r * 0.85); s.lineTo(-r * 0.85, r * 0.85); }
  else if (shape === 'diamond') { s.moveTo(0, r); s.lineTo(r, 0); s.lineTo(0, -r); s.lineTo(-r, 0); }
  else { s.moveTo(0, r); s.lineTo(r, -r * 0.8); s.lineTo(-r, -r * 0.8); } // triangle, apex away from visitor
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2); // extrude upward; shape +y -> -z (away from visitor)
  return g;
}

// --------------------------------------------------------------------- dial

const KNOB_R = 0.035, PLATE_H = 0.03, KNOB_H = 0.032;

class DialTool extends Tool {
  constructor(model, t) {
    super(model, t);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, PLATE_H, 0.12), mat(0x2b2d31));
    plate.position.y = PLATE_H / 2;
    this.group.add(this.target(plate));
    this.knob = new THREE.Group();
    this.knob.position.y = PLATE_H;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(KNOB_R, KNOB_R * 1.05, KNOB_H, 40), mat(0xd8d4cc, { roughness: 0.35, metalness: 0.3 }));
    body.position.y = KNOB_H / 2;
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.003, 0.022), mat(0x111111));
    notch.position.set(0, KNOB_H + 0.001, -0.02);
    this.knob.add(this.target(body), notch);
    this.group.add(this.knob);
    // detent ticks around the knob
    const ticks = model.get(this.id).state.detents;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.001, 0.008), mat(0x9aa0a6));
      tick.position.set(Math.sin(a) * 0.05, PLATE_H + 0.0005, -Math.cos(a) * 0.05);
      tick.rotation.y = -a;
      this.group.add(tick);
    }
    this.last = null;
  }
  angleAt(ptr) {
    const p = planePoint(this.group, ptr, PLATE_H + KNOB_H);
    return p ? Math.atan2(p.x, -p.z) * (180 / Math.PI) : null;
  }
  grab(ptr) { this.last = this.angleAt(ptr); }
  drag(ptr) {
    const a = this.angleAt(ptr);
    if (a === null || this.last === null) return;
    const d = ((a - this.last + 540) % 360) - 180;
    this.last = a;
    if (d) this.model.dialBy(this.id, d);
  }
  release() { this.last = null; this.model.dialSettle(this.id); }
  reach(point) {
    const p = this.group.worldToLocal(TMP.copy(point));
    const r = Math.hypot(p.x, p.z);
    return r < KNOB_R + 0.03 && p.y > PLATE_H - 0.02 && p.y < PLATE_H + KNOB_H + 0.04 ? r : null;
  }
  wheel(dir) { this.model.dialStep(this.id, dir); }
  sync() { this.knob.rotation.y = -THREE.MathUtils.degToRad(this.model.get(this.id).state.angle); }
}

// ------------------------------------------------------------------- slider

class SliderTool extends Tool {
  constructor(model, t) {
    super(model, t);
    this.len = t.def.length ?? 0.2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(this.len + 0.04, 0.02, 0.05), mat(0x2b2d31));
    base.position.y = 0.01;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(this.len, 0.001, 0.006), mat(0x0c0c0d));
    slot.position.y = 0.0205;
    this.thumb = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.026, 0.036), mat(0xd8d4cc, { roughness: 0.35 }));
    this.thumb.position.y = 0.033;
    this.group.add(this.target(base), slot, this.target(this.thumb));
    this.dragging = false;
  }
  grab(ptr) { this.dragging = true; this.drag(ptr); }
  drag(ptr) {
    if (!this.dragging) return;
    const p = planePoint(this.group, ptr, 0.033);
    if (p) this.model.setSlider(this.id, p.x / this.len + 0.5);
  }
  release() { this.dragging = false; this.model.settleSlider(this.id); }
  reach(point) {
    const p = this.group.worldToLocal(TMP.copy(point));
    const d = Math.hypot(p.x - this.thumb.position.x, p.z, (p.y - 0.033) * 0.5);
    return d < 0.04 ? d : null;
  }
  sync() { this.thumb.position.x = (this.model.get(this.id).state.pos - 0.5) * this.len; }
}

// ------------------------------------------------------------------- toggle

class ToggleTool extends Tool {
  constructor(model, t) {
    super(model, t);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.06), mat(0x2b2d31));
    base.position.y = 0.01;
    this.lever = new THREE.Group();
    this.lever.position.y = 0.02;
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.045, 0.02), mat(0xd8d4cc, { roughness: 0.35 }));
    stick.position.y = 0.0225;
    this.lever.add(this.target(stick));
    this.group.add(this.target(base), this.lever);
    this.armed = true;
  }
  grab() { this.model.flip(this.id); }
  poke(tips) {
    let touching = false, clear = true;
    for (const tip of tips) {
      const p = this.group.worldToLocal(TMP.copy(tip));
      const d = Math.hypot(p.x, p.y - 0.06, p.z);
      if (d < 0.025) touching = true;
      if (d < 0.05) clear = false;
    }
    if (touching && this.armed) { this.armed = false; this.model.flip(this.id); }
    if (clear) this.armed = true;
  }
  sync() { this.lever.rotation.z = this.model.get(this.id).state.on ? -0.45 : 0.45; }
}

// ------------------------------------------------------------- tray & mark

class TrayTool extends Tool {
  constructor(model, t) {
    super(model, t);
    const len = t.def.length ?? 0.6;
    const tray = new THREE.Mesh(new THREE.BoxGeometry(len, 0.004, 0.09), mat(0x1d1f23, { roughness: 0.9 }));
    tray.position.y = 0.002;
    this.group.add(tray);
  }
}

class MarkTool extends Tool {
  constructor(model, t) {
    super(model, t);
    const r = t.def.radius ?? 0.05;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 10, 64), mat(0xf4f4f2, { transparent: true, opacity: 0.75 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    this.group.add(ring);
    if (t.def.arrow) {
      const s = new THREE.Shape();
      s.moveTo(0, 0.02); s.lineTo(0.015, -0.01); s.lineTo(0.005, -0.01); s.lineTo(0.005, -0.04);
      s.lineTo(-0.005, -0.04); s.lineTo(-0.005, -0.01); s.lineTo(-0.015, -0.01);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const arrow = new THREE.Mesh(g, ring.material);
      arrow.position.set(0, 0, r + 0.065);
      this.group.add(arrow);
    }
  }
}

// ---------------------------------------------------------- tangible & dice

class TangibleTool extends Tool {
  constructor(model, t) {
    super(model, t);
    const def = t.def;
    const [w, d] = tangibleSize(def);
    this.radius = Math.max(w, d) / 2;
    if (def.type === 'dice') {
      this.height = w;
      this.body = new THREE.Mesh(new THREE.BoxGeometry(w, w, w), [2, 5, 1, 6, 3, 4].map((n) => new THREE.MeshStandardMaterial({ map: dieFace(n), roughness: 0.4 })));
      this.body.position.y = w / 2;
    } else if (def.kind === 'window') {
      this.height = 0.006;
      this.body = new THREE.Mesh(
        new THREE.BoxGeometry(w, this.height, d),
        new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, roughness: 0.15, metalness: 0, depthWrite: false })
      );
      this.body.position.y = this.height / 2;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.body.geometry), new THREE.LineBasicMaterial({ color: 0xbfe6ff }));
      this.body.add(edges);
    } else {
      this.height = 0.022;
      const side = mat(def.color || 0xdddddd, { roughness: 0.7 });
      const top = new THREE.MeshStandardMaterial({ map: puckTop(def.label ?? `#${def.marker}`, def.color || '#dddddd', def.image, def.crop), roughness: 0.7 });
      this.body = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, this.height, 40), [side, top, side]);
      this.body.position.y = this.height / 2;
    }
    this.group.add(this.target(this.body));
    this.holder = null;
    this.y = 0;
  }
  grab(ptr) {
    const s = this.model.get(this.id).state;
    const parent = this.group.parent;
    if (ptr.kind === 'pinch') {
      const p = parent.worldToLocal(ptr.point.clone());
      this.holder = { kind: 'pinch', dx: s.x - p.x, dz: s.z - p.z, dy: this.y - p.y, yaw0: s.yaw, hand0: ptr.yaw, moved: false };
    } else {
      const p = planePoint(parent, ptr, this.height);
      if (!p) return;
      this.holder = { kind: 'slide', dx: s.x - p.x, dz: s.z - p.z, start: p.clone(), moved: false };
    }
  }
  drag(ptr) {
    const h = this.holder;
    if (!h) return;
    const parent = this.group.parent;
    if (h.kind === 'pinch') {
      const p = parent.worldToLocal(ptr.point.clone());
      this.y = Math.max(0, p.y + h.dy);
      const yaw = h.yaw0 + (ptr.yaw - h.hand0);
      h.moved = true;
      this.model.setPose(this.id, { x: p.x + h.dx, z: p.z + h.dz, yaw, lifted: this.y > 0.012 });
    } else {
      const p = planePoint(parent, ptr, this.height);
      if (!p) return;
      if (p.distanceTo(h.start) > 0.005) h.moved = true;
      this.model.setPose(this.id, { x: p.x + h.dx, z: p.z + h.dz, lifted: false });
    }
  }
  release() {
    const h = this.holder;
    if (!h) return;
    this.holder = null;
    const wasLifted = this.y > 0.012;
    this.y = 0;
    const s = this.model.get(this.id).state;
    if (Math.abs(s.x) > FAST.projW / 2 + FAST.border || Math.abs(s.z) > FAST.projD / 2 + FAST.border) {
      this.model.sendHome(this.id); // dropped off the table
      return;
    }
    if (this.t.def.type === 'dice' && (wasLifted || !h.moved)) this.model.roll(this.id);
    this.model.setPose(this.id, { lifted: false });
  }
  reach(point) {
    const p = this.group.worldToLocal(TMP.copy(point));
    const r = Math.hypot(p.x, p.z);
    return r < this.radius + 0.025 && p.y > -0.02 && p.y < this.height + 0.04 ? r : null;
  }
  wheel(dir) {
    const s = this.model.get(this.id).state;
    this.model.setPose(this.id, { yaw: s.yaw - dir * (Math.PI / 12) });
  }
  sync() {
    const s = this.model.get(this.id).state;
    this.group.position.set(s.x, this.y, s.z);
    this.group.rotation.y = s.yaw;
    if (this.t.def.type === 'dice') {
      const r = { 1: [0, 0], 6: [Math.PI, 0], 2: [0, Math.PI / 2], 5: [0, -Math.PI / 2], 3: [-Math.PI / 2, 0], 4: [Math.PI / 2, 0] }[s.face];
      this.body.rotation.set(r[0], 0, r[1]);
    }
  }
}

function puckTop(label, color, image, crop) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const S = 512;
  const drawLabel = (band) => {
    g.font = `700 ${label.length > 6 ? 64 : 88}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (band) {
      g.fillStyle = 'rgba(250, 246, 236, 0.9)';
      g.fillRect(0, S * 0.74, S, S * 0.26);
      g.fillStyle = '#1a1a1a';
      g.font = `700 ${label.length > 6 ? 54 : 64}px system-ui, sans-serif`;
      g.fillText(label, S / 2, S * 0.855);
    } else {
      g.fillStyle = luminance(color) > 0.5 ? '#111' : '#fff';
      g.fillText(label, S / 2, S / 2);
    }
  };
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2; // cylinder cap UVs run sideways
  if (!image) {
    drawLabel(false);
    return t;
  }
  // The object's picture, zoomed in on the subject (like CSS background "cover" x zoom).
  const cr = { zoom: 1.5, x: 0.5, y: 0.46, ...crop };
  const img = new Image();
  img.onload = () => {
    const scale = Math.max(S / img.width, S / img.height) * cr.zoom;
    const w = img.width * scale, h = img.height * scale;
    g.drawImage(img, (S - w) * cr.x, (S - h) * cr.y, w, h);
    drawLabel(true);
    t.needsUpdate = true;
  };
  img.src = image;
  drawLabel(false);
  return t;
}

function dieFace(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fafaf7';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#16181c';
  const at = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[n];
  for (const i of at) {
    g.beginPath();
    g.arc(32 + (i % 3) * 32, 32 + Math.floor(i / 3) * 32, 11, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

const CLASSES = {
  buttons: ButtonsTool, dial: DialTool, slider: SliderTool, toggle: ToggleTool,
  tray: TrayTool, mark: MarkTool, tangible: TangibleTool, dice: TangibleTool
};

export function buildTools(model) {
  const out = [];
  for (const t of model.tools.values()) {
    const C = CLASSES[t.def.type];
    if (C) out.push(new C(model, t));
  }
  return out;
}
