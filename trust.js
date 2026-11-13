// Candidate rules against made-up listings, measured in shadow mode (tools/shadow.js) before any of
// them changes what a player sees. Pure, so the same code can later run in the Worker and in
// market.js, and what was measured is what goes live.
//
// The idea (Nov 13): install keys are free to make, so a key on its own is worth nothing. What a
// faker can't make is a listing someone else then sees in the game. So:
// - Trust spreads out from installs the admin trusts by hand (seeds). An install earns it when it
//   was the FIRST to report listings that trusted installs then also reported, on enough days and
//   from enough of them (a seed counts as enough). First, because anyone can copy listings from the public sync: a copy
//   always arrives after someone else's report, so copying earns nothing.
// - A listing is confirmed when a trusted install reported it. Only confirmed listings would point
//   a player at another stall or put text on the website.
// - No install, trusted or not, moves a usual price by more than CAP sellers' votes once others
//   have seen the item. Untrusted installs share one pool, so a hundred new keys are one source.
//
// Times: `received` is when the server first got an install's report of a listing. The app says
// when it saw something, which can be made up, so arrival order goes by `received`. Reports from
// before it was recorded (Nov 13) fall back to the app's own time.

const DAY_MS = 864e5;

// Draft bars, to be set from what shadow mode measures
const RULES = {
  listings: 20,  // listings an install reported first that trusted installs then saw
  // Different trusted installs among those. A seed's word is enough on its own, but a trusted
  // install that turns bad can't vouch alone for keys of its own.
  confirmers: 2,
  days: 2,       // different days those first reports were on
  // Sellers one source can add to an item's usual price once others saw it. Under market.js's
  // LOWER_SELLERS (3), so no source on its own meets any of its seller bars: with 3, one lying
  // install's cheap sales set the usual price (test/trust.test.js).
  cap: 2,
};

const arrival = r => r.received ?? r.firstSeen;

// Each listing's reports, earliest arrival first. reports: [{ listing, uploader, firstSeen, lastSeen, received }]
function sightings(reports) {
  const by = new Map();
  for (const r of reports) {
    if (!by.has(r.listing)) by.set(r.listing, []);
    by.get(r.listing).push(r);
  }
  for (const list of by.values()) list.sort((a, b) => arrival(a) - arrival(b) || a.uploader - b.uploader);
  return by;
}

// Who is trusted as of `at`, and what each install has earned towards it.
// seeds: ids the admin trusts by hand. blocked: ids that can never be trusted.
function trustedAt(seen, { seeds = [], blocked = [], at = Infinity, rules = RULES } = {}) {
  const never = new Set(blocked);
  const seeded = new Set(seeds.filter(id => !never.has(id)));
  const trusted = new Set(seeded);
  let credit;
  for (let grew = true; grew;) {
    grew = false;
    credit = new Map();
    for (const list of seen.values()) {
      const known = list.filter(r => arrival(r) <= at);
      if (!known.length) continue;
      const first = known[0];
      if (trusted.has(first.uploader) || never.has(first.uploader)) continue;
      const confirmers = known.filter(r => r.uploader !== first.uploader && trusted.has(r.uploader)).map(r => r.uploader);
      if (!confirmers.length) continue;
      const c = credit.get(first.uploader) ?? { listings: 0, confirmers: new Set(), days: new Set() };
      c.listings++;
      for (const id of confirmers) c.confirmers.add(id);
      c.days.add(Math.floor(arrival(first) / DAY_MS));
      credit.set(first.uploader, c);
    }
    const vouched = c => c.confirmers.size >= rules.confirmers || [...c.confirmers].some(id => seeded.has(id));
    for (const [id, c] of credit) {
      if (c.listings >= rules.listings && vouched(c) && c.days.size >= rules.days) {
        trusted.add(id);
        grew = true;
      }
    }
  }
  return { trusted, credit };
}

// What a listing's reporters make it. ids: the installs that reported it.
// ok: a trusted install reported it (confirmed). free: a trusted install and another install
// both did, so its vote needs no cap. source: whose cap it counts against otherwise, a trusted
// install's own id, or 'untrusted' for every untrusted install together.
function standing(ids, trusted) {
  const unique = [...new Set(ids)];
  const sure = unique.filter(id => trusted.has(id));
  const ok = sure.length > 0;
  const free = ok && unique.length >= 2;
  return { ok, free, source: free ? null : ok ? String(sure[0]) : 'untrusted' };
}

// Votes (market.js's, each with `free` and `source` from standing) with no source adding more than
// `cap` named sellers, once the item has votes from anywhere else. A source's sellers are kept at
// evenly spaced points of their prices, so what it saw still counts, at the weight of a few
// sellers. An item only one source has seen keeps everything: there's nothing to weigh it against,
// and its price confidence already says how thin it is.
function limitVotes(votes, { cap = RULES.cap } = {}) {
  const sources = new Map();
  for (const v of votes) {
    const key = v.free ? null : v.source;
    if (!sources.has(key)) sources.set(key, []);
    sources.get(key).push(v);
  }
  if (sources.size < 2) return votes;
  const dropped = new Set();
  for (const [key, list] of sources) {
    if (key === null) continue;
    const sellers = new Map();
    for (const v of list) {
      if (!v.s) continue; // unknown sellers are never counted as sellers anyway
      const name = v.s.toLowerCase();
      if (!sellers.has(name)) sellers.set(name, []);
      sellers.get(name).push(v);
    }
    if (sellers.size <= cap) continue;
    const ranked = [...sellers.values()].sort((a, b) => Math.min(...a.map(v => v.u)) - Math.min(...b.map(v => v.u)));
    const keep = new Set(Array.from({ length: cap }, (_, i) => Math.round(((i + 0.5) * ranked.length) / cap - 0.5)));
    ranked.forEach((group, i) => { if (!keep.has(i)) for (const v of group) dropped.add(v); });
  }
  return votes.filter(v => !dropped.has(v));
}

module.exports = { RULES, arrival, sightings, trustedAt, standing, limitVotes };
