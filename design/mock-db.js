// Builds a scratch price database of made-up listings, one item for each situation the
// Prices item card has to handle, so the card can be designed against all of them.
// Every listing goes in through db.js like a real scan, so only real names and stats that
// fit are saved. Times are counted back from when it's run, and the same seed gives the
// same shops, so screenshots can be compared after a change.
//
// Scans only happen in play sessions, like a real player's: an hour or two most evenings,
// some days none, over 8 weeks, with one going on now. A listing is seen when the player
// walks past it, and its sale only if they walk past again later.
//
//   node design/mock-db.js [file]           default design/mock/prices.db
//   DB=design/mock/prices.db node serve.js  then open http://localhost:8123 and the Prices tab
//
// Never point it at a real database: it deletes the file first.
const fs = require('fs');
const path = require('path');
const { openDb } = require('../db.js');
const items = require('../osms-items.json');

const file = path.resolve(process.argv[2] || path.join(__dirname, 'mock', 'prices.db'));
if (!/mock/i.test(path.basename(path.dirname(file)) + path.basename(file))) {
  console.error(`Refusing to write ${file}: the folder or file name must contain "mock", because it's deleted first.`);
  process.exit(1);
}
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

// The same made-up market every run (mulberry32).
let seed = 20261110;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const reseed = text => { seed = [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261); };
const between = (lo, hi) => lo + rand() * (hi - lo);
const pick = list => list[Math.floor(rand() * list.length)];
// Players type prices like 1,999 or 150,000, rarely 1,873.
const playerPrice = n => {
  const step = n >= 1e6 ? 1e4 : n >= 1e5 ? 1e3 : n >= 1e4 ? 500 : n >= 1e3 ? 50 : n >= 100 ? 5 : 1;
  const round = Math.max(step, Math.round(n / step) * step);
  return round >= 1e3 && rand() < 0.15 ? round - 1 : round;
};

const NOW = Date.now(), HOUR = 36e5, DAY = 24 * HOUR, WEEKS = 8;

// ---------- play sessions ----------
// Most days one or two sessions, mostly in the evening, and about one day in three none.
// The last one is going on now, so the 1h and 24h chips have something.
reseed('sessions');
const sessions = [{ start: NOW - 1.5 * HOUR, end: NOW }];
for (let d = 0; d < WEEKS * 7; d++) {
  const midnight = new Date(NOW - d * DAY);
  midnight.setHours(0, 0, 0, 0);
  if (d > 0 && rand() < 0.3) continue;
  for (let n = rand() < 0.6 ? 1 : 2; n > 0; n--) {
    const start = midnight.getTime() + pick([10, 13, 17, 18, 19, 20, 20, 21, 21, 22]) * HOUR + between(0, 50) * 6e4;
    const end = Math.min(start + between(0.5, 3) * HOUR, NOW);
    if (start < NOW - 2 * HOUR && !sessions.some(s => start < s.end && end > s.start)) sessions.push({ start, end });
  }
}
sessions.sort((a, b) => a.start - b.start);
const sessionAt = t => sessions.find(s => t >= s.start && t <= s.end);

// A moment the player was scanning, between `fromH` and `toH` hours ago, or null if they
// weren't playing then. Longer sessions are likelier, as they see more shops.
function when(fromH, toH = 0) {
  const lo = NOW - fromH * HOUR, hi = NOW - toH * HOUR;
  const parts = sessions.map(s => [Math.max(s.start, lo), Math.min(s.end, hi)]).filter(([a, b]) => b > a);
  let left = rand() * parts.reduce((sum, [a, b]) => sum + b - a, 0);
  for (const [a, b] of parts) {
    if (left <= b - a) return a + left;
    left -= b - a;
  }
  return null;
}
const hoursAgo = t => (NOW - t) / HOUR;

// ---------- shops and listings ----------
const SELLERS = ['Loodles', 'yisui', 'Blipbug', 'efrrg', 'BrockOmaba', 'Shilshulim', 'MapleMum', 'xXSinXx', 'Tofuwu', 'Kerninger', 'SlimeTime', 'PotatoMage',
  'Henesyz', 'oddbard', 'Ludilove', 'Nautigal', 'Pinkbeanie', 'Zakumdad', 'ElnathIce', 'Orbisly', 'Jrboogie', 'meowmeso', 'Rainbowsnail', 'Grendeling',
  'qwopqwop', 'Stumpie', 'Dyle', 'Wraithy', 'Hornyshroom', 'Lupinlord', 'Ellinia', 'Darkstump', 'Ribbonpig', 'cozyfm', 'Tanuki', 'Junior', 'Pepe12', 'hapless'];
