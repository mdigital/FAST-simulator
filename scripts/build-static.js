// Builds a static copy of the simulator into ./dist for hosting without
// server.js (e.g. GitHub Pages). Content must then be hosted on the same
// origin as the simulator to get touch injection and the 3D/VR table.
//
//   dist/sim/   the simulator (open this)
//   dist/demo/  demo content (the default ?src=)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true });

fs.rmSync(dist, { recursive: true, force: true });
copy('public', 'sim');
copy('node_modules/three/build', 'sim/vendor/three/build');
copy('node_modules/three/examples/jsm', 'sim/vendor/three/examples/jsm');
copy('node_modules/html2canvas/dist', 'sim/vendor/html2canvas');
copy('demo', 'demo');
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><meta http-equiv="refresh" content="0; url=sim/">\n');
console.log(`Built ${path.relative(root, dist)}/ — open sim/index.html from a web server.`);
