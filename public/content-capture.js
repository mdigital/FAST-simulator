// Copies what the content iframe is showing into something WebGL can texture.
//
// Modes:
//  - "canvas": the page is one full-screen <canvas> (a WebGL / 2D app). The
//    canvas itself becomes the texture source, live every frame.
//  - "dom": a regular web page. It is rasterised with html2canvas whenever it
//    changes (rate-limited), and any <video>/<canvas> elements are redrawn
//    live every frame, in the right stacking order: media that other content
//    covers (e.g. an animated background canvas) goes under the snapshot,
//    media that is on top goes over it.
//  - "auto" (default): picks one of the above, re-checked every couple of seconds.

import { FAST } from './config.js';

const W = FAST.width, H = FAST.height;

export class ContentCapture {
  constructor(frame, { mode = 'auto', domFps = 8 } = {}) {
    this.frame = frame;
    this.requestedMode = mode;
    this.mode = null;
    this.minInterval = 1000 / domFps;
    this.composite = document.createElement('canvas');
    this.composite.width = W;
    this.composite.height = H;
    this.cctx = this.composite.getContext('2d');
    this.snapshot = null;
    this.busy = false;
    this.dirty = true;
    this.lastSnap = 0;
    this.lastModeCheck = 0;
    this.observer = null;
    this.observedDoc = null;
    this.html2canvas = null;
    this.media = { under: [], over: [] };
    this.lastClassify = 0;
    this.pageBg = '#ffffff';
    drawMessage(this.cctx, 'Loading…');
  }

  markDirty() {
    this.dirty = true;
  }

  ctx() {
    try {
      const win = this.frame.contentWindow;
      const doc = this.frame.contentDocument;
      if (!win || !doc || !doc.documentElement) return null;
      return { win, doc };
    } catch {
      return null;
    }
  }

  /**
   * Call once per rendered frame. Returns the element to use as the texture
   * image (a canvas) and whether it changed since the last call.
   */
  update(now) {
    const c = this.ctx();
    if (!c) {
      if (this.mode !== 'blocked') {
        this.mode = 'blocked';
        drawMessage(this.cctx,
          'This content is cross-origin, so it cannot be drawn on the 3D table.',
          'Serve it through the simulator: npx fast-sim --target <url>  (see README)');
      }
      return { image: this.composite, changed: this.mode === 'blocked' };
    }
    this.watch(c);

    if (now - this.lastClassify > 500) {
      this.lastClassify = now;
      const prevUnder = this.media.under.length;
      this.media = classifyMedia(c);
      if (this.media.under.length !== prevUnder) this.dirty = true;
    }

    if (now - this.lastModeCheck > 2000 || !this.mode || this.mode === 'blocked') {
      this.lastModeCheck = now;
      const prev = this.mode;
      this.mode = this.requestedMode === 'auto' ? detectMode(c) : this.requestedMode;
      if (this.mode !== prev) this.dirty = true;
    }

    if (this.mode === 'canvas') {
      const canvas = mainCanvas(c);
      if (canvas) return { image: canvas, changed: true };
      this.mode = 'dom';
    }

    if (c.doc.getAnimations && c.doc.getAnimations().some((a) => a.playState === 'running')) this.dirty = true;
    if (!this.busy && this.dirty && now - this.lastSnap > this.minInterval) this.snap(c);

    const g = this.cctx;
    g.fillStyle = this.pageBg;
    g.fillRect(0, 0, W, H);
    this.drawLive(c, this.media.under);
    if (this.snapshot) g.drawImage(this.snapshot, 0, 0, W, H);
    this.drawLive(c, this.media.over);
    return { image: this.composite, changed: true };
  }

  watch(c) {
    if (this.observedDoc === c.doc) return;
    this.observer?.disconnect();
    this.observedDoc = c.doc;
    this.snapshot = null;
    this.dirty = true;
    this.observer = new MutationObserver(() => { this.dirty = true; });
    this.observer.observe(c.doc, { subtree: true, childList: true, attributes: true, characterData: true });
    for (const t of ['load', 'scroll', 'input', 'transitionend', 'animationiteration']) {
      c.win.addEventListener(t, () => { this.dirty = true; }, true);
    }
  }

