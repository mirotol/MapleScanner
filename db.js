// The local price database: one SQLite file holding items, misread names and shop listings.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { SEEN_DAYS, norm, itemFacts } = require('./pricing.js');

class BadInput extends Error {}

// Only items on the bundled list of real items are saved, under the list's spelling.
// A read that isn't one is a misread, and is left out rather than kept as a new item.
const itemList = JSON.parse(fs.readFileSync(path.join(__dirname, 'osms-items.json'), 'utf8'));
const realNames = new Map(itemList.names.map(name => [norm(name), name]));
const realName = name => (typeof name === 'string' ? realNames.get(norm(name)) ?? null : null);
const facts = itemFacts(itemList);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    confirmed INTEGER NOT NULL DEFAULT 0,
    fm INTEGER,
    npc_pays INTEGER,
    npc_sells INTEGER,
    added INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS aliases (
    raw TEXT PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id)
  );
  CREATE TABLE IF NOT EXISTS sightings (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id),
    seller TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price INTEGER NOT NULL,
    sold INTEGER NOT NULL,
    copies INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    channel INTEGER,
    map TEXT,
    room INTEGER,
    shop TEXT,
    stats TEXT,
    UNIQUE (item_id, seller, qty, price, sold)
  );
  CREATE INDEX IF NOT EXISTS sightings_recent ON sightings (last_seen);
