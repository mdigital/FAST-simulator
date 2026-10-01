// Tool layouts: which physical tools are on the table and where.
//
// A layout is JSON (or one of the preset names below):
//   {
//     "name": "…",
//     "pointer": "none" | "touch" | "native",
//     "tools": [ { "type": "buttons" | "dial" | "slider" | "toggle" | "tray"
//                        | "tangible" | "dice" | "mark", "id": "…", "place": {…}, … } ]
//   }
//
// pointer: what a mouse/finger on the projected image does. The FAST table
//   has no touch, so its presets use "none". "touch" simulates a touch table
//   and "native" passes the mouse straight to the page (for other web work).
//
// place: either on the image, in projection pixels  { "x": 960, "y": 540, "angle": 0 }
//        or on the rim along an edge                   { "edge": "near"|"far"|"left"|"right", "at": 0..1 }
//   "at" runs left to right as seen by someone standing at that edge.
//   Edge tools face outward, toward the visitor at that edge.

import { FAST } from './config.js';

export const SHAPES = {
  diamond: '#f2c12e',
  circle: '#e5484d',
  square: '#3e8ef7',
  triangle: '#30a46c'
};

const quizBox = (station, edge, at, keys) => ({
  type: 'buttons', id: `station${station}`, station, place: { edge, at },
  buttons: Object.entries(SHAPES).map(([shape, color], i) => ({ shape, color, key: keys[i] }))
});

export const PRESETS = {
  // Template A: Object Investigation
  objects: {
    name: 'Object Investigation',
    pointer: 'none',
    tools: [
      { type: 'tray', id: 'tray', place: { edge: 'near', at: 0.4 }, length: 0.7 },
      { type: 'mark', id: 'target', place: { x: 1560, y: 900 }, radius: 0.05, arrow: true },
      ...['Granite', 'Basalt', 'Obsidian', 'Sandstone', 'Limestone', 'Marble'].map((label, i) => ({
        type: 'tangible', id: label.toLowerCase(), marker: i, label,
        color: ['#c9b8a6', '#4b4b4f', '#1c1c22', '#d8a86c', '#e3dccb', '#f0eeea'][i], home: 'tray'
      })),
      {
        type: 'buttons', id: 'language', place: { edge: 'near', at: 0.9 },
        buttons: [{ shape: 'square', color: '#ffffff', key: 'l', label: 'EN/ES' }]
      }
    ]
  },

  // Template B: Quiz Show
  quiz: {
    name: 'Quiz Show',
    pointer: 'none',
    tools: [
      quizBox(1, 'near', 0.25, ['1', '2', '3', '4']),
      quizBox(2, 'near', 0.75, ['q', 'w', 'e', 'r']),
      quizBox(3, 'far', 0.25, ['a', 's', 'd', 'f']),
      quizBox(4, 'far', 0.75, ['z', 'x', 'c', 'v'])
    ]
  },

  // Template C: Node Exploration
  dial: {
    name: 'Node Exploration',
    pointer: 'none',
    tools: [
      { type: 'dial', id: 'dial', place: { edge: 'near', at: 0.5 }, detents: 12, keys: ['ArrowLeft', 'ArrowRight'] }
    ]
  },

  // One of everything, for experimenting.
  sandbox: {
    name: 'Sandbox',
    pointer: 'none',
    tools: [
      quizBox(1, 'near', 0.15, ['1', '2', '3', '4']),
      { type: 'dial', id: 'dial', place: { edge: 'near', at: 0.4 }, detents: 12, keys: ['ArrowLeft', 'ArrowRight'] },
      { type: 'slider', id: 'slider', place: { edge: 'near', at: 0.62 }, length: 0.2, steps: 0 },
      { type: 'toggle', id: 'toggle', place: { edge: 'near', at: 0.8 }, key: 't' },
      { type: 'tray', id: 'tray', place: { edge: 'right', at: 0.5 }, length: 0.5 },
      { type: 'tangible', id: 'puck-a', marker: 1, label: 'A', color: '#f2c12e', home: 'tray' },
      { type: 'tangible', id: 'puck-b', marker: 2, label: 'B', color: '#3e8ef7', home: 'tray' },
      { type: 'tangible', id: 'puck-c', marker: 3, label: 'C', color: '#30a46c', home: 'tray' },
      { type: 'tangible', id: 'window', marker: 10, kind: 'window', label: 'Magic window', place: { x: 1500, y: 300 } },
      { type: 'dice', id: 'die', marker: 20, place: { x: 1700, y: 600 } },
      { type: 'mark', id: 'target', place: { x: 960, y: 540 }, radius: 0.05 }
    ]
  },

  // Not FAST: a plain touch table, and a passthrough for mouse-driven web work.
  touch: { name: 'Touch table', pointer: 'touch', tools: [] },
  open: { name: 'Mouse', pointer: 'native', tools: [] }
};

