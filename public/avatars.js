// Other players, as a simple androgynous mannequin: an egg-shaped head with
// two dot eyes (so you can see which way they're facing), neck, tapered torso,
// arms and legs, in the player's colour, plus a name tag. Arms reach to the
// player's tracked hands (two-bone IK); otherwise they hang at the sides.

import * as THREE from 'three';

const STANDARD_EYE_HEIGHT = 1.62; // the figure is scaled so its eyes meet the player's head
const UP = new THREE.Vector3(0, 1, 0);

// Proportions at standard height, metres (y = height above the floor).
const P = {
  neck: 1.47, shoulder: 1.40, shoulderW: 0.19, hip: 0.92, hipW: 0.09,
  upperArm: 0.29, forearm: 0.27, thigh: 0.45, shin: 0.43
};

export class Avatars {
  constructor(scene) {
    this.scene = scene;
    this.list = new Map(); // id -> avatar
  }

  /** pose: { h: [x,y,z,qx,qy,qz,qw], l?: [palm xyz, tip xyz], r?: [...] } */
  update(peer, pose) {
    let a = this.list.get(peer.id);
    if (!a) {
      a = buildAvatar(peer);
      this.list.set(peer.id, a);
      this.scene.add(a.root);
    }
    a.target = pose;
    a.seen = performance.now();
  }

  remove(id) {
    const a = this.list.get(id);
    if (!a) return;
    this.scene.remove(a.root);
    a.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.list.delete(id);
  }

  /** Smoothly move avatars toward their latest pose. */
  tick(dt) {
    const k = Math.min(1, dt * 14);
    for (const [id, a] of this.list) {
      if (performance.now() - a.seen > 5000) { this.remove(id); continue; }
      const p = a.target;
      if (!p?.h) continue;
      a.headPos.lerp(new THREE.Vector3(p.h[0], p.h[1], p.h[2]), k);
      a.headQuat.slerp(new THREE.Quaternion(p.h[3], p.h[4], p.h[5], p.h[6]), k);
      for (const side of ['l', 'r']) {
        const d = p[side], h = a.hands[side];
        h.tracked = !!d;
        if (!d) continue;
        h.palm.lerp(new THREE.Vector3(d[0], d[1], d[2]), k);
        h.tip.lerp(new THREE.Vector3(d[3], d[4], d[5]), k);
      }
      pose(a, dt);
    }
  }
}

function buildAvatar(peer) {
  const colour = new THREE.Color(peer.colour || '#4cc2ff');
  // A soft, slightly desaturated mannequin finish in the player's colour.
  const hsl = colour.getHSL({});
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hsl.h, hsl.s * 0.7, 0.6), roughness: 0.75 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x15171c });
  const root = new THREE.Group();

  // Head: an egg, slightly narrower than tall, with two dot eyes on the front (-z).
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 28, 20), skin);
  skull.scale.set(0.86, 1.12, 0.95);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), eyeMat);
    eye.position.set(sx * 0.032, 0.012, -0.088);
    eye.scale.set(1, 1.15, 0.5);
    head.add(eye);
  }

  // Torso: a smooth lathe from shoulders to hips, softly tapered at the waist.
  const torsoProfile = [
    [0.0, 0.0], [0.13, 0.0], [0.155, 0.06], [0.14, 0.2], [0.125, 0.27], [0.15, 0.4], [0.175, 0.46], [0.16, 0.5], [0.06, 0.53], [0.0, 0.53]
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 28), skin);
  torso.scale.set(1, 1, 0.62); // flatter front-to-back
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1, 16), skin);
  neck.geometry.translate(0, 0.5, 0); // origin at its base, like the limbs

  const limb = (r0, r1) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 14), skin);
    m.geometry.translate(0, 0.5, 0); // origin at the start of the limb
    return m;
  };
  const joint = (r) => new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), skin);

  const arms = {}, hands = {}, legs = {};
  for (const side of ['l', 'r']) {
    arms[side] = { upper: limb(0.042, 0.035), fore: limb(0.034, 0.028), shoulder: joint(0.048), elbow: joint(0.036) };
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), skin);
    mitt.scale.set(0.75, 0.55, 1.15);
    hands[side] = { mitt, tracked: false, palm: new THREE.Vector3(), tip: new THREE.Vector3() };
    legs[side] = { thigh: limb(0.065, 0.05), shin: limb(0.05, 0.038), knee: joint(0.05), foot: new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.22), skin) };
    root.add(arms[side].upper, arms[side].fore, arms[side].shoulder, arms[side].elbow, mitt,
      legs[side].thigh, legs[side].shin, legs[side].knee, legs[side].foot);
  }
  const tag = nameTag(peer.name || `Player ${peer.id}`, colour);
  root.add(head, torso, neck, tag);
  return {
    root, head, torso, neck, arms, hands, legs, tag,
    headPos: new THREE.Vector3(0, STANDARD_EYE_HEIGHT, 0), headQuat: new THREE.Quaternion(), bodyYaw: null,
    target: null, seen: performance.now()
  };
}