// More names for the busy items, each far enough from every other that the app doesn't take
// two for one name read two ways (closeSellers in market.js): Loodles2 and Loodles were one
// seller to it, which hid one of their asks (Nov 10).
const { norm, sim } = require('../pricing.js');
const NAMES = (() => {
  const names = [...SELLERS];
  const first = ['Frosty', 'Sleepy', 'Mighty', 'Shiny', 'Grumpy', 'Lucky', 'Fuzzy', 'Brave', 'Sneaky', 'Jolly', 'Wobbly', 'Rusty', 'Stormy', 'Cozy', 'Spicy', 'Gloomy', 'Zesty', 'Humble', 'Witty', 'Dusty'];
  const second = ['Bean', 'Pig', 'Mage', 'Slime', 'Thief', 'Archer', 'Yeti', 'Golem', 'Pirate', 'Bard', 'Stump', 'Bunny', 'Drake', 'Ghost', 'Kitty', 'Tiger', 'Panda', 'Owl', 'Mango', 'Waffle'];
  for (const b of second) for (const a of first) {
    const name = a + b;
    if (names.every(n => sim(norm(n), norm(name)) < 0.8)) names.push(name);
  }
  return names;
})();
const sellerName = i => NAMES[i % NAMES.length];
const TITLES = ['Cheap etc', 'Love you all =3', '60 50 40', 'Retired, selling all', 'NX', 'Scrolls + etc', 'Pots pots pots', 'Going through a rough year', 'Buy my stuff', '', 'Clean gear', 'Crafting mats', '111'];
const shops = new Map();
// A seller keeps one shop for a run: same channel, room and title.
const shopOf = seller => {
  if (!shops.has(seller)) shops.set(seller, { channel: 1 + Math.floor(rand() * 20), map: 'Free Market', room: 1 + Math.floor(rand() * 20), shop: pick(TITLES) });
  return shops.get(seller);
};

const scans = [];
const scan = (at, row) => scans.push({ ...shopOf(row.seller), ...row, at: Math.round(at), list: 'shop' });

// One listing as the app would see it. It's first seen at `at` (a moment from when()), and
// again a little later in that session. With `until` (hours ago) the shop stays open and is
// seen once in every session up to then. With `soldWithin` (hours) it sells, and the sale is
// seen if the player walks past again in that time, but not later than `soldBy` hours ago.
// `price` is per item and becomes the shop's total for the amount, except stars, which are one set.
function listing(name, { seller, qty = 1, price, at, until = null, soldWithin = null, soldBy = 0, stats, copies }) {
  if (at == null) return false; // not playing then
  if (!items.recharge[name] && qty > 1) price = playerPrice(price * qty);
  const row = { name, seller, qty, price, stats, copies };
  const session = sessionAt(at);
  const times = [at, Math.min(at + between(3, 40) * 6e4, session.end)];
  if (until != null) for (const s of sessions) if (s.start > session.end && s.start < NOW - until * HOUR) times.push(s.start + between(0, s.end - s.start));
  for (const t of times) scan(t, row);
  const lastAsk = Math.max(...times);
  if (soldWithin != null) {
    const sold = when(hoursAgo(lastAsk) - 0.05, Math.max(soldBy, hoursAgo(lastAsk) - soldWithin));
    if (sold != null) {
      scan(sold, { ...row, sold: true });
      scan(Math.min(sold + between(3, 30) * 6e4, sessionAt(sold).end), { ...row, sold: true });
    }
  }
  return true;
}

const situations = [];
const situation = (name, what, build) => {
  if (!items.names.includes(name)) throw new Error(`${name} is not a real item name in osms-items.json`);
  // Each item draws from its own seed, so changing one situation leaves the others as they were.
  reseed(name);
  const before = scans.length;
  build(name);
  situations.push({ name, what, scans: scans.length - before });
};

