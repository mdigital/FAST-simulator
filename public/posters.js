// Posters from Te Papa's collection on the gallery walls, each with its
// rights statement underneath and a museum-style caption label beside it.
// Tapping one opens its Collections Online page.
//
// The content is cached in public/posters/ by scripts/fetch-posters.js;
// edit posters.config.json and re-run `npm run posters` to change it.

import * as THREE from 'three';
import { ROOM } from './room.js';

const BASE = new URL('./posters/', import.meta.url);
const HANG = 1.55; // centre height of a poster, metres (museum standard ~1.45-1.6)

export async function loadPosters() {
  try {
    const res = await fetch(new URL('posters.json', BASE));
    if (!res.ok) return [];
    return (await res.json()).posters || [];
  } catch {
    return [];
  }
}

/**
 * Hang posters on the room's solid walls (left, right, back). Returns the
 * meshes to make clickable; each has userData.poster.
 */
export function hangPosters(room, posters) {
  const group = new THREE.Group();
  room.add(group);
  const walls = [
    // position along each wall, room-local; rotation makes the poster face into the room
    { at: (t) => new THREE.Vector3(-ROOM.w / 2 + 0.03, 0, t), ry: Math.PI / 2 }, // left
    { at: (t) => new THREE.Vector3(ROOM.w / 2 - 0.03, 0, -t), ry: -Math.PI / 2 }, // right
    { at: (t) => new THREE.Vector3(-t, 0, ROOM.d / 2 - 0.03), ry: Math.PI } // back
  ];
  const perWall = Math.ceil(posters.length / walls.length);
  const spacing = Math.min(4, (ROOM.d - 4) / Math.max(1, perWall));
  const loader = new THREE.TextureLoader();
  const targets = [];

  posters.forEach((p, i) => {
    const wall = walls[Math.floor(i / perWall) % walls.length];
    const k = i % perWall;
    const t = (k - (perWall - 1) / 2) * spacing;
    const mount = new THREE.Group();
    mount.position.copy(wall.at(t));
    mount.rotation.y = wall.ry;
    group.add(mount);

    // Real size where Te Papa records it, otherwise ~1 m tall.
    let h = p.sizeMm ? p.sizeMm.height / 1000 : 1;
    let w = p.sizeMm ? p.sizeMm.width / 1000 : h * (p.aspect || 0.7);
    if (p.aspect && p.sizeMm) w = h * p.aspect; // trust the image's proportions
    const scale = Math.min(1, 1.6 / Math.max(w, h)); // keep huge ones wall-sized
    w *= scale; h *= scale;

    const tex = loader.load(new URL(p.image, BASE).href);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    // Picture-light wash on the wall behind, so posters read in the dim room.
    const wash = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 1.4, h + 1.6),
      new THREE.MeshBasicMaterial({ map: washTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    wash.position.set(0, HANG + 0.15, 0.002);

    // Thin black frame + the poster, lit as if by its own picture light.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.03), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }));
    frame.position.set(0, HANG, 0.015);
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.85 })
    );
    poster.position.set(0, HANG, 0.031);
    poster.userData = { poster: p };

    // Rights statement directly under the poster.
    const rights = textPlane(rightsLines(p), { width: Math.max(0.5, w), height: 0.06, size: 30, align: 'center', colour: '#e8e0d4' });
    rights.position.set(0, HANG - h / 2 - 0.07, 0.004);

    // Caption label to the right, at reading height.
    const label = textPlane(labelLines(p), { width: 0.34, height: 0.24, size: 28, card: true });
    label.position.set(w / 2 + 0.3, 1.3 - label.geometry.parameters.height / 2 + 0.12, 0.006);
    label.userData = { poster: p };

    mount.add(wash, frame, poster, rights, label);
    targets.push(poster, label);
  });
  return targets;
}

// "Poster, 'Rotorua'" -> "Rotorua"; "Chateau Tongariro poster" -> "Chateau Tongariro"
export function displayTitle(title = '') {
  return title.replace(/^poster,\s*/i, '').replace(/^['‘"]|['’"]$/g, '').replace(/\s+poster$/i, '').trim() || title;
}

function labelLines(p) {
  const lines = [{ text: displayTitle(p.title), font: '700 40px Georgia, serif', gap: 52 }];
  const who = [p.maker, p.date].filter(Boolean).join(', ');
  if (who) lines.push({ text: who, font: '30px system-ui, sans-serif', gap: 40 });
  if (p.place) lines.push({ text: p.place, font: '26px system-ui, sans-serif', gap: 36, colour: '#555' });
  if (p.medium) lines.push({ text: p.medium, font: 'italic 24px system-ui, sans-serif', gap: 36, colour: '#555' });
  lines.push({ gap: 14 });
  if (p.creditLine) lines.push({ text: p.creditLine, font: '22px system-ui, sans-serif', gap: 30, colour: '#555' });
  lines.push({ text: `Te Papa (${p.identifier ?? p.id})`, font: '22px system-ui, sans-serif', gap: 30, colour: '#555' });
  lines.push({ text: 'Tap to view in Collections Online ↗', font: '600 22px system-ui, sans-serif', gap: 30, colour: '#1d5fa8' });
  return lines;
}

function rightsLines(p) {
  return [{ text: p.rights || 'All Rights Reserved', font: '34px system-ui, sans-serif', gap: 42 }];
}

/** A plane with text drawn on a canvas; card = white museum label. */
function textPlane(lines, { width, height, size, align = 'left', card = false, colour = '#1a1a1a' }) {
  const pxPerM = 1600;
  const c = document.createElement('canvas');
  c.width = Math.round(width * pxPerM);
  const g = c.getContext('2d');
  const pad = card ? 36 : 0;
  if (card) {
    // grow the card to fit its text
    let need = pad * 2;
    for (const l of lines) {
      if (!l.text) { need += l.gap; continue; }
      g.font = l.font || `${size}px system-ui, sans-serif`;
      need += wrap(g, l.text, c.width - pad * 2).length * l.gap;
    }
    height = Math.max(height, need / pxPerM);
  }
  c.height = Math.round(height * pxPerM);
  g.fillStyle = card ? '#f4f1ea' : '#24211e'; // white label card, or a dark rights plaque
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = align;
  g.textBaseline = 'top';
  let y = card ? pad : (c.height - (lines[0]?.gap ?? size)) / 2;
  const x = align === 'center' ? c.width / 2 : pad;
  for (const l of lines) {
    if (l.text) {
      g.font = l.font || `${size}px system-ui, sans-serif`;
      g.fillStyle = l.colour || colour;
      for (const row of wrap(g, l.text, c.width - pad * 2)) {
        g.fillText(row, x, y);
        y += l.gap;
      }
    } else {
      y += l.gap;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // Unlit, so the text stays crisp and readable in the dim room.
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: card ? 0xe8e4dc : 0xffffff, toneMapped: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}

function wrap(g, text, max) {
  const words = text.split(/\s+/);
  const rows = [];
  let row = '';
  for (const w of words) {
    const t = row ? `${row} ${w}` : w;
    if (g.measureText(t).width > max && row) { rows.push(row); row = w; } else row = t;
  }
  if (row) rows.push(row);
  return rows;
}

let wash;
function washTexture() {
  if (wash) return wash;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 90, 8, 128, 122, 122); // fades out before the edges
  grd.addColorStop(0, 'rgba(255,236,205,0.9)');
  grd.addColorStop(1, 'rgba(255,236,205,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  wash = new THREE.CanvasTexture(c);
  return wash;
}
