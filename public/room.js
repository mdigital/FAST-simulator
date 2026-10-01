// The gallery around the table: a patterned museum carpet, walls with
// frosted windows (people passing by outside as silhouettes), and the two
// furniture styles: a table on legs with fabric stools, or a steel plinth.
// Everything is procedural (canvas textures), so there are no assets to load.

import * as THREE from 'three';

const ROOM = { w: 10, d: 10, h: 3.6 };

// ------------------------------------------------------------------ room

/** The room, centred on (cx, cz). */
export function buildRoom(cx, cz) {
  const room = new THREE.Group();
  room.position.set(cx, 0, cz);

  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: carpetTexture(ROOM.w / 2.5), roughness: 1 })
  );
  room.add(carpet);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9dfd0, roughness: 0.95 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x5a3b28, roughness: 0.6 });
  const walls = [
    { x: 0, z: -ROOM.d / 2, ry: 0, windows: 3 }, // far wall, facing the visitor
    { x: -ROOM.w / 2, z: 0, ry: Math.PI / 2, windows: 2 }, // left
    { x: ROOM.w / 2, z: 0, ry: -Math.PI / 2, windows: 0 }, // right
    { x: 0, z: ROOM.d / 2, ry: Math.PI, windows: 0 } // behind
  ];
  walls.forEach((w, i) => {
    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.ry;
    const len = i % 2 ? ROOM.d : ROOM.w;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, ROOM.h), wallMat);
    wall.position.y = ROOM.h / 2;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.02), skirtMat);
    skirt.position.set(0, 0.06, 0.01);
    g.add(wall, skirt);
    for (let k = 0; k < w.windows; k++) {
      const win = buildWindow(2.0, 2.1, i * 10 + k);
      win.position.set((k - (w.windows - 1) / 2) * 2.9, 1.55, 0.02);
      g.add(win);
    }
    room.add(g);
  });

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 1 })
  );
  ceiling.position.y = ROOM.h;
  room.add(ceiling);

  // Warm gallery lighting, with cooler daylight from the windows.
  const hemi = new THREE.HemisphereLight(0xfff0dc, 0x6a3f2c, 1.0);
  const day = new THREE.DirectionalLight(0xdfeaff, 0.8);
  day.position.set(-3, 3, -5);
  const lamp = new THREE.PointLight(0xffd9a8, 6, 8, 1.6);
  lamp.position.set(0, ROOM.h - 0.4, 1);
  room.add(hemi, day, lamp);
  return room;
}

function buildWindow(w, h, seed) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: windowTexture(seed), toneMapped: false })
  );
  g.add(glass);
  const frame = new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.5 });
  const t = 0.08;
  for (const [fw, fh, x, y] of [
    [w + 2 * t, t, 0, h / 2 + t / 2], [w + 2 * t, t, 0, -h / 2 - t / 2],
    [t, h, -w / 2 - t / 2, 0], [t, h, w / 2 + t / 2, 0],
    [0.035, h, 0, 0], [w, 0.035, 0, h * 0.12] // mullion and transom
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.06), frame);
    bar.position.set(x, y, 0.03);
    g.add(bar);
  }
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.04, 0.2), frame);
  sill.position.set(0, -h / 2 - t, 0.1);
  g.add(sill);
  return g;
}

// ------------------------------------------------------------- furniture

const steel = () => new THREE.MeshStandardMaterial({ map: brushedTexture(), color: 0xc9ccd1, metalness: 0.85, roughness: 0.38 });

/** Thin steel legs with a cabinet for the computer (the original look). */
export function buildLegs(TW, TD, h) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), metal);
    leg.position.set(sx * (TW / 2 - 0.05), h / 2, sz * (TD / 2 - 0.05));
    g.add(leg);
  }
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(TW * 0.5, 0.3, TD * 0.6), new THREE.MeshStandardMaterial({ color: 0x3a3d43, roughness: 0.9 }));
  cabinet.position.y = h - 0.15;
  g.add(cabinet, shadowBlob(TW * 1.05, TD * 1.05, 0.45));
  return g;
}

/** A brushed-steel box under the top, with a recessed dark toe kick. */
export function buildPlinth(TW, TD, h) {
  const g = new THREE.Group();
  const inset = 0.04, kick = 0.07;
  const box = new THREE.Mesh(new THREE.BoxGeometry(TW - 2 * inset, h - kick, TD - 2 * inset), steel());
  box.position.y = kick + (h - kick) / 2;
  const toe = new THREE.Mesh(new THREE.BoxGeometry(TW - 2 * inset - 0.08, kick, TD - 2 * inset - 0.08), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }));
  toe.position.y = kick / 2;
  g.add(box, toe, shadowBlob(TW * 1.1, TD * 1.1, 0.6));
  return g;
}

