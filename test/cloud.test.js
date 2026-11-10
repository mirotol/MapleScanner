// The shared price database's Worker (cloud/api.js), run in Node over a D1-like shim.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../cloud/api.js');
const { d1 } = require('./d1-shim.js');

const items = require('../osms-items.json');
const ADMIN = 'a'.repeat(40);
const KEY_A = 'a1'.repeat(32), KEY_B = 'b2'.repeat(32);
const DAY = 864e5;

function worker({ syncPage } = {}) {
  const env = { DB: d1(), ADMIN_TOKEN: ADMIN };
  const { handle } = createApi(items, { syncPage });
  const call = async (method, path, { body, key, token, headers = {} } = {}) => {
    const res = await handle(new Request(`http://worker${path}`, {
      method,
      headers: { ...(key ? { 'X-Install-Key': key } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: res.status, body: await res.json() };
  };
  const upload = (rows, key = KEY_A) => call('POST', '/v1/listings', { body: { rows }, key });
  const admin = (action, body, token = ADMIN) => call('POST', `/v1/admin/${action}`, { body, token });
  const sync = async (after = '') => (await call('GET', `/v1/sync${after ? `?after=${after}` : ''}`)).body;
  const history = async name => (await call('GET', `/v1/history?name=${encodeURIComponent(name)}`)).body;
  const itemList = async () => (await call('GET', '/v1/items')).body.items;
  return { env, call, upload, admin, sync, history, itemList };
}

const shop = (name, seller, price, extra = {}) => ({ list: 'shop', name, seller, qty: 1, price, sold: false, ...extra });

test('an upload is shared: it syncs with its item name, and the item list counts it', async () => {
  const w = worker();
  assert.deepEqual((await w.upload([shop('Red Potion', 'Alder', 50, { channel: 4, map: 'Free Market', room: 1, shop: 'Pots' })])).body, { saved: 1, skipped: 0 });
  const { listings, cursor, more } = await w.sync();
  assert.equal(listings.length, 1);
  assert.deepEqual([listings[0].name, listings[0].seller, listings[0].price, listings[0].channel, listings[0].shop], ['Red Potion', 'Alder', 50, 4, 'Pots']);
  assert.equal(more, false);
  assert.match(cursor, /^\d+:\d+$/);
  assert.deepEqual(await w.itemList(), [{ name: 'Red Potion', listings: 1, soldListings: 0, last: listings[0].lastSeen }]);
});

test('seeing a listing again does not count it twice, and its sale is a listing of its own', async () => {
  const w = worker();
  await w.upload([shop('Red Potion', 'a', 50)]);
  await w.upload([shop('Red Potion', 'a', 50)], KEY_B);
  assert.equal((await w.itemList())[0].listings, 1);
  await w.upload([shop('Red Potion', 'a', 50, { sold: true })]);
  const [item] = await w.itemList();
  assert.deepEqual([item.listings, item.soldListings], [2, 1]);
});

test('keeps where a listing was, and a later scan without it does not erase it', async () => {
  const w = worker();
  await w.upload([shop('Red Potion', 'a', 50, { channel: 4, map: 'Free Market', room: 1 })]);
  await w.upload([shop('Red Potion', 'a', 50)]);
  let [row] = await w.history('Red Potion');
  assert.deepEqual([row.channel, row.map, row.room], [4, 'Free Market', 1]);
  await w.upload([shop('Red Potion', 'a', 50, { channel: 7, map: 'Kerning City' })]);
  [row] = await w.history('Red Potion');
  assert.deepEqual([row.channel, row.map, row.room], [7, 'Kerning City', 1]);
});

test("only real items are kept, under the item list's spelling, and the rest of an upload still is", async () => {
  const w = worker();
  const res = await w.upload([shop('blue bamboo hat', 'a', 100), shop('Blue Bamhoo Hat', 'a', 200), { list: 'npcBuys', name: 'War Bow', qty: 1, price: 1250 }, shop('Red Potion', 'a', -5)]);
  assert.deepEqual(res.body, { saved: 1, skipped: 3 });
  assert.deepEqual((await w.itemList()).map(i => i.name), ['Blue Bamboo Hat']);
});

test('gear stats: kept when they fit, dropped when damaged or impossible, and kept when seen again without them', async () => {
  const w = worker();
  const stats = { slots: 5, attack: 30, str: 4 };
  await w.upload([shop('Crossbow', 'a', 100, { stats })]);
  await w.upload([shop('Crossbow', 'a', 100)]);
  assert.deepEqual(JSON.parse((await w.history('Crossbow'))[0].stats), stats);
  // a Heckler's stats on a Blue Sauna Robe (Nov 9): no W.Def, HP or MP
  await w.upload([shop('Blue Sauna Robe', 'b', 55555, { stats: { attack: 63, slots: 7 } }), shop('Crossbow', 'c', 5, { stats: 'not json' }), shop('Crossbow', 'd', 6, { stats: { attack: 30, slots: 8 } })]);
  assert.equal((await w.history('Blue Sauna Robe'))[0].stats, null);
  assert.ok((await w.history('Crossbow')).filter(h => h.seller !== 'a').every(h => h.stats === null), 'damaged, or more slots left than a Crossbow has');
});

test('equipment never stacks, so an amount read on gear is one item', async () => {
  const w = worker();
  await w.upload([shop('Reef Claw', 'a', 18777, { qty: 11 })]); // read as "11 for 18,777" live
  assert.equal((await w.history('Reef Claw'))[0].qty, 1);
});

test('a listing keeps its shop title when seen again, and a title too long to be real is dropped', async () => {
  const w = worker();
  await w.upload([shop('Battle Crossbow', 'iNext', 900, { shop: 'The Good Stuff' })]);
  await w.upload([shop('Battle Crossbow', 'iNext', 900)]);
  assert.equal((await w.history('Battle Crossbow'))[0].shop, 'The Good Stuff');
  await w.upload([shop('Red Potion', '', 50, { shop: 'x'.repeat(81) })]);
  assert.equal((await w.history('Red Potion'))[0].shop, null);
});

test('when a listing was seen is the scan time, unless it is far from now', async () => {
  const w = worker();
  const now = Date.now();
  await w.upload([shop('Red Potion', 'a', 50, { at: now - 60e3 }), shop('Red Potion', 'b', 50, { at: now + 30 * DAY })]);
  const rows = await w.history('Red Potion');
  assert.equal(rows.find(r => r.seller === 'a').lastSeen, now - 60e3);
  assert.ok(rows.find(r => r.seller === 'b').lastSeen <= Date.now(), 'a time in the future is not believed');
});

test('uploads need a well-formed install key, and each install that saw a listing is recorded', async () => {
  const w = worker();
  assert.equal((await w.call('POST', '/v1/listings', { body: { rows: [] } })).status, 401);
  assert.equal((await w.upload([], 'short')).status, 401);
  await w.upload([shop('Red Potion', 'a', 50)]);
  await w.upload([shop('Red Potion', 'a', 50)], KEY_B);
  const [listing] = await w.history('Red Potion');
  assert.equal((await w.admin('reports', { id: listing.id })).body.reports.length, 2);
  const { uploaders } = (await w.admin('uploaders', {})).body;
  assert.equal(uploaders.length, 2);
  const keys = w.env.DB.raw.prepare('SELECT key_hash FROM uploaders').all().map(u => u.key_hash);
  assert.ok(keys.every(k => /^[0-9a-f]{64}$/.test(k) && k !== KEY_A && k !== KEY_B), 'only a hash of the key is kept');
});

test('too many uploads from one install are refused', async () => {
  const w = worker();
  w.env.KEY_LIMIT = { limit: async () => ({ success: false }) };
  assert.equal((await w.upload([shop('Red Potion', 'a', 50)])).status, 429);
});

test('the admin calls need the admin token', async () => {
  const w = worker();
  assert.equal((await w.admin('uploaders', {}, null)).status, 401);
  assert.equal((await w.admin('uploaders', {}, 'b'.repeat(40))).status, 401);
  w.env.ADMIN_TOKEN = '';
  assert.equal((await w.admin('uploaders', {}, '')).status, 401, 'no token set means no admin');
});

test('blocking an install removes what only it reported, and apps are told on their next sync', async () => {
  const w = worker();
  await w.upload([shop('Red Potion', 'faker', 1), shop('Red Potion', 'a', 50)]);
  await w.upload([shop('Red Potion', 'a', 50)], KEY_B);
  const { cursor } = await w.sync();
  const faked = (await w.history('Red Potion')).find(h => h.seller === 'faker');
  const uploader = (await w.admin('uploaders', {})).body.uploaders.find(u => u.rows === 2).id;
  assert.deepEqual((await w.admin('block', { uploader })).body, { removed: 1 });
  assert.deepEqual((await w.history('Red Potion')).map(h => h.seller), ['a']);
  assert.deepEqual((await w.sync(cursor)).removed, [faked.id]);
  assert.equal((await w.upload([shop('Red Potion', 'faker', 1)])).status, 403);
  assert.equal((await w.itemList())[0].listings, 1);
});

test('moving an item read as the wrong one merges its listings and who reported them', async () => {
  const w = worker();
  await w.upload([shop('Crossbow', 'a', 100), shop('Battle Crossbow', 'b', 110), shop('Battle Crossbow', 'a', 100, { shop: 'Bows' })]);
  await w.upload([shop('Battle Crossbow', 'b', 110)], KEY_B);
  assert.deepEqual((await w.admin('move', { from: 'Battle Crossbow', to: 'crossbow' })).body, { moved: 2 });
  assert.deepEqual((await w.itemList()).map(i => [i.name, i.listings]), [['Crossbow', 2]]);
  const rows = await w.history('Crossbow');
  assert.equal(rows.find(r => r.seller === 'a').shop, 'Bows');
  assert.equal((await w.admin('reports', { id: rows.find(r => r.seller === 'b').id })).body.reports.length, 2);
  assert.equal((await w.admin('move', { from: 'Crossbow', to: 'Crosshow' })).status, 400, 'only to a real item');
});

test('deleting a listing or an item', async () => {
  const w = worker();
  await w.upload([shop('Red Potion', 'a', 50), shop('Red Potion', 'b', 60), shop('Blue Potion', 'a', 70)]);
  const [one] = await w.history('Red Potion');
  await w.admin('delete-listing', { id: one.id });
  assert.equal((await w.history('Red Potion')).length, 1);
  await w.admin('delete-item', { name: 'Blue Potion' });
  assert.deepEqual((await w.itemList()).map(i => [i.name, i.listings]), [['Red Potion', 1]]);
});

test('sync pages through by its cursor, and only the last 14 days', async () => {
  const w = worker({ syncPage: 2 });
  const now = Date.now();
  await w.upload(['a', 'b', 'c'].map((s, i) => shop('Red Potion', s, 50 + i)));
  await w.admin('import', { rows: [{ ...shop('Red Potion', 'old', 40), firstSeen: now - 30 * DAY, lastSeen: now - 20 * DAY }] });
  const first = await w.sync();
  assert.deepEqual([first.listings.length, first.more], [2, true]);
  const second = await w.sync(first.cursor);
  assert.deepEqual([second.listings.length, second.more], [1, false]);
  assert.deepEqual([...first.listings, ...second.listings].map(l => l.seller).sort(), ['a', 'b', 'c']);
  assert.deepEqual((await w.sync(second.cursor)).listings, []);
  assert.equal((await w.history('Red Potion')).length, 4, 'older listings stay in the history');
  await w.upload([shop('Red Potion', 'a', 50)]);
  assert.deepEqual((await w.sync(second.cursor)).listings.map(l => l.seller), ['a'], 'seen again, so synced again');
});

test('an import keeps its own dates', async () => {
  const w = worker();
  const now = Date.now();
  const res = await w.admin('import', { rows: [{ ...shop('Red Potion', 'a', 50), firstSeen: now - 9 * DAY, lastSeen: now - 3 * DAY }, { ...shop('Red Potion', 'b', 50) }] });
  assert.deepEqual(res.body, { saved: 1, skipped: 1 });
  const [row] = await w.history('Red Potion');
  assert.deepEqual([row.firstSeen, row.lastSeen], [now - 9 * DAY, now - 3 * DAY]);
});
