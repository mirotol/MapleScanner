// Sends the listings in an old local price database (prices.db, from before prices were shared)
// to the shared price database, keeping when each was first and last seen. Run once by the admin.
// Only real items and listings the Worker accepts go in; the rest is counted as skipped.
//
//   MAPLE_ADMIN_TOKEN=<token> node tools/import-local.js <copy of prices.db> <price server url>
//
// Work on a copy: the file is only read, but the app may be writing to the original.
const { DatabaseSync } = require('node:sqlite');

const [file, url] = process.argv.slice(2);
const token = process.env.MAPLE_ADMIN_TOKEN;
if (!file || !/^https?:\/\//.test(url ?? '') || !token) {
  console.error('Usage: MAPLE_ADMIN_TOKEN=<token> node tools/import-local.js <copy of prices.db> <price server url>');
  process.exit(1);
}

const db = new DatabaseSync(file, { readOnly: true });
// Older databases lack some columns, so only the ones there are read.
const have = new Set(db.prepare('PRAGMA table_info(sightings)').all().map(c => c.name));
const optional = ['copies', 'channel', 'map', 'room', 'shop', 'stats'].filter(c => have.has(c));
const rows = db.prepare(`SELECT i.name, s.seller, s.qty, s.price, s.sold, s.first_seen, s.last_seen${optional.map(c => `, s.${c}`).join('')}
  FROM sightings s JOIN items i ON i.id = s.item_id ORDER BY s.last_seen`).all()
  .map(r => ({
    list: 'shop', name: r.name, seller: r.seller, qty: r.qty, price: r.price, sold: !!r.sold, firstSeen: r.first_seen, lastSeen: r.last_seen,
    copies: r.copies ?? 1, channel: r.channel ?? null, map: r.map ?? null, room: r.room ?? null, shop: r.shop ?? null, stats: r.stats ?? null,
  }));
db.close();

(async () => {
  let saved = 0, skipped = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/admin/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rows.slice(i, i + 500), source: 'local-db' }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `The price server answered ${res.status}`);
    saved += out.saved;
    skipped += out.skipped;
    process.stdout.write(`\r${Math.min(i + 500, rows.length)} of ${rows.length} sent`);
  }
  console.log(`\nDone: ${saved} saved, ${skipped} skipped.`);
})().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
