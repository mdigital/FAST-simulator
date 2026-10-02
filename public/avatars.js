// Other players: a head with a visor, a body that turns with the head, two
// hands (when they have tracked hands or controllers) and a name tag.

import * as THREE from 'three';

export class Avatars {
  constructor(scene) {
    this.scene = scene;
    this.list = new Map(); // id -> avatar
  }

  /** pose: { h: [x,y,z,qx,qy,qz,qw], l?: [x,y,z, tx,ty,tz], r?: [...] } */
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
    this.list.delete(id);
  }

  /** Smoothly move avatars toward their latest pose. */
  tick(dt) {
    const k = Math.min(1, dt * 14);
    for (const [id, a] of this.list) {
      if (performance.now() - a.seen > 5000) { this.remove(id); continue; }
      const p = a.target;
      if (!p?.h) continue;
      const hp = new THREE.Vector3(p.h[0], p.h[1], p.h[2]);
      const hq = new THREE.Quaternion(p.h[3], p.h[4], p.h[5], p.h[6]);
      a.head.position.lerp(hp, k);
      a.head.quaternion.slerp(hq, k);
      // Body: below the head, turned to the head's yaw only.
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(a.head.quaternion);
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      a.body.position.set(a.head.position.x, a.head.position.y - 0.55, a.head.position.z);
      a.body.rotation.set(0, yaw, 0);
      a.tag.position.set(a.head.position.x, a.head.position.y + 0.26, a.head.position.z);
      for (const side of ['l', 'r']) {
        const h = a.hands[side], d = p[side];
        h.visible = !!d;
        if (!d) continue;
        h.palm.position.lerp(new THREE.Vector3(d[0], d[1], d[2]), k);
        h.tip.position.lerp(new THREE.Vector3(d[3], d[4], d[5]), k);
      }
    }
  }
}

function buildAvatar(peer) {
  const colour = new THREE.Color(peer.colour || '#4cc2ff');
  const skin = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 });
  const root = new THREE.Group();

  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), skin);
  skull.scale.set(1, 1.15, 1.05);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.07, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.25, metalness: 0.4 })
  );
  visor.position.set(0, 0.01, -0.095);
  head.add(skull, visor);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 6, 16), skin);
  const tag = nameTag(peer.name || `Player ${peer.id}`, colour);

  const hands = {};
  for (const side of ['l', 'r']) {
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), skin);
    palm.scale.set(1, 0.6, 1.2);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), skin);
    const g = new THREE.Group();
    g.add(palm, tip);
    g.visible = false;
    hands[side] = Object.assign(g, { palm, tip });
    root.add(g);
  }
  root.add(head, body, tag);
  return { root, head, body, tag, hands, target: null, seen: performance.now() };
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