// Typed prices bunch on round numbers, which on a busy item makes rows of dots at 300 and 350.
const ROUND = [20, 250, 270, 275, 280, 290, 299, 300, 300, 310, 320, 325, 330, 340, 349, 350, 350, 360, 375, 380, 399, 400, 400, 420, 449, 450, 480, 499, 500];
const snap = n => ROUND.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));

// ---------- the situations ----------

situation('Iron Ore', `Busy, sold all the time, over ${WEEKS} weeks: hundreds of listings bunched on round prices, rising about 15% as players get richer, with a 20 misprice and an 80,000 troll. The case where dots turn into a wall.`, name => {
  let n = 0;
  for (const s of sessions) {
    // About 8 Iron Ore listings an hour of play, and more lately: the market grows.
    const count = Math.round(((s.end - s.start) / HOUR) * between(5, 11));
    for (let i = 0; i < count; i++) {
      const at = s.start + rand() * (s.end - s.start);
      const rise = 1 + 0.15 * (1 - hoursAgo(at) / (WEEKS * 7 * 24));
      const sells = rand() < 0.5;
      const price = rand() < 0.004 ? 20 : rand() < 0.004 ? 80000 : snap((sells ? between(270, 330) : between(290, 410)) * rise);
      listing(name, { seller: sellerName(n++ % 140), qty: pick([1, 10, 50, 100, 100, 200, 300]), price, at, soldWithin: sells ? between(1, 30) : null });
    }
  }
});

situation('Leather', `Steady over ${WEEKS} weeks with no rise, sold most days a session happened, so a trend line has a flat case next to Iron Ore.`, name => {
  for (let i = 0; i < 160; i++) {
    const sells = rand() < 0.55;
    listing(name, { seller: sellerName(i % 45), qty: pick([1, 10, 50, 100, 100, 200]), price: playerPrice(sells ? between(115, 150) : between(130, 230)), at: when(WEEKS * 7 * 24), soldWithin: sells ? between(2, 30) : null });
  }
});

situation('Gloves Attack Scroll: Greater', 'A price rising fast, from about 1.2M to 2M over 10 days. The flat usual-price line hides that.', name => {
  for (let i = 0; i < 26; i++) {
    const at = when(10 * 24), sells = rand() < 0.5;
    if (at == null) continue;
    const level = 2.0e6 - (hoursAgo(at) / (10 * 24)) * 0.8e6;
    listing(name, { seller: SELLERS[(i * 3) % SELLERS.length], price: playerPrice(level * between(sells ? 0.9 : 0.97, sells ? 1.02 : 1.15)), at, soldWithin: sells ? between(2, 24) : null });
  }
});

situation('Orange Mushroom Cap', 'Troll asks of 9,999,999 and 999,999 among asks of 50 to 90, seen in every session since they were put up. They stay, above the chart.', name => {
  for (let i = 0; i < 14; i++) {
    const sells = rand() < 0.4;
    listing(name, { seller: SELLERS[(i * 5 + 2) % SELLERS.length], qty: pick([1, 20, 100]), price: playerPrice(between(50, 90)), at: when(5 * 24), soldWithin: sells ? between(2, 24) : null });
  }
  listing(name, { seller: 'TrollFace', price: 9999999, at: when(40, 20), until: 0 });
  listing(name, { seller: 'notforsale', price: 999999, at: when(10, 2), until: 0 });
});

situation('Ligator Skin', 'Thin: one seller, one ask, about 5 days old.', name => {
  listing(name, { seller: 'oddbard', qty: 40, price: 2400, at: when(7 * 24, 4 * 24) });
});

situation('Dark Crystal Ore', 'Sold only: plenty of sales this week but none of it in the last day, the time the card opens on.', name => {
  for (let i = 0; i < 10; i++) {
    listing(name, { seller: SELLERS[(i * 7 + 1) % SELLERS.length], qty: pick([1, 1, 5, 10]), price: playerPrice(between(38e3, 52e3)), at: when(7 * 24, 30), soldWithin: 30, soldBy: 26 });
  }
});

