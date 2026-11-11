// The app's side of the shared price database (cloud.js), talking to the real Worker code over a
// D1-like shim, with a fetch that can be cut off to act offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCloud, installKey, BadInput } = require('../cloud.js');
const { createApi } = require('../cloud/api.js');
const { d1 } = require('./d1-shim.js');

const items = require('../osms-items.json');
const ADMIN = 'a'.repeat(40);
const KEY = 'c3'.repeat(32);

function setup({ resendAfter, sharing } = {}) {
  const env = { DB: d1(), ADMIN_TOKEN: ADMIN };
  const { handle } = createApi(items);
  const net = { up: true, calls: 0, posts: 0 };
  const fetch = async (url, init) => {
    net.calls++;
    if (init.method === 'POST') net.posts++;
    if (!net.up) throw new TypeError('fetch failed');
    return handle(new Request(url, { method: init.method, headers: init.headers, body: init.body }), env);
  };
  let clock = Date.now();
  const cloud = createCloud({ url: 'http://worker', key: KEY, sharing, itemList: items, fetch, now: () => clock, resendAfter, log: {} });
  const admin = async (action, body) => (await handle(new Request(`http://worker/v1/admin/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify(body) }), env)).json();
  // Another install's scan, sent straight to the Worker.
  const other = async rows => handle(new Request('http://worker/v1/listings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Install-Key': 'd4'.repeat(32) }, body: JSON.stringify({ rows: rows.map(r => ({ ...r, at: clock })) }) }), env);
  return { cloud, net, admin, other, tick: ms => { clock += ms; } };
}

const shop = (name, seller, price, extra = {}) => ({ list: 'shop', name, seller, qty: 1, price, sold: false, ...extra });

test("a scan is sent, synced back, and shows in the state in the old database's shape", async () => {
  const { cloud } = setup();
  assert.deepEqual(cloud.add([shop('Red Potion', 'Alder', 50, { channel: 3 }), shop('Not An Item', 'Alder', 5)]), { saved: 1, skipped: 1 });
  assert.equal(cloud.status().waiting, 1);
  await cloud.send();
  await cloud.sync();
  const state = await cloud.state();
  assert.deepEqual(state.items.map(i => [i.name, i.listings, i.soldListings]), [['Red Potion', 1, 0]]);
  const [vote] = state.seen['Red Potion'];
  assert.deepEqual([vote.u, vote.s, vote.sold, vote.channel], [50, 'Alder', false, 3]);
  assert.deepEqual([state.status.online, state.status.waiting], [true, 0]);
  assert.equal((await cloud.state({ full: true })).items[0].name, 'Red Potion');
  assert.equal((await cloud.history('red potion')).length, 1);
});

test('the open shop read again and again is sent once, unless the read adds something or a while has passed', async () => {
  const { cloud, tick } = setup({ resendAfter: 600e3 });
  cloud.add([shop('Red Potion', 'a', 50)]);
  await cloud.send();
  cloud.add([shop('Red Potion', 'a', 50)]);
  assert.equal(cloud.status().waiting, 0);
  cloud.add([shop('Red Potion', 'a', 50, { channel: 5 })]);
  assert.equal(cloud.status().waiting, 1, 'now with its channel');
  await cloud.send();
  tick(601e3);
  cloud.add([shop('Red Potion', 'a', 50)]);
  assert.equal(cloud.status().waiting, 1, 'seen again ten minutes later');
});

test('offline, scans wait and the state says so; back online, they are sent', async () => {
  const { cloud, net } = setup();
  net.up = false;
  cloud.add([shop('Red Potion', 'a', 50), shop('Blue Potion', 'b', 70)]);
  await cloud.send();
  await cloud.sync().catch(() => {});
  assert.deepEqual([cloud.status().online, cloud.status().waiting], [false, 2]);
  net.up = true;
  await cloud.send();
  await cloud.sync();
  assert.deepEqual([cloud.status().online, cloud.status().waiting], [true, 0]);
  assert.deepEqual(Object.keys((await cloud.state()).seen).sort(), ['Blue Potion', 'Red Potion']);
});

test('with sharing off, nothing is uploaded, and prices still come in', async () => {
  const { cloud, net, other } = setup({ sharing: false });
  assert.deepEqual(cloud.add([shop('Red Potion', 'a', 50)]), { saved: 0, skipped: 1, sharing: false });
  assert.equal(cloud.status().waiting, 0);
  await cloud.send();
  assert.equal(net.posts, 0, 'not one upload');
  assert.equal((await other([shop('Blue Potion', 'b', 70)])).status, 200);
  await cloud.sync();
  assert.deepEqual(Object.keys((await cloud.state()).seen), ['Blue Potion']);
  assert.equal(cloud.status().sharing, false);
});

test('turning sharing off drops the scans still waiting, and on again sends new ones', async () => {
  const { cloud, net } = setup();
  net.up = false;
  cloud.add([shop('Red Potion', 'a', 50)]);
  cloud.setSharing(false);
  net.up = true;
  await cloud.send();
  assert.deepEqual([cloud.status().waiting, net.posts], [0, 0]);
  cloud.setSharing(true);
  cloud.add([shop('Red Potion', 'a', 50)]);
  await cloud.send();
  assert.equal(net.posts, 1);
});

test('the install key is only asked for when something is uploaded', async () => {
  let asked = 0;
  const lazy = createCloud({ url: 'http://worker', key: () => { asked++; return KEY; }, sharing: false, itemList: items, fetch: async () => new Response('{"listings":[],"removed":[],"cursor":"0:0","more":false}'), log: {} });
  lazy.add([shop('Red Potion', 'a', 50)]);
  await lazy.send();
  await lazy.sync();
  assert.equal(asked, 0);
});

test("the installer's answer is taken into the settings once, and Settings can change it after", async () => {
  const { start } = require('../serve.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maple-choice-'));
  fs.writeFileSync(path.join(dir, 'installer-choice.json'), '{"shareScans":false}\n');
  const settingsOf = async port => (await fetch(`http://127.0.0.1:${port}/api/settings`)).json();
  const first = await start({ dataDir: dir, cloudUrl: null });
  assert.equal((await settingsOf(first.port)).shareScans, false);
  assert.equal(first.cloud.status().sharing, false);
  assert.ok(!fs.existsSync(path.join(dir, 'installer-choice.json')), 'used up');
  const res = await fetch(`http://127.0.0.1:${first.port}/api/settings`, { method: 'POST', headers: { Origin: `http://127.0.0.1:${first.port}` }, body: '{"shareScans":true}' });
  assert.equal((await res.json()).shareScans, true);
  assert.equal(first.cloud.status().sharing, true, 'at once, without a restart');
  first.close();
  const second = await start({ dataDir: dir, cloudUrl: null });
  assert.equal((await settingsOf(second.port)).shareScans, true, 'an update leaves no file, so the setting stays');
  assert.ok(!fs.existsSync(path.join(dir, 'install.json')), 'no install key made, as nothing was sent');
  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a row that cannot be a listing refuses the whole scan', () => {
  const { cloud } = setup();
  assert.throws(() => cloud.add([shop('Red Potion', 'a', 50), shop('Blue Potion', 'a', -5)]), BadInput);
  assert.throws(() => cloud.add([{ list: 'npcBuys', name: 'War Bow', qty: 1, price: 1250 }]), BadInput);
  assert.equal(cloud.status().waiting, 0);
});

test('a listing the admin removed leaves the state on the next sync', async () => {
  const { cloud, admin } = setup();
  cloud.add([shop('Red Potion', 'a', 50), shop('Red Potion', 'b', 60)]);
  await cloud.send();
  await cloud.sync();
  const target = (await cloud.history('Red Potion')).find(h => h.seller === 'b');
  await admin('delete-listing', { id: target.id });
  await cloud.sync();
  assert.deepEqual((await cloud.state()).seen['Red Potion'].map(v => v.s), ['a']);
});

test('a throwing star is priced by the set, and arrows by the arrow', async () => {
  const { cloud } = setup();
  cloud.add([shop('Ilbi Throwing Stars', 'a', 650000, { qty: 800 }), shop('Ilbi Throwing Stars', 'b', 600000, { qty: 4 }), shop('Arrows for Bows', 'c', 5000, { qty: 1000 })]);
  await cloud.send();
  await cloud.sync();
  const { seen } = await cloud.state();
  assert.deepEqual(seen['Ilbi Throwing Stars'].map(v => v.u).sort((a, b) => a - b), [600000, 650000]);
  assert.equal(seen['Arrows for Bows'][0].u, 5);
});

test('without a price server it says so and sends nothing', async () => {
  const cloud = createCloud({ url: null, key: KEY, itemList: items, log: {} });
  cloud.start();
  assert.equal(cloud.status().connected, false);
  await assert.rejects(cloud.history('Red Potion'));
});

test('the install key is made once and kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maple-key-'));
  const key = installKey(dir);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(installKey(dir), key);
  fs.rmSync(dir, { recursive: true, force: true });
});
