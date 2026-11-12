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
const isPng = bytes => PNG_START.every((byte, i) => bytes[i] === byte);
const isWebp = bytes => String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
// Other game pictures the site shows, each at its own address, saved the same way: downloaded
// from OSMS the first time it's asked for and kept in the bucket from then on, never in the
// repo. Mano stands on the 404 page (the user's wish, Nov 12). Kept under its address, not the
// game's build, because OSMS names the file by a hash that a new build may change.
const ART = {
  '/art/mano.webp': 'https://osmsdataexplorer.com/data/images/monsters/ec1bb47a2226911bc351998ced902f84.webp',
};
const MAX_BYTES = 256 * 1024;
const AGENT = 'MapleScanner website (maplescanner.app, saves each icon once)';

// bucket: an R2 bucket (get, put). cache: the Worker's edge cache, or nothing.
function createIcons(itemList, { fetch = globalThis.fetch } = {}) {
  const known = new Set(Object.values(itemList.icons ?? {}));
  const build = itemList.clientBuild ?? 'current';

  const found = (body, type) => new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
  const missing = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=600' } });

  async function download(from, isPicture) {
    const res = await fetch(from, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`OSMS answered ${res.status}`);
    const png = new Uint8Array(await res.arrayBuffer());
    if (png.length > MAX_BYTES || !isPicture(png)) throw new Error('That is not an icon.');
    return png;
  }

  // The answer for an icon or picture address, or null when the address isn't one.
  async function handle(request, { bucket, cache, waitUntil = () => {} }) {
    const { pathname } = new URL(request.url);
    const match = ICON_PATH.exec(pathname), art = ART[pathname];
    if (!match && !art) return null;
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const id = match && Number(match[1]);
    if (match && !known.has(id)) return missing();
    const type = art ? 'image/webp' : 'image/png';
    const from = art ?? `${ICON_BASE}${String(id).padStart(8, '0')}.png`;

    const cached = await cache?.match(request.url);
    if (cached) return cached;
    const key = art ? pathname.slice(1) : `${build}/${id}.png`;
    let response;
    const saved = await bucket.get(key);
    if (saved) response = found(await saved.arrayBuffer(), type);
    else {
      try {
        const png = await download(from, art ? isWebp : isPng);
        await bucket.put(key, png, { httpMetadata: { contentType: type } });
        response = found(png, type);
      } catch (err) {
        console.error(`Icon ${art ? pathname : id}: ${err.message}`);
        response = missing();
      }
    }
    if (cache) waitUntil(cache.put(request.url, response.clone()));
    return response;
  }

  return { handle };
}

module.exports = { createIcons };