/** A layout with no tools is a plain table: thin bezel, no projector. */
export function isPlain(layout) {
  return !layout.tools.length;
}
export const PLAIN_BORDER = 0.05; // metres of bezel around a plain touch table

export async function loadLayout(spec, base = location.href) {
  if (!spec) return normalize(PRESETS.sandbox);
  if (typeof spec === 'object') return normalize(spec);
  if (PRESETS[spec]) return normalize(PRESETS[spec]);
  const res = await fetch(new URL(spec, base));
  if (!res.ok) throw new Error(`Layout ${spec}: HTTP ${res.status}`);
  return normalize(await res.json());
}

function normalize(layout) {
  const l = structuredClone(layout);
  l.pointer ??= 'none';
  l.tools ??= [];
  // Hand out tray slots to tangibles that live in a tray.
  const trays = l.tools.filter((t) => t.type === 'tray');
  const homed = l.tools.filter((t) => (t.type === 'tangible' || t.type === 'dice') && t.home === 'tray');
  if (!trays.length) {
    homed.forEach((t, i) => { t.place = { x: 200 + i * 150, y: 900 }; });
    return l;
  }
  const perTray = trays.map(() => []);
  homed.forEach((t, i) => perTray[i % trays.length].push(t));
  perTray.forEach((items, ti) => items.forEach((t, k) => {
    t.place = { trayOf: trays[ti].id, slot: k, slots: items.length };
  }));
  return l;
}

/**
 * Where a tool sits, in table-local metres: x to the right and z toward the
 * near-side viewer, origin at the centre of the projected image. yaw turns the
 * tool's front (+z) toward its visitor.
 */
export function resolvePlace(place, layout) {
  const W = FAST.projW, D = FAST.projD;
  if (place.trayOf) {
    const tray = layout.tools.find((t) => t.id === place.trayOf);
    const len = tray.length ?? 0.6;
    const at = (place.slot + 0.5) / place.slots;
    const base = resolvePlace(tray.place, layout);
    const along = (at - 0.5) * len;
    return { x: base.x + Math.cos(base.yaw) * along, z: base.z - Math.sin(base.yaw) * along, yaw: 0, edge: true };
  }
  if (place.edge) {
    const at = place.at ?? 0.5;
    const off = place.offset ?? FAST.border / 2;
    switch (place.edge) {
      case 'far': return { x: (0.5 - at) * W, z: -(D / 2 + off), yaw: Math.PI, edge: true };
      case 'left': return { x: -(W / 2 + off), z: (at - 0.5) * D, yaw: -Math.PI / 2, edge: true };
      case 'right': return { x: W / 2 + off, z: (0.5 - at) * D, yaw: Math.PI / 2, edge: true };
      default: return { x: (at - 0.5) * W, z: D / 2 + off, yaw: 0, edge: true };
    }
  }
  return {
    x: ((place.x ?? FAST.width / 2) / FAST.width - 0.5) * W,
    z: ((place.y ?? FAST.height / 2) / FAST.height - 0.5) * D,
    yaw: -((place.angle ?? 0) * Math.PI) / 180,
    edge: false
  };
}

/** Table-local metres -> projection pixels (may be outside 0..1920 / 0..1080). */
export function toPx(x, z) {
  return { x: (x / FAST.projW + 0.5) * FAST.width, y: (z / FAST.projD + 0.5) * FAST.height };
}
