// The website's item icons (site/icons.js), over a made-up bucket and a made-up OSMS.
const test = require('node:test');
const assert = require('node:assert');
const { createIcons } = require('../site/icons.js');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const items = { icons: { 'Iron Ore': 4010000, Leather: 4000021 }, clientBuild: 'b1' };

function setup({ answer = () => new Response(PNG), list = items } = {}) {
  const asked = [], stored = new Map();
  const bucket = {
    get: async key => (stored.has(key) ? { arrayBuffer: async () => stored.get(key).buffer } : null),
    put: async (key, body) => { stored.set(key, body); },
  };
  const fetch = async (url, options) => { asked.push({ url, agent: options.headers['User-Agent'] }); return answer(url); };
  const { handle } = createIcons(list, { fetch });
  const get = (path, method = 'GET') => handle(new Request(`https://maplescanner.app${path}`, { method }), { bucket });
  return { get, asked, stored };
}

test('an icon is downloaded from OSMS once and then served from the bucket', async () => {
  const { get, asked, stored } = setup();
  const first = await get('/icon/4010000.png');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), PNG);
  const again = await get('/icon/4010000.png');
  assert.deepEqual(new Uint8Array(await again.arrayBuffer()), PNG);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, 'https://osmsdataexplorer.com/data/current/images/items/04010000.png');
  assert.match(asked[0].agent, /MapleScanner/);
  assert.deepEqual([...stored.keys()], ['b1/4010000.png']);
});

test('an id that is not in the item list is never asked of OSMS', async () => {
  const { get, asked } = setup();
  assert.equal((await get('/icon/1234.png')).status, 404);
  assert.equal(asked.length, 0);
});

test('an address that is not an icon is left to the files', async () => {
  const { get } = setup();
  assert.equal(await get('/icon/../site.js'), null);
  assert.equal(await get('/icon/abc.png'), null);
  assert.equal(await get('/download'), null);
});

test('a failed download or something that is not a PNG is no icon, and is not kept', async () => {
  for (const answer of [() => new Response('gone', { status: 404 }), () => new Response('<html>'), () => new Response(new Uint8Array(300 * 1024))]) {
    const { get, stored } = setup({ answer });
    const res = await get('/icon/4000021.png');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('Cache-Control'), /max-age=600/);
    assert.equal(stored.size, 0);
  }
});

test('a new game build fetches its icons again', async () => {
  const shared = setup();
  await shared.get('/icon/4010000.png');
  const next = createIcons({ ...items, clientBuild: 'b2' }, { fetch: async () => new Response(PNG) });
  const stored = new Map();
  await next.handle(new Request('https://maplescanner.app/icon/4010000.png'), { bucket: { get: async () => null, put: async key => { stored.set(key, 1); } } });
  assert.deepEqual([...stored.keys()], ['b2/4010000.png']);
});

test('only reading is allowed', async () => {
  const { get } = setup();
  assert.equal((await get('/icon/4010000.png', 'POST')).status, 405);
});

// ---------- item pages and the sitemap (site/items.js), over a made-up price server ----------
const { createItemPages } = require('../site/items.js');
const { itemFacts } = require('../pricing.js');
const { marketFor, historyVotes } = require('../market.js');

const NOW = Date.UTC(2026, 10, 12, 12), HOUR = 36e5, DAY = 864e5;
const list = { names: ['Iron Ore', 'Leather', "Dragon's <Tail> & Co", 'Ilbi Throwing-Stars'], npc: { 'Iron Ore': 100 }, recharge: { 'Ilbi Throwing-Stars': 1 }, icons: {} };
const PAGE = '<head><!--item-head--><title>Free Market prices</title><!--/item-head--></head><body><!--item-summary--><section><h1>The list</h1></section><!--/item-summary--><main></main></body>';
const listing = (id, price, hoursAgo, more = {}) => ({ id, qty: 1, price, seller: `Seller${id}`, sold: 0, lastSeen: NOW - hoursAgo * HOUR, shop: `Shop title ${id}`, channel: 3, map: 'Free Market', room: 7, copies: 1, stats: null, ...more });
const ORE = [listing(1, 300, 2), listing(2, 320, 3), listing(3, 9999999, 5), listing(4, 310, 30, { sold: 1 }), listing(5, 290, 50, { sold: 1 })];

function site({ history = { 'Iron Ore': ORE }, items = [], down = false } = {}) {
  const asked = [], kept = new Map();
  const fetch = async url => {
    asked.push(url);
    if (down) return new Response('{}', { status: 500 });
    const at = new URL(url);
    if (at.pathname === '/v1/items') return Response.json({ items });
    return Response.json(history[at.searchParams.get('name')] ?? []);
  };
  const { handle } = createItemPages(list, { fetch, now: () => NOW });
  const cache = { match: async key => kept.get(key)?.clone(), put: async (key, res) => { kept.set(key, res); } };
  const get = (path, method = 'GET') => handle(new Request(`https://maplescanner.app${path}`, { method }),
    { assets: { fetch: async () => new Response(PAGE) }, cache, api: 'https://prices.test' });
  return { get, asked, kept };
}

