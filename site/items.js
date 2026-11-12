// The website's item pages, at /item/<slug>, and its sitemap. An item page is the Prices page
// (site/dist/index.html) with that item's own title, description and a short written summary of
// its prices already in the HTML, so a search engine has something to read before any script
// runs. The visitor sees the Prices page with the item's card open (prices.js).
// The figures are worked out as the card works them out (historyVotes, marketFor and
// cheaperElsewhere in market.js), from the price server's /v1/history.
// Only prices are written here: no seller name, shop title or place (the user's choice, Nov 12),
// because they'd be searchable, and they're words an install could make up.
// Plain CommonJS with no Worker-only imports, so test/site.test.js runs it in Node.
const { SEEN_DAYS, itemSlug, itemFacts, fmt, esc } = require('../pricing.js');
const { marketFor, cheaperElsewhere, historyVotes } = require('../market.js');

const ORIGIN = 'https://maplescanner.app';
const ITEM_PATH = /^\/item\/([^/]+)\/?$/;
const DAY_MS = 864e5;
const PAGE_SECONDS = 600, SITEMAP_SECONDS = 3600;
const GAME = 'the MapleStory Classic Free Market';
// What build.js leaves in the page for this to fill
const HEAD = /<!--item-head-->[\s\S]*?<!--\/item-head-->/, SUMMARY = /<!--item-summary-->[\s\S]*?<!--\/item-summary-->/;

// What a link to a page shows where it's shared (Discord, Reddit): its title, a line about it and
// the site's icon. Used for every page, by build.js too. `address` is the whole address.
const shareTags = ({ title, description, address }) => `<meta property="og:type" content="website">
<meta property="og:site_name" content="MapleScanner">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(address)}">
<meta property="og:image" content="${ORIGIN}/icon-512.png">
<meta name="twitter:card" content="summary">`;

