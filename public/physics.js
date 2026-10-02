// Physics for the throwable stools (cannon-es).
//
// The table, walls, glass and floor are static. A stool you hold is moved
// kinematically toward your hand/pointer (so it shoves other stools) but is
// kept out of the table, and when you let go it flies with your hand's speed.
// Stools that come to rest on the tabletop slide themselves off, so nothing
// can sit on (or wreck) the table.
//
// Multiplayer: whoever grabs a stool owns it and streams its pose; everyone
// else shows it kinematically. When it comes to rest, ownership is released
// and everyone simulates it locally again from the same pose.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { ROOM, STOOL, STOOL_COLOURS, buildStool, stoolSpots, shadowBlob } from './room.js';

const MAX_THROW = 7; // m/s
const MAX_FOLLOW = 12; // m/s while held
const SEND_INTERVAL = 50; // ms between pose updates for stools we own

export class Physics {
  /**
   * room: { x, z } centre of the room. net: optional Net for multiplayer.
   */
  constructor(scene, { room, net = null }) {
    this.scene = scene;
    this.room = room;
    this.net = net;
    this.me = net?.id ?? 'local';
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.allowSleep = true;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.45;
    this.world.defaultContactMaterial.restitution = 0.25;
    this.tableBodies = [];
    this.tableBox = null;
    this.stools = [];
    this.enabled = true;
    this.lastSend = 0;
    this.buildStatics();
  }

  get targets() {
    return this.enabled ? this.stools.flatMap((s) => s.targets) : [];
  }

  buildStatics() {
    const floor = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floor);
    const { x, z } = this.room, hw = ROOM.w / 2, hd = ROOM.d / 2, h = ROOM.h, t = 0.2;
    for (const [px, pz, sx, sz] of [
      [x - hw - t, z, t, hd], [x + hw + t, z, t, hd], [x, z - hd - t, hw, t], [x, z + hd + t, hw, t]
    ]) {
      const wall = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(sx, h, sz)) });
      wall.position.set(px, h, pz);
      this.world.addBody(wall);
    }
    const ceiling = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(hw, t, hd)) });
    ceiling.position.set(x, h + t, z);
    this.world.addBody(ceiling);
  }

  /** (Re)build the table's static colliders. pos: table centre on the floor. */
  setTable({ x, z, TW, TD, h, style }) {
    for (const b of this.tableBodies) this.world.removeBody(b);
    this.tableBodies = [];
    const add = (sx, sy, sz, px, py, pz) => {
      const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)) });
      b.position.set(x + px, py, z + pz);
      this.world.addBody(b);
      this.tableBodies.push(b);
    };
    add(TW, 0.04, TD, 0, h - 0.02, 0); // top
    if (style === 'plinth') {
      add(TW - 0.08, h - 0.04, TD - 0.08, 0, (h - 0.04) / 2, 0);
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.05, h, 0.05, sx * (TW / 2 - 0.05), h / 2, sz * (TD / 2 - 0.05));
      add(TW * 0.5, 0.3, TD * 0.6, 0, h - 0.04 - 0.15, 0); // cabinet
    }
    this.tableBox = { x, z, hx: TW / 2, hz: TD / 2, top: h };
    this.tableSpots = stoolSpots(TW, TD).map(([sx, sz]) => [x + sx, z + sz]);
  }

  /** Stools on (table + stools) or off (plinth). */
  setStools(on) {
    this.enabled = on;
    if (on && !this.stools.length) {
      this.tableSpots.forEach(([px, pz], i) => this.stools.push(new Stool(this, i, STOOL_COLOURS[i % STOOL_COLOURS.length], px, pz, i * 1.3)));
    }
    for (const s of this.stools) s.setActive(on);
  }

  setVisible(v) {
    for (const s of this.stools) s.setVisible(v && this.enabled);
  }

  /** Put every stool back around the table (and tell everyone). */
  reset() {
    this.stools.forEach((s, i) => {
      const [px, pz] = this.tableSpots[i % this.tableSpots.length];
      s.place(px, STOOL.h / 2, pz, i * 1.3);
      s.owner = this.me;
      s.sendState(true);
      s.owner = null;
    });
  }

  step(dt, now) {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.1); // real time even at low frame rates (up to 9 substeps)
    for (const s of this.stools) s.beforeStep(dt);
    this.world.step(1 / 90, dt, 10);
    for (const s of this.stools) s.afterStep(now);
    // Stream poses of stools we own.
    if (this.net?.connected && now - this.lastSend > SEND_INTERVAL) {
      this.lastSend = now;
      for (const s of this.stools) if (s.owner === this.me) s.sendState(false);
    }
  }

  /** Push a held stool's target out of the table (it can't be shoved through it). */
  keepOffTable(p) {
    const t = this.tableBox;
    if (!t) return p;
    const r = STOOL.r + 0.02, half = STOOL.h / 2;
    const dx = p.x - t.x, dz = p.z - t.z;
    const inX = Math.abs(dx) < t.hx + r, inZ = Math.abs(dz) < t.hz + r, below = p.y < t.top + half + 0.01;
    if (inX && inZ && below) {
      // Smallest way out: over the top, or out of the nearest side.
      const outs = [
        { d: t.top + half + 0.01 - p.y, f: () => { p.y = t.top + half + 0.01; } },
        { d: t.hx + r - Math.abs(dx), f: () => { p.x = t.x + Math.sign(dx || 1) * (t.hx + r); } },
        { d: t.hz + r - Math.abs(dz), f: () => { p.z = t.z + Math.sign(dz || 1) * (t.hz + r); } }
      ].sort((a, b) => a.d - b.d);
      outs[0].f();
    }
    const { x, z } = this.room, m = STOOL.r + 0.05;
    p.x = THREE.MathUtils.clamp(p.x, x - ROOM.w / 2 + m, x + ROOM.w / 2 - m);
    p.z = THREE.MathUtils.clamp(p.z, z - ROOM.d / 2 + m, z + ROOM.d / 2 - m);
    p.y = THREE.MathUtils.clamp(p.y, half, ROOM.h - half);
    return p;
  }

  /** A stool state from another player. */
  applyRemote(msg) {
    const s = this.stools[msg.i];
    if (!s) return;
    s.applyRemote(msg);
  }

  /** The local player id changed (connected to the server). */
  setMe(id) {
    for (const s of this.stools) if (s.owner === this.me) s.owner = id;
    this.me = id;
  }
}