test("an item's page has its own title, address and the card's figures", async () => {
  const { get, asked } = site();
  const res = await get('/item/iron-ore');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(asked[0], 'https://prices.test/v1/history?name=Iron%20Ore');
  assert.match(html, /<title>Iron Ore price · MapleStory Classic Free Market · MapleScanner<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/maplescanner\.app\/item\/iron-ore">/);
  assert.match(html, /<h1>Iron Ore price<\/h1>/);
  const usual = marketFor(historyVotes('Iron Ore', ORE, itemFacts(list)), { now: NOW });
  assert.ok(html.includes(`Iron Ore usually sells for ${usual.price.toLocaleString('en-US')} mesos each`), html);
  assert.ok(html.includes('Cheapest ask in the last 24 hours: 300.'));
  assert.ok(html.includes('Last sold for 310.'));
  assert.ok(html.includes('An NPC pays 100.'));
  assert.ok(html.includes('<time datetime="2026-11-12T10:00:00.000Z">12 Nov 2026</time>'));
  assert.doesNotMatch(html, /noindex/);
  assert.doesNotMatch(html, /Free Market prices<\/title>|The list/); // the list's own title and heading are replaced
  assert.ok(html.includes('<meta property="og:title" content="Iron Ore price">'));
  assert.ok(html.includes('<meta property="og:image" content="https://maplescanner.app/icon-512.png">'));
});

test("no seller, shop title or place is written into an item's page", async () => {
  const html = await (await site().get('/item/iron-ore')).text();
  assert.doesNotMatch(html, /Seller\d|Shop title|room|channel/i);
});

test('the page is kept for the next visitor, and a browser asks again each time', async () => {
  const { get, asked } = site();
  const first = await get('/item/iron-ore');
  assert.equal(first.headers.get('Cache-Control'), 'no-cache');
  const again = await get('/item/iron-ore');
  assert.equal(await again.text(), await first.text());
  assert.equal(asked.length, 1);
});

test('an item not seen in 14 days, or never, is left out of search engines', async () => {
  const old = await (await site({ history: { Leather: [listing(1, 500, 15 * 24)] } }).get('/item/leather')).text();
  assert.match(old, /<meta name="robots" content="noindex">/);
  assert.ok(old.includes('Leather has no usual price yet'), old);
  const never = await (await site().get('/item/leather')).text();
  assert.match(never, /noindex/);
  assert.ok(never.includes('No prices seen yet for Leather'));
});

test("a set of stars is priced as a set, and a name's marks are escaped", async () => {
  const stars = await (await site({ history: { 'Ilbi Throwing-Stars': [listing(1, 600000, 1, { qty: 4 })] } }).get('/item/ilbi-throwing-stars')).text();
  assert.ok(stars.includes('usually sells for 600K mesos a set'), stars);
  const odd = await (await site().get('/item/dragons-tail-co')).text();
  assert.ok(odd.includes('<h1>Dragon\'s &lt;Tail&gt; &amp; Co price</h1>'), odd);
  assert.doesNotMatch(odd, /<Tail>/);
});

test('an address that is no item is left for the 404 page, and a near one is sent to the real one', async () => {
  const { get, asked } = site();
  assert.equal(await get('/item/nothing-here'), null);
  assert.equal(await get('/about'), null);
  const moved = await get('/item/Iron%20Ore/');
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('Location'), 'https://maplescanner.app/item/iron-ore');
  assert.equal((await get('/item/iron-ore', 'POST')).status, 405);
  assert.equal(asked.length, 0);
});

test('with the price server away the page still opens, claims nothing and is not kept', async () => {
  const { get, kept } = site({ down: true });
  const html = await (await get('/item/iron-ore')).text();
  assert.match(html, /<h1>Iron Ore price<\/h1>/);
  assert.doesNotMatch(html, /usually sells|No prices seen|noindex/);
  assert.equal(kept.size, 0);
});

test('the sitemap lists the pages and only the items seen in the last 14 days', async () => {
  const items = [{ name: 'Iron Ore', last: NOW - DAY }, { name: 'Leather', last: NOW - 15 * DAY }, { name: 'Not An Item', last: NOW }];
  const res = await site({ items }).get('/sitemap.xml');
  const xml = await res.text();
  assert.match(res.headers.get('Content-Type'), /xml/);
  assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]),
    ['https://maplescanner.app/', 'https://maplescanner.app/download', 'https://maplescanner.app/about', 'https://maplescanner.app/item/iron-ore']);
  assert.ok(xml.includes('<lastmod>2026-11-11</lastmod>'));
  assert.equal((await site({ down: true }).get('/sitemap.xml')).status, 503);
});

test("the 404 page's picture is fetched from OSMS once, and only a real WebP is kept", async () => {
  const WEBP = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8X')]);
  const { get, asked, stored } = setup({ answer: () => new Response(WEBP) });
  const first = await get('/art/mano.webp');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Content-Type'), 'image/webp');
  await get('/art/mano.webp');
  assert.equal(asked.length, 1);
  assert.ok(asked[0].url.startsWith('https://osmsdataexplorer.com/data/images/monsters/') && asked[0].url.endsWith('.webp'), asked[0].url);
  assert.deepEqual([...stored.keys()], ['art/mano.webp']);
  assert.equal(await get('/art/other.webp'), null);
  const bad = setup(); // answers with a PNG
  assert.equal((await bad.get('/art/mano.webp')).status, 404);
  assert.equal(bad.stored.size, 0);
});
