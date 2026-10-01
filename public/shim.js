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
//  - On a touch-table layout, makes the page see a touchscreen device
//    (maxTouchPoints, ontouchstart, pointer: coarse), because many apps and
//    libraries pick mouse-only handling when they detect a desktop.
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

  var config = null;
  try { config = window.parent !== window && window.parent.__fastsimConfig; } catch (e) { /* cross-origin parent */ }
  if (config && config.touch) emulateTouchDevice();

  function emulateTouchDevice() {
    try {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: function () { return 10; }, configurable: true });
    } catch (e) { /* ignore */ }
    // ontouchstart etc. exist on touch builds; make them real handler properties.
    ['ontouchstart', 'ontouchmove', 'ontouchend', 'ontouchcancel'].forEach(function (prop) {
      var type = prop.slice(2);
      [window, Document.prototype, HTMLElement.prototype, SVGElement.prototype].forEach(function (obj) {
        if (prop in obj) return;
        var key = '__fastsim_' + prop;
        Object.defineProperty(obj, prop, {
          configurable: true,
          get: function () { return this[key] || null; },
          set: function (fn) {
            if (this[key]) this.removeEventListener(type, this[key]);
            this[key] = typeof fn === 'function' ? fn : null;
            if (this[key]) this.addEventListener(type, this[key]);
          }
        });
      });
    });
    // A touch table has a coarse pointer and no hover.
    var answers = {
      '(pointer: coarse)': true, '(pointer: fine)': false, '(pointer: none)': false,
      '(any-pointer: coarse)': true, '(any-pointer: fine)': false,
      '(hover: none)': true, '(hover: hover)': false, '(any-hover: none)': true, '(any-hover: hover)': false
    };
    var nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
      var q = String(query).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\( */g, '(').replace(/ *\)/g, ')').replace(/: */g, ': ');
      if (!(q in answers)) return nativeMatchMedia(query);
      return {
        matches: answers[q], media: query, onchange: null,
        addListener: function () {}, removeListener: function () {},
        addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; }
      };
    };
  }

  window.__fastsim = {
    version: 1,
    syntheticIdBase: SYNTHETIC_ID_BASE,
    tick: tick,
    capture: capture
  };
})();