export const STOOL_COLOURS = [0x1f3fd1, 0xe0602a, 0x1f9e8f, 0xe3b23c, 0xb8323a, 0x6b8f3a];

/** Upholstered cylinder stools around the table, leaving room at the front-centre to stand. */
export function buildStools(TW, TD) {
  const g = new THREE.Group();
  const gap = 0.38; // stool centre to table edge
  const near = TD / 2 + gap, side = TW / 2 + gap;
  const spots = [
    [-0.33 * TW, near], [0.33 * TW, near],
    [-0.3 * TW, -near], [0, -near], [0.3 * TW, -near],
    [-side, 0], [side, 0]
  ];
  spots.forEach(([x, z], i) => {
    const stool = buildStool(STOOL_COLOURS[i % STOOL_COLOURS.length]);
    stool.position.set(x, 0, z);
    stool.rotation.y = i * 1.3;
    g.add(stool);
  });
  return g;
}

function buildStool(colour, r = 0.2, h = 0.45) {
  const g = new THREE.Group();
  // Lathe profile: a cylinder with softly rounded top and bottom edges.
  const pts = [new THREE.Vector2(0, 0.012)];
  const arc = (cx, cy, rad, a0, a1) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      pts.push(new THREE.Vector2(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad));
    }
  };
  arc(r - 0.012, 0.024, 0.012, -Math.PI / 2, 0);
  arc(r - 0.03, h - 0.03, 0.03, 0, Math.PI / 2);
  pts.push(new THREE.Vector2(0, h));
  const fabric = fabricTexture();
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 48),
    new THREE.MeshStandardMaterial({ color: colour, map: fabric, bumpMap: fabric, bumpScale: 1.5, roughness: 0.95 })
  );
  // Piping seam around the top.
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(r - 0.02, 0.004, 6, 48),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).multiplyScalar(0.75), roughness: 0.9 })
  );
  seam.rotation.x = Math.PI / 2;
  seam.position.y = h - 0.012;
  g.add(body, seam, shadowBlob(r * 2.6, r * 2.6, 0.5));
  return g;
}

/** Soft fake contact shadow on the floor. */
function shadowBlob(w, d, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity, depthWrite: false })
  );
  m.position.y = 0.003;
  m.renderOrder = -1;
  return m;
}

