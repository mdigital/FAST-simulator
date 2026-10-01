#!/usr/bin/env node
// FAST simulator dev server.
//
//   /__fastsim/...   the simulator itself (and its demos)
//   everything else  your content: a reverse proxy to --target, or a local
//                    folder (--content)
//
// Serving the content from the same origin as the simulator is what lets it
// inject touch events and draw the page onto the 3D table. HTML responses get
// a small shim script injected so it runs before the content's own scripts.
//
// HTTPS is on by default (WebXR on the Quest requires a secure origin); a
// self-signed certificate is generated with openssl into ./.cert.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = '/__fastsim/';
const SHIM_TAG = `<script src="${PREFIX}shim.js"></script>`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: fast-sim [options]

  --target <url>    proxy this site/dev server as the table content
                    (e.g. http://localhost:5173)
  --content <dir>   serve a local folder as the content
  --port <n>        port (default 8443, or 8080 with --http)
  --host <addr>     interface to listen on (default 0.0.0.0)
  --http            plain HTTP instead of HTTPS`);
  process.exit(0);
}

const useTls = !args.http;
const port = Number(args.port) || (useTls ? 8443 : 8080);
const host = args.host || '0.0.0.0';
const target = args.target ? new URL(args.target) : null;
const contentDir = args.content ? path.resolve(args.content) : null;

const STATIC_MOUNTS = [
  [`${PREFIX}vendor/three/`, path.join(ROOT, 'node_modules/three/')],
  [`${PREFIX}vendor/html2canvas/`, path.join(ROOT, 'node_modules/html2canvas/dist/')],
  [PREFIX, path.join(ROOT, 'public/')]
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__fastsim') return redirect(res, PREFIX);
  for (const [mount, dir] of STATIC_MOUNTS) {
    if (url.pathname.startsWith(mount)) {
      // Demo pages get the shim like any other content.
      const inject = url.pathname.startsWith(`${PREFIX}demo/`);
      return serveFile(req, res, dir, decodeURIComponent(url.pathname.slice(mount.length)), inject);
    }
  }
  if (target) return proxy(req, res);
  if (!contentDir) return url.pathname === '/' ? redirect(res, PREFIX) : send(res, 404, 'Not found');
  return serveFile(req, res, contentDir, decodeURIComponent(url.pathname.slice(1)), true);
}

function serveFile(req, res, dir, rel, inject) {
  const base = path.resolve(dir);
  let file = path.resolve(base, rel);
  if (file !== base && !file.startsWith(base + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!req.url.split('?')[0].endsWith('/')) return redirect(res, req.url.replace(/^([^?]*)/, '$1/'));
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (err2, data) => {
      if (err2) return send(res, 404, `Not found: ${rel}`);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      if (inject && type.startsWith('text/html')) data = injectShim(data.toString('utf8'));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(data);
    });
  });
}

function proxy(req, res) {
  const isHtmlNav = /text\/html/.test(req.headers.accept || '');
  const headers = { ...req.headers, host: target.host };
  if (headers.origin) headers.origin = target.origin;
  if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, target.origin);
  if (isHtmlNav) headers['accept-encoding'] = 'identity';
  const mod = target.protocol === 'https:' ? https : http;
  const up = mod.request({
    protocol: target.protocol, hostname: target.hostname, port: target.port || undefined,
    method: req.method, path: req.url, headers
  }, (upRes) => {
    const h = { ...upRes.headers };
    // Allow framing by the simulator.
    delete h['x-frame-options'];
    delete h['content-security-policy'];
    delete h['content-security-policy-report-only'];
    if (h.location) h.location = h.location.replace(target.origin, '');
    if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].map((c) => c.replace(/;\s*domain=[^;]+/i, ''));
    const type = h['content-type'] || '';
    if (type.includes('text/html') && !h['content-encoding']) {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        const body = injectShim(Buffer.concat(chunks).toString('utf8'));
        delete h['content-length'];
        delete h['transfer-encoding'];
        res.writeHead(upRes.statusCode, h);
        res.end(body);
      });
    } else {
      res.writeHead(upRes.statusCode, h);
      upRes.pipe(res);
    }
  });
  up.on('error', (err) => send(res, 502, `Proxy error contacting ${target.origin}: ${err.message}`));
  req.pipe(up);
}

// WebSocket pass-through (e.g. Vite / webpack hot reload).
function proxyUpgrade(req, socket, head) {
  if (!target) return socket.destroy();
  const secure = target.protocol === 'https:';
  const tport = Number(target.port) || (secure ? 443 : 80);
  const upstream = secure
    ? tls.connect({ host: target.hostname, port: tport, servername: target.hostname })
    : net.connect({ host: target.hostname, port: tport });
  upstream.once(secure ? 'secureConnect' : 'connect', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      const v = /^host$/i.test(k) ? target.host : /^origin$/i.test(k) ? target.origin : req.rawHeaders[i + 1];
      lines.push(`${k}: ${v}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

function injectShim(html) {
  if (html.includes(SHIM_TAG)) return html;
  const m = html.match(/<head[^>]*>/i);
  if (m) return html.replace(m[0], `${m[0]}${SHIM_TAG}`);
  return SHIM_TAG + html;
}

function send(res, code, text) {
  if (res.headersSent) return res.end();
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function redirect(res, loc) {
  res.writeHead(302, { location: loc });
  res.end();
}

function ensureCert() {
  const dir = path.join(ROOT, '.cert');
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanAddresses().map((a) => `IP:${a}`)].join(',');
    try {
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
        '-keyout', key, '-out', cert, '-subj', '/CN=FAST simulator', '-addext', `subjectAltName=${san}`
      ], { stdio: 'ignore' });
    } catch {
      console.error('Could not create a certificate with openssl. Install openssl, or run with --http\n' +
        '(then use `adb reverse tcp:8080 tcp:8080` and http://localhost:8080 on the headset).');
      process.exit(1);
    }
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (list[i + 1] && !list[i + 1].startsWith('--')) out[k] = list[++i];
      else out[k] = true;
    }
  }
  return out;
}

const server = useTls ? https.createServer(ensureCert(), handle) : http.createServer(handle);
server.on('upgrade', proxyUpgrade);
server.listen(port, host, () => {
  const scheme = useTls ? 'https' : 'http';
  const content = target ? target.origin : contentDir;
  const query = content ? '?src=/' : '';
  console.log(`FAST simulator running.${content ? ` Your content: ${content}` : ' Showing the demos.'}\n`);
  console.log(`  This machine:  ${scheme}://localhost:${port}${PREFIX}${query}`);
  for (const a of lanAddresses()) console.log(`  Quest / LAN:   ${scheme}://${a}:${port}${PREFIX}${query}`);
  if (useTls) console.log('\n  The certificate is self-signed: accept the browser warning once per device.');
});
