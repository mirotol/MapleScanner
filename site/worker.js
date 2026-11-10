// The website's Worker entry. It only runs for /icon/* (wrangler.jsonc): everything else is a
// plain file from site/dist. The icon code is in icons.js, so it can be tested in Node.
import icons from './icons.js';
import itemList from '../osms-items.json';

const { handle } = icons.createIcons(itemList);

export default {
  async fetch(request, env, ctx) {
    const icon = await handle(request, { bucket: env.ICONS, cache: caches.default, waitUntil: p => ctx.waitUntil(p) });
    return icon ?? env.ASSETS.fetch(request);
  },
};
