// Turns raw listings into a market summary and a verdict on one listing. Pure, so it can be
// tested in Node and shared by the pages. See "Average or median" in CLAUDE.md for the rules.
const { marketFor, usualSource, verdict, priceRail, cheaperElsewhere, soldSince, dailyPrices, sameStats, closestGear } = (({ norm, sim, fmt }) => {
  const DAY_MS = 864e5;
  const WINDOWS = [3, 7, 14]; // days, shortest first, because prices move fast
  // Named sellers a usual price needs to be firm (raised from 3 on Nov 10, to be harder to fake)
  const FIRM_SELLERS = 5, SOLD_DAYS = 2;
  // Named sellers whose sales can lower a usual price that still comes from asks, never raise
  // it. Asks are what's left unsold, so they run high: on the real list (Nov 12, 3 days of
  // scans) 64 of 232 items were over 1.25× their sales. Three, because the middle of three
  // takes two cheap sellers to move, and a usual price that's too low only hides a deal.
  const LOWER_SELLERS = 3;
  const NEAR_SOLD = 2; // a price within this many times a sale is no surprise
  const MOSTLY_ONE_MIN = 3; // open listings before "one seller holds most of the stock" can apply
  const CHECK_BELOW = -70, OVER_ABOVE = 25; // percent from the usual price
  // How far under the usual price a deal starts. Measured Nov 9 on the real list: from 50K,
  // -20% caught only the cheapest 7% of asks, and 10% of 150K is worth walking to. Under 50K
  // prices jump around and 10% is a few hundred mesos, so it stays -20%.
  const dealBelow = usual => (usual >= 50e3 ? -10 : -20);
  const CHEAPER_MS = 6 * 36e5; // shops close, so an older ask isn't worth walking to
  const SAME_SELLER = 0.8, MOSTLY_ONE = 0.6;
  // How far apart sellers' prices can be (upper quarter over lower) and still agree, and past
  // which a usual price loses a confidence level. Measured Nov 9 on the real list: with 3 or
  // more sellers, not gear, half the items are within 1.3× and 9 in 10 within 2.5×.
  const SPREAD_AGREE = 1.5, SPREAD_WIDE = 2;
  const LEVELS = { 1: 'Thin', 2: 'Decent', 3: 'Solid' };

  const sorted = prices => [...prices].sort((a, b) => a - b);
  // The lower middle, so the answer is always a price someone really set.
  const middle = prices => sorted(prices)[(prices.length - 1) >> 1];
  // Asks lean low: a fake high ask is free, but anyone can buy a fake low one.
  const lowerQuartile = prices => sorted(prices)[(prices.length - 1) >> 2];

  // Whether two listings are the same seller's. The same name is. OCR can read one name two
  // ways (Loodles and Lood1es), which would look like two sellers, so a close name counts too,
  // but only on the same stall: the same shop title, or the same channel and room. Two players
  // with close names have different stalls, and taking them for one hid one's cheaper ask
  // (Ludilove and Ludilove2, Nov 10). Unknown sellers are never the same as anyone.
  const sameStall = (a, b) => (!!a.shop && !!b.shop && norm(a.shop) === norm(b.shop))
    || (a.channel != null && a.room != null && a.channel === b.channel && a.room === b.room && (a.map ?? null) === (b.map ?? null));
  function sameSeller(a, b) {
    if (!a.s || !b.s) return false;
    const x = norm(a.s), y = norm(b.s);
    return x === y || (sim(x, y) >= SAME_SELLER && sameStall(a, b));
  }
  // except: the seller being judged, as a name or as { s, shop, channel, map, room }.
  const excepted = (v, except) => !!except && sameSeller(v, typeof except === 'string' ? { s: except } : except);

  // Groups votes by seller. Unknown sellers share one group and are never counted as a seller.
  function bySeller(votes) {
    const groups = [];
    for (const v of votes) {
      const group = groups.find(g => (v.s ? g.known && g.votes.some(u => sameSeller(u, v)) : !g.known));
      if (group) group.votes.push(v);
      else groups.push({ seller: v.s, known: !!v.s, votes: [v] });
    }
    return groups;
  }

  // An ask is gone once the game showed it sold: a shop keeps a sold item in its list as a
  // greyed row with the same amount and price. It's a sale now, so the Prices card lists it
  // once, under Sold. Nothing links the two rows, so only what's sure ties them, because
  // hiding an ask that's still up is worse than showing one that sold (Nov 10):
  // - a named seller, as an unknown one (a hidden name plate) could be any shop
  // - the same amount, not just the same price each: 50 for 6,500 selling isn't 100 for 13,000
  // - as many copies sold as were up: 1 of 3 identical rows sold leaves 2 for sale
  // Votes without an amount match on the price each alone.
  const soldSince = (ask, votes) => {
    if (ask.sold || !ask.s) return false;
    const sales = votes.filter(v => v.sold && v.t >= ask.t && v.u === ask.u && sameSeller(ask, v)
      && (v.qty == null || ask.qty == null || v.qty === ask.qty));
    return sales.length > 0 && sales.reduce((n, v) => n + (v.copies || 1), 0) >= (ask.copies || 1);
  };

  // A seller's standing ask: their newest, unless it was later seen sold.
  function standingAsk({ votes }) {
    const asks = votes.filter(v => !v.sold);
    if (!asks.length) return null;
    const latest = asks.reduce((a, b) => (b.t > a.t ? b : a));
    return soldSince(latest, votes) ? null : latest;
  }

  const inDays = (votes, days, now) => votes.filter(v => now - v.t <= days * DAY_MS);
  const knownSellers = votes => bySeller(votes).filter(g => g.known).length;

  // The shortest window with enough sellers, otherwise everything recent.
  function pickWindow(votes, now) {
    for (const days of WINDOWS) {
      const picks = inDays(votes, days, now);
      if (knownSellers(picks) >= FIRM_SELLERS) return { days, picks };
    }
    const days = WINDOWS[WINDOWS.length - 1];
    return { days, picks: inDays(votes, days, now) };
  }

  // votes: [{ u: price per item, s: seller, sold, t: time }], one for each distinct listing.
  // except: the seller being judged, who can't vouch for their own price.
  function marketFor(votes, { except = null, now = Date.now() } = {}) {
    const others = (votes || []).filter(v => !excepted(v, except));
    const { days, picks } = pickWindow(others, now);
    if (!picks.length) return null;

    const groups = bySeller(picks);
    const asks = groups.map(standingAsk).filter(Boolean).map(v => v.u);
    const sellersSold = groups.filter(g => g.votes.some(v => v.sold));
    const solds = sellersSold.map(g => middle(g.votes.filter(v => v.sold).map(v => v.u)));
    const soldBy = sellersSold.filter(g => g.known).length;
    const askedBy = groups.filter(g => g.known && standingAsk(g)).length;
    const soldDays = new Set(picks.filter(v => v.sold).map(v => Math.floor(v.t / DAY_MS))).size;

    // Sold beats asked only when it's hard to fake.
    const soldIsSolid = soldBy >= FIRM_SELLERS && soldDays >= SOLD_DAYS;
    const useSold = soldIsSolid || !asks.length;
    const namedSolds = sellersSold.filter(g => g.known).map(g => middle(g.votes.filter(v => v.sold).map(v => v.u)));
    const lowered = !useSold && soldBy >= LOWER_SELLERS && middle(namedSolds) < lowerQuartile(asks);
    const fromSold = useSold || lowered;
    const prices = picks.map(v => v.u);
    const open = picks.filter(v => !v.sold);
    const top = Math.max(0, ...groups.filter(g => g.known).map(g => g.votes.filter(v => !v.sold).length));
    // One price for each named seller the usual price comes from, to see how far apart they are
    const theirs = sorted(fromSold
      ? namedSolds
      : groups.filter(g => g.known).map(standingAsk).filter(Boolean).map(v => v.u));
    const market = {
      price: useSold ? middle(solds) : lowered ? middle(namedSolds) : lowerQuartile(asks),
      basis: fromSold ? 'sold' : 'asking',
      lowered, // a few sellers' sales, taken because they're under the asks
      firm: soldIsSolid || (!useSold && askedBy >= FIRM_SELLERS),
      low: Math.min(...prices), high: Math.max(...prices),
      sellers: groups.filter(g => g.known).length,
      from: fromSold ? soldBy : askedBy, // the named sellers the price comes from
      sold: solds.length ? middle(solds) : null,
      soldCount: picks.filter(v => v.sold).length,
      ask: asks.length ? lowerQuartile(asks) : null,
      cheapest: asks.length ? Math.min(...asks) : null,
      days,
      mostlyOne: open.length >= MOSTLY_ONE_MIN &&top / open.length >= MOSTLY_ONE,
      // the upper quarter over the lower quarter of those prices, so one troll price can't widen it
      spread: theirs.length < 2 ? 1 : theirs[theirs.length - 1 - ((theirs.length - 1) >> 2)] / theirs[(theirs.length - 1) >> 2],
    };
    return market;
  }

  const sellerText = n => `${n} seller${n === 1 ? '' : 's'}`;
  const rangeText = m => (m.low === m.high ? fmt(m.low) : `${fmt(m.low)}–${fmt(m.high)}`);

  function reasonText(m) {
    const against = { sold: 'sold', asking: 'asking' }[m.basis];
    const parts = [`vs ${fmt(m.price)} ${against}`];
    parts.push(sellerText(m.sellers), `${m.days} days`);
    if (m.mostlyOne) parts.push('mostly 1 seller');
    return parts.join(', ');
  }

  // Where a price sits among everything seen, as percentages along a rail. The scale is
  // logarithmic so a 9,999,999 troll price stays on it without squashing normal prices.
  // unit can be null, to show a market with no listing to place.
  function priceRail(unit, market) {
    if (market?.low == null) return null;
    const low = unit == null ? market.low : Math.min(market.low, unit);
    const high = unit == null ? market.high : Math.max(market.high, unit);
    const place = v => (high === low ? 50 : Math.round(Math.log(v / low) / Math.log(high / low) * 1000) / 10);
    return {
      low, high, thin: !market.firm,
      here: unit == null ? null : place(unit),
      sold: market.sold == null ? null : place(market.sold),
    };
  }

  // The usual price in plain words, for a line on the stall card.
  const basisText = m => `${{ sold: 'Sold for', asking: 'Others ask' }[m.basis]} ${fmt(m.price)}`;

  // How far to trust a usual price, for the Prices page's Price confidence column: a level from
  // 1 (Thin) to 3 (Solid) drawn as dots, a short label naming what decided it ("1 seller",
  // "prices vary", "sold often"), so the dots explain themselves, and the whole reasoning as a
  // sentence. A level is a few plain rules rather than a percentage, because no true price
  // exists to measure a percentage against. Only what costs a faker something raises it: more
  // named sellers, or real sales on more than one day. gear: clean and scrolled copies are mixed.
  function usualSource(m, { gear = false } = {}) {
    const why = [];
    let level = 0, short = '';
    // A rule that changes the level also gives the label, so the label is what decided it
    const set = (to, label) => { if (to !== level) { level = to; short = label; } };
    if (m.from < FIRM_SELLERS) {
      set(1, m.from ? sellerText(m.from) : 'unknown sellers');
      why.push(m.from ? `Only ${sellerText(m.from)} so far` : 'No seller names were read');
    } else if (m.basis === 'sold' && m.firm && !m.lowered) {
      set(3, 'sold often');
      why.push(`Sold by ${sellerText(m.from)} on ${SOLD_DAYS} or more different days`);
    } else if (m.basis === 'sold') {
      set(2, 'sold, 1 day');
      why.push(`Sold by ${sellerText(m.from)}, but all on one day`);
    } else {
      set(2, sellerText(m.from));
      why.push(`Listed by ${sellerText(m.from)}, but not yet seen sold by ${FIRM_SELLERS} sellers on ${SOLD_DAYS} different days`);
    }
    const spread = m.spread ?? 1;
    if (m.from >= 2) {
      // Past 10× the exact number says nothing more, and 18,182× read like a fault (troll asks, Nov 10)
      const apart = spread >= 10 ? 'over 10×' : `${spread.toFixed(1)}×`;
      if (spread > SPREAD_WIDE) set(Math.max(1, level - 1), 'prices vary');
      why.push(spread <= SPREAD_AGREE ? `Their prices agree within ${apart}` : `Their prices are ${apart} apart`);
    }
    if (m.days === WINDOWS[WINDOWS.length - 1] && m.from >= FIRM_SELLERS) { set(Math.min(level, 2), 'over a week old'); why.push('Some of it is over a week old'); }
    if (m.mostlyOne) { set(Math.max(1, level - 1), 'one seller\'s stock'); why.push('One seller holds most of the stock'); }
    if (gear) { set(Math.min(level, 2), 'mixed condition'); why.push('Clean and scrolled copies are mixed'); }
    const method = m.lowered ? 'the middle of their sales, because that is below what others ask' : m.basis === 'sold' ? 'the middle of their sales' : m.from === 1 ? 'their listed price' : 'a low listed price, the lower quarter of theirs';
    return { line: m.basis, level, word: LEVELS[level], short, why: `${why.join('. ')}. The usual price is ${method}, over the last ${m.days} days.` };
  }

  // Why a deal is one, in a line a player takes in at a glance.
  function dealNote(unit, m) {
    const parts = [basisText(m)];
    if (m.cheapest != null && m.cheapest > unit) parts.push(`Next cheapest ask ${fmt(m.cheapest)}`);
    if (m.mostlyOne) parts.push('Mostly 1 seller');
    return `${parts.join('. ')}.`;
  }

  // A troll price like 79,999 for one arrow is +16031764%, too wide for the answer column, so
  // from 10 times the usual price it's a whole multiple: ×12, ×160K, ×3M. Rounded down, so
  // it never reads higher than it is.
  function overLabel(times, pct) {
    if (times < 10) return `+${pct}%`;
    const whole = Math.floor(times);
    return `×${whole < 1e3 ? whole : whole < 1e6 ? `${Math.floor(whole / 1e3)}K` : `${Math.floor(whole / 1e6)}M`}`;
  }

  // listing: { unit: price per item, sold, cut, unread: the name read as no real item,
  // needsHover: gear with no stats read yet, confirmed: a hover read this row's name (or a
  // gear's stats), so it's surely this item, ownFee: the sales fee as a share, when it's the
  // player's own shop }
  // Returns what to say about it. A lower rank sorts first. text and why are the longer
  // wording, label is one short word for the stall card's answer column, and note is that
  // row's second line, only when there's something to act on.
  function verdict({ unit, sold, cut, unread, needsHover, confirmed, ownFee }, market, npc) {
    const rail = sold || cut || unread || needsHover ? null : priceRail(unit, market);
    const say = (rank, tag, text, why, label, note = '', pct = null) => ({ rank, tag, text, why, label, note, pct, rail });
    const npcWhy = npc ? `NPC pays ${fmt(npc)}` : '';
    if (sold) return say(3, 'quiet', 'sold', '', 'sold');
    if (cut) return say(1, 'warn', 'hover to check', '', 'check', 'Name cut off. Hover it to read the rest.');
    if (unread) return say(1, 'warn', 'hover to check', '', 'check', 'Name not read. Hover it to read it.');
    // In your own shop a price that pays you less than an NPC would is a loss, not a deal. The
    // game takes its fee from a sale, so 101 pays 97.97 where the NPC pays 100. This is a fixed
    // game fact, not a price to list at.
    if (ownFee != null && npc && unit * (1 - ownFee) < npc) {
      return say(1, 'warn', 'under NPC', npcWhy, 'NPC', `An NPC pays ${fmt(npc)}. This pays you ${fmt(Math.floor(unit * (1 - ownFee)))} after the ${Math.round(ownFee * 100)}% fee.`);
    }
    if (npc && unit < npc) return say(0, 'deal', 'below NPC', npcWhy, 'deal', `NPC pays ${fmt(npc)}.`);
    if (needsHover) return say(2, 'quiet', 'hover for stats', market ? `seen ${rangeText(market)}` : npcWhy, 'hover', 'Its stats decide the price.');
    if (!market) return say(2, 'quiet', 'no price data', npcWhy, 'no data');
    if (!market.firm) return say(2, 'quiet', `${sellerText(market.sellers)}, ${rangeText(market)}`, npcWhy, 'few', `Only ${sellerText(market.sellers)} so far, ${rangeText(market)}.`);
    const pct = Math.round((unit / market.price - 1) * 100), why = reasonText(market);
    if (pct <= CHECK_BELOW) {
      // Far below what others ask but near what it sold for is no surprise, and no deal either:
      // too few sales to set the price (Arrows for Bows at 0.4, sold at 0.3, asks from 9,999).
      if (market.sold != null && unit >= market.sold / NEAR_SOLD) {
        return say(2, 'quiet', `sold ${fmt(market.sold)}`, why, 'few', `Sold for ${fmt(market.sold)}, ${market.soldCount} sale${market.soldCount === 1 ? '' : 's'}. ${basisText(market)}.`, pct);
      }
      // Usually a misread name or another item, so it's a warning until a hover has read the
      // name. Then it's the best deal there is (100K listed at 10K), if the sellers agree.
      if (!confirmed) return say(1, 'warn', 'check item', why, 'check', `${basisText(market)}. Far below: hover it to check it's the same item.`, pct);
      if ((market.spread ?? 1) > SPREAD_WIDE) return say(1, 'warn', 'check item', why, 'check', `${basisText(market)}. Far below, but sellers' prices vary a lot.`, pct);
    }
    // A pumped usual price can't make a deal while someone else is cheaper.
    const cheapest = market.cheapest == null || unit <= market.cheapest;
    if (pct <= dealBelow(market.price) && cheapest) return say(0, 'deal', `deal ${pct}%`, why, `${pct}%`, dealNote(unit, market), pct);
    if (pct >= OVER_ABOVE) return say(2, 'over', `+${pct}%`, why, overLabel(unit / market.price, pct), '', pct);
    return say(2, 'quiet', 'fair', why, 'fair', '', pct);
  }

  // The cheapest recent ask below this price from anyone else, for a buyer deciding to walk.
  function cheaperElsewhere(votes, unit, { except = null, now = Date.now(), within = CHEAPER_MS } = {}) {
    const recent = (votes || []).filter(v => now - v.t <= within && !excepted(v, except));
    const asks = bySeller(recent).map(standingAsk).filter(v => v && v.u < unit);
    return asks.length ? asks.reduce((a, b) => (b.u < a.u ? b : a)) : null;
  }

  // The trend on the Prices card: for each day something was seen, what sold and what was
  // asked over the 3 days to the end of it, the usual price's shortest window, so a point
  // means the same as the usual price would have that day. Sold is the middle of sales, one
  // vote per seller. Asked is the lower quarter of each seller's standing ask, because a fake
  // high ask is free. Each needs FIRM_SELLERS named sellers, or that day has no point on that line: a
  // gap is better than a line drawn through one sale. dayStart gives a time's midnight.
  const TREND_DAYS = WINDOWS[0];
  const localMidnight = t => new Date(t).setHours(0, 0, 0, 0);
  function dailyPrices(votes, { dayStart = localMidnight } = {}) {
    const days = [...new Set((votes || []).map(v => dayStart(v.t)))].sort((a, b) => a - b);
    return days.map(day => {
      const end = dayStart(day + 1.5 * DAY_MS); // the next midnight, whatever the clocks did
      const groups = bySeller(votes.filter(v => v.t < end && v.t >= end - TREND_DAYS * DAY_MS)).filter(g => g.known);
      const sold = groups.filter(g => g.votes.some(v => v.sold)).map(g => middle(g.votes.filter(v => v.sold).map(v => v.u)));
      const asks = groups.map(standingAsk).filter(Boolean).map(v => v.u);
      return {
        day,
        sold: sold.length >= FIRM_SELLERS ? { price: middle(sold), sellers: sold.length } : null,
        ask: asks.length >= FIRM_SELLERS ? { price: lowerQuartile(asks), sellers: asks.length } : null,
      };
    });
  }

  const STAT_KEYS = ['slots', 'attack', 'magic', 'wdef', 'mdef', 'str', 'dex', 'int', 'luk', 'hp', 'mp', 'accuracy', 'avoid', 'speed', 'jump', 'crit', 'critDamage'];
  const statGap = (a, b) => STAT_KEYS.reduce((sum, k) => sum + Math.abs((a[k] ?? 0) - (b[k] ?? 0)), 0);
  const sameStats = (a, b) => statGap(a, b) === 0;

  // The listings with the nearest stats, for gear too rare to have a price of its own.
  function closestGear(votes, stats, { except = null, limit = 3 } = {}) {
    return (votes || [])
      .filter(v => v.stats && !excepted(v, except))
      .map(v => ({ ...v, gap: statGap(v.stats, stats) }))
      .sort((a, b) => a.gap - b.gap || a.u - b.u)
      .slice(0, limit);
  }

  return { marketFor, usualSource, verdict, priceRail, cheaperElsewhere, soldSince, dailyPrices, sameStats, closestGear };
})(typeof module !== 'undefined' ? require('./pricing.js') : { norm, sim, fmt });

if (typeof module !== 'undefined') module.exports = { marketFor, usualSource, verdict, priceRail, cheaperElsewhere, soldSince, dailyPrices, sameStats, closestGear };