// --------------------------------------------------------------- textures

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function canvasTex(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

// Deterministic random so the room looks the same every time.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Museum carpet: warm field, medallion lattice, fine fibre noise. One tile = 2.5 m. */
function carpetTexture(repeat) {
  return cached(`carpet${repeat}`, () => canvasTex(1024, (g, S) => {
    const C = { field: '#7a2a20', deep: '#4a1d18', terra: '#b5532f', ochre: '#d69a3a', cream: '#ecdcbc', plum: '#5b2d3a' };
    g.fillStyle = C.field;
    g.fillRect(0, 0, S, S);
    // diagonal lattice
    g.strokeStyle = C.deep;
    g.lineWidth = 10;
    for (let i = -S; i <= 2 * S; i += S / 4) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
      g.beginPath(); g.moveTo(i, S); g.lineTo(i + S, 0); g.stroke();
    }
    // medallions at lattice crossings
    const medallion = (x, y, r) => {
      g.save();
      g.translate(x, y);
      g.fillStyle = C.terra;
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath(); g.fill();
      g.fillStyle = C.ochre;
      g.beginPath(); g.arc(0, 0, r * 0.55, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.plum;
      for (let k = 0; k < 8; k++) {
        g.rotate(Math.PI / 4);
        g.beginPath(); g.ellipse(0, -r * 0.38, r * 0.08, r * 0.16, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = C.cream;
      g.beginPath(); g.arc(0, 0, r * 0.16, 0, Math.PI * 2); g.fill();
      g.restore();
    };
    for (let y = 0; y <= S; y += S / 2) for (let x = 0; x <= S; x += S / 2) medallion(x, y, S / 9);
    for (let y = S / 4; y < S; y += S / 2) for (let x = S / 4; x < S; x += S / 2) {
      g.fillStyle = C.ochre;
      g.beginPath(); g.arc(x, y, S / 40, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.cream; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, S / 22, 0, Math.PI * 2); g.stroke();
    }
    // pile: fine noise so it reads as carpet up close
    const img = g.getImageData(0, 0, S, S), d = img.data, r = rng(7);
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 34;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }, { repeat }));
}

/** Frosted daylight with blurred people walking past. */
function windowTexture(seed) {
  return cached(`win${seed}`, () => {
    const t = canvasTex(512, (g, S) => {
      const sky = g.createLinearGradient(0, 0, 0, S);
      sky.addColorStop(0, '#f6f8fb');
      sky.addColorStop(0.6, '#e4ebf2');
      sky.addColorStop(1, '#cfd6dc');
      g.fillStyle = sky;
      g.fillRect(0, 0, S, S);
      const r = rng(seed * 97 + 13);
      // People further from the glass: smaller, paler, blurrier. Draw them first.
      const people = Array.from({ length: 2 + Math.floor(r() * 4) }, () => ({ x: r() * S, depth: r() }))
        .sort((a, b) => b.depth - a.depth);
      for (const p of people) {
        g.filter = `blur(${4 + p.depth * 8}px)`;
        const h = S * (0.85 - p.depth * 0.3);
        person(g, p.x, S * 1.02, h, r, `rgba(52, 56, 64, ${0.75 - p.depth * 0.4})`);
      }
      g.filter = 'none';
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

// A soft, frosted-glass silhouette: head, shoulders, arms, coat, legs mid-stride.
function person(g, x, feet, height, r, colour) {
  const u = height / 10; // one "head unit" is ~1/8 of height; keep it simple
  const headR = u * 0.62;
  const neck = feet - height + headR * 2.1;
  const shoulderW = u * 2.1, hipW = u * 1.5;
  const hip = feet - height * 0.47;
  const stride = (r() - 0.5) * u * 1.6;
  g.fillStyle = colour;
  g.strokeStyle = colour;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // head
  g.beginPath();
  g.ellipse(x, feet - height + headR, headR * 0.85, headR, 0, 0, Math.PI * 2);
  g.fill();
  // torso / coat
  g.beginPath();
  g.moveTo(x - u * 0.35, neck - u * 0.1);
  g.quadraticCurveTo(x - shoulderW / 2, neck, x - shoulderW / 2, neck + u * 0.7);
  g.lineTo(x - hipW / 2 - u * 0.15, hip + u * 0.4);
  g.lineTo(x + hipW / 2 + u * 0.15, hip + u * 0.4);
  g.lineTo(x + shoulderW / 2, neck + u * 0.7);
  g.quadraticCurveTo(x + shoulderW / 2, neck, x + u * 0.35, neck - u * 0.1);
  g.closePath();
  g.fill();
  // arms, swinging opposite to the legs
  g.lineWidth = u * 0.55;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(x + side * shoulderW * 0.42, neck + u * 0.5);
    g.quadraticCurveTo(x + side * shoulderW * 0.55, neck + u * 2, x + side * shoulderW * 0.45 - side * stride * 0.5, hip + u * 0.3);
    g.stroke();
  }
  // legs
  g.lineWidth = u * 0.7;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(x + side * hipW * 0.25, hip);
    g.quadraticCurveTo(x + side * hipW * 0.25 + side * stride * 0.3, hip + (feet - hip) * 0.5, x + side * hipW * 0.2 + side * stride, feet);
    g.stroke();
  }
  if (r() < 0.35) { // a shoulder bag
    g.beginPath();
    g.ellipse(x + shoulderW * 0.6, hip - u * 0.2, u * 0.45, u * 0.6, 0, 0, Math.PI * 2);
    g.fill();
  }
}

/** Upholstery weave, used as both colour and bump map. */
function fabricTexture() {
  return cached('fabric', () => canvasTex(256, (g, S) => {
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, S, S);
    const r = rng(3);
    for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
      const v = 190 + ((x + y) % 4 === 0 ? 40 : 0) + r() * 25;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 2, 2);
    }
  }, { repeat: 6 }));
}

function brushedTexture() {
  return cached('brushed', () => canvasTex(512, (g, S) => {
    g.fillStyle = '#bfbfbf';
    g.fillRect(0, 0, S, S);
    const r = rng(11);
    for (let i = 0; i < 1400; i++) {
      const v = 150 + r() * 100;
      g.strokeStyle = `rgba(${v},${v},${v},0.35)`;
      g.lineWidth = r() * 1.5;
      const y = r() * S;
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (r() - 0.5) * 4); g.stroke();
    }
  }));
}

function blobTexture() {
  return cached('blob', () => {
    const t = canvasTex(128, (g, S) => {
      const grd = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
      grd.addColorStop(0, 'rgba(0,0,0,0.9)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }, { srgb: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
