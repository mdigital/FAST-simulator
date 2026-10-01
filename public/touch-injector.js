// Turns simulated finger contacts into the events a real touch table produces
// inside the content page: pointer events (pointerType "touch"), touch events,
// and, for a tap, the compatibility mouse events and click.
//
// Requires the content iframe to be same-origin with the simulator.

const TAP_SLOP = 15; // px a finger may drift and still count as a tap
const POINTER_ID_BASE = 1000; // must match shim.js

export class TouchInjector {
  constructor(frame) {
    this.frame = frame;
    this.active = new Map(); // id -> contact
    this.listeners = new Set();
  }

  /** Called with (type, contact) after each injected down/move/up. */
  onContact(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  ctx() {
    try {
      const win = this.frame.contentWindow;
      const doc = this.frame.contentDocument;
      if (!win || !doc || !doc.documentElement) return null;
      return { win, doc };
    } catch {
      return null; // cross-origin
    }
  }

  available() {
    return !!this.ctx();
  }

  down(key, x, y) {
    const c = this.ctx();
    if (!c || this.active.has(key)) return;
    const id = POINTER_ID_BASE + nextPointerSlot(this.active);
    const target = c.doc.elementFromPoint(x, y) || c.doc.body || c.doc.documentElement;
    const p = {
      key, id, x, y, sx: x, sy: y,
      primary: this.active.size === 0,
      target, moved: false, touchPrevented: false, scroller: null, scrolling: false
    };
    this.active.set(key, p);

    this.firePointer(c, 'pointerover', p, target);
    this.firePointer(c, 'pointerenter', p, target, { bubbles: false, cancelable: false });
    const pd = this.firePointer(c, 'pointerdown', p, target);
    const ts = this.fireTouch(c, 'touchstart', p);
    p.touchPrevented = pd.defaultPrevented || ts;
    if (!p.touchPrevented && p.primary) p.scroller = findScroller(c, target);
    this.emit('down', p);
  }

  move(key, x, y) {
    const p = this.active.get(key);
    const c = this.ctx();
    if (!p || !c) return;
    const dx = x - p.x, dy = y - p.y;
    if (dx === 0 && dy === 0) return;
    p.x = x; p.y = y;
    if (!p.moved && Math.hypot(x - p.sx, y - p.sy) > TAP_SLOP) p.moved = true;

    if (p.scrolling) {
      // While the browser scrolls, touch events continue but pointer events don't.
      p.scroller.scrollBy(-dx, -dy);
      this.fireTouch(c, 'touchmove', p);
      this.emit('move', p);
      return;
    }
    this.firePointer(c, 'pointermove', p, this.pointerTarget(c, p), { button: -1 });
    const tm = this.fireTouch(c, 'touchmove', p);
    if (tm) p.touchPrevented = true;
    // Native touch scrolling: once a drag starts on a scrollable area whose
    // touch handlers did not cancel it, the browser takes over and sends
    // pointercancel to the page.
    if (p.moved && p.scroller && !p.touchPrevented) {
      p.scrolling = true;
      this.firePointer(c, 'pointercancel', p, this.pointerTarget(c, p), { cancelable: false });
      p.scroller.scrollBy(-(x - p.sx), -(y - p.sy));
    }
    this.emit('move', p);
  }

  up(key) {
    const p = this.active.get(key);
    if (!p) return;
    const c = this.ctx();
    if (!c) { this.active.delete(key); return; }
    const target = this.pointerTarget(c, p);
    if (!p.scrolling) {
      this.firePointer(c, 'pointerup', p, target, { buttons: 0 });
    }
    this.firePointer(c, 'pointerout', p, target, { buttons: 0 });
    this.firePointer(c, 'pointerleave', p, target, { buttons: 0, bubbles: false, cancelable: false });
    this.active.delete(key);
    c.win.__fastsim?.capture.delete(p.id);
    const te = this.fireTouch(c, 'touchend', p);

    if (p.primary && !p.moved && !p.scrolling && !te && !p.touchPrevented) {
      // A tap: browsers follow it with compatibility mouse events and a click.
      const hit = c.doc.elementFromPoint(p.x, p.y) || target;
      for (const type of ['mouseover', 'mousemove', 'mousedown']) this.fireMouse(c, type, p, hit, type === 'mousedown' ? 1 : 0);
      focusFor(hit);
      this.fireMouse(c, 'mouseup', p, hit, 0);
      this.fireMouse(c, 'click', p, hit, 0);
    }
    this.emit('up', p);
  }

  cancelAll() {
    for (const key of [...this.active.keys()]) this.up(key);
  }

  emit(type, p) {
    for (const fn of this.listeners) fn(type, p);
  }

  pointerTarget(c, p) {
    // Touch pointers are implicitly captured to the pointerdown target,
    // unless the page captured them somewhere else.
    const captured = c.win.__fastsim?.capture.get(p.id);
    if (captured && captured.isConnected) return captured;
    return p.target.isConnected ? p.target : c.doc.documentElement;
  }

  firePointer(c, type, p, target, extra = {}) {
    const down = type !== 'pointerup' && type !== 'pointerout' && type !== 'pointerleave' && type !== 'pointercancel';
    const ev = new c.win.PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: c.win,
      pointerId: p.id, pointerType: 'touch', isPrimary: p.primary,
      clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
      width: 20, height: 20, pressure: down ? 0.5 : 0,
      button: 0, buttons: down ? 1 : 0,
      ...extra
    });
    target.dispatchEvent(ev);
    return ev;
  }

  fireMouse(c, type, p, target, buttons) {
    const ev = new c.win.MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: c.win,
      clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
      button: 0, buttons, detail: type === 'click' || type === 'mousedown' || type === 'mouseup' ? 1 : 0
    });
    target.dispatchEvent(ev);
  }

  // Returns true if the page called preventDefault().
  fireTouch(c, type, p) {
    const { win } = c;
    if (typeof win.Touch !== 'function' || typeof win.TouchEvent !== 'function') return false;
    const mk = (q) => new win.Touch({
      identifier: q.id, target: q.target,
      clientX: q.x, clientY: q.y, pageX: q.x + win.scrollX, pageY: q.y + win.scrollY,
      screenX: q.x, screenY: q.y, radiusX: 10, radiusY: 10, force: 0.5
    });
    const ending = type === 'touchend';
    const live = [...this.active.values()];
    const touches = live.map(mk);
    const changed = mk(p);
    const targetTouches = live.filter((q) => q.target === p.target).map(mk);
    if (!ending && !touches.some((t) => t.identifier === p.id)) return false;
    const ev = new win.TouchEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: win,
      touches, targetTouches, changedTouches: [changed]
    });
    (p.target.isConnected ? p.target : c.doc.documentElement).dispatchEvent(ev);
    return ev.defaultPrevented;
  }
}

function nextPointerSlot(active) {
  const used = new Set([...active.values()].map((p) => p.id - POINTER_ID_BASE));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

function focusFor(el) {
  const focusable = el.closest?.('input, textarea, select, button, a[href], [tabindex], [contenteditable=""], [contenteditable="true"]');
  if (focusable) focusable.focus({ preventScroll: true });
  else el.ownerDocument.activeElement?.blur?.();
}

// The nearest ancestor that can scroll and allows touch panning.
function findScroller(c, el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = c.win.getComputedStyle(n);
    if (cs.touchAction === 'none' || cs.touchAction === 'pinch-zoom') return null;
    const canY = /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight;
    const canX = /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth;
    if (canX || canY) return n;
  }
  const root = c.doc.scrollingElement;
  if (root && (root.scrollHeight > c.win.innerHeight || root.scrollWidth > c.win.innerWidth)) return root;
  return null;
}
