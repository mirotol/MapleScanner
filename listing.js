// The checks a scanned listing must pass before it's shared. The Worker (cloud/) runs them on every
// upload as the final word, and the app runs them first so it doesn't queue rows that would be
// refused. Only items on the bundled list of real items are kept, under the list's spelling: a read
// that isn't one is a misread, and is left out rather than kept as a new item.
const { norm, itemFacts } = require('./pricing.js');

const MAX_PRICE = 499999999999; // the highest ask the game allows (Nov 9)
const MAX_SELLER = 24;          // character names are far shorter; longer is a misread
const MAX_COPIES = 100;
const MAX_TEXT = 80;            // map and shop title

const isPositive = n => Number.isSafeInteger(n) && n > 0;
const isText = (s, max = MAX_TEXT) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;

function listingRules(itemList) {
  const facts = itemFacts(itemList);
  const realNames = new Map(itemList.names.map(name => [norm(name), name]));
  const realName = name => (typeof name === 'string' ? realNames.get(norm(name)) ?? null : null);

  // Gear stats are kept as read, so what they're worth can change without losing data. Stats that
  // can't be this item's (statsFit in pricing.js) are dropped, and the listing is still kept.
  const gearStats = (value, name) => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      const text = parsed && typeof parsed === 'object' && facts.fits(name, parsed) ? JSON.stringify(parsed) : null;
      return text && text.length <= 400 ? text : null;
    } catch {
      return null; // a damaged value is dropped rather than refusing the listing
    }
  };

  // Why a row can't be a shop listing at all, or null. NPC prices never come from the screen.
  const problem = r => {
    if (!r || typeof r !== 'object') return 'A row is not valid.';
    if (r.list !== 'shop') return 'Only shop listings are shared.';
    if (!isText(r.name)) return 'A row has no item name.';
    if (!isPositive(r.qty)) return 'A row has no amount.';
    if (!isPositive(r.price) || r.price > MAX_PRICE) return 'A row has no valid price.';
    return null;
  };

  // The listing as it's stored, or null when its name isn't a real item. `at` is when it was seen:
  // trusted only within `window` of now, otherwise it's now. Imports pass a window of Infinity.
  const clean = (r, now = Date.now(), window = { before: 2 * 864e5, after: 5 * 6e4 }) => {
    const name = realName(r.name);
    if (!name) return null;
    const at = isPositive(r.at) && r.at >= now - window.before && r.at <= now + window.after ? r.at : now;
    const seller = typeof r.seller === 'string' && r.seller.trim().length <= MAX_SELLER ? r.seller.trim() : '';
    return {
      name,
      seller,
      qty: facts.single(name) ? 1 : r.qty, // equipment never stacks, so an amount read on gear is a misread
      price: r.price,
      sold: r.sold ? 1 : 0,
      copies: isPositive(r.copies) && r.copies <= MAX_COPIES ? r.copies : 1,
      at,
      channel: isPositive(r.channel) && r.channel <= 99 ? r.channel : null,
      map: isText(r.map) ? r.map : null,
      room: isPositive(r.room) && r.room <= 99 ? r.room : null,
      shop: isText(r.shop) ? r.shop : null,
      stats: gearStats(r.stats, name),
    };
  };

  return { facts, realName, problem, clean };
}

module.exports = { listingRules, MAX_PRICE };