class Stool {
  constructor(physics, i, colour, x, z, yaw) {
    this.physics = physics;
    this.i = i;
    this.id = `stool${i}`;
    this.owner = null;
    this.holder = null;
    this.remote = null;
    this.restTimer = 0;

    this.body = new CANNON.Body({
      mass: 6,
      shape: new CANNON.Cylinder(STOOL.r, STOOL.r, STOOL.h, 16),
      linearDamping: 0.05,
      angularDamping: 0.25,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.6
    });
    physics.world.addBody(this.body);

    // Visual: pivot at the body's centre; the model's origin is its base.
    this.group = new THREE.Group();
    const model = buildStool(colour, { shadow: false });
    model.position.y = -STOOL.h / 2;
    this.group.add(model);
    this.targets = [];
    model.traverse((o) => { if (o.isMesh) { o.userData.tool = this; this.targets.push(o); } });
    this.shadow = shadowBlob(STOOL.r * 2.6, STOOL.r * 2.6, 0.5);
    physics.scene.add(this.group, this.shadow);
    this.place(x, STOOL.h / 2, z, yaw);
  }

  place(x, y, z, yaw) {
    this.body.type = CANNON.Body.DYNAMIC;
    this.body.position.set(x, y, z);
    this.body.quaternion.setFromEuler(0, yaw, 0);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.body.sleep();
    this.holder = null;
    this.remote = null;
    this.sync();
  }

  setActive(on) {
    const inWorld = this.physics.world.bodies.includes(this.body);
    if (on && !inWorld) this.physics.world.addBody(this.body);
    if (!on && inWorld) this.physics.world.removeBody(this.body);
    this.setVisible(on);
  }

  setVisible(v) {
    this.group.visible = v;
    this.shadow.visible = v;
  }

  // ---- the tool interface used by TableScene (mouse, controller ray, pinch)

  grab(ptr, hit) {
    if (this.remote?.held) return; // someone else has it
    const pos = vec(this.body.position);
    const h = { kind: ptr.kind, history: [], target: pos.clone() };
    if (ptr.kind === 'pinch') {
      h.offset = pos.clone().sub(ptr.point);
    } else if (ptr.kind === 'ray') {
      h.dist = hit?.distance ?? ptr.ray.origin.distanceTo(pos);
    } else {
      h.lift = Math.max(pos.y, 0.55); // mouse: carry it at this height
    }
    this.holder = h;
    this.claim();
    this.body.type = CANNON.Body.KINEMATIC;
    this.body.wakeUp();
    this.drag(ptr);
  }