`;

const SIGHTING_CONFLICT = `
  ON CONFLICT (item_id, seller, qty, price, sold) DO UPDATE SET
    copies = MAX(copies, excluded.copies),
    first_seen = MIN(first_seen, excluded.first_seen),
    last_seen = MAX(last_seen, excluded.last_seen),
    channel = COALESCE(excluded.channel, channel),
    map = COALESCE(excluded.map, map),
    room = COALESCE(excluded.room, room),
    shop = COALESCE(excluded.shop, shop),
    stats = COALESCE(excluded.stats, stats)`;

const isPositive = n => Number.isSafeInteger(n) && n > 0;
const isName = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 80;
// Gear stats are kept as read, so what they're worth can change without losing data. Stats that
// can't be this item's (statsFit in pricing.js) are dropped, and the listing is still saved.
const gearStats = (value, name) => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const text = parsed && typeof parsed === 'object' && facts.fits(name, parsed) ? JSON.stringify(parsed) : null;
    return text && text.length <= 400 ? text : null;
  } catch {
    return null; // a damaged value is dropped rather than failing the save
  }
};
const place = r => [isPositive(r.channel) ? r.channel : null, isName(r.map) ? r.map : null, isPositive(r.room) ? r.room : null, isName(r.shop) ? r.shop : null, gearStats(r.stats, r.name)];

function parseItemList(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const parts = l.split(',');
    const npc = parts.length >= 3 ? parts.pop() : '';
    const fm = parts.length >= 2 ? parts.pop() : '';
    return { name: parts.join(',').trim(), fm: parseInt(fm, 10) || null, npc: parseInt(npc, 10) || null };
  }).filter(i => i.name);
}

function openDb(file, seedFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  // Databases made before shops had a location, a title or gear stats.
  const columns = db.prepare('PRAGMA table_info(sightings)').all().map(c => c.name);
  for (const [name, type] of [['channel', 'INTEGER'], ['map', 'TEXT'], ['room', 'INTEGER'], ['shop', 'TEXT'], ['stats', 'TEXT']]) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE sightings ADD COLUMN ${name} ${type}`);
  }

  const tx = fn => {
    db.exec('BEGIN');
    try { const out = fn(); db.exec('COMMIT'); return out; } catch (err) { db.exec('ROLLBACK'); throw err; }
  };
  const findItem = db.prepare('SELECT * FROM items WHERE name = ?');
  const addItem = db.prepare('INSERT INTO items (name, confirmed, fm, npc_pays, npc_sells, added) VALUES (?, ?, ?, ?, ?, ?)');
  const addAlias = db.prepare('INSERT INTO aliases (raw, item_id) VALUES (?, ?) ON CONFLICT (raw) DO UPDATE SET item_id = excluded.item_id');
  const addSighting = db.prepare(`INSERT INTO sightings (item_id, seller, qty, price, sold, copies, first_seen, last_seen, channel, map, room, shop, stats)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ${SIGHTING_CONFLICT}`);

  // `name` must already be a real name. The old `confirmed` column is ignored but stays.
  const itemId = (name, now) => findItem.get(name)?.id ?? Number(addItem.run(name, 1, null, null, null, now).lastInsertRowid);
  const mustFind = name => {
    const item = isName(name) ? findItem.get(name) : null;
    if (!item) throw new BadInput('That item is not in the database.');
    return item;
  };

  // Moves one item's listings and misreads into another, or renames it when there's no other.
  // The old name is remembered as a misread.
  const moveItem = (from, to) => {
    const into = to === from.name ? null : findItem.get(to);
    if (!into) {
      db.prepare('UPDATE items SET name = ? WHERE id = ?').run(to, from.id);
    } else {
      db.prepare(`INSERT INTO sightings (item_id, seller, qty, price, sold, copies, first_seen, last_seen, channel, map, room, shop, stats)
        SELECT ?, seller, qty, price, sold, copies, first_seen, last_seen, channel, map, room, shop, stats FROM sightings WHERE item_id = ? ${SIGHTING_CONFLICT}`).run(into.id, from.id);
      db.prepare('DELETE FROM sightings WHERE item_id = ?').run(from.id);
      db.prepare('UPDATE aliases SET item_id = ? WHERE item_id = ?').run(into.id, from.id);
      db.prepare('UPDATE items SET fm = COALESCE(fm, ?), npc_pays = COALESCE(npc_pays, ?), npc_sells = COALESCE(npc_sells, ?) WHERE id = ?')
        .run(from.fm, from.npc_pays, from.npc_sells, into.id);
      db.prepare('DELETE FROM items WHERE id = ?').run(from.id);
    }
    if (norm(from.name) !== norm(to)) addAlias.run(norm(from.name), (into ?? from).id);
  };

  // Databases from before only real names were saved can hold a real item in another
  // spelling, like "sewing Machine". It joins the list's spelling.
  tx(() => {
    for (const item of db.prepare('SELECT * FROM items').all()) {
      const real = realName(item.name);
      if (real && real !== item.name) moveItem(item, real);
    }
  });

  if (seedFile && db.prepare('SELECT COUNT(*) n FROM items').get().n === 0 && fs.existsSync(seedFile)) {
    tx(() => {
      for (const i of parseItemList(fs.readFileSync(seedFile, 'utf8'))) {
        const name = realName(i.name);
        if (name) addItem.run(name, 1, i.fm, i.npc, null, Date.now());
      }
    });
  }

  return {
    close: () => db.close(),

    // Saves what one scan found. Seeing the same listing again only updates its dates.
    // A row whose name isn't a real item is left out, and the rest are still saved.
    addSightings(rows) {
      if (!Array.isArray(rows)) throw new BadInput('Expected a list of rows.');
      for (const r of rows) {
        if (!isName(r.name) || !isPositive(r.qty) || !isPositive(r.price) || r.list !== 'shop') throw new BadInput('A row is not valid.');
      }
      const real = rows.map(r => ({ ...r, name: realName(r.name) })).filter(r => r.name);
      tx(() => {
        for (const r of real) {
          const at = isPositive(r.at) ? r.at : Date.now(), id = itemId(r.name, at);
          if (r.raw && norm(r.raw) && norm(r.raw) !== norm(r.name)) addAlias.run(norm(r.raw), id);
          addSighting.run(id, String(r.seller ?? ''), r.qty, r.price, r.sold ? 1 : 0, r.copies || 1, at, at, ...place(r));
        }
      });
      return { saved: real.length, skipped: rows.length - real.length };
    },

    // Everything the pages need to judge prices.
    state() {
      const items = db.prepare(`SELECT i.name,
          COUNT(s.id) listings, COALESCE(SUM(s.sold), 0) soldListings, MAX(s.last_seen) last
        FROM items i LEFT JOIN sightings s ON s.item_id = i.id GROUP BY i.id ORDER BY i.name COLLATE NOCASE`).all();
      const aliases = {};
      for (const a of db.prepare('SELECT a.raw, i.name FROM aliases a JOIN items i ON i.id = a.item_id').all()) aliases[a.raw] = a.name;
      const seen = {};
      const recent = db.prepare(`SELECT i.name, s.seller, s.qty, s.price, s.sold, s.copies, s.last_seen, s.channel, s.map, s.room, s.shop, s.stats
        FROM sightings s JOIN items i ON i.id = s.item_id WHERE s.last_seen > ?`).all(Date.now() - SEEN_DAYS * 864e5);
      for (const s of recent) (seen[s.name] ||= []).push({ u: facts.unitPrice(s.name, s.qty, s.price), s: s.seller, sold: !!s.sold, t: s.last_seen, qty: s.qty, copies: s.copies, channel: s.channel, map: s.map, room: s.room, shop: s.shop, stats: s.stats ? JSON.parse(s.stats) : null });
      return { items, aliases, seen };
    },

    history(name) {
      const item = mustFind(name);
      return db.prepare(`SELECT id, seller, qty, price, sold, copies, first_seen firstSeen, last_seen lastSeen, channel, map, room, shop, stats
        FROM sightings WHERE item_id = ? ORDER BY last_seen DESC`).all(item.id);
    },
  };
}

module.exports = { openDb, BadInput };
