// Measures the text colours of each theme in themes.js against what they sit on (WCAG 2 contrast).
// Small text needs 4.5, a pill's outline or a chart mark 3. Run: node design/check-contrast.js
const THEMES = require('./themes.js');

const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const solid = (c, under) => c === 'transparent' ? under : c;

let failed = 0;
for (const t of THEMES) {
  const c = t.colors;
  const pairs = [
    ['text', c.cloud, c.panel, 4.5],
    ['muted text', c.mist, c.panel, 4.5],
    ['muted on hover row', c.mist, c.dusk, 4.5],
    ['placeholder', c.mist, c.search, 4.5],
    ['where to walk', c.sky, c.panel, 4.5],
    ['header', c.thFg, solid(c.headBg, c.panel), 4.5],
    ['sorted header', c.sortFg, solid(c.headBg, c.panel), 4.5],
    ['pill label', c.chipFg, c.page, 4.5],
    ['chosen pill', c.selFg, solid(c.selBg, c.page), 4.5],
    ['chosen count', c.selCount, solid(c.selBg, c.page), 4.5],
    ['chosen tab', c.tabOnFg, solid(c.tabOnBg, c.night), 4.5],
    ['pill outline', c.ridge, c.page, 1.4], // decoration only: the label says what it is
    ['chosen ring', solid(c.selRing, solid(c.selBg, c.page)), c.page, t.look === 'underline' ? 3 : 1],
    ['button on orange', c.onBright, c.meso, 4.5],
    ['sold mark', c.meso, c.panel, 3],
    ['good', c.exp, c.panel, 4.5],
    ['over', c.hp, c.panel, 4.5],
    ['look closer', c.ember, c.panel, 4.5],
  ];
  console.log(`\n${t.name}`);
  for (const [what, fg, bg, need] of pairs) {
    const r = ratio(fg, bg);
    const bad = r < need;
    if (bad) failed++;
    console.log(`  ${bad ? 'LOW ' : '    '}${what.padEnd(20)} ${r.toFixed(2).padStart(5)}  (needs ${need})`);
  }
}
console.log(failed ? `\n${failed} too low` : '\nall fine');
process.exitCode = failed ? 1 : 0;
