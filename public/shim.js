// Runs inside the content page (the thing shown on the table).
//
// The dev server injects it at the top of every proxied HTML page so it runs
// before the content's own scripts; the simulator also installs it after the
// iframe loads, as a fallback for static hosting. It is idempotent.
//
// What it does:
//  - Lets the simulator drive requestAnimationFrame. While a WebXR session is
//    running, the 2D page's rAF is paused on Quest, which would freeze the
//    content. Each rAF callback is registered both natively and in a queue the
//    simulator can flush from its XR frame loop; whichever fires first wins.
//  - Makes setPointerCapture work for the synthetic touch pointers the
//    simulator injects (ids >= 1000), which the browser would otherwise reject.
//  - Forces preserveDrawingBuffer on WebGL canvases so the simulator can copy
//    them onto the 3D table.
(function () {
  if (window.__fastsim) return;

  var SYNTHETIC_ID_BASE = 1000;
  var nativeRAF = window.requestAnimationFrame.bind(window);
  var nativeCAF = window.cancelAnimationFrame.bind(window);
  var queue = new Map();
  var nextId = 1;

  window.requestAnimationFrame = function (cb) {
    var id = nextId++;
    var entry = { cb: cb, nativeId: 0 };
    entry.nativeId = nativeRAF(function (t) {
      if (queue.get(id) !== entry) return;
      queue.delete(id);
      cb(t);
    });
    queue.set(id, entry);
    return id;
  };

  window.cancelAnimationFrame = function (id) {
    var entry = queue.get(id);
    if (!entry) return;
    queue.delete(id);
    nativeCAF(entry.nativeId);
  };

  function tick() {
    if (!queue.size) return;
    var t = performance.now();
    var entries = Array.from(queue.values());
    queue.clear();
    for (var i = 0; i < entries.length; i++) {
      nativeCAF(entries[i].nativeId);
      try {
        entries[i].cb(t);
      } catch (err) {
        setTimeout(function () { throw err; });
      }
    }
  }

  var capture = new Map();
  var proto = Element.prototype;
  var origSet = proto.setPointerCapture;
  var origRelease = proto.releasePointerCapture;
  var origHas = proto.hasPointerCapture;
  proto.setPointerCapture = function (id) {
    if (id >= SYNTHETIC_ID_BASE) { capture.set(id, this); return; }
    return origSet.call(this, id);
  };
  proto.releasePointerCapture = function (id) {
    if (id >= SYNTHETIC_ID_BASE) { if (capture.get(id) === this) capture.delete(id); return; }
    return origRelease.call(this, id);
  };
  proto.hasPointerCapture = function (id) {
    if (id >= SYNTHETIC_ID_BASE) return capture.get(id) === this;
    return origHas.call(this, id);
  };

  var origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
    }
    return origGetContext.call(this, type, attrs);
  };

  window.__fastsim = {
    version: 1,
    syntheticIdBase: SYNTHETIC_ID_BASE,
    tick: tick,
    capture: capture
  };
})();
