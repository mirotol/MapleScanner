// The candidate anti-fake rules (trust.js), each attack as a test. Run with: node --test test/trust.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sightings, trustedAt, standing, limitVotes } = require('../trust.js');
const { marketFor } = require('../market.js');

const NOW = Date.UTC(2026, 10, 13, 12);
const HOUR = 36e5, DAY = 864e5;
const SEED = 1, HONEST = 2, COPIER = 3;

// A made-up world: report(uploader, listing, arrivedAt, seenAt) adds one install's report.
function world() {
  const reports = [];
  const report = (uploader, listing, received, firstSeen = received) => reports.push({ listing, uploader, firstSeen, lastSeen: firstSeen, received });
  const trust = (opts = {}) => trustedAt(sightings(reports), { seeds: [SEED], ...opts });
  return { reports, report, trust };
}

// `count` listings an install reports first, then the seed reports later, spread over `days` days.
function firstThenSeed(w, uploader, { count = 20, days = 2, from = 0, start = NOW - 3 * DAY } = {}) {
  for (let i = 0; i < count; i++) {
    const t = start + (i % days) * DAY + i * 60e3;
    w.report(uploader, from + i, t);
    w.report(SEED, from + i, t + HOUR);
  }
}

test('an honest player earns trust by being first to listings the trusted player later sees', () => {
  const w = world();
  firstThenSeed(w, HONEST);
  const { trusted, credit } = w.trust();
  assert.ok(trusted.has(HONEST));
  assert.equal(credit.get(HONEST)?.listings, undefined, 'once trusted, nothing more is counted');
});

test('not yet trusted with too few listings or all on one day, and it shows how far along it is', () => {
  const few = world();
  firstThenSeed(few, HONEST, { count: 19 });
  assert.ok(!few.trust().trusted.has(HONEST));
  assert.equal(few.trust().credit.get(HONEST).listings, 19);
  const oneDay = world();
  firstThenSeed(oneDay, HONEST, { days: 1 });
  assert.ok(!oneDay.trust().trusted.has(HONEST));
});

test('trust is worked out as of a time: what arrived later does not count yet', () => {
  const w = world();
  firstThenSeed(w, HONEST, { start: NOW - 3 * DAY });
  assert.ok(!w.trust({ at: NOW - 2.5 * DAY }).trusted.has(HONEST));
  assert.ok(w.trust({ at: NOW }).trusted.has(HONEST));
});

test('copying listings from the public sync earns nothing, even with its seen time backdated', () => {
  const w = world();
  for (let i = 0; i < 100; i++) {
    const t = NOW - 3 * DAY + (i % 3) * DAY + i * 60e3;
    w.report(SEED, i, t);
    // the copy arrives after the seed's report, though it claims to have been seen an hour before
    w.report(COPIER, i, t + 60e3, t - HOUR);
  }
  const { trusted, credit } = w.trust();
  assert.ok(!trusted.has(COPIER));
  assert.equal(credit.get(COPIER), undefined);
});

test('a ring of new installs confirming each other never becomes trusted', () => {
  const w = world();
  for (let i = 0; i < 60; i++) {
    const t = NOW - 3 * DAY + (i % 3) * DAY + i * 60e3;
    w.report(10 + (i % 3), 1000 + i, t);
    w.report(10 + ((i + 1) % 3), 1000 + i, t + 60e3);
    w.report(10 + ((i + 2) % 3), 1000 + i, t + 120e3);
  }
  const { trusted } = w.trust();
  assert.deepEqual([...trusted], [SEED]);
  const s = standing([10, 11, 12], trusted);
  assert.deepEqual(s, { ok: false, free: false, source: 'untrusted' });
});

// 20 listings `uploader` reports first over 2 days, then each of `confirmers` reports later.
function firstThenOthers(w, uploader, confirmers, from) {
  for (let i = 0; i < 20; i++) {
    const t = NOW - 2 * DAY + (i % 2) * DAY + i * 60e3;
    w.report(uploader, from + i, t);
    confirmers.forEach((c, k) => w.report(c, from + i, t + (k + 1) * HOUR));
  }
}

test('trust spreads: two players trusted through the seed then vouch for the next one', () => {
  const w = world();
  firstThenSeed(w, HONEST);
  firstThenSeed(w, 5, { from: 100 });
  firstThenOthers(w, 4, [HONEST, 5], 500);
  assert.ok(w.trust().trusted.has(4));
});

test('a trusted player alone cannot vouch for keys of their own, though the seed alone can', () => {
  const w = world();
  firstThenSeed(w, HONEST);
  firstThenOthers(w, 4, [HONEST], 500);
  const { trusted, credit } = w.trust();
  assert.ok(trusted.has(HONEST));
  assert.ok(!trusted.has(4));
  assert.equal(credit.get(4).confirmers.size, 1);
});

test('a blocked install is never trusted, and reports from before arrival times were kept use their seen time', () => {
  const w = world();
  firstThenSeed(w, HONEST);
  assert.ok(!w.trust({ blocked: [HONEST] }).trusted.has(HONEST));
  const old = world();
  for (let i = 0; i < 20; i++) {
    const t = NOW - 3 * DAY + (i % 2) * DAY + i * 60e3;
    old.reports.push({ listing: i, uploader: HONEST, firstSeen: t, lastSeen: t, received: null });
    old.reports.push({ listing: i, uploader: SEED, firstSeen: t + HOUR, lastSeen: t + HOUR, received: null });
  }
  assert.ok(old.trust().trusted.has(HONEST));
});

