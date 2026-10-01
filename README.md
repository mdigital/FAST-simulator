# FAST table simulator

A simulator for the **FAST table**, the projection-based exhibit table from the Museum of Science, Boston's
[FAST (Flexible, Accessible Strategies for Timely) Digital Exhibit Design](https://informalscience.org/research/fast-flexible-accessible-strategies-for-timely-digital-exhibit-design/)
project. A projector puts a **1920×1080** image onto a matte tabletop. Visitors don't touch the image. They use
**physical tools**: shape-coded buttons, dials, sliders, toggles, and tangible objects (pucks, dice and a
"magic window") that a camera tracks with fiducial markers.

Point the simulator at your web page (the 1920×1080 image) and try it:

- **in a browser**: from above in a flat view, or in a 3D view of the table
- **in a Meta Quest headset** (WebXR): stand at the table and use the tools with your **hands**. Poke buttons, pinch the dial to turn it, and pick pucks up and set them down, in VR or in passthrough
- **on your website**: list your pieces in `works.json` and embed the simulator with an `<iframe>`

## Quick start

```bash
npm install
npm start                                     # the demos
npm start -- --target http://localhost:5173   # your content (any dev server or site)
npm start -- --content ./path/to/folder       # a local folder of static files
```

Open the URL it prints, e.g. `https://localhost:8443/__fastsim/`. The certificate is self-signed, so accept the warning once per device.

## Plain touch table (no tools)

To show any web page on a plain 1920×1080 touch table, with a black bezel and no tools, projector, pucks or buttons, use the `touch` layout.
It's the default for any URL you enter yourself.

- **In the toolbar:** choose **Custom URL…**, paste the address, keep **Touch table (no tools)**, then press **Load**. Switch between **Flat**, **3D** and **Enter VR** as usual.
- **As a link:** `/__fastsim/?src=<url>&layout=touch`

In touch mode the page sees a real touch device. `navigator.maxTouchPoints` is 10, `ontouchstart` exists, and `matchMedia('(pointer: coarse)')` / `(hover: none)` match.
So apps and libraries that check for a touchscreen use their touch code.
Drags send `pointermove` (with `movementX/Y`) and `touchmove` events. Like a real touchscreen, they don't send `mousemove`.
In the flat view, the mouse wheel scrolls whatever is under the pointer.

How interactive it is depends on where the page is hosted:

| Content | Flat view | 3D / VR |
| --- | --- | --- |
| **Another site**, e.g. `https://waiaroha-pipes.netlify.app/` typed into the box | Your real mouse or touchscreen works on the page directly | Not possible: the browser won't let the simulator read the page |
| **Through the dev server:** `npm start -- --target https://waiaroha-pipes.netlify.app` and open the printed `…/__fastsim/?src=/` | Mouse becomes touch, with simulated pinch (<kbd>Shift</kbd>+drag) and pan (<kbd>Ctrl</kbd>+drag) | Click on the table to touch it. In VR, touch it with your index finger. |
| **Same website as the simulator** (e.g. upload `dist/sim/` into your Netlify site and use `src: "../"`) | As above | As above |

## Tools and layouts

The tools on the table come from a **layout**. The presets follow the booklet's three templates:

| Layout | Template | Tools |
| --- | --- | --- |
| `objects` | A: Object Investigation | A tray of six pucks, a raised target circle with a tactile arrow, and a square language button |
| `quiz` | B: Quiz Show | Four stations (two per long side), each a box of ◆ ● ■ ▲ buttons |
| `dial` | C: Node Exploration | One dial with detents at the front edge |
| `sandbox` | — | One of each: buttons, dial, slider, toggle, pucks, magic window, die and target |
| `touch` | not FAST | A plain multi-touch table: no tools, black bezel, no projector (the default for custom URLs) |
| `open` | not FAST | The mouse goes straight to the page, for other interactive web work |

Choose one with `?layout=quiz`, or make your own JSON file and pass `?layout=my-layout.json`:

```json
{
  "name": "My exhibit",
  "pointer": "none",
  "tools": [
    { "type": "buttons", "id": "station1", "station": 1, "place": { "edge": "near", "at": 0.3 },
      "buttons": [ { "shape": "circle", "color": "#e5484d", "key": "1" }, { "shape": "square", "key": "2" } ] },
    { "type": "dial", "id": "dial", "place": { "edge": "near", "at": 0.7 }, "detents": 12, "keys": ["ArrowLeft", "ArrowRight"] },
    { "type": "slider", "id": "year", "place": { "edge": "right", "at": 0.5 }, "length": 0.2, "steps": 10 },
    { "type": "toggle", "id": "layers", "place": { "edge": "left", "at": 0.5 }, "key": "t" },
    { "type": "tray", "id": "tray", "place": { "edge": "near", "at": 0.5 }, "length": 0.5 },
    { "type": "tangible", "id": "shell", "marker": 3, "label": "Shell", "color": "#f0d9b5", "home": "tray" },
    { "type": "tangible", "id": "lens", "marker": 9, "kind": "window", "place": { "x": 1500, "y": 300 } },
    { "type": "dice", "id": "die", "marker": 20, "place": { "x": 300, "y": 800 } },
    { "type": "mark", "id": "target", "place": { "x": 1560, "y": 900 }, "radius": 0.05, "arrow": true }
  ]
}
```

- **`place`** is either a point on the image in pixels, `{ "x", "y", "angle" }`, or a spot on the rim, `{ "edge": "near" | "far" | "left" | "right", "at": 0–1 }`.
  `at` runs left to right as seen by the visitor standing at that edge, and rim tools face that visitor.
- **`key`/`keys`** make physical keys work in the simulator. With same-origin content they also send real `keydown`/`keyup` events, matching wired buttons wired up as a USB keyboard.
- **`home: "tray"`** puts a tangible in the tray. Pucks go back there when dropped off the table or double-clicked.

## What your content receives

Each tool action is sent to your page with `window.postMessage`. This works even when the page is on another site:

```js
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m?.type !== 'fast-input') return;
  // m.tool: 'button' | 'dial' | 'slider' | 'toggle' | 'tangible' | 'dice'
});
```

| tool | fields |
| --- | --- |
| `button` | `id`, `station`, `index`, `shape`, `state: 'down' \| 'up'` |
| `dial` | `id`, `delta: +1 \| -1` (one per detent; +1 is clockwise), `value` (running count), `angle` |
| `slider` | `id`, `value` 0–1, and `step` if the slider has `steps` |
| `toggle` | `id`, `on` |
| `tangible` | `id`, `marker`, `kind: 'puck' \| 'window'`, `state: 'placed' \| 'moved' \| 'lifted'`, `x`, `y` (image pixels), `angle` (degrees) |
| `dice` | the `tangible` fields, plus `face` 1–6 |

Tangibles behave like they do under the table's camera. They only count once they're **on the image**.
Picking one up sends `lifted`, and putting it down sends `placed`.

When your page loads (or whenever it posts `{ type: 'fast-get-layout' }` to its parent), it receives
`{ type: 'fast-layout', width, height, pxPerMeter, tools: [...] }`, with every tool's position in image pixels.
Use it to put text in front of each quiz station, draw arrows next to the dial, or highlight the target circle.

`public/demo/fast-client.js` wraps this up (`onFast`, `getLayout`, plus small `say` and `beep` helpers for the booklet's
"more than one modality" advice). The demos in `public/demo/` show each template in use.

## The 3D room

The 3D and VR views put the table in a gallery about 20 × 20 m, with a patterned museum carpet in warm colours.
One wall is floor-to-ceiling glass with slim vertical mullions. Through it you see a grassy square, a concrete path crossing it, trees and a blue sky.
The outside is real 3D geometry, so it has proper depth and parallax in VR.

Choose the table style with the picker in the toolbar (it appears in 3D view) or with `?furniture=`:

- **Table + stools**: the table on legs, with upholstered cylinder stools in several colours around it. The front-centre is left clear so you can stand there.
- **Steel plinth**: the top sits on a brushed-steel box with a dark toe-kick, as a museum installation would.

Passthrough hides the room and the stools so you can line the table up with your real surroundings.
Everything is drawn in code (`public/room.js`), so there are no images or models to download.

## Posters on the walls

The gallery walls hold New Zealand posters from [Te Papa's collection](https://collections.tepapa.govt.nz/): 1930s Railways tourism posters, the 1940 Centennial Exhibition, MacDonald Gill's map of New Zealand, health and home-front posters, and more.
Each hangs at its real size under a picture light. Its rights statement sits on a plaque underneath, with a museum caption label beside it.
Click a poster or its label (in VR: point and pinch, or pull the trigger) to open its Collections Online page. In VR this leaves the headset view first.

The posters are **cached in the repo** (`public/posters/`: images plus `posters.json`), so the simulator never calls the API and needs no key.
To change them:

1. Edit the ids in `posters.config.json`. You can use `{ "id": 605717, "title": "…" }` to override any field. You can also edit `public/posters/posters.json` directly.
2. Find candidates: `TEPAPA_API_KEY=<your key> npm run posters -- --search "railways poster"`
3. Rebuild the cache: `TEPAPA_API_KEY=<your key> npm run posters`

The script only caches images whose rights allow download, and it removes images that are no longer listed.
`TEPAPA_API_BASE` overrides the API (default: the v4 staging API). Keep your key out of the repo: pass it in the environment.

## Desktop controls

- **Buttons**: click them, or press their keys (quiz: `1`–`4`, `Q`–`R`, `A`–`F`, `Z`–`V`)
- **Dial**: drag around the knob, scroll over it, or press `←` / `→`
- **Slider**: drag. **Toggle**: click.
- **Pucks, window, die**: drag onto the image, scroll to rotate, double-click to put back. Click the die to roll it.
- **3D view**: the tools work the same way, and dragging anywhere else orbits the camera (right-drag pans, the wheel zooms)

## On the Quest 2

1. Run `npm start` on a computer on the same Wi-Fi as the headset.
2. In the Quest Browser, open the `Quest / LAN` URL it prints and accept the certificate warning.
3. Press **Enter VR**, or **Passthrough** to see your room. Put the controllers down to switch to hand tracking.

| Do this | To get |
| --- | --- |
| Poke a button or toggle with your fingertip | Press it |
| Pinch at the dial's edge and move around it | Turn it |
| Pinch a slider knob | Slide it |
| Pinch a puck, lift it and set it down | `lifted`, then `placed` where you put it. Turn your hand to rotate it. |
| Pinch while pointing at something out of reach | A ray that grabs or presses from a distance |
| Controller trigger | The same ray |
| Panel beside the table | Raise or lower the table, move it, recenter it, reset the work, exit |

In passthrough, use **Table ▲/▼** and **Recenter** to line the virtual table up with a real one, so your fingers hit something solid.

If the certificate is a problem: run `npm start -- --http --port 8080` and `adb reverse tcp:8080 tcp:8080`, then open `http://localhost:8080/__fastsim/` on the headset.

## Showcasing your work on your website

1. `npm run build`. This writes a static `dist/sim/` folder: the simulator, its libraries and the demos.
2. Edit `dist/sim/works.json` to list your pieces:
   ```json
   {
     "title": "Robin's FAST work",
     "works": [
       { "id": "tides", "title": "Tides", "description": "Turn the dial to move through a day.",
         "src": "/projects/tides/", "layout": "dial" }
     ]
   }
   ```
   `src` is relative to `works.json`. `layout` is a preset name or a path to your layout JSON.
3. Upload `dist/sim/` to your site (say at `/fast/`) and link to `/fast/?work=tides`, or embed it:
   ```html
   <iframe src="/fast/?work=tides&embed=1"
           style="width:100%; aspect-ratio:16/10; border:0"
           allow="xr-spatial-tracking; fullscreen; autoplay"></iframe>
   ```
   `embed=1` swaps the full toolbar for a small floating one, and adds a button that opens the simulator in its own tab.
   An embed pinned to one `work` doesn't show the work picker. Visitors with a Quest can press **Enter VR** right from your page.

**Host the works on the same site as the simulator.** The tools work with any URL, but drawing the
image onto the 3D/VR table needs same-origin access. A cross-origin work shows in the flat view only.

## URL parameters

| Param | Default | Meaning |
| --- | --- | --- |
| `work` | first in `works.json` | Which work to show |
| `src` / `layout` | `layout=touch` | Show any URL with any layout instead |
| `works` | `works.json` | Where to read the works list |
| `embed` | | `1` for the compact embed UI |
| `view` | `flat` | `flat` or `3d` |
| `width` | `1.6` | Width of the projected image on the table, metres |
| `height` | `0.81` | Floor to tabletop, metres |
| `border` | `0.16` | Tabletop rim around the image, where the edge tools sit, metres |
| `capture` | `auto` | How the page gets onto the 3D table: `auto`, `canvas` or `dom` |
| `domfps` | `8` | Maximum refresh rate for `dom` capture |
| `hands` | `mesh` | Hand model in VR: `mesh`, `spheres` or `boxes` |
| `furniture` | `stools` | Table style in 3D/VR: `stools` (table on legs, fabric stools around it) or `plinth` (brushed-steel box to the floor) |
| `fbscale` | `1` | XR resolution scale (higher is sharper and slower) |

## Notes and assumptions

- The booklet gives no measurements. The defaults are a 1.6 m wide image, a 0.81 m high table (usable sitting or standing, as the booklet recommends) and a 16 cm rim. Tool sizes are typical for arcade buttons and knobs.
- The FAST Toolkit's own software and input protocol aren't public in the booklet. The `fast-input` messages and key mappings here are this simulator's own, chosen to be easy to wire to real hardware (e.g. buttons through a USB keyboard encoder).
- **How the image reaches the 3D table:** a full-screen `<canvas>` app is copied every frame. A regular HTML page is redrawn with html2canvas when it changes, up to `domfps` times a second, with videos and canvases drawn on top live. Use the flat view to judge exactly how the page looks.
- **Dev server:** it serves the simulator at `/__fastsim/` and your content at every other path. It proxies `--target` (including WebSockets, so hot reload works), and injects `shim.js` into HTML pages. The shim keeps the page animating while VR is running, and keeps WebGL frames readable.

## Layout of this repo

```
server.js                 dev server: static files, proxy, shim injection, HTTPS
public/                   the simulator (served at /__fastsim/, built to dist/sim/)
  app.js                  page wiring: works, layouts, views, keyboard, embed mode
  layouts.js              tool layout presets and placement
  model.js                tool state + the messages sent to the content
  flat-view.js            top-down view with HTML tools
  table-scene.js          three.js table, WebXR hands/controllers, VR panel
  room.js                 gallery room, carpet, windows, stools and plinth
  posters.js              Te Papa posters, rights plaques and caption labels on the walls
  posters/                cached poster images + posters.json (from scripts/fetch-posters.js)
  tools3d.js              3D tools and their hand/mouse interaction
  touch-injector.js       touch/mouse events for the touch and open layouts
  content-capture.js      copies the page into a texture for the 3D table
  shim.js                 injected into content pages
  config.js               table size and URL options
  works.json              the works list
  demo/                   demo content for each template, plus fast-client.js
scripts/build-static.js   static build into dist/
scripts/fetch-posters.js  refreshes the poster cache from the Te Papa API
posters.config.json       which posters to hang
```
