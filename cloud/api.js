// The shared price database's API, run as a Cloudflare Worker (index.js) over D1. Plain CommonJS
// with no Worker-only imports, so test/cloud.test.js runs it in Node over a D1-like shim.
//
//   GET  /v1/sync?after=<updated>:<id>  listings changed since the cursor, last SEEN_DAYS only
//   GET  /v1/items                      every item with listings, with its counts
//   GET  /v1/history?name=<item>        every listing of one item
//   POST /v1/listings                   an install's scans: X-Install-Key header, { rows }
//   POST /v1/admin/...                  the author's fixes, with Authorization: Bearer <ADMIN_TOKEN>
const { listingRules } = require('../listing.js');
const { SEEN_DAYS } = require('../pricing.js');

const DAY_MS = 864e5;
const SYNC_PAGE = 5000;
const MAX_ROWS = 500;
const MAX_BODY = 1024 * 1024;
const INSTALL_KEY = /^[0-9a-f]{64}$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const LISTING_FIELDS = `l.id, l.seller, l.qty, l.price, l.sold, l.copies, l.first_seen AS firstSeen, l.last_seen AS lastSeen,
  l.channel, l.map, l.room, l.shop, l.stats`;

// The merge rule for a listing seen again: the most copies, the widest dates, and the newest
// place, title and stats that were read, never erased by a read that missed them.
const UPSERT_LISTING = `
  INSERT INTO listings (item_id, seller, qty, price, sold, copies, first_seen, last_seen, channel, map, room, shop, stats, updated)
  VALUES ((SELECT id FROM items WHERE name = ?1), ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
  ON CONFLICT (item_id, seller, qty, price, sold) DO UPDATE SET
    copies = MAX(copies, excluded.copies),
    first_seen = MIN(first_seen, excluded.first_seen),
    last_seen = MAX(last_seen, excluded.last_seen),
    channel = COALESCE(excluded.channel, channel),
    map = COALESCE(excluded.map, map),
    room = COALESCE(excluded.room, room),
    shop = COALESCE(excluded.shop, shop),
    stats = COALESCE(excluded.stats, stats),
    updated = excluded.updated`;

const UPSERT_REPORT = `
  INSERT INTO reports (listing_id, uploader_id, first_seen, last_seen)
  VALUES ((SELECT l.id FROM listings l JOIN items i ON i.id = l.item_id
           WHERE i.name = ?1 AND l.seller = ?2 AND l.qty = ?3 AND l.price = ?4 AND l.sold = ?5), ?6, ?7, ?8)
  ON CONFLICT (listing_id, uploader_id) DO UPDATE SET
    first_seen = MIN(first_seen, excluded.first_seen), last_seen = MAX(last_seen, excluded.last_seen)`;

