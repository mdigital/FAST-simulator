// Fetches the posters for the gallery walls from the Te Papa Collections API
// and caches them in public/posters/ (images + posters.json), so the
// simulator never calls the API at runtime and needs no key.
//
//   TEPAPA_API_KEY=xxxx npm run posters                     # (re)build the cache from posters.config.json
//   TEPAPA_API_KEY=xxxx npm run posters -- --search "railways poster"   # find ids to add
//
// TEPAPA_API_BASE overrides the API (default: the v4 staging API).
// Only images whose rights allow download are cached; others are skipped.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/posters');
const CONFIG = path.join(ROOT, 'posters.config.json');
const API = (process.env.TEPAPA_API_BASE || 'https://staging.co4-data.tepapa.govt.nz/api/v4').replace(/\/$/, '');
const KEY = process.env.TEPAPA_API_KEY;

if (!KEY) {
  console.error('Set TEPAPA_API_KEY (your Te Papa Collections API key) first.');
  process.exit(1);
}

const headers = { 'X-API-Key': KEY, Accept: 'application/json' };

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const imageOf = (obj) => (obj.hasRepresentation || []).find((r) => r.type === 'ImageObject');

async function search(query) {
  const r = await api('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query, size: 40,
      filters: [{ field: 'type', keyword: 'Object' }, { field: 'hasRepresentation.rights.allowsDownload', keyword: 'true' }]
    })
  });
  for (const o of r.results || []) {
    const im = imageOf(o);
    const p = o.production?.[0];
    console.log(`${String(o.id).padEnd(8)} ${o.title}  —  ${p?.contributor?.title ?? '?'}, ${p?.verbatimCreatedDate ?? p?.createdDate ?? '?'}  [${im?.rights?.title ?? 'no image'}]`);
  }
  console.log(`\n${r._metadata?.resultset?.count ?? 0} matches. Add ids to posters.config.json, then run npm run posters.`);
}

// Who made it: prefer artists/designers over publishers and printers.
function maker(production = []) {
  const rank = (role = '') => (/artist|designer|illustrator|attributed/i.test(role) ? 0 : /publisher|commissioned/i.test(role) ? 1 : 2);
  const sorted = [...production].filter((p) => p.contributor?.title).sort((a, b) => rank(a.role) - rank(b.role));
  return sorted[0]?.contributor?.title ?? null;
}

function sizeMm(obj) {
  const d = (obj.observedDimension || []).find((m) => m.extentType === 'Overall') || obj.observedDimension?.[0];
  if (!d || d.sizeUnitText !== 'mm') return null;
  const w = d.width ?? d.length, h = d.height;
  return w && h ? { width: w, height: h } : null;
}

async function build() {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const posters = [];
  for (const entry of config.posters) {
    const override = typeof entry === 'object' ? entry : { id: entry };
    const id = override.id;
    try {
      const obj = await api(`/object/${id}`);
      const im = imageOf(obj);
      if (!im) { console.warn(`skip ${id}: no image`); continue; }
      if (!im.rights?.allowsDownload) { console.warn(`skip ${id}: image rights "${im.rights?.title}" do not allow download`); continue; }

      const file = `${id}.jpg`;
      const img = await fetch(im.previewUrl, { redirect: 'follow' });
      if (!img.ok) throw new Error(`image HTTP ${img.status}`);
      fs.writeFileSync(path.join(OUT, file), Buffer.from(await img.arrayBuffer()));

      const p = obj.production?.[0];
      posters.push({
        id,
        title: obj.title,
        maker: maker(obj.production),
        date: p?.verbatimCreatedDate ?? p?.createdDate ?? null,
        place: p?.spatial?.title ?? null,
        medium: (obj.isMadeOf || []).map((m) => m.title).join(', ') || null,
        creditLine: obj.creditLine ?? null,
        identifier: obj.identifier ?? null,
        caption: obj.caption ?? null,
        rights: im.rights.title,
        image: file,
        aspect: im.width && im.height ? +(im.width / im.height).toFixed(4) : null,
        sizeMm: sizeMm(obj),
        url: `https://collections.tepapa.govt.nz/object/${id}`,
        ...override
      });
      console.log(`ok   ${id} ${obj.title}`);
    } catch (err) {
      console.warn(`fail ${id}: ${err.message}`);
    }
  }
  // Remove cached images no longer in the list.
  const keep = new Set(posters.map((p) => p.image));
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.jpg') && !keep.has(f)) fs.unlinkSync(path.join(OUT, f));

  fs.writeFileSync(path.join(OUT, 'posters.json'), JSON.stringify({
    source: 'Te Papa Collections API',
    fetched: new Date().toISOString(),
    posters
  }, null, 2) + '\n');
  console.log(`\nCached ${posters.length} posters in ${path.relative(ROOT, OUT)}/`);
}

const i = process.argv.indexOf('--search');
if (i > -1) await search(process.argv.slice(i + 1).join(' ') || 'poster');
else await build();
