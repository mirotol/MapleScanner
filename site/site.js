// The website's link to the shared price database. The Prices page (prices.html, prices.js) is the
// app's own, built into the site by build.js. In the app it asks the local server (serve.js) for
// /api/state and /api/history. Here those are answered in the browser, straight from the price
// server's public reads, with the same code that judges prices in the app (pricing.js, market.js).
// The website only reads: it has no install key and uploads nothing.
globalThis.PUBLIC_SITE = true; // read by pricing.js and prices.js

(() => {
  // A page opened from this computer is being worked on, so it asks the local Worker
  // (npm run cloud:dev), never the real price server.
  const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
  const API = LOCAL ? 'http://127.0.0.1:8787' : 'https://api.maplescanner.app';
  const DAY_MS = 864e5;
  const REFRESH_MS = 60e3;

  const listings = new Map(); // id -> listing, the last SEEN_DAYS only, as cloud.js keeps them
  let cursor = '0:0', items = null, itemList = null, facts = null;

  async function get(url) {
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(15e3) }); } catch { throw new Error("Can't reach the price server."); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The price server answered ${res.status}`);
    return data;
  }

  async function sync() {
    for (let more = true; more;) {
      const page = await get(`${API}/v1/sync?after=${cursor}`);
      for (const l of page.listings) listings.set(l.id, l);
      for (const id of page.removed) listings.delete(id);
      cursor = page.cursor;
      more = page.more;
    }
    const since = Date.now() - SEEN_DAYS * DAY_MS;
    for (const [id, l] of listings) if (l.lastSeen <= since) listings.delete(id);
  }

  // The shape serve.js gives the page: { items, seen, status }. When the price server can't be
  // reached, what was loaded before stays on show and the page says it's offline.
  async function state() {
    let online = true;
    try {
      await sync();
      items = (await get(`${API}/v1/items`)).items;
    } catch (err) {
      if (!items) throw err;
      online = false;
    }
    return { items, seen: marketState(listings.values(), facts).seen, status: { connected: true, online } };
  }

  window.api = async path => {
    if (path === 'osms-items.json') {
      itemList ??= get('osms-items.json');
      facts = itemFacts(await itemList);
      return itemList;
    }
    if (path.startsWith('/api/state')) return state();
    if (path.startsWith('/api/history?')) return get(`${API}/v1/history${path.slice(path.indexOf('?'))}`);
    throw new Error(`The website has no ${path}.`);
  };

  // The app reloads the list each time its Prices tab is opened. A web page stays open, so it
  // asks for what's new once a minute while it's being looked at.
  setInterval(() => { if (!document.hidden) window.reload?.().catch(() => {}); }, REFRESH_MS);
})();