function createApi(itemList, { syncPage = SYNC_PAGE } = {}) {
  const rules = listingRules(itemList);

  const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra },
  });

  async function readJson(request) {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new HttpError(413, 'Too much at once.');
    try { return JSON.parse(text); } catch { throw new HttpError(400, 'That is not valid JSON.'); }
  }

  async function sha256(text) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  // The statements that save one cleaned listing and who reported it.
  const saveListing = (db, l, uploaderId, firstSeen, lastSeen, now) => [
    db.prepare('INSERT INTO items (name, added) VALUES (?1, ?2) ON CONFLICT (name) DO NOTHING').bind(l.name, now),
    db.prepare(UPSERT_LISTING).bind(l.name, l.seller, l.qty, l.price, l.sold, l.copies, firstSeen, lastSeen, l.channel, l.map, l.room, l.shop, l.stats, now),
    db.prepare(UPSERT_REPORT).bind(l.name, l.seller, l.qty, l.price, l.sold, uploaderId, firstSeen, lastSeen),
  ];

  async function uploaderFor(db, key, now) {
    const hash = await sha256(key);
    await db.prepare('INSERT INTO uploaders (key_hash, created) VALUES (?1, ?2) ON CONFLICT (key_hash) DO NOTHING').bind(hash, now).run();
    return db.prepare('SELECT id, blocked FROM uploaders WHERE key_hash = ?1').bind(hash).first();
  }

  // ---------- reads ----------

  async function sync(env, url) {
    const [updated, id] = (url.searchParams.get('after') || '0:0').split(':').map(Number);
    if (!Number.isSafeInteger(updated) || !Number.isSafeInteger(id)) throw new HttpError(400, 'The cursor is not valid.');
    const since = Date.now() - SEEN_DAYS * DAY_MS;
    const { results } = await env.DB.prepare(`SELECT ${LISTING_FIELDS}, i.name, l.updated FROM listings l JOIN items i ON i.id = l.item_id
      WHERE (l.updated > ?1 OR (l.updated = ?1 AND l.id > ?2)) AND l.last_seen > ?3
      ORDER BY l.updated, l.id LIMIT ?4`).bind(updated, id, since, syncPage).all();
    const removed = updated
      ? (await env.DB.prepare('SELECT listing_id AS id FROM removed WHERE at >= ?1').bind(updated).all()).results.map(r => r.id)
      : [];
    const last = results[results.length - 1];
    return {
      listings: results.map(({ updated: _, ...l }) => l),
      removed,
      cursor: last ? `${last.updated}:${last.id}` : `${updated}:${id}`,
      more: results.length === syncPage,
    };
  }

  async function items(env) {
    const { results } = await env.DB.prepare(`SELECT name, listings, sold_listings AS soldListings, last_seen AS last
      FROM items WHERE listings > 0 ORDER BY name COLLATE NOCASE`).all();
    return { items: results };
  }

  async function history(env, url) {
    const name = rules.realName(url.searchParams.get('name'));
    if (!name) throw new HttpError(404, 'That item is not in the database.');
    const { results } = await env.DB.prepare(`SELECT ${LISTING_FIELDS} FROM listings l JOIN items i ON i.id = l.item_id
      WHERE i.name = ?1 ORDER BY l.last_seen DESC`).bind(name).all();
    return results;
  }

  // ---------- uploads ----------

  async function upload(request, env) {
    const key = request.headers.get('X-Install-Key') || '';
    if (!INSTALL_KEY.test(key)) throw new HttpError(401, 'Uploads need an install key.');
    for (const [limiter, by] of [[env.KEY_LIMIT, key], [env.IP_LIMIT, request.headers.get('CF-Connecting-IP') || '']]) {
      if (limiter && !(await limiter.limit({ key: by })).success) throw new HttpError(429, 'Too many uploads. Try again in a minute.');
    }
    const body = await readJson(request);
    if (!Array.isArray(body?.rows) || body.rows.length > MAX_ROWS) throw new HttpError(400, `Send a list of at most ${MAX_ROWS} rows.`);
    const now = Date.now();
    const uploader = await uploaderFor(env.DB, key, now);
    if (uploader.blocked) throw new HttpError(403, 'This install can no longer upload.');
    const kept = body.rows.filter(r => !rules.problem(r)).map(r => rules.clean(r, now)).filter(Boolean);
    if (kept.length) {
      await env.DB.batch([
        ...kept.flatMap(l => saveListing(env.DB, l, uploader.id, l.at, l.at, now)),
        env.DB.prepare('UPDATE uploaders SET last_upload = ?1, rows = rows + ?2 WHERE id = ?3').bind(now, kept.length, uploader.id),
      ]);
    }
    return { saved: kept.length, skipped: body.rows.length - kept.length };
  }

  // ---------- admin ----------

  function mustBeAdmin(request, env) {
    const given = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const wanted = env.ADMIN_TOKEN || '';
    let same = given.length === wanted.length && wanted.length >= 32;
    for (let i = 0; i < wanted.length; i++) same = same && given.charCodeAt(i) === wanted.charCodeAt(i);
    if (!same) throw new HttpError(401, 'Admin only.');
  }

  const findItem = async (db, name) => {
    const real = rules.realName(name);
    const item = real && await db.prepare('SELECT id, name FROM items WHERE name = ?1').bind(real).first();
    if (!item) throw new HttpError(404, 'That item is not in the database.');
    return item;
  };

  // Statements that remove listings matching `where` (with `?1` bound to `value`). They're
  // tombstoned first, so apps drop them on their next sync, and the tombstones then say what to
  // delete, because `where` can depend on reports, which are deleted along the way.
  const removeListings = (db, where, value, now) => [
    db.prepare(`INSERT INTO removed (listing_id, at) SELECT id, ?2 FROM listings WHERE ${where} ON CONFLICT (listing_id) DO UPDATE SET at = excluded.at`).bind(value, now),
    db.prepare('DELETE FROM reports WHERE listing_id IN (SELECT listing_id FROM removed WHERE at = ?1)').bind(now),
    db.prepare('DELETE FROM listings WHERE id IN (SELECT listing_id FROM removed WHERE at = ?1)').bind(now),
  ];

  const admin = {
    // Existing data with its own dates, such as the author's old local database.
    async import(env, body, now) {
      if (!Array.isArray(body.rows) || body.rows.length > MAX_ROWS) throw new HttpError(400, `Send a list of at most ${MAX_ROWS} rows.`);
      const uploader = await uploaderFor(env.DB, await sha256(`import:${body.source || 'admin'}`), now);
      const kept = [];
      for (const r of body.rows) {
        if (rules.problem(r) || !Number.isSafeInteger(r.firstSeen) || !Number.isSafeInteger(r.lastSeen)) continue;
        const l = rules.clean({ ...r, at: r.lastSeen }, now, { before: Infinity, after: 0 });
        if (l) kept.push({ l, first: Math.min(r.firstSeen, l.at), last: l.at });
      }
      if (kept.length) await env.DB.batch(kept.flatMap(({ l, first, last }) => saveListing(env.DB, l, uploader.id, first, last, now)));
      return { saved: kept.length, skipped: body.rows.length - kept.length };
    },

    // Moves an item read as the wrong one into the right one: its listings merge by the usual rule,
    // and who reported them goes along.
    async move(env, body, now) {
      const from = await findItem(env.DB, body.from);
      const to = rules.realName(body.to);
      if (!to) throw new HttpError(400, `${body.to} is not an item in the game.`);
      if (to === from.name) return { moved: 0 };
      const db = env.DB;
      const count = (await db.prepare('SELECT COUNT(*) AS n FROM listings WHERE item_id = ?1').bind(from.id).first()).n;
      await db.batch([
        db.prepare('INSERT INTO items (name, added) VALUES (?1, ?2) ON CONFLICT (name) DO NOTHING').bind(to, now),
        db.prepare(`INSERT INTO listings (item_id, seller, qty, price, sold, copies, first_seen, last_seen, channel, map, room, shop, stats, updated)
          SELECT (SELECT id FROM items WHERE name = ?1), seller, qty, price, sold, copies, first_seen, last_seen, channel, map, room, shop, stats, ?3
          FROM listings WHERE item_id = ?2
          ON CONFLICT (item_id, seller, qty, price, sold) DO UPDATE SET
            copies = MAX(copies, excluded.copies), first_seen = MIN(first_seen, excluded.first_seen),
            last_seen = MAX(last_seen, excluded.last_seen), channel = COALESCE(excluded.channel, channel),
            map = COALESCE(excluded.map, map), room = COALESCE(excluded.room, room), shop = COALESCE(excluded.shop, shop),
            stats = COALESCE(excluded.stats, stats), updated = excluded.updated`).bind(to, from.id, now),
        db.prepare(`INSERT INTO reports (listing_id, uploader_id, first_seen, last_seen)
          SELECT n.id, r.uploader_id, r.first_seen, r.last_seen FROM reports r
          JOIN listings o ON o.id = r.listing_id
          JOIN listings n ON n.item_id = (SELECT id FROM items WHERE name = ?1)
            AND n.seller = o.seller AND n.qty = o.qty AND n.price = o.price AND n.sold = o.sold
          WHERE o.item_id = ?2
          ON CONFLICT (listing_id, uploader_id) DO UPDATE SET
            first_seen = MIN(first_seen, excluded.first_seen), last_seen = MAX(last_seen, excluded.last_seen)`).bind(to, from.id),
        ...removeListings(db, 'item_id = ?1', from.id, now),
        db.prepare('DELETE FROM items WHERE id = ?1').bind(from.id),
      ]);
      return { moved: count };
    },

    async 'delete-listing'(env, body, now) {
      if (!Number.isSafeInteger(body.id)) throw new HttpError(400, 'That listing is not valid.');
      await env.DB.batch(removeListings(env.DB, 'id = ?1', body.id, now));
      return { ok: true };
    },

    async 'delete-item'(env, body, now) {
      const item = await findItem(env.DB, body.name);
      await env.DB.batch([...removeListings(env.DB, 'item_id = ?1', item.id, now), env.DB.prepare('DELETE FROM items WHERE id = ?1').bind(item.id)]);
      return { ok: true };
    },

    async uploaders(env) {
      const { results } = await env.DB.prepare('SELECT id, created, last_upload AS lastUpload, rows, blocked FROM uploaders ORDER BY rows DESC').all();
      return { uploaders: results };
    },

    // Who reported one listing, to judge whether it's real.
    async reports(env, body) {
      const { results } = await env.DB.prepare('SELECT uploader_id AS uploader, first_seen AS firstSeen, last_seen AS lastSeen FROM reports WHERE listing_id = ?1').bind(body.id).all();
      return { reports: results };
    },

    // Stops an install uploading, removes the listings nobody else reported, and its reports.
    async block(env, body, now) {
      if (!Number.isSafeInteger(body.uploader)) throw new HttpError(400, 'Name the uploader by its id.');
      const db = env.DB;
      const only = `id IN (SELECT listing_id FROM reports GROUP BY listing_id HAVING COUNT(*) = 1 AND MAX(uploader_id) = ?1)`;
      const removed = (await db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE ${only}`).bind(body.uploader).first()).n;
      await db.batch([
        db.prepare('UPDATE uploaders SET blocked = 1 WHERE id = ?1').bind(body.uploader),
        ...removeListings(db, only, body.uploader, now),
        db.prepare('DELETE FROM reports WHERE uploader_id = ?1').bind(body.uploader),
      ]);
      return { removed };
    },
  };

  async function handle(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
      if (request.method === 'GET') {
        if (url.pathname === '/v1/sync') return json(await sync(env, url));
        if (url.pathname === '/v1/items') return json(await items(env));
        if (url.pathname === '/v1/history') return json(await history(env, url));
        if (url.pathname === '/' || url.pathname === '/v1') return json({ name: 'MapleScanner shared prices', ok: true });
      }
      if (request.method === 'POST') {
        if (url.pathname === '/v1/listings') return json(await upload(request, env));
        const action = url.pathname.startsWith('/v1/admin/') && admin[url.pathname.slice('/v1/admin/'.length)];
        if (action) {
          mustBeAdmin(request, env);
          return json(await action(env, await readJson(request), Date.now()));
        }
      }
      return json({ error: 'Not found.' }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'The server could not do that.' }, 500);
    }
  }

  return { handle };
}

module.exports = { createApi, SYNC_PAGE, MAX_ROWS };