/** Lay the figure out from the head pose (and hands, if tracked). */
function pose(a, dt) {
  const hp = a.headPos;
  // Scale the whole figure so its eyes are at the player's head height.
  const s = THREE.MathUtils.clamp(hp.y / STANDARD_EYE_HEIGHT, 0.55, 1.25);
  const H = (y) => y * s;

  a.head.position.copy(hp);
  a.head.quaternion.copy(a.headQuat);
  a.head.scale.setScalar(s);

  // The body turns with the head, lagging a little, yaw only.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(a.headQuat);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  if (a.bodyYaw === null) a.bodyYaw = yaw;
  const dyaw = Math.atan2(Math.sin(yaw - a.bodyYaw), Math.cos(yaw - a.bodyYaw));
  a.bodyYaw += dyaw * Math.min(1, dt * 4);
  const rot = new THREE.Quaternion().setFromAxisAngle(UP, a.bodyYaw);
  // Body sits under the head, a little behind the eyes.
  const base = new THREE.Vector3(0, 0, 0.05 * s).applyQuaternion(rot).add(new THREE.Vector3(hp.x, 0, hp.z));
  const at = (x, y, z = 0) => new THREE.Vector3(x * s, H(y), z * s).applyQuaternion(rot).add(base);

  a.torso.position.copy(at(0, P.hip));
  a.torso.quaternion.copy(rot);
  a.torso.scale.set(s, s, s * 0.62);
  setLimb(a.neck, at(0, P.shoulder + 0.02), hp.clone().add(new THREE.Vector3(0, -0.08 * s, 0)), 1);

  for (const side of ['l', 'r']) {
    const sx = side === 'l' ? -1 : 1;
    const arm = a.arms[side], hand = a.hands[side], leg = a.legs[side];
    // Arms: reach to the tracked hand, or hang relaxed.
    const shoulder = at(sx * P.shoulderW, P.shoulder);
    const target = hand.tracked ? hand.palm.clone() : at(sx * (P.shoulderW + 0.04), P.shoulder - 0.55, -0.04);
    const pole = at(sx * 0.35, P.hip - 0.3, 0.35).sub(shoulder); // elbows point down, out and back
    const elbow = solveElbow(shoulder, target, P.upperArm * s, P.forearm * s, pole);
    arm.shoulder.position.copy(shoulder);
    arm.shoulder.scale.setScalar(s);
    arm.elbow.position.copy(elbow);
    arm.elbow.scale.setScalar(s);
    setLimb(arm.upper, shoulder, elbow, s);
    const wrist = target.clone();
    setLimb(arm.fore, elbow, wrist, s);
    hand.mitt.position.copy(wrist);
    hand.mitt.scale.setScalar(s);
    const pointTo = hand.tracked ? hand.tip.clone() : wrist.clone().add(new THREE.Vector3(0, -0.1, 0));
    hand.mitt.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(pointTo, wrist, UP));

    // Legs: straight down from the hips to the floor, slightly apart.
    const hipJ = at(sx * P.hipW, P.hip + 0.02);
    const ankle = at(sx * (P.hipW + 0.01), 0.06);
    const knee = solveElbow(hipJ, ankle, P.thigh * s, P.shin * s, at(0, P.hip - 0.4, -0.5).sub(hipJ));
    setLimb(leg.thigh, hipJ, knee, s);
    setLimb(leg.shin, knee, ankle, s);
    leg.knee.position.copy(knee);
    leg.knee.scale.setScalar(s);
    leg.foot.position.copy(at(sx * (P.hipW + 0.01), 0.025, -0.05));
    leg.foot.quaternion.copy(rot);
    leg.foot.scale.setScalar(s);
  }
  a.tag.position.set(hp.x, hp.y + 0.24 * s, hp.z);
}

/** Two-bone IK: where the elbow (or knee) goes, bending toward the pole. */
function solveElbow(a, b, l1, l2, pole) {
  const ab = b.clone().sub(a);
  const d = THREE.MathUtils.clamp(ab.length(), 0.01, l1 + l2 - 0.001);
  const dir = ab.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (bend.lengthSq() < 1e-6) bend.set(0, -1, 0);
  bend.normalize();
  return a.clone().addScaledVector(dir, x).addScaledVector(bend, y);
}

/** Stretch a unit limb (origin at its start, along +y) from p1 to p2. */
function setLimb(mesh, p1, p2, thickness) {
  const v = p2.clone().sub(p1);
  const len = v.length();
  mesh.position.copy(p1);
  mesh.quaternion.setFromUnitVectors(UP, len > 1e-6 ? v.divideScalar(len) : UP);
  mesh.scale.set(thickness, Math.max(len, 1e-3), thickness);
}

function nameTag(text, colour) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.font = '600 52px system-ui, sans-serif';
  const w = Math.min(500, g.measureText(text).width + 48);
  g.fillStyle = 'rgba(20, 22, 26, 0.8)';
  g.beginPath();
  g.roundRect((512 - w) / 2, 8, w, 80, 40);
  g.fill();
  g.fillStyle = `#${colour.getHexString()}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, toneMapped: false }));
  sprite.scale.set(0.5, 0.094, 1);
  return sprite;
}
