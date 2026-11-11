// Background creams tried on the Prices page (Nov 11), shown by design/themes.html?set=creams.
// The user found #fbf7ee too white. Each one is the current look (Orange underline) with only the
// page, its darker fill (search box, row lines) and the border colour changed; the text colours stay.
const base = {
  cloud: '#2a1a08', mist: '#6b5438',
  meso: '#c04f00', exp: '#26703a', hp: '#b42318', ember: '#8a5f00', sky: '#005db7', onBright: '#fffaf0',
  selBg: 'transparent', selFg: '#2a1a08', selRing: '#c04f00', selCount: '#6b5438',
  chipFg: '#6b5438', thFg: '#6b5438', sortFg: '#943c00', tabOnBg: 'transparent', tabOnFg: '#2a1a08',
  headBg: 'transparent',
};
const cream = (id, name, about, night, dusk, ridge) => ({
  id, name, look: 'underline', about, chipWeight: 600,
  colors: { ...base, night, dusk, ridge, page: night, panel: night, search: dusk },
});

const THEMES = [
  cream('now', 'A. Now', 'The page as it is: #fbf7ee, nearly white.', '#fbf7ee', '#f0e8d6', '#d4c4a8'),
  cream('warm', 'B. Warm cream', '#f8f1e0: a step warmer, still light.', '#f8f1e0', '#ece2ca', '#d0be9e'),
  cream('parchment', 'C. Parchment', '#f5ecd7: clearly cream, not yet paper.', '#f5ecd7', '#e9dec2', '#cbb894'),
  cream('butter', 'D. Buttercream', '#f3e9cf: a deeper, yellower cream.', '#f3e9cf', '#e6d9b9', '#c8b38c'),
  cream('paper', 'E. Old paper', '#efe5ca: the darkest, like an old map.', '#efe5ca', '#e2d4b2', '#c3ad85'),
  cream('oat', 'F. Muted oat', '#f3ede0: greyer and less yellow.', '#f3ede0', '#e7ddc9', '#cdbfa5'),
];

if (typeof module !== 'undefined') module.exports = THEMES;