  drag(ptr) {
    const h = this.holder;
    if (!h) return;
    let target;
    if (h.kind === 'pinch') {
      target = ptr.point.clone().add(h.offset);
    } else if (h.kind === 'ray') {
      h.dist += (0.7 - h.dist) * 0.08; // pull it in toward you
      target = ptr.ray.origin.clone().addScaledVector(ptr.ray.direction, h.dist);
    } else {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h.lift);
      target = ptr.ray.intersectPlane(plane, new THREE.Vector3()) || h.target;
    }
    h.target = this.physics.keepOffTable(target);
  }

  release() {
    const h = this.holder;
    if (!h) return;
    this.holder = null;
    this.body.type = CANNON.Body.DYNAMIC;
    // Throw: average velocity over the last ~100 ms of movement.
    const now = performance.now();
    const recent = h.history.filter((e) => now - e.t < 120);
    const v = new THREE.Vector3();
    if (recent.length > 1) {
      const a = recent[0], b = recent[recent.length - 1];
      v.copy(b.p).sub(a.p).divideScalar(Math.max(0.016, (b.t - a.t) / 1000));
    }
    if (v.length() > MAX_THROW) v.setLength(MAX_THROW);
    this.body.velocity.set(v.x, v.y, v.z);
    // A bit of tumble, more for harder throws.
    const spin = Math.min(6, v.length() * 1.2);
    this.body.angularVelocity.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    this.body.wakeUp();
    this.sendState(false); // still ours while it flies; released when it lands
  }

  reach(point) {
    const d = point.distanceTo(vec(this.body.position));
    return d < STOOL.h / 2 + 0.12 ? d : null;
  }

  poke() {}

  // ---- simulation

  beforeStep(dt) {
    const b = this.body;
    if (this.holder) {
      // Kinematic follow: velocity toward the target, so it pushes other stools.
      const v = this.holder.target.clone().sub(vec(b.position)).divideScalar(dt);
      if (v.length() > MAX_FOLLOW) v.setLength(MAX_FOLLOW);
      b.velocity.set(v.x, v.y, v.z);
      b.angularVelocity.scale(0.8, b.angularVelocity);
      this.holder.history.push({ t: performance.now(), p: vec(b.position) });
      if (this.holder.history.length > 20) this.holder.history.shift();
    } else if (this.remote && this.owner && this.owner !== this.physics.me) {
      // Someone else owns it: follow their pose.
      b.type = CANNON.Body.KINEMATIC;
      const target = new THREE.Vector3(...this.remote.p);
      const v = target.sub(vec(b.position)).multiplyScalar(Math.min(1, 12 * dt) / dt);
      b.velocity.set(v.x, v.y, v.z);
      const q = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w).slerp(new THREE.Quaternion(...this.remote.q), Math.min(1, 12 * dt));
      b.quaternion.set(q.x, q.y, q.z, q.w);
      b.angularVelocity.setZero();
    }
  }

  afterStep() {
    const b = this.body;
    // Off the table: a stool resting on the tabletop slides itself off.
    const t = this.physics.tableBox;
    if (!this.holder && t && (!this.owner || this.owner === this.physics.me) && b.type === CANNON.Body.DYNAMIC) {
      const dx = b.position.x - t.x, dz = b.position.z - t.z;
      const r = STOOL.r + 0.05; // keep nudging until it's clear of the edge
      if (Math.abs(dx) < t.hx + r && Math.abs(dz) < t.hz + r && b.position.y > t.top && b.velocity.length() < 0.4) {
        const out = Math.abs(dx) / t.hx > Math.abs(dz) / t.hz ? new THREE.Vector3(Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz));
        b.wakeUp();
        b.velocity.set(out.x * 1.6, 0.6, out.z * 1.6);
        this.claim();
      }
    }
    // Shove an unowned stool with one of ours: we own its motion now.
    if (!this.owner && b.sleepState === CANNON.Body.AWAKE && b.velocity.length() > 0.3 && this.physics.net?.connected) {
      this.claim();
    }
    // Owned by us and at rest: hand it back to everyone.
    if (this.owner === this.physics.me && !this.holder && b.sleepState === CANNON.Body.SLEEPING) {
      this.sendState(true);
      this.owner = null;
    }
    this.sync();
  }

  sync() {
    const b = this.body;
    this.group.position.set(b.position.x, b.position.y, b.position.z);
    this.group.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    const lift = Math.max(0, b.position.y - STOOL.h / 2);
    this.shadow.position.set(b.position.x, 0.003, b.position.z);
    this.shadow.material.opacity = 0.5 * Math.max(0.15, 1 - lift * 1.2);
    this.shadow.scale.setScalar(1 + lift * 0.6);
  }

  // ---- multiplayer

  claim() {
    if (this.owner === this.physics.me) return;
    this.owner = this.physics.me;
    this.remote = null;
    this.sendState(false);
  }

  sendState(rest) {
    const net = this.physics.net;
    if (!net?.connected) return;
    const b = this.body;
    net.send({
      t: 'stool', i: this.i, owner: rest ? null : this.owner, held: !!this.holder, rest,
      p: [b.position.x, b.position.y, b.position.z].map(r4),
      q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w].map(r4),
      v: [b.velocity.x, b.velocity.y, b.velocity.z].map(r4)
    });
  }

  applyRemote(msg) {
    const b = this.body;
    if (msg.rest) {
      // At rest (or reset): everyone simulates it again from this exact pose.
      if (this.holder) return;
      this.owner = null;
      this.remote = null;
      b.type = CANNON.Body.DYNAMIC;
      b.position.set(...msg.p);
      b.quaternion.set(...msg.q);
      b.velocity.set(...(msg.v || [0, 0, 0]));
      b.angularVelocity.setZero();
      if (b.velocity.length() < 0.05) b.sleep(); else b.wakeUp();
      this.sync();
      return;
    }
    if (this.holder && msg.held) this.release(); // they grabbed it too; last grab wins
    this.owner = msg.owner;
    this.remote = { p: msg.p, q: msg.q, held: msg.held };
    b.wakeUp();
  }
}

const vec = (v) => new THREE.Vector3(v.x, v.y, v.z);
const r4 = (n) => Math.round(n * 1e4) / 1e4;
