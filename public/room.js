// The gallery around the table: a patterned museum carpet, a floor-to-ceiling
// glass wall looking out over a grassy square with a concrete path under a
// blue sky, and the two furniture styles: a table on legs with fabric
// stools, or a steel plinth.
// Everything is procedural (geometry + canvas textures): nothing to download.

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

export const ROOM = { w: 20, d: 20, h: 4.2 };

// ------------------------------------------------------------------ room

/**
 * The room. (cx, cz) is its centre; the glass wall is the far (-z) wall,
 * so put the centre behind the table to have the view in front of it.
 */
export function buildRoom(cx, cz) {
  const room = new THREE.Group();
  room.position.set(cx, 0, cz);

  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: carpetTexture(ROOM.w / 2.5), color: 0x8f8984, roughness: 1 })
  );
  room.add(carpet);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x847b70, roughness: 0.95 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x5a3b28, roughness: 0.6 });
  // Solid walls on three sides; the far wall is glass.
  for (const w of [
    { x: -ROOM.w / 2, z: 0, ry: Math.PI / 2, len: ROOM.d },
    { x: ROOM.w / 2, z: 0, ry: -Math.PI / 2, len: ROOM.d },
    { x: 0, z: ROOM.d / 2, ry: Math.PI, len: ROOM.w }
  ]) {
    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.ry;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w.len, ROOM.h), wallMat);
    wall.position.y = ROOM.h / 2;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(w.len, 0.12, 0.02), skirtMat);
    skirt.position.set(0, 0.06, 0.01);
    g.add(wall, skirt);
    room.add(g);
  }

  const glassWall = buildGlassWall(ROOM.w, ROOM.h);
  glassWall.position.z = -ROOM.d / 2;
  room.add(glassWall);

  const outside = buildOutside();
  outside.position.z = -ROOM.d / 2;
  room.add(outside);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 1 })
  );
  ceiling.position.y = ROOM.h;
  room.add(ceiling);

  // A dim gallery: the daylight comes in through the glass wall (an area
  // light the size of the wall, plus a soft pool on the carpet), and the
  // table has its own spotlight (in table-scene.js).
  RectAreaLightUniformsLib.init();
  const windowLight = new THREE.RectAreaLight(0xdcebff, 0.7, ROOM.w, ROOM.h);
  windowLight.position.set(0, ROOM.h / 2, -ROOM.d / 2 + 0.05);
  windowLight.lookAt(0, ROOM.h / 2, 0);
  const hemi = new THREE.HemisphereLight(0x9fb4cc, 0x2a1c16, 0.18);
  room.add(windowLight, hemi, buildDaylightPool(ROOM.w));
  return room;
}

/** Floor-to-ceiling glazing: slim vertical mullions only, head and sill channels. */
function buildGlassWall(width, height) {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.6, roughness: 0.4 });
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshPhysicalMaterial({ color: 0xdfeef5, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, depthWrite: false })
  );
  glass.position.y = height / 2;
  g.add(glass);
  const bays = Math.round(width / 1.6);
  for (let i = 0; i <= bays; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, height, 0.12), frame);
    m.position.set(-width / 2 + (i * width) / bays, height / 2, 0);
    g.add(m);
  }
  for (const y of [0.04, height - 0.05]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, y < 1 ? 0.08 : 0.1, 0.14), frame);
    bar.position.y = y;
    g.add(bar);
  }
  return g;
}

/** Daylight falling on the carpet inside the glass, striped by the mullions. */
function buildDaylightPool(width) {
  const depth = 7;
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: daylightTexture(Math.round(width / 1.6)), color: 0xcfe2ff, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    })
  );
  pool.position.set(0, 0.004, -ROOM.d / 2 + depth / 2);
  return pool;
}

