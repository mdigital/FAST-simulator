// Copies what the content iframe is showing into something WebGL can texture.
//
// Modes:
//  - "canvas": the page is one full-screen <canvas> (a WebGL / 2D app). The
//    canvas itself becomes the texture source, live every frame.
//  - "dom": a regular web page. It is rasterised with html2canvas whenever it
//    changes (rate-limited), and any <video>/<canvas> elements are redrawn
//    live on top every frame.
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

    this.cctx.clearRect(0, 0, W, H);
    if (this.snapshot) this.cctx.drawImage(this.snapshot, 0, 0, W, H);
    this.drawLiveMedia(c);
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
      const bg = c.win.getComputedStyle(c.doc.body || c.doc.documentElement).backgroundColor;
      this.snapshot = await this.html2canvas(c.doc.documentElement, {
        width: W, height: H, windowWidth: W, windowHeight: H,
        x: c.win.scrollX, y: c.win.scrollY, scrollX: 0, scrollY: 0,
        scale: 1, useCORS: true, logging: false,
        backgroundColor: isTransparent(bg) ? '#ffffff' : bg
      });
    } catch (err) {
      console.warn('[fast-sim] DOM capture failed', err);
    } finally {
      this.busy = false;
    }
  }

  drawLiveMedia(c) {
    for (const el of c.doc.querySelectorAll('video, canvas')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < 0 || r.left > W || r.top > H) continue;
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

// A canvas covering (nearly) the whole 1920x1080 viewport with nothing else visible.
function mainCanvas(c) {
  const canvases = c.doc.getElementsByTagName('canvas');
  for (const el of canvases) {
    const r = el.getBoundingClientRect();
    if (r.left <= 2 && r.top <= 2 && r.width >= W - 4 && r.height >= H - 4) {
      const top = c.doc.elementFromPoint(W / 2, H / 2);
      const corner = c.doc.elementFromPoint(W - 10, 10);
      if ((top === el || top === null) && (corner === el || corner === null)) return el;
    }
  }
  return null;
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
