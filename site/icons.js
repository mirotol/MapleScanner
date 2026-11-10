// Item icons for the website, at /icon/<id>.png. They come from OSMS Data Explorer, like the
// app's (serve.js), but one copy serves every visitor: the first time an icon is asked for, the
// site's Worker downloads it from OSMS and keeps it in an R2 bucket, so OSMS gets one download per
// item, not one per visitor. Only ids in osms-items.json are fetched. Icons are kept under the
// game data's build, so a new build fetches them again in case one changed. A failed download is
// no icon, tried again after 10 minutes.
// Plain CommonJS with no Worker-only imports, so test/site.test.js runs it in Node.
const ICON_BASE = 'https://osmsdataexplorer.com/data/current/images/items/';
const ICON_PATH = /^\/icon\/(\d{1,9})\.png$/;
const PNG_START = [0x89, 0x50, 0x4e, 0x47];
const MAX_BYTES = 256 * 1024;
const AGENT = 'MapleScanner website (maplescanner.app, saves each icon once)';

// bucket: an R2 bucket (get, put). cache: the Worker's edge cache, or nothing.
function createIcons(itemList, { fetch = globalThis.fetch } = {}) {
  const known = new Set(Object.values(itemList.icons ?? {}));
  const build = itemList.clientBuild ?? 'current';

  const found = body => new Response(body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
  const missing = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=600' } });

  async function download(id) {
    const res = await fetch(`${ICON_BASE}${String(id).padStart(8, '0')}.png`, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`OSMS answered ${res.status}`);
    const png = new Uint8Array(await res.arrayBuffer());
    if (png.length > MAX_BYTES || !PNG_START.every((byte, i) => png[i] === byte)) throw new Error('That is not an icon.');
    return png;
  }

  // The answer for an icon address, or null when the address isn't one.
  async function handle(request, { bucket, cache, waitUntil = () => {} }) {
    const match = ICON_PATH.exec(new URL(request.url).pathname);
    if (!match) return null;
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const id = Number(match[1]);
    if (!known.has(id)) return missing();

    const cached = await cache?.match(request.url);
    if (cached) return cached;
    const key = `${build}/${id}.png`;
    let response;
    const saved = await bucket.get(key);
    if (saved) response = found(await saved.arrayBuffer());
    else {
      try {
        const png = await download(id);
        await bucket.put(key, png, { httpMetadata: { contentType: 'image/png' } });
        response = found(png);
      } catch (err) {
        console.error(`Icon ${id}: ${err.message}`);
        response = missing();
      }
    }
    if (cache) waitUntil(cache.put(request.url, response.clone()));
    return response;
  }

  return { handle };
}

module.exports = { createIcons };
