// The 3D table: a projector image on a matte tabletop, with the physical tools.
// Works on desktop (orbit camera, mouse grabs tools) and in WebXR on Quest
// (hand tracking: poke buttons, pinch to grab/turn/slide; controllers: ray + trigger).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { FAST, OPTIONS } from './config.js';
import { buildTools } from './tools3d.js';
import { isPlain, PLAIN_BORDER } from './layouts.js';
import { buildRoom, buildLegs, buildPlinth, buildStools } from './room.js';
import { loadPosters, hangPosters } from './posters.js';

const SLAB = 0.04; // tabletop thickness
const RELEASE_GAP = 0.012; // hysteresis above the poke threshold before lifting
const PINCH_ON = 0.022, PINCH_OFF = 0.04; // thumb-index distance, metres
const TIPS = ['index-finger-tip', 'middle-finger-tip'];

export class TableScene {
  constructor(container, { capture, injector, frame, onReload }) {
    this.container = container;
    this.capture = capture;
    this.injector = injector;
    this.frame = frame;
    this.onReload = onReload;
    this.running = false;
    this.tableHeight = FAST.tableHeight;
    this.tools = [];
    this.targets = [];
    this.grabs = new Map(); // pointer key -> { tool, ptr }
    this.touchState = new Map();
    this.buttons = [];
    this.model = null;
    this.pointer = 'none';
    this.furnitureStyle = OPTIONS.furniture === 'plinth' ? 'plinth' : 'stools';
    this.plain = false;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; // contrast between the lit table and the dim room
    r.toneMappingExposure = 1.1;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFramebufferScaleFactor(OPTIONS.framebufferScale);
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.background = new THREE.Color(0x141619);
    this.scene.background = this.background;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 250);

    this.buildEnvironment();
    this.buildTable();
    this.buildPanel();
    this.setupDesktopInput();
    this.setupXRInput();

