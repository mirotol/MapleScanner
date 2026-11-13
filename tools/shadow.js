// Shadow mode: works out the candidate anti-fake rules (trust.js) on the real shared database and
// says what they would change, while nothing a player sees changes. Run by the admin:
//
//   set MAPLE_ADMIN_TOKEN and CLOUD_URL, then:
//   node tools/shadow.js --seed-key <path to install.json>    trust your own install by hand
//   node tools/shadow.js --seed 3 --seed 7                     or name the seeds by uploader id
//
// Everything is read into memory and only counts and a few examples are printed: nothing is saved
// on this computer. Times are this computer's.
const fs = require('fs');
const crypto = require('crypto');
const { RULES, arrival, sightings, trustedAt, standing, limitVotes } = require('../trust.js');
const { marketFor, verdict, cheaperElsewhere, soldSince } = require('../market.js');
const { itemFacts, SEEN_DAYS, fmt } = require('../pricing.js');

const HOUR = 36e5, DAY = 864e5;
const BUSY = 20; // listings in the window that make an item busy

// The figures, from { listings, reports, uploaders } as the admin export gives them.
function measure({ listings, reports, uploaders }, { seeds = [], now = Date.now(), rules = RULES, items = require('../osms-items.json') } = {}) {
  const facts = itemFacts(items);
  const seen = sightings(reports);
  const blocked = uploaders.filter(u => u.blocked).map(u => u.id);
  const { trusted, credit } = trustedAt(seen, { seeds, blocked, at: now, rules });
  const recent = listings.filter(l => l.lastSeen >= now - SEEN_DAYS * DAY);
  const ids = l => [...new Set((seen.get(l.id) || []).map(r => r.uploader))];

  // ---------- how often a second install sees the same listing ----------
  const perItem = new Map();
  for (const l of recent) perItem.set(l.name, (perItem.get(l.name) || 0) + 1);
  const groups = {};
  const add = (group, l) => {
    const g = groups[group] ??= { listings: 0, one: 0, two: 0, more: 0, trusted: 0, gaps: [] };
    const list = seen.get(l.id) || [];
    const by = ids(l);
    g.listings++;
    g[by.length <= 1 ? 'one' : by.length === 2 ? 'two' : 'more']++;
    if (standing(by, trusted).ok) g.trusted++;
    const second = list.find(r => r.uploader !== list[0].uploader);
    if (second) g.gaps.push(arrival(second) - arrival(list[0]));
  };
  for (const l of recent) {
    const first = (seen.get(l.id) || [])[0];
    add('all', l);
    add(l.room != null || l.map === 'Free Market' ? 'Free Market' : 'elsewhere', l);
    add(perItem.get(l.name) >= BUSY ? `busy items (${BUSY}+ listings)` : 'thin items', l);
    if (first) {
      const h = new Date(arrival(first)).getHours();
      add(`first seen ${String(h - (h % 6)).padStart(2, '0')}–${String(h - (h % 6) + 6).padStart(2, '0')}`, l);
    }
  }

  // ---------- who would be trusted, and since when ----------
  const start = reports.reduce((t, r) => Math.min(t, arrival(r)), now);
  const since = new Map();
  for (let day = new Date(start).setHours(24, 0, 0, 0); day <= now + DAY; day += DAY) {
    for (const id of trustedAt(seen, { seeds, blocked, at: Math.min(day, now), rules }).trusted) if (!since.has(id)) since.set(id, Math.min(day, now));
  }
  const installs = uploaders.map(u => {
    const c = credit.get(u.id);
    return {
      id: u.id, rows: u.rows, created: u.created, blocked: !!u.blocked, seed: seeds.includes(u.id),
      trusted: trusted.has(u.id), since: since.get(u.id) ?? null,
      first: c?.listings ?? 0, confirmers: c?.confirmers.size ?? 0, days: c?.days.size ?? 0,
    };
  });
  const bars = [];
  for (const need of [10, 20, 30]) {
    for (const days of [1, 2, 3]) {
      const t = trustedAt(seen, { seeds, blocked, at: now, rules: { ...rules, listings: need, days } }).trusted;
      bars.push({ listings: need, days, trusted: [...t].filter(id => !seeds.includes(id)).length });
    }
  }

  // ---------- what players would see differently ----------
  const votesOf = new Map();
  for (const l of recent) {
    if (!votesOf.has(l.name)) votesOf.set(l.name, []);
    votesOf.get(l.name).push({
      id: l.id, u: facts.unitPrice(l.name, l.qty, l.price), s: l.seller, sold: !!l.sold, t: l.lastSeen, qty: l.qty, copies: l.copies,
      channel: l.channel, map: l.map, room: l.room, shop: l.shop, ...standing(ids(l), trusted),
    });
  }
  const prices = { items: 0, changed: 0, firmLost: 0, examples: [] };
  const cheapest = { '1 hour': { shown: 0, unconfirmed: 0 }, '6 hours': { shown: 0, unconfirmed: 0 } };
  const deals = { before: 0, after: 0, lost: [], gained: [], unconfirmed: 0 };
  for (const [name, votes] of votesOf) {
    const limited = limitVotes(votes, { cap: rules.cap });
    const before = marketFor(votes, { now }), after = marketFor(limited, { now });
    if (before) {
      prices.items++;
      if (!after || after.price !== before.price) {
        prices.changed++;
        prices.examples.push({ name, before: before.price, after: after?.price ?? null, sellers: before.sellers, kept: after?.sellers ?? 0 });
      }
      if (before.firm && !after?.firm) prices.firmLost++;
    }
    for (const [label, within] of [['1 hour', HOUR], ['6 hours', 6 * HOUR]]) {
      const c = cheaperElsewhere(votes, Infinity, { now, within });
      if (!c) continue;
      cheapest[label].shown++;
      if (!c.ok) cheapest[label].unconfirmed++;
    }
    if (facts.single(name)) continue; // gear gets no percentage on the card until its stats are read
    for (const v of votes) {
      if (v.sold || now - v.t > DAY || soldSince(v, votes)) continue;
      const tag = list => verdict({ unit: v.u, confirmed: true }, marketFor(list, { now, except: v }), null).tag;
      const was = tag(votes), is = tag(limited);
      if (was === 'deal') deals.before++;
      if (is === 'deal') deals.after++;
      if (is === 'deal' && !v.ok) deals.unconfirmed++;
      if (was === 'deal' && is !== 'deal') deals.lost.push({ name, price: v.u, seller: v.s });
      if (was !== 'deal' && is === 'deal') deals.gained.push({ name, price: v.u, seller: v.s });
    }
  }
  prices.examples.sort((a, b) => Math.abs(Math.log((b.after ?? 1) / b.before)) - Math.abs(Math.log((a.after ?? 1) / a.before)));

  return {
    now, rules, seeds, trustedCount: trusted.size,
    data: { listings: listings.length, recent: recent.length, reports: reports.length, uploaders: uploaders.length, noArrival: reports.filter(r => r.received == null).length },
    corroboration: groups, installs, bars, prices, cheapest, deals,
  };
}

