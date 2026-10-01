// The 3D table: a three.js scene with the content texture on the tabletop.
// Works on desktop (orbit camera, mouse = finger) and in WebXR on Quest
// (hand tracking poke, pinch / controller ray, passthrough).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { FAST, OPTIONS } from './config.js';

const FINGER_TIPS = {
  thumb: 'thumb-tip',
  index: 'index-finger-tip',
  middle: 'middle-finger-tip',
  ring: 'ring-finger-tip',
  pinky: 'pinky-finger-tip'
};
const SLAB = 0.04; // tabletop thickness
const RELEASE_GAP = 0.012; // hysteresis above the poke threshold before lifting

export class TableScene {
  constructor(container, { capture, injector, frame, onReload }) {
    this.container = container;
    this.capture = capture;
    this.injector = injector;
    this.frame = frame;
    this.onReload = onReload;
    this.running = false;
    this.tableHeight = FAST.tableHeight;
    this.fingerState = new Map();
    this.buttons = [];
    this.tmp = new THREE.Vector3();

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFramebufferScaleFactor(OPTIONS.framebufferScale);
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.background = new THREE.Color(0x2a2d33);
    this.scene.background = this.background;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 50);

    this.buildEnvironment();
    this.buildTable();
    this.buildPanel();
    this.setupDesktopInput();
    this.setupXRInput();

