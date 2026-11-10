// The app's link to the shared price database (the Worker in cloud/). No listing data is kept on
// the player's PC: the last SEEN_DAYS of listings are held in memory, kept fresh by syncing, and
// scans wait in memory until they're sent. A scan that was never sent is lost when the app closes.
//
// The stall card asks for the state after every scan, several times a second, so the state is
// answered from memory and rebuilt only when the listings change.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SEEN_DAYS } = require('./pricing.js');
const { listingRules } = require('./listing.js');

// The live Worker (cloud/), on the app's own domain. CLOUD_URL overrides it, such as for the local
// Worker (npm run cloud:dev).
const PRODUCTION_URL = 'https://api.maplescanner.app';

const DAY_MS = 864e5;
const BATCH = 500;          // the Worker's limit per upload
const TIMEOUT_MS = 15e3;

class BadInput extends Error {}

// The anonymous key this install uploads with, made on first use. It's kept with the settings and
// says nothing about the player. The Worker stores only a hash of it.
function installKey(dir) {
  const file = path.join(dir, 'install.json');
  try {
    const { key } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (/^[0-9a-f]{64}$/.test(key)) return key;
  } catch {} // none yet, or damaged: a new one
  const key = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ key })}\n`);
  return key;
}

// The same listing (seller, amount, price, sold) read again. The stall card reads the open shop
// several times a second, so a listing is only sent again when the read adds something (a channel,
// a title, stats) or after `resendAfter`, which keeps its last-seen time fresh enough.
const listingKey = l => `${l.name}|${l.seller}|${l.qty}|${l.price}|${l.sold}`;
const EXTRA = ['copies', 'channel', 'map', 'room', 'shop', 'stats'];

function createCloud({ url, key, itemList, fetch = globalThis.fetch, now = Date.now, syncEvery = 30e3, sendEvery = 5e3, resendAfter = 10 * 60e3, log = console }) {
  const rules = listingRules(itemList);
  const { facts } = rules;
  const listings = new Map(); // id -> listing with its item name, the last SEEN_DAYS only
  let cursor = '0:0';
  let items = null, itemsAt = 0; // the Worker's item list, fetched when the Prices page asks
  let queue = [];               // cleaned listings waiting to be sent, one per listingKey
  const sent = new Map();       // listingKey -> { at, extra } of the last one sent
  let version = 0, built = null;
  let online = null, lastSync = null, blocked = false, error = null;
  let sending = false, syncing = null, timers = [];

  const call = async (method, route, body) => {
    if (!url) throw new Error('No price server is set.');
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(method === 'POST' ? { 'X-Install-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `The price server answered ${res.status}`), { status: res.status });
    return data;
  };
  const reachable = ok => { online = ok; if (ok) error = null; };

  // ---------- scans out ----------

  // Takes one scan's rows, as the stall card sends them. A row that can't be a listing at all is a
  // bug, so the whole scan is refused, as the old database did. A row whose name isn't a real item
  // is left out.
  function add(rows) {
    if (!Array.isArray(rows)) throw new BadInput('Expected a list of rows.');
    const bad = rows.map(rules.problem).find(Boolean);
    if (bad) throw new BadInput(bad);
    const t = now();
    let kept = 0;
    for (const row of rows) {
      const l = rules.clean({ ...row, at: row.at ?? t }, t);
      if (!l) continue;
      kept++;
      const k = listingKey(l), last = sent.get(k);
      const adds = !last || EXTRA.some(f => l[f] != null && l[f] !== last.extra[f]);
      if (!adds && t - last.at < resendAfter) continue;
      queue = queue.filter(q => listingKey(q) !== k).concat(l);
    }
    return { saved: kept, skipped: rows.length - kept };
  }

  async function send() {
    if (sending || !queue.length || blocked) return;
    sending = true;
    const batch = queue.slice(0, BATCH);
    try {
      await call('POST', '/v1/listings', { rows: batch.map(({ at, ...l }) => ({ ...l, list: 'shop', sold: !!l.sold, at })) });
      queue = queue.filter(q => !batch.includes(q));
      for (const l of batch) sent.set(listingKey(l), { at: l.at, extra: Object.fromEntries(EXTRA.map(f => [f, l[f]])) });
      reachable(true);
      sync().catch(() => {}); // so the player's own scans show up in the prices soon
    } catch (err) {
      if (err.status === 403) { blocked = true; queue = []; }
      else if (err.status === 400 || err.status === 401) queue = queue.filter(q => !batch.includes(q)); // never accepted, so don't retry
      else if (err.status !== 429) reachable(false); // too many: just wait for the next turn
      error = err.message;
      log.error?.(`Upload failed: ${err.message}`);
    } finally {
      sending = false;
    }
  }

  // ---------- listings in ----------

  function sync() {
    syncing ??= (async () => {
      try {
        let more = true, changed = false;
        while (more) {
          const page = await call('GET', `/v1/sync?after=${cursor}`);
          for (const l of page.listings) listings.set(l.id, l);
          for (const id of page.removed) listings.delete(id);
          changed ||= page.listings.length > 0 || page.removed.length > 0;
          cursor = page.cursor;
          more = page.more;
        }
        const since = now() - SEEN_DAYS * DAY_MS;
        for (const [id, l] of listings) if (l.lastSeen <= since) { listings.delete(id); changed = true; }
        if (changed) { version++; items = null; }
        lastSync = now();
        reachable(true);
      } catch (err) {
        reachable(false);
        error = err.message;
        throw err;
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  // The Prices list needs every item ever listed, with its counts. That's a bigger read for the
  // Worker, so it's only fetched when the Prices page asks, and at most once a minute.
  async function allItems() {
    if (!items || now() - itemsAt > 60e3) {
      try {
        items = (await call('GET', '/v1/items')).items;
        itemsAt = now();
      } catch (err) {
        if (!items) throw err;
      }
    }
    return items;
  }

  function status() {
    return { online, lastSync, waiting: queue.length, blocked, error, connected: !!url };
  }

  // What the pages need to judge prices, in the shape the old local database gave:
  // { items: [{ name, listings, soldListings, last }], seen: { name: [vote] }, status }.
  // Without `full`, the items are the ones with recent listings, counted from those.
  async function state({ full = false } = {}) {
    if (!built || built.version !== version) {
      const seen = {}, counts = new Map();
      for (const l of listings.values()) {
        (seen[l.name] ||= []).push({
          u: facts.unitPrice(l.name, l.qty, l.price), s: l.seller, sold: !!l.sold, t: l.lastSeen, qty: l.qty, copies: l.copies,
          channel: l.channel, map: l.map, room: l.room, shop: l.shop, stats: l.stats ? JSON.parse(l.stats) : null,
        });
        const c = counts.get(l.name) ?? { name: l.name, listings: 0, soldListings: 0, last: 0 };
        c.listings++; c.soldListings += l.sold ? 1 : 0; c.last = Math.max(c.last, l.lastSeen);
        counts.set(l.name, c);
      }
      built = { version, seen, recent: [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })) };
    }
    const list = full ? await allItems().catch(() => built.recent) : built.recent;
    return { items: list, seen: built.seen, status: status() };
  }

  async function history(name) {
    if (!rules.realName(name)) throw new BadInput('That item is not in the database.');
    return call('GET', `/v1/history?name=${encodeURIComponent(rules.realName(name))}`);
  }

  function start() {
    const tick = (fn, ms) => { const t = setInterval(() => fn().catch(() => {}), ms); t.unref?.(); timers.push(t); };
    if (!url) { error = 'No price server is set.'; return; }
    sync().catch(err => log.error?.(`Sync failed: ${err.message}`));
    tick(sync, syncEvery);
    tick(send, sendEvery);
  }

  function stop() { timers.forEach(clearInterval); timers = []; }

  return { add, send, sync, state, history, status, start, stop };
}

module.exports = { createCloud, installKey, BadInput, PRODUCTION_URL };
