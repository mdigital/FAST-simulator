// Builds a Te Papa Object Investigation (FAST template A) from an
// investigation.config.json: fetches each object's record and image from the
// Te Papa Collections API and writes, next to the config:
//   objects.json   metadata + clues for the content page
//   layout.json    the table layout: a tray of pucks (one per object, with its
//                  image on top) and a target circle
//   images/<id>.jpg
//
//   TEPAPA_API_KEY=xxxx npm run investigation                       # the bird demo
//   TEPAPA_API_KEY=xxxx npm run investigation -- path/to/investigation.config.json
//
// Only images whose rights allow download are cached.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.resolve(process.argv[2] || path.join(ROOT, 'public/demo/tepapa-birds/investigation.config.json'));
const DIR = path.dirname(CONFIG);
const API = (process.env.TEPAPA_API_BASE || 'https://staging.co4-data.tepapa.govt.nz/api/v4').replace(/\/$/, '');
const KEY = process.env.TEPAPA_API_KEY;
if (!KEY) { console.error('Set TEPAPA_API_KEY first.'); process.exit(1); }

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
fs.mkdirSync(path.join(DIR, 'images'), { recursive: true });

const objects = [];
for (const entry of config.objects) {
  const res = await fetch(`${API}/object/${entry.id}`, { headers: { 'X-API-Key': KEY, Accept: 'application/json' } });
  if (!res.ok) { console.warn(`fail ${entry.id}: HTTP ${res.status}`); continue; }
  const obj = await res.json();
  const im = (obj.hasRepresentation || []).find((r) => r.type === 'ImageObject');
  if (!im?.rights?.allowsDownload) { console.warn(`skip ${entry.id}: image rights "${im?.rights?.title}" do not allow download`); continue; }
  const img = await fetch(im.previewUrl, { redirect: 'follow' });
  if (!img.ok) { console.warn(`fail ${entry.id}: image HTTP ${img.status}`); continue; }
  fs.writeFileSync(path.join(DIR, 'images', `${entry.id}.jpg`), Buffer.from(await img.arrayBuffer()));
  const p = obj.production?.[0];
  objects.push({
    ...entry,
    key: slug(entry.name),
    title: obj.title,
    maker: p?.contributor?.title ?? null,
    date: p?.verbatimCreatedDate ?? p?.createdDate ?? null,
    caption: obj.caption ?? null,
    creditLine: obj.creditLine ?? null,
    identifier: obj.identifier ?? null,
    rights: im.rights.title,
    image: `images/${entry.id}.jpg`,
    aspect: im.width && im.height ? +(im.width / im.height).toFixed(4) : 1,
    url: `https://collections.tepapa.govt.nz/object/${entry.id}`
  });
  console.log(`ok   ${entry.id} ${entry.name} — ${obj.title}`);
}

fs.writeFileSync(path.join(DIR, 'objects.json'), JSON.stringify({ title: config.title, subtitle: config.subtitle, fetched: new Date().toISOString(), objects }, null, 2) + '\n');

// The table: a tray of pucks along the near edge, and a target circle.
const layout = {
  name: config.title,
  pointer: 'none',
  tools: [
    { type: 'tray', id: 'tray', place: { edge: 'near', at: 0.42 }, length: Math.max(0.5, objects.length * 0.11) },
    { type: 'mark', id: 'target', place: { x: 1560, y: 860 }, radius: 0.06, arrow: true },
    ...objects.map((o, i) => ({ type: 'tangible', id: o.key, marker: i, label: o.name, image: o.image, color: '#efe7d6', home: 'tray', diameter: 0.08 }))
  ]
};
fs.writeFileSync(path.join(DIR, 'layout.json'), JSON.stringify(layout, null, 2) + '\n');
console.log(`\nWrote ${objects.length} objects to ${path.relative(ROOT, DIR)}/`);

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