/** Outside the glass (built toward -z): grassy square, concrete path, trees, sky. */
function buildOutside() {
  const g = new THREE.Group();
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 120).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 })
  );
  grass.position.set(0, -0.02, -60);
  g.add(grass);

  // A paved strip along the building, then the path crossing the square.
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(160, 2.5).rotateX(-Math.PI / 2), concrete);
  apron.position.set(0, -0.01, -1.25);
  const pathMat = concrete.clone();
  pathMat.map = concreteTexture(2.5, 70);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 70).rotateX(-Math.PI / 2), pathMat);
  path.position.set(0, -0.005, -36);
  path.rotation.y = 0.5; // cuts diagonally across the square
  const crossMat = concrete.clone();
  crossMat.map = concreteTexture(2.2, 120);
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 120).rotateX(-Math.PI / 2), crossMat);
  cross.rotation.y = Math.PI / 2;
  cross.position.set(0, -0.006, -22);
  g.add(apron, path, cross);

  // Trees around the square.
  const r = rng(42);
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
  const leaves = [0x3f7d3a, 0x4f8f3f, 0x386b34].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 8);
  for (let i = 0; i < 26; i++) {
    const x = (r() - 0.5) * 70, z = -10 - r() * 50;
    if (Math.abs(z + 22) < 2.5 || Math.abs(x - (z + 36) * Math.tan(0.5)) < 3) continue; // keep the paths clear
    const s = 0.8 + r() * 0.9;
    const t = new THREE.Mesh(trunkGeo, trunk);
    t.scale.set(s, 2.2 * s, s);
    t.position.set(x, 1.1 * s, z);
    const c = new THREE.Mesh(canopyGeo, leaves[i % 3]);
    c.scale.set(1.8 * s, 1.6 * s, 1.8 * s);
    c.position.set(x, 2.2 * s + 1.2 * s, z);
    g.add(t, c);
  }

  // Sky dome: deep blue overhead fading to pale at the horizon.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x2f6fd6) }, horizon: { value: new THREE.Color(0xcfe6fb) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }'
    })
  );
  sky.position.set(0, 0, -30);
  g.add(sky);
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

/** Where the stools start, relative to the table centre: room at the front-centre to stand. */
export function stoolSpots(TW, TD) {
  const gap = 0.38; // stool centre to table edge
  const near = TD / 2 + gap, side = TW / 2 + gap;
  return [
    [-0.33 * TW, near], [0.33 * TW, near],
    [-0.3 * TW, -near], [0, -near], [0.3 * TW, -near],
    [-side, 0], [side, 0]
  ];
}

export const STOOL = { r: 0.2, h: 0.45 };

/** An upholstered cylinder stool; its origin is the bottom centre. */
export function buildStool(colour, { r = STOOL.r, h = STOOL.h, shadow = true } = {}) {
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
  g.add(body, seam);
  if (shadow) g.add(shadowBlob(r * 2.6, r * 2.6, 0.5));
  return g;
}

/** Soft fake contact shadow on the floor. */
export function shadowBlob(w, d, opacity) {
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

function daylightTexture(bays) {
  return cached(`daylight${bays}`, () => {
    const t = canvasTex(512, (g, S) => {
      // fades from the glass (top of the texture) into the room
      const fade = g.createLinearGradient(0, 0, 0, S);
      fade.addColorStop(0, 'rgba(255,255,255,1)');
      fade.addColorStop(0.35, 'rgba(255,255,255,.55)');
      fade.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = fade;
      g.fillRect(0, 0, S, S);
      // mullion shadows, slightly slanted as the sun is off to one side
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,.85)';
      for (let i = 0; i <= bays; i++) {
        const x = (i / bays) * S;
        g.beginPath();
        g.moveTo(x - 2, 0); g.lineTo(x + 2, 0); g.lineTo(x + 40, S); g.lineTo(x + 30, S);
        g.fill();
      }
    }, { srgb: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

function grassTexture() {
  return cached('grass', () => canvasTex(512, (g, S) => {
    g.fillStyle = '#5f8f3e';
    g.fillRect(0, 0, S, S);
    const r = rng(5);
    for (let i = 0; i < 9000; i++) {
      const v = r();
      g.fillStyle = v < 0.5 ? 'rgba(80,130,50,.5)' : v < 0.85 ? 'rgba(120,165,70,.45)' : 'rgba(60,100,40,.5)';
      g.fillRect(r() * S, r() * S, 2, 3 + r() * 4);
    }
  }, { repeat: 60 }));
}

/** Concrete paving: speckled grey with joints every slab. */
function concreteTexture(width = 160, length = 2.5) {
  return cached(`concrete${width}x${length}`, () => {
    const t = canvasTex(256, (g, S) => {
      g.fillStyle = '#b9b6ae';
      g.fillRect(0, 0, S, S);
      const r = rng(9);
      for (let i = 0; i < 4000; i++) {
        const v = 150 + r() * 70;
        g.fillStyle = `rgba(${v},${v},${v - 6},.5)`;
        g.fillRect(r() * S, r() * S, 1.5, 1.5);
      }
      g.strokeStyle = 'rgba(70,70,66,.7)';
      g.lineWidth = 3;
      g.strokeRect(0, 0, S, S);
    });
    // one texture tile per ~1.25 m slab
    t.repeat.set(Math.max(1, width / 1.25), Math.max(1, length / 1.25));
    return t;
  });
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
