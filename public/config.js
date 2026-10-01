// Table geometry and simulator options. Everything can be overridden with
// URL query parameters, e.g. ?src=/my-exhibit/&diag=55&height=0.86

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : d);

const width = 1920;
const height = 1080;
const diagInches = num('diag', 55); // visible screen diagonal
const diagM = diagInches * 0.0254;
const aspect = width / height;
const screenH = diagM / Math.sqrt(1 + aspect * aspect);

export const FAST = {
  width,
  height,
  diagInches,
  screenW: screenH * aspect, // metres
  screenD: screenH, // metres (depth of the screen across the table)
  tableHeight: num('height', 0.86), // floor to screen surface, metres
  tilt: num('tilt', 0), // degrees the surface tilts up toward the far side
  border: num('border', 0.12), // tabletop rim around the screen, metres
  standoff: num('standoff', 0.25) // gap between the viewer and the near edge, metres
};

export const OPTIONS = {
  src: q.get('src'),
  view: q.get('view') || 'flat', // flat | 3d
  capture: q.get('capture') || 'auto', // auto | canvas | dom
  domFps: num('domfps', 8),
  fingers: (q.get('fingers') || 'index').split(','), // index | all | thumb,index,...
  hands: q.get('hands') || 'mesh', // mesh | spheres | boxes
  pokeDown: num('poke', 0.012), // fingertip height (m) that counts as touching
  framebufferScale: num('fbscale', 1)
};

export function defaultSrc() {
  // Served by server.js: the content is proxied at the site root.
  if (location.pathname.startsWith('/__fastsim/')) return '/';
  return new URL('../demo/', location.href).pathname;
}
