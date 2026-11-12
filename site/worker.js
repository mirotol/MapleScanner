// The website's Worker entry. It only runs for /icon/*, /item/* and /sitemap.xml (wrangler.jsonc):
// everything else is a plain file from site/dist. The code is in icons.js and items.js, so it can
// be tested in Node.
import icons from './icons.js';
import items from './items.js';
import itemList from '../osms-items.json';

const icon = icons.createIcons(itemList);
const pages = items.createItemPages(itemList);

// A site opened from this computer is being worked on, so it asks the local Worker
// (npm run cloud:dev), never the real price server, as site.js does in the browser.
const apiFor = url => (['localhost', '127.0.0.1'].includes(new URL(url).hostname) ? 'http://127.0.0.1:8787' : 'https://api.maplescanner.app');

export default {
  async fetch(request, env, ctx) {
    const waitUntil = p => ctx.waitUntil(p);
    const answer = await icon.handle(request, { bucket: env.ICONS, cache: caches.default, waitUntil })
      ?? await pages.handle(request, { assets: env.ASSETS, cache: caches.default, waitUntil, api: apiFor(request.url) });
    return answer ?? env.ASSETS.fetch(request);
  },
};
