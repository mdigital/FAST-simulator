// Table geometry and simulator options. Everything can be overridden with
// URL query parameters, e.g. ?layout=quiz&width=1.8&height=0.8
//
// The FAST table (Museum of Science, Boston) is a projector shining a
// 1920x1080 image down onto a matte tabletop, with physical tools (buttons,
// dials, sliders, toggles, tangible objects) around and on it. The booklet
// gives no dimensions, so the physical sizes below are assumptions.

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : d);

const width = 1920;
const height = 1080;
const projW = num('width', 1.6); // width of the projected image on the table, metres

export const FAST = {
  width,
  height,
  projW,
  projD: projW * (height / width), // depth of the projected image, metres
  pxPerM: width / projW,
  tableHeight: num('height', 0.81), // floor to tabletop; usable sitting or standing
  border: num('border', 0.16), // tabletop rim around the image, where edge tools sit
  standoff: num('standoff', 0.3) // gap between the viewer and the near edge in VR, metres
};

export const OPTIONS = {
  src: q.get('src'),
  layout: q.get('layout'),
  work: q.get('work'),
  works: q.get('works') || 'works.json',
  embed: q.has('embed') && q.get('embed') !== '0',
  view: q.get('view') || 'flat', // flat | 3d
  capture: q.get('capture') || 'auto', // auto | canvas | dom
  domFps: num('domfps', 8),
  hands: q.get('hands') || 'mesh', // mesh | spheres | boxes
  pokeDown: num('poke', 0.012), // fingertip height (m) that counts as touching
  framebufferScale: num('fbscale', 1)
};

export function defaultSrc() {
  return new URL('demo/sandbox/', location.href).href;
}