    const centerZ = this.table.position.z;
    this.camera.position.set(0, 1.65, 0.35);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, this.tableHeight, centerZ + 0.1);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 4;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // stay above the floor
    this.controls.update();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    r.xr.addEventListener('sessionstart', () => this.onSessionStart());
    r.xr.addEventListener('sessionend', () => this.onSessionEnd());
  }

  // ---------------------------------------------------------------- building

  buildEnvironment() {
    const s = this.scene;
    // Soft reflections so metal (the steel plinth) reads as metal.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.22;
    pmrem.dispose();

    // Faint base light that stays on in passthrough, when the room is hidden.
    s.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2a22, 0.15));

    // The gallery: carpet, walls, windows. Hidden in passthrough.
    // Centred behind the viewer so the glass wall is ~6 m beyond the table.
    this.env = buildRoom(0, 4);
    s.add(this.env);
    // Te Papa posters on the walls (cached in public/posters/).
    this.posterTargets = [];
    loadPosters().then((list) => { this.posterTargets = hangPosters(this.env, list); });
  }

  buildTable() {
    const W = FAST.projW, D = FAST.projD, B = FAST.border;
    const TW = W + 2 * B, TD = D + 2 * B;
    this.table = new THREE.Group();
    this.table.position.z = -(FAST.standoff + B + D / 2);
    this.scene.add(this.table);

    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 });

    // Matte white top: the projection surface.
    this.top = new THREE.Mesh(new THREE.BoxGeometry(TW, SLAB, TD), new THREE.MeshStandardMaterial({ color: 0xcfd0cc, roughness: 1 }));
    this.table.add(this.top);

    // Legs + stools, or a steel plinth: rebuilt by rebuildFurniture().
    this.furniture = new THREE.Group();
    this.table.add(this.furniture);

    // The projected image.
    this.texture = null;
    this.screenMat = new THREE.MeshBasicMaterial({ color: 0xf0f0f0, toneMapped: false });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(W, D), this.screenMat);
    this.screen.rotation.x = -Math.PI / 2;
    this.table.add(this.screen);

    // Spotlight over the table, so it reads clearly in the dim room.
    this.spot = new THREE.SpotLight(0xfff1dc, 52, 0, 0.6, 0.5, 1.2);
    this.spot.position.set(0, 3.2, 0.25);
    this.spot.target.position.set(0, 0, 0);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5, metalness: 0.5 }));
    can.position.set(0, 3.3, 0.25);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3e0 }));
    glow.position.set(0, 3.199, 0.25);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8), can.material);
    rod.position.set(0, 3.8, 0.25); // hangs from the 4.2 m ceiling
    this.table.add(this.spot, this.spot.target, can, glow, rod);

    // Ceiling-mounted projector.
    this.projector = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.6 }));
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 24), new THREE.MeshBasicMaterial({ color: 0xfff7e0 }));
    lens.position.y = -0.07;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2), metal);
    pole.position.y = 1.06;
    this.projector.add(body, lens, pole);
    this.table.add(this.projector);

    this.toolsGroup = new THREE.Group();
    this.table.add(this.toolsGroup);

    this.cursors = new THREE.Group();
    this.screen.add(this.cursors);
    this.applyHeight();
  }

  applyHeight() {
    const h = this.tableHeight;
    this.top.position.y = h - SLAB / 2 - 0.001;
    this.rebuildFurniture();
    this.screen.position.y = h + 0.0008;
    this.toolsGroup.position.y = h;
    this.projector.position.y = h + 1.25;
    if (this.panel) this.panel.position.y = h + 0.14;
  }

  /** Swap in the tools for a new layout. */
  setModel(model, pointer) {
    this.releaseAll();
    for (const tool of this.tools) this.toolsGroup.remove(tool.group);
    this.model?.removeEventListener('change', this.onModelChange);
    this.model = model;
    this.pointer = pointer;
    this.tools = model ? buildTools(model) : [];
    this.targets = this.tools.flatMap((t) => t.targets);
    for (const tool of this.tools) { this.toolsGroup.add(tool.group); tool.sync(); }
    this.onModelChange = (e) => this.tools.find((t) => t.id === e.detail.id)?.sync();
    model?.addEventListener('change', this.onModelChange);
    this.setPlain(!!model && isPlain(model.layout));
  }

  /** 'stools': legs with fabric stools around; 'plinth': a steel box to the floor. */
  setFurniture(style) {
    this.furnitureStyle = style === 'plinth' ? 'plinth' : 'stools';
    this.rebuildFurniture();
  }

  rebuildFurniture() {
    if (!this.furniture) return;
    this.furniture.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.furniture.clear();
    const B = this.plain ? PLAIN_BORDER : FAST.border;
    const TW = FAST.projW + 2 * B, TD = FAST.projD + 2 * B;
    const base = this.tableHeight - SLAB;
    if (this.furnitureStyle === 'plinth') {
      this.furniture.add(buildPlinth(TW, TD, base));
      this.stools = null;
    } else {
      this.furniture.add(buildLegs(TW, TD, base));
      this.stools = buildStools(TW, TD);
      this.stools.visible = this.xrMode !== 'immersive-ar';
      this.furniture.add(this.stools);
    }
  }

  /** No tools: show a plain touch table (black bezel, thin rim, no projector). */
  setPlain(plain) {
    this.plain = plain;
    const W = FAST.projW, D = FAST.projD, B = plain ? PLAIN_BORDER : FAST.border;
    const TW = W + 2 * B, TD = D + 2 * B;
    this.top.scale.set(TW / (W + 2 * FAST.border), 1, TD / (D + 2 * FAST.border));
    this.top.material.color.set(plain ? 0x111214 : 0xcfd0cc);
    this.top.material.roughness = plain ? 0.35 : 1;
    this.rebuildFurniture();
    this.projector.visible = !plain && this.xrMode !== 'immersive-ar';
    this.screenMat.color.set(plain ? 0xffffff : 0xf0f0f0);
    this.panel.position.x = TW / 2 + 0.14;
    this.panel.position.z = TD / 2 - 0.05;
  }

  buildPanel() {
    const W = FAST.projW, D = FAST.projD, B = FAST.border;
    this.panel = new THREE.Group();
    this.panel.position.set(W / 2 + B + 0.14, 0, D / 2 + B - 0.05);
    this.panel.rotation.set(-0.5, -0.5, 0, 'YXZ');
    this.table.add(this.panel);
    const defs = [
      ['Table ▲', () => this.nudgeHeight(+0.02)],
      ['Table ▼', () => this.nudgeHeight(-0.02)],
      ['Closer', () => this.nudgeDistance(+0.05)],
      ['Farther', () => this.nudgeDistance(-0.05)],
      ['Recenter', () => this.recenter()],
      ['Reset', () => this.onReload?.()],
      ['Exit', () => this.renderer.xr.getSession()?.end()]
    ];
    const bw = 0.1, bh = 0.04, gap = 0.008;
    defs.forEach(([label, action], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: labelTexture(label), toneMapped: false }));
      mesh.position.set((col - 0.5) * (bw + gap), -row * (bh + gap), 0);
      mesh.userData = { action, w: bw, h: bh, pressed: false, cooldown: 0 };
      this.panel.add(mesh);
      this.buttons.push(mesh);
    });
    this.panel.visible = false; // only in XR
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
    const dist = FAST.standoff + FAST.border + FAST.projD / 2;
    this.table.rotation.set(0, yaw, 0);
    this.table.position.set(pos.x - Math.sin(yaw) * dist, 0, pos.z - Math.cos(yaw) * dist);
  }

  // ------------------------------------------------------------------ input

  uvToContent(uv) {
    return { x: uv.x * FAST.width, y: (1 - uv.y) * FAST.height };
  }

  /** First thing a ray hits: a tool, a VR panel button, or the image. */
  pick(ray) {
    const rc = new THREE.Raycaster(ray.origin, ray.direction, 0, 30);
    const list = [...this.targets, this.screen];
    if (this.panel.visible) list.push(...this.buttons);
    if (this.env.visible) list.push(...this.posterTargets);
    const hit = rc.intersectObjects(list, false)[0];
    if (!hit) return null;
    if (this.buttons.includes(hit.object)) return { kind: 'panel', hit };
    if (hit.object.userData.poster) return { kind: 'poster', hit, poster: hit.object.userData.poster };
    if (hit.object === this.screen) return { kind: 'screen', hit };
    return { kind: 'tool', hit, tool: hit.object.userData.tool };
  }

  startGrab(key, ptr, picked) {
    if (!picked) return false;
    if (picked.kind === 'panel') { picked.hit.object.userData.action(); return true; }
    if (picked.kind === 'poster') { this.openLink(picked.poster.url); return true; }
    if (picked.kind === 'tool') {
      picked.tool.grab(ptr, picked.hit);
      this.grabs.set(key, { tool: picked.tool, ptr });
      return true;
    }
    if (picked.kind === 'screen' && this.pointer !== 'none') {
      const p = this.uvToContent(picked.hit.uv);
      this.injector.down(key, p.x, p.y);
      this.grabs.set(key, { screen: true, ptr });
      this.capture.markDirty();
      return true;
    }
    return false;
  }

  moveGrab(key, ptr) {
    const g = this.grabs.get(key);
    if (!g) return;
    g.ptr = ptr;
    if (g.tool) { g.tool.drag(ptr); return; }
    const h = ptr.ray && new THREE.Raycaster(ptr.ray.origin, ptr.ray.direction).intersectObject(this.screen, false)[0];
    if (h) { const p = this.uvToContent(h.uv); this.injector.move(key, p.x, p.y); }
  }

  endGrab(key) {
    const g = this.grabs.get(key);
    if (!g) return;
    this.grabs.delete(key);
    if (g.tool) g.tool.release(g.ptr);
    else { this.injector.up(key); this.capture.markDirty(); }
  }

  /** Open a poster's Collections Online page (leaving VR first, so it's visible). */
  openLink(url) {
    const session = this.renderer.xr.getSession();
    const win = window.open(url, '_blank');
    if (win) win.opener = null;
    if (session) session.end();
    else if (!win) location.href = url; // popup blocked: navigate instead
  }

  releaseAll() {
    for (const key of [...this.grabs.keys()]) this.endGrab(key);
  }

  setupDesktopInput() {
    const el = this.renderer.domElement;
    const ndc = new THREE.Vector2();
    const rc = new THREE.Raycaster();
    const rayOf = (e) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      rc.setFromCamera(ndc, this.camera);
      return rc.ray.clone();
    };
    // Capture phase on the container runs before OrbitControls sees the event.
    this.container.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.renderer.xr.isPresenting) return;
      const ray = rayOf(e);
      if (this.startGrab('mouse', { kind: 'mouse', ray }, this.pick(ray))) {
        el.setPointerCapture(e.pointerId);
        e.stopPropagation();
      }
    }, true);
    el.addEventListener('pointermove', (e) => {
      if (this.grabs.has('mouse')) this.moveGrab('mouse', { kind: 'mouse', ray: rayOf(e) });
    });
    const end = () => this.endGrab('mouse');
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    this.container.addEventListener('wheel', (e) => {
      const p = this.pick(rayOf(e));
      if (p?.kind === 'tool' && p.tool.wheel) {
        p.tool.wheel(e.deltaY > 0 ? 1 : -1);
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true, passive: false });
  }

  setupXRInput() {
    const r = this.renderer;
    const handFactory = new XRHandModelFactory();
    const ctrlFactory = new XRControllerModelFactory();
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
      ctrl.userData = { index: i, line, source: null };
      ctrl.addEventListener('connected', (e) => { ctrl.userData.source = e.data; });
      ctrl.addEventListener('disconnected', () => { this.endGrab(`ctrl${i}`); ctrl.userData.source = null; });
      // Hands pinch-select too; they're handled in updateHands() instead.
      ctrl.addEventListener('selectstart', () => {
        if (ctrl.userData.source?.hand) return;
        const ray = this.rayFrom(ctrl);
        this.startGrab(`ctrl${i}`, { kind: 'ray', ray }, this.pick(ray));
      });
      ctrl.addEventListener('selectend', () => this.endGrab(`ctrl${i}`));
      this.scene.add(ctrl);
      this.controllers.push(ctrl);

      const grip = r.xr.getControllerGrip(i);
      grip.add(ctrlFactory.createControllerModel(grip));
      this.scene.add(grip);

      const hand = r.xr.getHand(i);
      hand.add(handFactory.createHandModel(hand, OPTIONS.hands));
      hand.userData = { index: i, source: null, pinching: false };
      hand.addEventListener('connected', (e) => { hand.userData.source = e.data; });
      hand.addEventListener('disconnected', () => {
        hand.userData.source = null;
        this.endGrab(`pinch${i}`);
        this.releaseTouches(i);
      });
      this.scene.add(hand);
      this.hands.push(hand);
    }
  }

  rayFrom(obj) {
    obj.updateMatrixWorld();
    const origin = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(obj.matrixWorld);
    return new THREE.Ray(origin, dir);
  }

  joint(hand, name) {
    const j = hand.joints?.[name];
    return j && j.visible ? j.getWorldPosition(new THREE.Vector3()) : null;
  }

  handYaw(hand) {
    const w = hand.joints?.wrist;
    if (!w || !w.visible) return 0;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));
    return Math.atan2(-f.x, -f.z) - this.table.rotation.y;
  }

  updateHands() {
    for (const hand of this.hands) {
      const i = hand.userData.index;
      if (!hand.userData.source) continue;
      const thumb = this.joint(hand, 'thumb-tip');
      const index = this.joint(hand, 'index-finger-tip');
      const key = `pinch${i}`;
      const ctrl = this.controllers[i];
      if (!thumb || !index) { this.endGrab(key); hand.userData.pinching = false; continue; }

      const d = thumb.distanceTo(index);
      const point = thumb.clone().add(index).multiplyScalar(0.5);
      const ray = this.rayFrom(ctrl);
      const wasPinching = hand.userData.pinching;
      const pinching = wasPinching ? d < PINCH_OFF : d < PINCH_ON;
      hand.userData.pinching = pinching;

      // Pinch near a tool grabs it directly; otherwise pinch aims a ray.
      if (pinching && !wasPinching) {
        let best = null, bestD = Infinity;
        for (const tool of this.tools) {
          const r = tool.reach(point);
          if (r !== null && r < bestD) { best = tool; bestD = r; }
        }
        if (best) {
          const ptr = { kind: 'pinch', point, yaw: this.handYaw(hand) };
          best.grab(ptr, { object: best.targets[0] });
          this.grabs.set(key, { tool: best, ptr });
        } else {
          this.startGrab(key, { kind: 'ray', ray }, this.pick(ray));
        }
      } else if (pinching && this.grabs.has(key)) {
        const g = this.grabs.get(key);
        this.moveGrab(key, g.ptr.kind === 'pinch' ? { kind: 'pinch', point, yaw: this.handYaw(hand) } : { kind: 'ray', ray });
      } else if (!pinching && wasPinching) {
        this.endGrab(key);
      }

      // Show the aiming ray only when it's pointing at something out of reach.
      const near = this.tools.some((t) => t.reach(index) !== null) || this.handNearSurface(i);
      const grabbedRay = this.grabs.get(key)?.ptr.kind === 'ray';
      const hit = !near && this.pick(ray);
      const show = grabbedRay || (hit && (hit.kind !== 'screen' || this.pointer !== 'none'));
      ctrl.userData.line.visible = !!show;
      if (show) {
        ctrl.userData.line.scale.z = hit ? hit.hit.distance : 0.5;
        ctrl.userData.line.material.color.set(pinching ? 0x2fe0a0 : 0x7fd4ff);
      }
    }
  }

  updateControllers() {
    for (const ctrl of this.controllers) {
      const { line, source, index } = ctrl.userData;
      if (!source || source.hand) continue;
      const ray = this.rayFrom(ctrl);
      const key = `ctrl${index}`;
      if (this.grabs.has(key)) this.moveGrab(key, { kind: 'ray', ray });
      const hit = this.pick(ray);
      line.visible = true;
      line.scale.z = hit ? hit.hit.distance : 1.5;
      line.material.color.set(this.grabs.has(key) ? 0x2fe0a0 : 0x7fd4ff);
    }
  }

  /** Fingertips poke buttons and toggles (and the image, in touch layouts). */
  updatePokes() {
    const tips = [];
    for (const hand of this.hands) {
      if (!hand.userData.source) continue;
      for (const n of TIPS) {
        const p = this.joint(hand, n);
        if (p) tips.push(p);
      }
    }
    for (const tool of this.tools) tool.poke(tips);
    if (this.pointer !== 'none') this.updateSurfaceTouch();
  }

  handNearSurface(i) {
    for (const [key, st] of this.touchState) if (key.startsWith(`h${i}-`) && st.cursor.visible) return true;
    return false;
  }

  releaseTouches(i) {
    for (const [key, st] of this.touchState) {
      if (!key.startsWith(`h${i}-`)) continue;
      if (st.down) this.injector.up(key);
      st.down = false;
      st.cursor.visible = false;
    }
  }

  touchCursor(key) {
    let st = this.touchState.get(key);
    if (!st) {
      const cursor = new THREE.Mesh(
        new THREE.RingGeometry(0.006, 0.009, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })
      );
      cursor.renderOrder = 10;
      cursor.visible = false;
      this.cursors.add(cursor);
      st = { down: false, cursor, smooth: null };
      this.touchState.set(key, st);
    }
    return st;
  }

  // Touch layouts only: an index fingertip at the surface touches the image.
  updateSurfaceTouch() {
    const W = FAST.projW, D = FAST.projD, touchAt = OPTIONS.pokeDown;
    this.screen.updateMatrixWorld();
    for (const hand of this.hands) {
      const i = hand.userData.index;
      if (!hand.userData.source) continue;
      const key = `h${i}-index`;
      const st = this.touchCursor(key);
      const tip = this.joint(hand, 'index-finger-tip');
      if (!tip) {
        if (st.down) { this.injector.up(key); st.down = false; }
        st.cursor.visible = false;
        st.smooth = null;
        continue;
      }
      const local = this.screen.worldToLocal(tip);
      st.smooth = st.smooth ? st.smooth.lerp(local, 0.6) : local.clone();
      const { x: lx, y: ly, z: lz } = st.smooth;
      const inside = Math.abs(lx) <= W / 2 && Math.abs(ly) <= D / 2;
      const p = { x: (lx / W + 0.5) * FAST.width, y: (0.5 - ly / D) * FAST.height };
      if (st.down) {
        if (!inside || lz > touchAt + RELEASE_GAP) { this.injector.up(key); st.down = false; this.capture.markDirty(); }
        else this.injector.move(key, p.x, p.y);
      } else if (inside && lz < touchAt && lz > -0.03) {
        st.down = true;
        this.injector.down(key, p.x, p.y);
        this.capture.markDirty();
      }
      st.cursor.visible = inside && lz < 0.12;
      if (st.cursor.visible) {
        st.cursor.position.set(lx, ly, 0.001);
        st.cursor.scale.setScalar(st.down ? 1 : 1 + Math.max(0, lz) * 25);
        st.cursor.material.color.set(st.down ? 0x2fe0a0 : 0xffffff);
      }
    }
  }

  // Poke the floating settings panel with an index fingertip.
  updatePanel(now) {
    const tips = this.hands.map((h) => h.userData.source && this.joint(h, 'index-finger-tip')).filter(Boolean);
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
    this.projector.visible = !ar && !this.plain;
    if (this.stools) this.stools.visible = !ar;
    this.scene.background = ar ? null : this.background;
    this.panel.visible = true;
    this.controls.enabled = false;
  }

  onSessionEnd() {
    this.env.visible = true;
    this.xrMode = null;
    this.projector.visible = !this.plain;
    if (this.stools) this.stools.visible = true;
    this.scene.background = this.background;
    this.panel.visible = false;
    this.controls.enabled = true;
    this.releaseAll();
    this.releaseTouches(0);
    this.releaseTouches(1);
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

    this.updateTexture(this.capture.update(now).image);

    if (this.renderer.xr.isPresenting) {
      this.updateHands();
      this.updateControllers();
      this.updatePokes();
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