// Emerald Earrings: 5 slots, 27 M.Def, 2 crit damage when plain.
situation('Emerald Earrings', 'Gear in every condition: clean, clean with a better roll, scrolled for INT, failed scrolls, and copies whose stats were never read.', name => {
  const kinds = [
    { stats: { slots: 5, mdef: 27, critDamage: 2 }, price: [16e3, 25e3], n: 7 },
    { stats: { slots: 5, mdef: 28, critDamage: 3 }, price: [35e3, 55e3], n: 2 },
    { stats: { slots: 0, mdef: 27, critDamage: 2, int: 10 }, price: [700e3, 950e3], n: 3 },
    { stats: { slots: 2, mdef: 27, critDamage: 2, int: 6 }, price: [180e3, 260e3], n: 2 },
    { stats: { slots: 0, mdef: 27, critDamage: 2 }, price: [8e3, 14e3], n: 2 },
    { stats: undefined, price: [15e3, 900e3], n: 4 },
  ];
  let s = 4;
  for (const kind of kinds) {
    for (let i = 0; i < kind.n; i++) {
      listing(name, { seller: SELLERS[s++ % SELLERS.length], price: playerPrice(between(...kind.price)), stats: kind.stats, at: when(6 * 24), soldWithin: rand() < 0.35 ? between(2, 30) : null });
    }
  }
});

situation('Ilbi Throwing Stars', 'Stars sell as sets, so 800 for 2,950,000 is one set at 2.95M. Includes the 4 for 600,000 scam, still up.', name => {
  for (let i = 0; i < 12; i++) {
    listing(name, { seller: SELLERS[(i * 4 + 3) % SELLERS.length], qty: pick([800, 800, 750, 500, 1]), price: playerPrice(between(2.6e6, 3.3e6)), at: when(6 * 24), soldWithin: rand() < 0.4 ? between(2, 24) : null });
  }
  listing(name, { seller: 'Ilbiking', qty: 4, price: 600000, at: when(24, 6), until: 0 });
});

situation('Mithril Ore', 'One seller relisting lower each day they were seen (one vote per seller), among four steady sellers.', name => {
  [90, 85, 80, 74, 69, 65].forEach((price, i) => listing(name, { seller: 'cozyfm', qty: 100, price, at: when((6 - i) * 24 + 24, (6 - i) * 24) }));
  for (const seller of ['Stumpie', 'Dyle', 'Ribbonpig', 'Tanuki']) {
    listing(name, { seller, qty: 100, price: between(85, 95), at: when(4 * 24), soldWithin: rand() < 0.5 ? between(2, 24) : null });
  }
});

situation('Dark Crystal', 'Sellers more than 2× apart, so the confidence reads "prices vary".', name => {
  [[95e3, false], [110e3, true], [180e3, false], [230e3, true], [260e3, false], [340e3, false]].forEach(([price, sells], i) =>
    listing(name, { seller: SELLERS[(i * 6 + 5) % SELLERS.length], price, at: when(4 * 24, 2), soldWithin: sells ? 30 : null }));
});

situation('Power Elixir', 'A long list: 70 listings over 3 days across every channel, with copies and two sellers whose name was hidden.', name => {
  for (let i = 0; i < 70; i++) {
    const seller = i === 11 || i === 40 ? '' : sellerName(i);
    listing(name, { seller, qty: pick([1, 10, 50, 100, 100]), price: playerPrice(between(4200, 6500)), at: when(3 * 24), copies: rand() < 0.15 ? 2 + Math.floor(rand() * 3) : undefined, soldWithin: rand() < 0.3 ? between(1, 12) : null });
  }
});

scans.sort((a, b) => a.at - b.at);

const db = openDb(file);
let saved = 0, skipped = 0;
for (const s of scans) {
  const out = db.addSightings([s]);
  saved += out.saved;
  skipped += out.skipped;
}
db.close();

const played = sessions.reduce((sum, s) => sum + s.end - s.start, 0) / HOUR;
const days = new Set(sessions.map(s => new Date(s.start).toDateString())).size;
console.log(`Wrote ${file}: ${saved} scans saved, ${skipped} skipped.`);
console.log(`${sessions.length} play sessions on ${days} of the last ${WEEKS * 7} days, ${Math.round(played)} hours in all.\n`);
for (const s of situations) console.log(`${s.name} (${s.scans} scans)\n  ${s.what}`);
console.log(`\nServe it with:  DB="${file}" node serve.js`);