const dayText = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// assets: the site's files (fetch). cache: the Worker's edge cache, or nothing. api: the price
// server's address.
function createItemPages(itemList, { fetch = globalThis.fetch, now = Date.now } = {}) {
  const facts = itemFacts(itemList);
  const bySlug = new Map((itemList.names ?? []).map(name => [itemSlug(name), name]));

  async function ask(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`The price server answered ${res.status}`);
    return res.json();
  }

  // What the page says about an item, as sentences. `history` is null when the price server
  // couldn't be asked, and then nothing is claimed either way.
  function summary(name, history) {
    if (!history) return { sentences: [`${name} prices in ${GAME}, from shops scanned by MapleScanner players.`], recent: true };
    const at = now(), npc = facts.npc(name);
    const npcLine = npc != null ? [`An NPC pays ${fmt(npc)}.`] : [];
    if (!history.length) return { sentences: [`No prices seen yet for ${name} in ${GAME}.`, ...npcLine], recent: false };

    const votes = historyVotes(name, history, facts);
    const usual = marketFor(votes, { now: at });
    const low = cheaperElsewhere(votes, Infinity, { now: at, within: DAY_MS });
    const lastSold = votes.filter(v => v.sold).sort((a, b) => b.t - a.t)[0];
    const last = Math.max(...votes.map(v => v.t));
    const each = facts.recharges(name) ? 'a set' : 'each';
    const sentences = [];
    if (usual?.price != null) {
      sentences.push(`${name} usually sells for ${fmt(usual.price)} mesos ${each} in ${GAME}.`);
      // A gear name mixes clean and scrolled copies, which only the card's Stats filter separates
      if (facts.slots(name) != null) sentences.push('That is over every copy, clean and scrolled.');
    } else sentences.push(`${name} has no usual price yet in ${GAME}.`);
    if (low) sentences.push(`Cheapest ask in the last 24 hours: ${fmt(low.u)}.`);
    if (lastSold) sentences.push(`Last sold for ${fmt(lastSold.u)}.`);
    sentences.push(...npcLine);
    return { sentences, last, recent: at - last <= SEEN_DAYS * DAY_MS };
  }

  function fill(page, name, { sentences, last, recent }) {
    const address = `${ORIGIN}/item/${itemSlug(name)}`;
    const title = `${name} price · MapleStory Classic Free Market · MapleScanner`;
    const seen = last ? ` Last seen ${dayText(last)}.` : '';
    const text = sentences.join(' ') + seen;
    const head = `<title>${esc(title)}</title>
<meta name="description" content="${esc(text)}">
<link rel="canonical" href="${address}">
${shareTags({ title: `${name} price`, description: text, address })}${recent ? '' : '\n<meta name="robots" content="noindex">'}`;
    const when = last ? ` Last seen <time datetime="${new Date(last).toISOString()}">${dayText(last)}</time>.` : '';
    const block = `<section class="item-summary" id="itemSummary"><h1>${esc(name)} price</h1><p>${esc(sentences.join(' '))}${when}</p></section>`;
    return page.replace(HEAD, () => head).replace(SUMMARY, () => block);
  }

  // Search engines and the edge keep a copy for a while. A browser asks again each time, so a
  // new version of the site shows at once.
  const toBrowser = stored => {
    const res = new Response(stored.body, stored);
    res.headers.set('Cache-Control', 'no-cache');
    return res;
  };

  async function itemPage(request, url, match, { assets, cache, waitUntil, api }) {
    let slug;
    try { slug = decodeURIComponent(match[1]); } catch { return null; }
    const name = bySlug.get(itemSlug(slug));
    if (!name) return null; // not an item: the caller answers with the 404 page
    const path = `/item/${itemSlug(name)}`;
    if (url.pathname !== path) return Response.redirect(`${url.origin}${path}`, 301);

    const key = `${url.origin}${path}`;
    const cached = await cache?.match(key);
    if (cached) return toBrowser(cached);

    const page = await (await assets.fetch(new Request(`${url.origin}/`))).text();
    let history = null;
    try { history = await ask(`${api}/v1/history?name=${encodeURIComponent(name)}`); } catch (err) { console.error(`Item page ${name}: ${err.message}`); }
    const stored = new Response(fill(page, name, summary(name, history)), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `public, max-age=${PAGE_SECONDS}` },
    });
    // A page written while the price server was away isn't kept
    if (cache && history) waitUntil(cache.put(key, stored.clone()));
    return toBrowser(stored);
  }

  // The site's pages, and every item seen in the last SEEN_DAYS: the items whose pages have
  // prices to show. The rest are left for a search engine to skip (noindex on the page).
  async function sitemap(url, { cache, waitUntil, api }) {
    const key = `${url.origin}/sitemap.xml`;
    const cached = await cache?.match(key);
    if (cached) return cached;
    let items;
    try { ({ items } = await ask(`${api}/v1/items`)); } catch (err) {
      console.error(`Sitemap: ${err.message}`);
      // not an empty sitemap, which would say the items are gone
      return new Response('The price server is not answering. Try again soon.', { status: 503, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
    }
    const since = now() - SEEN_DAYS * DAY_MS;
    const entry = (path, last) => `<url><loc>${esc(ORIGIN + path)}</loc>${last ? `<lastmod>${new Date(last).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
    const urls = [
      entry('/'), entry('/download'), entry('/about'),
      ...items.filter(i => i.last > since && bySlug.has(itemSlug(i.name))).map(i => entry(`/item/${itemSlug(i.name)}`, i.last)),
    ];
    const res = new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': `public, max-age=${SITEMAP_SECONDS}` },
    });
    if (cache) waitUntil(cache.put(key, res.clone()));
    return res;
  }

  // The answer for an item page or the sitemap, or null when the address is neither.
  async function handle(request, { assets, cache, waitUntil = () => {}, api }) {
    const url = new URL(request.url);
    const match = ITEM_PATH.exec(url.pathname);
    if (!match && url.pathname !== '/sitemap.xml') return null;
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    return match ? itemPage(request, url, match, { assets, cache, waitUntil, api }) : sitemap(url, { cache, waitUntil, api });
  }

  return { handle };
}

module.exports = { createItemPages, shareTags, ORIGIN };
