# FAST table simulator

A simulator for a [FAST](https://informalscience.org/research/fast-flexible-accessible-strategies-for-timely-digital-exhibit-design/)
style digital exhibit table: a horizontal **1920×1080 multi-touch screen**
showing any web page you point it at. Use it to try out table content:

- **in a desktop browser**: a flat view (mouse or a real touchscreen acts as fingers), or a 3D view of the table
- **in a Meta Quest headset** (WebXR): stand at a virtual table and touch it with your **hands**,
  in VR or in passthrough over a real table

## Quick start

```bash
npm install
npm start                                     # demo content
npm start -- --target http://localhost:5173   # your own content (any dev server or site)
npm start -- --content ./path/to/folder       # a local folder of static files
```

Then open the printed URL, e.g. `https://localhost:8443/__fastsim/`.
The certificate is self-signed, so accept the browser warning once on each device.

The content is shown in a 1920×1080 iframe. You can also type any URL into the
address bar at the top, but see [same-origin content](#why-the-dev-server) below.

## On the Quest 2

1. Run `npm start` on a computer on the same Wi-Fi as the headset.
2. In the Quest Browser, open the `Quest / LAN` URL the server prints
   (`https://<your-computer-ip>:8443/__fastsim/`) and accept the certificate warning.
3. Press **Enter VR**, or **Passthrough** to see your room.
4. Put the controllers down: hand tracking takes over.

In the headset:

| Do this | To get |
| --- | --- |
| Poke the screen with your index finger | Touch (each hand is a separate touch, so pinch and rotate work two-handed) |
| Pinch while pointing at the screen | Touch at the end of the ray (for reaching far edges) |
| Controller trigger | Touch at the end of the ray |
| Poke the buttons beside the table | Raise or lower the table, move it closer or farther, recenter it in front of you, reload the content, exit |

A ring under each fingertip shows where it will touch. It shrinks as you get closer and turns green on contact.
In passthrough mode, use **Table ▲/▼** and **Recenter** to line the virtual
screen up with a real table so your fingers hit something solid.

If the self-signed certificate is a problem, use USB instead:
`npm start -- --http --port 8080`, `adb reverse tcp:8080 tcp:8080`, then open
`http://localhost:8080/__fastsim/` on the headset (WebXR allows `localhost` without HTTPS).

## Desktop controls

**Flat view**: the screen scaled to fit the window.
- Drag: one finger
- <kbd>Shift</kbd>+drag: two-finger pinch/rotate around where you pressed
- <kbd>Ctrl</kbd>/<kbd>Alt</kbd>+drag: two-finger pan
- On a touchscreen, real multi-touch is passed through
- Untick **Mouse = touch** to give the page ordinary mouse events

**3D view**: click or drag on the screen to touch it. Drag anywhere else to orbit, right-drag to pan, and use the wheel to zoom.

The simulator sends what a real touch table sends: `pointer*` events with
`pointerType: "touch"`, `touch*` events, and for a tap the compatibility mouse
events plus `click`. A drag on a scrollable area scrolls it, like on real touch.
Content that only listens for mouse drags will not work for drags, just as on the table.

## Options (URL parameters)

| Param | Default | Meaning |
| --- | --- | --- |
| `src` | demo | Content URL |
| `view` | `flat` | `flat` or `3d` |
| `diag` | `55` | Screen diagonal in inches (sets its physical size in VR) |
| `height` | `0.86` | Floor to screen surface, metres |
| `tilt` | `0` | Degrees the surface tilts up toward the far side |
| `border` | `0.12` | Tabletop rim around the screen, metres |
| `standoff` | `0.25` | Distance from you to the near edge when VR starts, metres |
| `fingers` | `index` | Fingertips that touch: `index`, `all`, or a list like `thumb,index` |
| `poke` | `0.012` | How close (m) a fingertip must be to the surface to count as touching |
| `capture` | `auto` | How the page is drawn on the 3D table: `auto`, `canvas`, `dom` |
| `domfps` | `8` | Maximum refresh rate for `dom` capture |
| `hands` | `mesh` | Hand model: `mesh`, `spheres`, `boxes` |
| `fbscale` | `1` | XR framebuffer scale (higher is sharper and slower) |

Example: `/__fastsim/?src=/my-exhibit/&view=3d&diag=65&height=0.8`

## Why the dev server?

Browsers don't let one page reach inside another site's page. To send touch events into the content and draw it onto the 3D table,
the simulator has to be on the **same origin** as the content. `server.js` does that:

- `/__fastsim/` is the simulator
- every other path is your content, either proxied from `--target` (with WebSocket pass-through, so hot reload works) or served from `--content`
- HTML pages get a small `shim.js` injected before their own scripts. It keeps `requestAnimationFrame` running during VR (Quest pauses it for the 2D page), lets `setPointerCapture` work with simulated fingers, and keeps WebGL frames readable

Cross-origin URLs still load in the flat view, where you can use them with a real mouse or touchscreen, but simulated touch and the 3D/VR table are not available for them.

### Static hosting

`npm run build` writes `dist/` (simulator in `dist/sim/`, demo in `dist/demo/`).
Host it on GitHub Pages or similar, with your content on the same site.
The shim then loads after the content's scripts start, which works for most pages.

## How the 3D table gets its picture

- **Full-screen `<canvas>` apps** (WebGL, PixiJS, p5, …): the canvas is copied to the table every frame.
- **Regular HTML pages**: rendered with html2canvas when the page changes, up to `domfps` times a second. Videos and canvases on the page are drawn live on top.
  html2canvas is not a browser, so some CSS (filters, complex shadows, some transforms, scrolled overflow areas) can look slightly off on the 3D table. Use the flat view as the reference for how the page looks, and the headset to judge reach, scale and touch.

## Assumptions

The [FAST booklet](https://informalscience.org/wp-content/uploads/2024/11/FAST_Booklet_00.pdf)
could not be read while this was built. The defaults are general assumptions for
a museum touch table: a 55" landscape screen, a horizontal surface 0.86 m high, and a 12 cm rim.
They are not taken from the FAST spec. Adjust them with the URL parameters above
(or the defaults in `public/config.js`) to match the real table.

## Layout

```
server.js                 dev server: static files, reverse proxy, shim injection, HTTPS
public/                   the simulator (served at /__fastsim/)
  app.js                  UI, flat view, mouse/touch → simulated fingers
  table-scene.js          three.js table, WebXR hands/controllers, in-VR panel
  touch-injector.js       turns finger contacts into pointer/touch/mouse events in the content
  content-capture.js      copies the content into a texture for the 3D table
  shim.js                 injected into content pages
  config.js               table dimensions and URL options
demo/                     sample content (multi-touch cards, scrolling list, canvas paint)
scripts/build-static.js   static build into dist/
```
