// Builds the website into site/dist, which Cloudflare serves as plain files (wrangler.jsonc).
//   npm run site:build
// The site's own pages are in this folder. Its front page is the Prices page, which is the app's (prices.html, prices.js,
// pricing.js, market.js, theme.css), copied here with the site's header and site.js added, so
// there's one Prices page to change and the website follows. No game pictures or icons go in.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'dist');

const HEAD = current => `<header class="site-head">
  <a class="brand" href="/">MapleScanner</a>
  <nav aria-label="Site">
    <a href="/"${current === 'prices' ? ' aria-current="page"' : ''}>Prices</a>
    <a href="/download"${current === 'download' ? ' aria-current="page"' : ''}>Download</a>
    <a href="/about"${current === 'about' ? ' aria-current="page"' : ''}>About</a>
  </nav>
  <button type="button" id="themePick" class="theme-pick" aria-label="Switch light or dark"></button>
</header>`;
// In <head>, so a saved light or dark choice applies before the page is drawn (theme-pick.js).
const THEME_PICK = '<script src="theme-pick.js"></script>\n</head>';

const FOOT = `<footer class="site-foot">
  <p>MapleStory and its game content are © Nexon. MapleScanner is an unofficial fan project, not affiliated with or endorsed by Nexon. <a href="/about#credits">Licences and credits</a></p>
</footer>`;

// Replaces `from` once, and fails the build if the page no longer has it.
function swap(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`${file} no longer has ${from}, which the site build replaces.`);
  return text.replace(from, () => to);
}

// Emptied, not removed: `wrangler dev` watches the folder, and stopped seeing new pages once it
// had been deleted (Nov 10).
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(out)) fs.rmSync(path.join(out, name), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'));

for (const file of ['theme.css', 'pricing.js', 'market.js', 'prices.js', 'osms-items.json']) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const file of fs.readdirSync(path.join(root, 'fonts'))) fs.copyFileSync(path.join(root, 'fonts', file), path.join(out, 'fonts', file));
for (const file of ['site.css', 'site.js', 'theme-pick.js']) fs.copyFileSync(path.join(__dirname, file), path.join(out, file));

for (const [file, current] of [['download.html', 'download'], ['about.html', 'about'], ['404.html', null]]) {
  let page = swap(fs.readFileSync(path.join(__dirname, file), 'utf8'), '<!--site-head-->', HEAD(current), file);
  if (current) page = swap(page, '<!--site-foot-->', FOOT, file);
  page = swap(page, '</head>', THEME_PICK, file);
  fs.writeFileSync(path.join(out, file), page);
}

let prices = fs.readFileSync(path.join(root, 'prices.html'), 'utf8');
prices = swap(prices, '<title>Price Database</title>', `<title>Free Market prices · MapleScanner</title>
<meta name="description" content="What items sell for in the MapleStory Classic Free Market, from shops scanned by MapleScanner players.">`, 'prices.html');
prices = swap(prices, '<link rel="stylesheet" href="theme.css">', '<link rel="stylesheet" href="theme.css">\n<link rel="stylesheet" href="site.css">', 'prices.html');
prices = swap(prices, '</head>', THEME_PICK, 'prices.html');
prices = swap(prices, '<body>',`<body>\n${HEAD('prices')}`, 'prices.html');
// site.js goes after pricing.js, whose `api` it replaces, and before prices.js, which calls it
prices = swap(prices, '<script src="market.js"></script>', '<script src="market.js"></script>\n<script src="site.js"></script>', 'prices.html');
fs.writeFileSync(path.join(out, 'index.html'), prices); // the site's front page

console.log(`Built the website in ${path.relative(root, out)}`);
