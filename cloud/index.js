// The Cloudflare Worker entry. Everything else is in api.js, so it can be tested in Node.
import api from './api.js';
import itemList from '../osms-items.json';

const { handle } = api.createApi(itemList);

export default {
  fetch: (request, env, ctx) => handle(request, env, { cache: caches.default, waitUntil: p => ctx.waitUntil(p) }),
};
