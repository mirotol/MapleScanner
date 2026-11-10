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