  async snap(c) {
    this.busy = true;
    this.dirty = false;
    this.lastSnap = performance.now();
    try {
      this.html2canvas ??= await loadHtml2canvas();
      const cs = (el) => el && c.win.getComputedStyle(el).backgroundColor;
      const bg = [cs(c.doc.body), cs(c.doc.documentElement)].find((b) => !isTransparent(b)) || '#ffffff';
      // With media underneath, the page background is painted by us first,
      // so the snapshot must be see-through where the media shows.
      const underlay = this.media.under.length > 0;
      this.pageBg = bg;
      const snapshot = await this.html2canvas(c.doc.documentElement, {
        width: W, height: H, windowWidth: W, windowHeight: H,
        x: c.win.scrollX, y: c.win.scrollY, scrollX: 0, scrollY: 0,
        scale: 1, useCORS: true, logging: false,
        backgroundColor: underlay ? null : bg,
        // Video and canvas are drawn live by drawLive().
        ignoreElements: (el) => el.tagName === 'VIDEO' || el.tagName === 'CANVAS',
        onclone: (doc) => {
          if (!underlay) return;
          for (const el of [doc.documentElement, doc.body]) if (el) el.style.setProperty('background', 'transparent', 'important');
        }
      });
      this.snapshot = snapshot;
    } catch (err) {
      console.warn('[fast-sim] DOM capture failed', err);
    } finally {
      this.busy = false;
    }
  }

  drawLive(c, list) {
    for (const el of list) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (el.tagName === 'VIDEO' && el.readyState < 2) continue;
      try {
        this.cctx.drawImage(el, r.left, r.top, r.width, r.height);
      } catch {
        // tainted / not ready
      }
    }
  }
}

function detectMode(c) {
  return mainCanvas(c) ? 'canvas' : 'dom';
}

// A canvas covering the whole 1920x1080 viewport with nothing at all on top of it.
function mainCanvas(c) {
  for (const el of c.doc.getElementsByTagName('canvas')) {
    const r = el.getBoundingClientRect();
    if (r.left > 2 || r.top > 2 || r.width < W - 4 || r.height < H - 4) continue;
    const pts = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) pts.push([(i + 0.5) * (W / 6), (j + 0.5) * (H / 4)]);
    if (withHitTesting(c, () => pts.every(([x, y]) => c.doc.elementFromPoint(x, y) === el))) return el;
  }
  return null;
}

/** Which visible videos/canvases are covered by other content, and which are on top. */
function classifyMedia(c) {
  const under = [], over = [];
  const els = [...c.doc.querySelectorAll('video, canvas')].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = c.win.getComputedStyle(el);
    return r.width >= 2 && r.height >= 2 && r.right > 0 && r.bottom > 0 && r.left < W && r.top < H &&
      cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0;
  });
  if (!els.length) return { under, over };
  withHitTesting(c, () => {
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const x0 = Math.max(0, r.left), x1 = Math.min(W, r.right), y0 = Math.max(0, r.top), y1 = Math.min(H, r.bottom);
      let hits = 0, n = 0;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const t = c.doc.elementFromPoint(x0 + ((i + 0.5) / 5) * (x1 - x0), y0 + ((j + 0.5) / 5) * (y1 - y0));
        n++;
        if (t === el || el.contains(t)) hits++;
      }
      (hits === n ? over : under).push(el);
    }
  });
  return { under, over };
}

// Hit-test everything, including pointer-events:none overlays, so stacking
// order (not clickability) decides what is on top.
function withHitTesting(c, fn) {
  const style = c.doc.createElement('style');
  style.textContent = '* { pointer-events: auto !important; }';
  (c.doc.head || c.doc.documentElement).appendChild(style);
  try {
    return fn();
  } finally {
    style.remove();
  }
}

function isTransparent(color) {
  return !color || color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color);
}

function drawMessage(ctx, ...lines) {
  ctx.fillStyle = '#1b1f24';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => {
    if (i === 1) ctx.font = '32px ui-monospace, monospace';
    ctx.fillText(l, W / 2, H / 2 - 30 + i * 70);
  });
}

let html2canvasPromise;
function loadHtml2canvas() {
  html2canvasPromise ??= new Promise((resolve, reject) => {
    if (window.html2canvas) return resolve(window.html2canvas);
    const s = document.createElement('script');
    s.src = new URL('./vendor/html2canvas/html2canvas.min.js', import.meta.url).href;
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('could not load html2canvas'));
    document.head.appendChild(s);
  });
  return html2canvasPromise;
}