// ---------- printing ----------

const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '–');
const median = list => (list.length ? [...list].sort((a, b) => a - b)[(list.length - 1) >> 1] : null);
const span = ms => (ms == null ? '–' : ms < HOUR ? `${Math.round(ms / 6e4)} min` : ms < 2 * DAY ? `${(ms / HOUR).toFixed(1)} h` : `${(ms / DAY).toFixed(1)} days`);
const date = t => (t == null ? '–' : new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));

function print(r, out = console.log) {
  const { data } = r;
  out(`Shadow mode, ${date(r.now)}. Nothing here changes what players see.`);
  out(`${data.listings} listings (${data.recent} in the last ${SEEN_DAYS} days), ${data.reports} reports, ${data.uploaders} installs.`);
  if (data.noArrival) out(`${data.noArrival} reports are from before arrival times were kept, and use the app's own time.`);
  if (!r.seeds.length) out('No seed given, so nobody is trusted. Pass --seed-key <install.json> or --seed <id>.');
  out(`Rules: trusted after ${r.rules.listings} listings reported first and then seen by trusted installs, on ${r.rules.days} days, from ${r.rules.confirmers} of them or a seed. One source adds at most ${r.rules.cap} sellers to a usual price.`);

  out('\nHow often a second install sees the same listing (last 14 days)');
  out(['', 'listings', '1 install', '2', '3+', 'trusted saw it', 'median wait for 2nd'].join('\t'));
  const order = name => ['all', 'Free Market', 'elsewhere', 'busy', 'thin'].findIndex(k => name.startsWith(k)) >>> 0;
  const rows = Object.entries(r.corroboration).sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b));
  for (const [name, g] of rows) {
    out([name, g.listings, pct(g.one, g.listings), pct(g.two, g.listings), pct(g.more, g.listings), pct(g.trusted, g.listings), span(median(g.gaps))].join('\t'));
  }

  out(`\nInstalls (${r.trustedCount} trusted)`);
  out(['id', 'rows', 'started', 'trusted', 'since', 'first to', 'confirmers', 'days'].join('\t'));
  for (const i of r.installs) {
    out([i.id, i.rows, date(i.created), i.blocked ? 'blocked' : i.seed ? 'seed' : i.trusted ? 'yes' : 'no', i.trusted && !i.seed ? date(i.since) : '', i.first, i.confirmers, i.days].join('\t'));
  }
  out('\nOther trust bars: installs trusted besides the seeds');
  out(['', ...[1, 2, 3].map(d => `${d} day${d > 1 ? 's' : ''}`)].join('\t'));
  for (const need of [10, 20, 30]) out([`${need} listings`, ...r.bars.filter(b => b.listings === need).map(b => b.trusted)].join('\t'));

  const p = r.prices;
  out(`\nUsual prices with the cap: ${p.changed} of ${p.items} items change, ${p.firmLost} lose their firm price.`);
  for (const e of p.examples.slice(0, 10)) out(`  ${e.name}: ${fmt(e.before)} → ${e.after == null ? 'none' : fmt(e.after)} (${e.sellers} sellers → ${e.kept})`);
  out('\nCheapest ask "elsewhere" that is not confirmed by a trusted install');
  for (const [label, c] of Object.entries(r.cheapest)) out(`  within ${label}: ${c.unconfirmed} of ${c.shown} items (${pct(c.unconfirmed, c.shown)})`);
  const d = r.deals;
  out(`\nDeals among asks of the last 24 hours (not gear): ${d.before} now, ${d.after} with the cap, ${d.unconfirmed} of those unconfirmed.`);
  for (const [label, list] of [['lost', d.lost], ['new', d.gained]]) {
    if (list.length) out(`  ${label}: ${list.slice(0, 10).map(x => `${x.name} ${fmt(x.price)} (${x.seller || 'unknown'})`).join(', ')}${list.length > 10 ? ` and ${list.length - 10} more` : ''}`);
  }
}

