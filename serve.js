// Local server for the pages, icons and settings, and the app's link to the shared price database
// (cloud.js). In a browser: node serve.js  ->  http://localhost:8123
// The Windows app starts the same server itself, see desktop/main.js. No listing data is kept here.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createCloud, installKey, BadInput, PRODUCTION_URL } = require('./cloud.js');

const root = __dirname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const MAX_BODY = 2 * 1024 * 1024;
const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const sendJson = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};

async function answer(res, work) {
  try {
    sendJson(res, 200, await work());
  } catch (err) {
    if (err instanceof BadInput) return sendJson(res, 400, { error: err.message });
    if (err.status) return sendJson(res, err.status, { error: err.message }); // from the price server
    console.error(err);
    sendJson(res, 502, { error: "Can't reach the price server." });
  }
}

function readBody(req, res, done) {
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY) { res.writeHead(413); res.end(); req.destroy(); } else chunks.push(chunk);
  });
  req.on('end', () => done(Buffer.concat(chunks)));
}

// Item icons, from OSMS Data Explorer. They're (c) Nexon and not covered by its licence, so
// they aren't bundled: each one is downloaded the first time a page shows it and kept in a
// folder next to the settings, which then works offline and costs OSMS one download per
// item. Only ids in osms-items.json are fetched, and the saved icons are dropped when the
// game data changes, in case an icon did. A failed download is no icon, tried again later.
const ICON_BASE = 'https://osmsdataexplorer.com/data/current/images/items/';
const ICON_PATH = /^\/icon\/(\d{1,9})\.png$/;
const ICON_FILE = /^\d+\.png(\.part)?$/;
const ICON_AGAIN_MS = 10 * 60 * 1000;
const AGENT = `MapleScanner/${require('./package.json').version} (local price app, saves each icon once)`;

function iconStore(dir, items, download = fetch) {
  const known = new Set(Object.values(items.icons ?? {}));
  const build = items.clientBuild ?? '';
  const pending = new Map(), failed = new Map();
  let ready = false;
  // The folder holds one build's icons. Only icon files are removed, nothing else in it.
  const prepare = () => {
    if (ready) return;
    const mark = path.join(dir, 'build.txt');
    let saved = null;
    try { saved = fs.readFileSync(mark, 'utf8').trim(); } catch {}
    fs.mkdirSync(dir, { recursive: true });
    if (saved !== build) {
      for (const name of fs.readdirSync(dir)) if (ICON_FILE.test(name)) fs.rmSync(path.join(dir, name), { force: true });
      fs.writeFileSync(mark, build);
    }
    ready = true;
  };
  const save = async (id, file) => {
    const res = await download(`${ICON_BASE}${String(id).padStart(8, '0')}.png`, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`OSMS answered ${res.status}`);
    const png = Buffer.from(await res.arrayBuffer());
    if (!png.subarray(0, 4).equals(PNG_START) || png.length > 256 * 1024) throw new Error('That is not an icon.');
    fs.writeFileSync(`${file}.part`, png);
    fs.renameSync(`${file}.part`, file);
    return png;
  };
  // The icon as a PNG, or null when there's none to give.
  return async id => {
    if (!known.has(id)) return null;
    prepare();
    const file = path.join(dir, `${id}.png`);
    try { return fs.readFileSync(file); } catch {}
    if (Date.now() - (failed.get(id) ?? -Infinity) < ICON_AGAIN_MS) return null;
    if (!pending.has(id)) {
      pending.set(id, save(id, file)
        .catch(() => { failed.set(id, Date.now()); return null; })
        .finally(() => pending.delete(id)));
    }
    return pending.get(id);
  };
}

