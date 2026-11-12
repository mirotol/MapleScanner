// Builds the website into site/dist, which Cloudflare serves as plain files (wrangler.jsonc).
//   npm run site:build
// The site's own pages are in this folder. Its front page is the Prices page, which is the app's (prices.html, prices.js,
// pricing.js, market.js, theme.css), copied here with the site's header and site.js added, so
// there's one Prices page to change and the website follows. No game pictures or icons go in.
const fs = require('fs');
const path = require('path');

const { shareTags, ORIGIN } = require('./items.js');
const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'dist');

// On a phone the links fold into a menu button (site.css, head.js).
const HEAD = current => `<header class="site-head">
  <a class="brand" href="/"><img src="/favicon.svg" alt="" width="26" height="26">MapleScanner</a>
  <nav aria-label="Site" id="siteNav">
    <a href="/"${current === 'prices' ? ' aria-current="page"' : ''}>Prices</a>
    <a href="/download"${current === 'download' ? ' aria-current="page"' : ''}>Download</a>
    <a href="/about"${current === 'about' ? ' aria-current="page"' : ''}>About</a>
  </nav>
  <button type="button" id="themePick" class="head-button" aria-label="Switch light or dark"></button>
  <button type="button" id="menuButton" class="head-button menu-button" aria-label="Menu" aria-controls="siteNav" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="bars" d="M4 7h16M4 12h16M4 17h16"/><path class="cross" d="M6 6l12 12M18 6L6 18"/></svg></button>
</header>`;
// In <head>, so a saved light or dark choice applies before the page is drawn (head.js).
// From the top, because the 404 page is shown at any address (/item/nothing).
// The site's icon goes on every page with it.
// The .ico is for browsers that don't take an SVG (older Safari), which pick the last they can use.
const THEME_PICK = '<link rel="icon" href="/favicon.ico" sizes="32x32">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<script src="/head.js"></script>\n</head>';

const FOOT = `<footer class="site-foot">
  <p>MapleStory and its game content are © Nexon. MapleScanner is an unofficial fan project, not affiliated with or endorsed by Nexon. <a href="/about#credits">Licences and credits</a></p>
</footer>`;

// A page's own words are already written for HTML, and shareTags writes them so again
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The front page's title, worded as LIST_TITLE in prices.js, and its line about itself
const LIST = {
  heading: 'MapleStory Classic Free Market prices',
  description: 'What items sell for in the MapleStory Classic Free Market, from shops scanned by MapleScanner players.',
};

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
for (const file of ['site.css', 'site.js', 'head.js', 'robots.txt', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-512.png']) fs.copyFileSync(path.join(__dirname, file), path.join(out, file));

for (const [file, current] of [['download.html', 'download'], ['about.html', 'about'], ['404.html', null]]) {
  let page = swap(fs.readFileSync(path.join(__dirname, file), 'utf8'), '<!--site-head-->', HEAD(current), file);
  if (current) page = swap(page, '<!--site-foot-->', FOOT, file);
  if (current) {
    // its address for search engines, and what a link to it shows where it's shared
    const title = /<title>(.*?)<\/title>/.exec(page)?.[1], description = /<meta name="description" content="(.*?)">/.exec(page)?.[1];
    if (!title || !description) throw new Error(`${file} needs a title and a description.`);
    const address = `${ORIGIN}/${current}`;
    page = swap(page, '</head>', `<link rel="canonical" href="${address}">\n${shareTags({ title: unesc(title), description: unesc(description), address })}\n</head>`, file);
  }
  page = swap(page, '</head>', THEME_PICK, file);
  fs.writeFileSync(path.join(out, file), page);
}

let prices = fs.readFileSync(path.join(root, 'prices.html'), 'utf8');
// The Worker serves this page for every item too, at /item/<slug> (items.js). It writes that
// item's own title, description and address between the item-head marks, and a summary of its
// prices in place of item-summary.
prices = swap(prices, '<title>Price Database</title>', `<!--item-head--><title>${LIST.heading} · MapleScanner</title>
<meta name="description" content="${LIST.description}">
<link rel="canonical" href="${ORIGIN}/">
${shareTags({ title: LIST.heading, description: LIST.description, address: `${ORIGIN}/` })}<!--/item-head-->`, 'prices.html');
prices = swap(prices, '<link rel="stylesheet" href="theme.css">', '<link rel="stylesheet" href="theme.css">\n<link rel="stylesheet" href="site.css">', 'prices.html');
prices = swap(prices, '</head>', THEME_PICK, 'prices.html');
// The front page says what it is in a heading and a line, where an item's page has its summary
prices = swap(prices, '<body>',`<body>\n${HEAD('prices')}\n<!--item-summary--><section class="item-summary"><h1>${LIST.heading}</h1><p>What items sell for, from shops scanned by MapleScanner players.</p></section><!--/item-summary-->`, 'prices.html');
// site.js goes after pricing.js, whose `api` it replaces, and before prices.js, which calls it
prices = swap(prices, '<script src="market.js"></script>', '<script src="market.js"></script>\n<script src="site.js"></script>', 'prices.html');
// Under /item/ a file named without its folder would be looked for in /item/, so every file
// the page names starts from the top
prices = prices.replace(/\b(src|href)="(?![/#]|[a-z]+:)/g, '$1="/');
fs.writeFileSync(path.join(out, 'index.html'), prices); // the site's front page, and every item's page

console.log(`Built the website in ${path.relative(root, out)}`);