// ---------- reading the price server ----------

async function load(url, token) {
  const call = async (action, body) => {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/admin/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${action}: ${json.error || res.status}`);
    return json;
  };
  const all = async table => {
    const rows = [];
    for (let after = 0, more = true; more;) {
      const page = await call('export', { table, after });
      rows.push(...page.rows);
      ({ cursor: after, more } = page);
    }
    return rows;
  };
  const [listings, reports, { uploaders }] = await Promise.all([all('listings'), all('reports'), call('uploaders', {})]);
  return { listings, reports, uploaders };
}

if (require.main === module) {
  const url = process.env.CLOUD_URL, token = process.env.MAPLE_ADMIN_TOKEN;
  if (!url || !token) {
    console.error('Usage: set MAPLE_ADMIN_TOKEN and CLOUD_URL, then: node tools/shadow.js [--seed-key <install.json>] [--seed <id>]...');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const values = flag => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
  (async () => {
    const data = await load(url, token);
    const seeds = values('--seed').map(Number);
    for (const file of values('--seed-key')) {
      const { key } = JSON.parse(fs.readFileSync(file, 'utf8'));
      const hash = crypto.createHash('sha256').update(key).digest('hex');
      const mine = data.uploaders.find(u => u.keyHash === hash);
      if (mine) seeds.push(mine.id);
      else console.error(`${file}: that install has not uploaded anything.`);
    }
    print(measure(data, { seeds }));
  })().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { measure, print };