    const centerZ = this.table.position.z;
    this.camera.position.set(0, 1.6, 0.25);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, this.tableHeight, centerZ + 0.05);
    this.controls.enableDamping = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.update();

    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(container);
    this.resize();

    r.xr.addEventListener('sessionstart', () => this.onSessionStart());
    r.xr.addEventListener('sessionend', () => this.onSessionEnd());
  }

  // ---------------------------------------------------------------- building

  buildEnvironment() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(1.5, 3, 1);
    s.add(sun);

    this.env = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 1 })
    );
    this.env.add(floor);
    const grid = new THREE.GridHelper(16, 32, 0x555a63, 0x474b52);
    grid.position.y = 0.001;
    this.env.add(grid);
    s.add(this.env);
  }

  buildTable() {
    const W = FAST.screenW, D = FAST.screenD, B = FAST.border;
    this.table = new THREE.Group();
    this.table.position.z = -(FAST.standoff + B + D / 2);
    this.scene.add(this.table);

    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.9 });

    this.base = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * B - 0.16, 1, D + 2 * B - 0.3), dark);
    this.table.add(this.base);

    this.surface = new THREE.Group();
    this.surface.rotation.x = THREE.MathUtils.degToRad(FAST.tilt);
    this.table.add(this.surface);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * B, SLAB, D + 2 * B), wood);
    slab.position.y = -SLAB / 2 - 0.001;
    this.surface.add(slab);

    const bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.03, D + 0.03).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.3 })
    );
    bezel.position.y = 0.0002;
    this.surface.add(bezel);

    this.texture = null;
    this.screenMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(W, D), this.screenMat);
    this.screen.rotation.x = -Math.PI / 2;
    this.screen.position.y = 0.0008;
    this.surface.add(this.screen);

    this.cursors = new THREE.Group();
    this.screen.add(this.cursors);

    this.applyHeight();
  }

  applyHeight() {
    const h = this.tableHeight;
    this.surface.position.y = h;
    this.base.scale.y = Math.max(0.05, h - SLAB);
    this.base.position.y = (h - SLAB) / 2;
    if (this.panel) this.panel.position.y = h + 0.12;
  }

  buildPanel() {
    const W = FAST.screenW, D = FAST.screenD, B = FAST.border;
    this.panel = new THREE.Group();
    this.panel.position.set(W / 2 + B + 0.12, 0, D / 2 + B - 0.05);
    this.panel.rotation.set(-0.5, -0.5, 0, 'YXZ');
    this.table.add(this.panel);

    const defs = [
      ['Table ▲', () => this.nudgeHeight(+0.02)],
      ['Table ▼', () => this.nudgeHeight(-0.02)],
      ['Closer', () => this.nudgeDistance(+0.05)],
      ['Farther', () => this.nudgeDistance(-0.05)],
      ['Recenter', () => this.recenter()],
      ['Reload', () => this.onReload?.()],
      ['Exit', () => this.renderer.xr.getSession()?.end()]
    ];
    const bw = 0.1, bh = 0.04, gap = 0.008;
    defs.forEach(([label, action], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(bw, bh),
        new THREE.MeshBasicMaterial({ map: labelTexture(label), toneMapped: false })
      );
      mesh.position.set((col - 0.5) * (bw + gap), -row * (bh + gap), 0);
      mesh.userData = { action, w: bw, h: bh, pressed: false, cooldown: 0 };
      this.panel.add(mesh);
      this.buttons.push(mesh);
    });
    this.panel.visible = false; // only in XR
    this.applyHeight();
  }

  nudgeHeight(d) {
    this.tableHeight = THREE.MathUtils.clamp(this.tableHeight + d, 0.4, 1.4);
    this.applyHeight();
  }

  nudgeDistance(d) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.table.quaternion);
    this.table.position.addScaledVector(fwd, d);
  }

  // Put the table in front of where the viewer is now looking.
  recenter() {
    const cam = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const yaw = Math.atan2(-dir.x, -dir.z);
    const dist = FAST.standoff + FAST.border + FAST.screenD / 2;
    this.table.rotation.set(0, yaw, 0);
    this.table.position.set(pos.x - Math.sin(yaw) * dist, 0, pos.z - Math.cos(yaw) * dist);
  }

  // ------------------------------------------------------------------ input

  /** Maps a world-space hit on the screen mesh to content pixels. */
  uvToContent(uv) {
    return { x: uv.x * FAST.width, y: (1 - uv.y) * FAST.height };
  }

  setupDesktopInput() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let touching = false;
    const hit = (e) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const h = ray.intersectObject(this.screen, false)[0];
      return h ? this.uvToContent(h.uv) : null;
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.renderer.xr.isPresenting) return;
      const p = hit(e);
      if (!p) return;
      touching = true;
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      this.injector.down('mouse', p.x, p.y);
      this.capture.markDirty();
      e.stopImmediatePropagation();
    }, { capture: true });
    el.addEventListener('pointermove', (e) => {
      if (!touching) return;
      const p = hit(e);
      if (p) this.injector.move('mouse', p.x, p.y);
    });
    const end = () => {
      if (!touching) return;
      touching = false;
      this.controls.enabled = true;
      this.injector.up('mouse');
      this.capture.markDirty();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  setupXRInput() {
    const r = this.renderer;
    const handFactory = new XRHandModelFactory();
    const ctrlFactory = new XRControllerModelFactory();
    this.raycaster = new THREE.Raycaster();
    this.controllers = [];
    this.hands = [];

    for (let i = 0; i < 2; i++) {
      const ctrl = r.xr.getController(i);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.8 })
      );
      line.visible = false;
      ctrl.add(line);
      ctrl.userData = { index: i, line, selecting: false, source: null };
      ctrl.addEventListener('connected', (e) => { ctrl.userData.source = e.data; });
      ctrl.addEventListener('disconnected', () => {
        this.endRay(ctrl);
        ctrl.userData.source = null;
      });
      ctrl.addEventListener('selectstart', () => this.startRay(ctrl));
      ctrl.addEventListener('selectend', () => this.endRay(ctrl));
      this.scene.add(ctrl);
      this.controllers.push(ctrl);

      const grip = r.xr.getControllerGrip(i);
      grip.add(ctrlFactory.createControllerModel(grip));
      this.scene.add(grip);

      const hand = r.xr.getHand(i);
      hand.add(handFactory.createHandModel(hand, OPTIONS.hands));
      hand.userData = { index: i, source: null };
      hand.addEventListener('connected', (e) => { hand.userData.source = e.data; });
      hand.addEventListener('disconnected', () => {
        hand.userData.source = null;
        this.releaseHand(i);
      });
      this.scene.add(hand);
      this.hands.push(hand);
    }

    const tips = OPTIONS.fingers.includes('all') ? Object.keys(FINGER_TIPS) : OPTIONS.fingers;
    this.fingerNames = tips.filter((f) => FINGER_TIPS[f]);
  }

  rayHit(ctrl) {
    ctrl.updateMatrixWorld();
    const m = ctrl.matrixWorld;
    this.raycaster.ray.origin.setFromMatrixPosition(m);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(m);
    const targets = this.panel.visible ? [this.screen, ...this.buttons] : [this.screen];
    return this.raycaster.intersectObjects(targets, false)[0] || null;
  }

  startRay(ctrl) {
    const h = this.rayHit(ctrl);
    if (!h) return;
    if (h.object !== this.screen) {
      h.object.userData.action();
      return;
    }
    const p = this.uvToContent(h.uv);
    ctrl.userData.selecting = true;
    this.injector.down(`ray${ctrl.userData.index}`, p.x, p.y);
    this.capture.markDirty();
  }

  endRay(ctrl) {
    if (!ctrl.userData.selecting) return;
    ctrl.userData.selecting = false;
    this.injector.up(`ray${ctrl.userData.index}`);
    this.capture.markDirty();
  }

  updateRays() {
    for (const ctrl of this.controllers) {
      const { line, source, selecting } = ctrl.userData;
      if (!source) { line.visible = false; continue; }
      const h = this.rayHit(ctrl);
      // Hands only show a ray while it points at something and the hand isn't
      // poking the table; controllers always do.
      const poking = source.hand && this.handNearSurface(ctrl.userData.index);
      line.visible = selecting || (source.hand ? !!h && !poking : true);
      line.scale.z = h ? h.distance : 1.5;
      line.material.color.set(selecting ? 0x2fe0a0 : 0x7fd4ff);
      if (selecting && h && h.object === this.screen) {
        const p = this.uvToContent(h.uv);
        this.injector.move(`ray${ctrl.userData.index}`, p.x, p.y);
      }
    }
  }

  handNearSurface(i) {
    for (const [key, st] of this.fingerState) {
      if (key.startsWith(`h${i}-`) && st.cursor.visible) return true;
    }
    return false;
  }

  releaseHand(i) {
    for (const [key, st] of this.fingerState) {
      if (key.startsWith(`h${i}-`)) {
        if (st.down) this.injector.up(key);
        st.cursor.visible = false;
        st.down = false;
      }
    }
  }

  cursorFor(key) {
    let st = this.fingerState.get(key);
    if (!st) {
      const cursor = new THREE.Mesh(
        new THREE.RingGeometry(0.006, 0.009, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })
      );
      cursor.renderOrder = 10;
      cursor.visible = false;
      this.cursors.add(cursor);
      st = { down: false, cursor, smooth: null };
      this.fingerState.set(key, st);
    }
    return st;
  }

  // Poke: a fingertip at the surface touches the screen.
  updateHands() {
    const W = FAST.screenW, D = FAST.screenD;
    const touchAt = OPTIONS.pokeDown;
    this.screen.updateMatrixWorld();
    for (const hand of this.hands) {
      const i = hand.userData.index;
      if (!hand.userData.source) continue;
      for (const finger of this.fingerNames) {
        const key = `h${i}-${finger}`;
        const st = this.cursorFor(key);
        const joint = hand.joints[FINGER_TIPS[finger]];
        if (!joint || !joint.visible) {
          if (st.down) { this.injector.up(key); st.down = false; this.capture.markDirty(); }
          st.cursor.visible = false;
          st.smooth = null;
          continue;
        }
        const local = this.screen.worldToLocal(joint.getWorldPosition(this.tmp));
        // Light smoothing against tracking jitter.
        st.smooth = st.smooth ? st.smooth.lerp(local, 0.6) : local.clone();
        const { x: lx, y: ly, z: lz } = st.smooth;
        const inside = Math.abs(lx) <= W / 2 && Math.abs(ly) <= D / 2;
        const p = { x: (lx / W + 0.5) * FAST.width, y: (0.5 - ly / D) * FAST.height };

        if (st.down) {
          if (!inside || lz > touchAt + RELEASE_GAP) {
            this.injector.up(key);
            st.down = false;
            this.capture.markDirty();
          } else {
            this.injector.move(key, p.x, p.y);
          }
        } else if (inside && lz < touchAt && lz > -0.03) {
          st.down = true;
          this.injector.down(key, p.x, p.y);
          this.capture.markDirty();
        }

        st.cursor.visible = inside && lz < 0.12;
        if (st.cursor.visible) {
          st.cursor.position.set(lx, ly, 0.001);
          const s = st.down ? 1 : 1 + Math.max(0, lz) * 25;
          st.cursor.scale.setScalar(s);
          st.cursor.material.color.set(st.down ? 0x2fe0a0 : 0xffffff);
        }
      }
    }
  }

  // Poke the floating panel buttons with any tracked fingertip.
  updatePanel(now) {
    if (!this.panel.visible) return;
    const tips = [];
    for (const hand of this.hands) {
      const j = hand.userData.source && hand.joints['index-finger-tip'];
      if (j && j.visible) tips.push(j.getWorldPosition(new THREE.Vector3()));
    }
    for (const b of this.buttons) {
      const u = b.userData;
      let touching = false;
      for (const t of tips) {
        const l = b.worldToLocal(t.clone());
        if (Math.abs(l.x) < u.w / 2 && Math.abs(l.y) < u.h / 2 && l.z < 0.01 && l.z > -0.04) touching = true;
      }
      if (touching && !u.pressed && now > u.cooldown) {
        u.pressed = true;
        u.cooldown = now + 400;
        u.action();
      } else if (!touching) {
        u.pressed = false;
      }
      b.scale.setScalar(u.pressed ? 0.92 : 1);
    }
  }

  // -------------------------------------------------------------- XR session

  async enterXR(mode) {
    const session = await navigator.xr.requestSession(mode, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
    });
    this.xrMode = mode;
    await this.renderer.xr.setSession(session);
  }

  onSessionStart() {
    const ar = this.xrMode === 'immersive-ar';
    this.env.visible = !ar;
    this.scene.background = ar ? null : this.background;
    this.panel.visible = true;
    this.controls.enabled = false;
  }

  onSessionEnd() {
    this.env.visible = true;
    this.scene.background = this.background;
    this.panel.visible = false;
    this.controls.enabled = true;
    for (const ctrl of this.controllers) this.endRay(ctrl);
    this.releaseHand(0);
    this.releaseHand(1);
    this.injector.cancelAll();
  }

  // ------------------------------------------------------------------ frame

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frameLoop(t));
  }

  stop() {
    if (!this.running || this.renderer.xr.isPresenting) return;
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  frameLoop(now) {
    // Drive the content page's animation frame first so a WebGL canvas still
    // holds this frame when we copy it.
    try { this.frame.contentWindow?.__fastsim?.tick(); } catch { /* cross-origin */ }

    const { image } = this.capture.update(now);
    this.updateTexture(image);

    if (this.renderer.xr.isPresenting) {
      this.updateHands();
      this.updateRays();
      this.updatePanel(now);
    } else {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }

  updateTexture(image) {
    if (!this.texture || this.texture.image !== image) {
      this.texture?.dispose();
      const t = new THREE.Texture(image);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      t.minFilter = THREE.LinearMipmapLinearFilter;
      this.texture = t;
      this.screenMat.map = t;
      this.screenMat.needsUpdate = true;
    }
    this.texture.needsUpdate = true;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h || this.renderer.xr.isPresenting) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 102;
  const g = c.getContext('2d');
  g.fillStyle = '#20252c';
  g.beginPath();
  g.roundRect(2, 2, 252, 98, 18);
  g.fill();
  g.strokeStyle = '#7fd4ff';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = '600 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