test('a listing is confirmed by a trusted reporter, and free of the cap once a second install saw it too', () => {
  const trusted = new Set([SEED, HONEST]);
  assert.deepEqual(standing([SEED], trusted), { ok: true, free: false, source: String(SEED) });
  assert.deepEqual(standing([SEED, 9], trusted), { ok: true, free: true, source: null });
  assert.deepEqual(standing([SEED, SEED], trusted), { ok: true, free: false, source: String(SEED) });
  assert.deepEqual(standing([9], trusted), { ok: false, free: false, source: 'untrusted' });
});

// ---------- the usual price ----------

const v = (u, s, source, extra = {}) => ({ u, s, sold: false, t: NOW, source, free: false, ...extra });
const realSellers = ['Alder', 'Ash', 'Birch', 'Cedar', 'Dogwood', 'Elm'].map((s, i) => v(100e3 + i * 2e3, s, null, { free: true }));

test('a lone scanner keeps every seller: there is nothing to weigh their prices against', () => {
  const alone = Array.from({ length: 12 }, (_, i) => v(1000 + i * 10, `Seller${i}`, 'untrusted'));
  assert.equal(limitVotes(alone), alone);
  assert.deepEqual(marketFor(limitVotes(alone), { now: NOW }), marketFor(alone, { now: NOW }));
});

test('a hundred new keys inventing high sales are one source, and do not move a usual price', () => {
  const fakes = Array.from({ length: 100 }, (_, i) => v(900e3, `Fake${i}`, 'untrusted', { sold: true, t: NOW - (i % 2) * DAY }));
  const all = [...realSellers, ...fakes];
  assert.equal(marketFor(all, { now: NOW }).price, 900e3, 'without the cap the fakes set the price');
  const kept = limitVotes(all);
  assert.equal(kept.filter(x => x.source === 'untrusted').length, 2);
  assert.equal(marketFor(kept, { now: NOW }).price, 102e3);
});

test('a trusted player who turns liar cannot set a usual price with cheap sales', () => {
  const lies = Array.from({ length: 20 }, (_, i) => v(10e3, `Made${i}`, String(HONEST), { sold: true, t: NOW - (i % 2) * DAY }));
  const all = [...realSellers, ...lies];
  assert.equal(marketFor(all, { now: NOW }).price, 10e3, 'without the cap the lies set the price');
  // With a cap of 3 they still would: three sellers' sales lower a price from asks (LOWER_SELLERS)
  assert.equal(marketFor(limitVotes(all, { cap: 3 }), { now: NOW }).price, 10e3);
  assert.equal(marketFor(limitVotes(all), { now: NOW }).price, 102e3);
});

test('the cap keeps a source\'s sellers at evenly spaced prices, with every vote of each one kept', () => {
  const many = Array.from({ length: 9 }, (_, i) => v(100 * (i + 1), `S${i}`, 'untrusted'));
  many.push(v(150, 'S0', 'untrusted', { sold: true }));
  const kept = limitVotes([...realSellers, ...many], { cap: 3 }).filter(x => x.source === 'untrusted');
  assert.deepEqual([...new Set(kept.map(x => x.s))], ['S1', 'S4', 'S7']);
  const withSale = limitVotes([...realSellers, ...many], { cap: 9 }).filter(x => x.s === 'S0');
  assert.equal(withSale.length, 2);
});

test('shadow mode measures a liar: trust, the price the cap keeps and the cheapest ask nobody trusted saw', () => {
  const { measure, print } = require('../tools/shadow.js');
  const listings = [], reports = [];
  const list = (id, seller, price, uploader, t, extra = {}) => {
    listings.push({ id, name: 'Red Potion', seller, qty: 1, price, sold: 0, copies: 1, firstSeen: t, lastSeen: t, channel: 1, map: 'Free Market', room: 1, shop: null, ...extra });
    reports.push({ listing: id, uploader, firstSeen: t, lastSeen: t, received: t });
  };
  ['Alder', 'Ash', 'Birch', 'Cedar', 'Dogwood', 'Elm'].forEach((s, i) => list(i + 1, s, 50 + i, SEED, NOW - HOUR));
  // each in a room of its own, or names this close on one stall would be one seller (sameSeller)
  for (let i = 0; i < 10; i++) list(100 + i, `Fake${i}`, 5, 9, NOW - 2 * HOUR, { sold: 1, room: 2 + i });
  list(200, 'Cheapo', 1, 9, NOW - 10 * 60e3);
  const uploaders = [{ id: SEED, rows: 6, created: NOW - DAY, blocked: 0 }, { id: 9, rows: 11, created: NOW - DAY, blocked: 0 }];
  const r = measure({ listings, reports, uploaders }, { seeds: [SEED], now: NOW });
  assert.equal(r.trustedCount, 1);
  assert.equal(r.prices.changed, 1);
  assert.deepEqual([r.prices.examples[0].before, r.prices.examples[0].after], [5, 51]);
  assert.deepEqual(r.cheapest['1 hour'], { shown: 1, unconfirmed: 1 });
  const lines = [];
  print(r, line => lines.push(line));
  assert.ok(lines.some(l => l.includes('Red Potion: 5 → 51')));
});

test('unknown sellers are not counted against the cap', () => {
  const unknown = Array.from({ length: 5 }, () => v(500, '', 'untrusted'));
  const kept = limitVotes([...realSellers, ...unknown]);
  assert.equal(kept.length, realSellers.length + 5);
});