function sendIcon(icons, id, res) {
  icons(id).then(png => {
    // The page asks again after a restart anyway, as the port changes.
    if (!png) { res.writeHead(404, { 'Cache-Control': 'max-age=600' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
    res.end(png);
  }, err => { console.error(err); res.writeHead(500); res.end(); });
}

// The player's settings, in a file in the app's data folder. Not browser storage, because the app's
// page gets a new port on each start, and with it storage of its own.
// cardHotkey is an Electron accelerator, or '' for none. The app's main process saves it, because
// it has to check Windows will give it the key first (desktop/main.js).
// textSize scales the pages and the stall card as a whole (CSS zoom), because their sizes are in
// pixels. Only the sizes Settings offers.
// autoUpdate: download new versions in the background (desktop/main.js). Only the app reads it.
// shareScans: send the listings read off the screen to the shared price database. Off, prices
// still come in but nothing goes out. The installer asks first (build/installer.nsh).
const SETTINGS = { channelWatch: true, cardHotkey: 'Scrolllock', textSize: 1, autoUpdate: true, shareScans: true };
const TEXT_SIZES = [0.9, 1, 1.15, 1.3, 1.5];
const allowed = (key, value) => typeof value === typeof SETTINGS[key] && (key !== 'textSize' || TEXT_SIZES.includes(value));

function readSettings(file) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} // none yet, or damaged: the defaults
  return Object.fromEntries(Object.entries(SETTINGS).map(([key, value]) => [key, allowed(key, saved?.[key]) ? saved[key] : value]));
}

function saveSettings(file, changes) {
  const settings = readSettings(file);
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in SETTINGS)) throw new BadInput(`There is no setting called ${key}.`);
    if (typeof value !== typeof SETTINGS[key]) throw new BadInput(`${key} must be ${typeof SETTINGS[key]}.`);
    if (!allowed(key, value)) throw new BadInput(`${key} must be one of ${TEXT_SIZES.join(', ')}.`);
    settings[key] = value;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 1)}\n`);
  return settings;
}

// The installer's privacy page leaves the player's answer in installer-choice.json, as
// { "shareScans": true or false }, because it can't merge into settings.json. It's taken into the
// settings on the next start and deleted, so a later change in Settings wins. Updates install
// silently and leave no file, so they keep the setting.
function takeInstallerChoice(dataDir, settingsFile) {
  const file = path.join(dataDir, 'installer-choice.json');
  let choice;
  try { choice = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; } // none, or damaged
  if (typeof choice?.shareScans === 'boolean') saveSettings(settingsFile, { shareScans: choice.shareScans });
  fs.rmSync(file, { force: true });
}

// dataDir holds the settings, the install key and the icons. cloudUrl is the shared price
// database's Worker, and key this install's anonymous upload key.
function start({ port = 0, dataDir, download, cloudUrl, key, fetch: cloudFetch }) {
  const settingsFile = path.join(dataDir, 'settings.json');
  takeInstallerChoice(dataDir, settingsFile);
  const items = JSON.parse(fs.readFileSync(path.join(root, 'osms-items.json'), 'utf8'));
  const icons = iconStore(path.join(dataDir, 'icons'), items, download);
  const cloud = createCloud({
    url: cloudUrl, key: key ?? (() => installKey(dataDir)), sharing: readSettings(settingsFile).shareScans,
    itemList: items, ...(cloudFetch ? { fetch: cloudFetch } : {}),
  });
  cloud.start();
  const reads = {
    '/api/state': query => cloud.state({ full: query.has('full') }),
    '/api/history': query => cloud.history(query.get('name')),
    '/api/status': () => cloud.status(),
    '/api/about': () => ({ version: require('./package.json').version }),
    '/api/settings': () => readSettings(settingsFile),
  };
  const writes = {
    '/api/sightings': body => cloud.add(body.rows),
    '/api/settings': body => {
      const settings = saveSettings(settingsFile, body);
      cloud.setSharing(settings.shareScans);
      return settings;
    },
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST') {
      // Only this app's own pages may change anything.
      const own = server.address().port;
      if (![`http://localhost:${own}`, `http://127.0.0.1:${own}`].includes(req.headers.origin)) { res.writeHead(403); return res.end(); }
      const write = writes[url.pathname];
      if (!write) { res.writeHead(404); return res.end(); }
      return readBody(req, res, body => answer(res, () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { throw new BadInput('That is not valid JSON.'); }
        return write(parsed ?? {});
      }));
    }
    if (reads[url.pathname]) return answer(res, () => reads[url.pathname](url.searchParams));
    const icon = ICON_PATH.exec(url.pathname);
    if (icon) return sendIcon(icons, Number(icon[1]), res);

    const urlPath = decodeURIComponent(url.pathname);
    const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(root) || file.startsWith(path.join(root, 'data'))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, cloud, close: () => { cloud.stop(); server.close(); } }));
  });
}

// DATA is the folder for settings, the install key and icons. CLOUD_URL is the price server, such as
// http://127.0.0.1:8787 for the local Worker (npm run cloud:dev).
if (require.main === module) {
  const cloudUrl = process.env.CLOUD_URL || PRODUCTION_URL;
  start({
    port: process.env.PORT || 8123,
    dataDir: process.env.DATA || path.join(root, 'data'),
    cloudUrl,
  }).then(({ port }) => console.log(`MapleScanner: http://localhost:${port}, prices from ${cloudUrl || 'nowhere: set CLOUD_URL'}`));
}

module.exports = { start, readSettings, saveSettings, SETTINGS, TEXT_SIZES, iconStore };
