// Run with: node --test test/market.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { marketFor, usualSource, verdict, priceRail, cheaperElsewhere, soldSince, dailyPrices, sameStats, closestGear } = require('../market.js');

const NOW = Date.UTC(2026, 10, 6, 12);
const DAY = 864e5;
const vote = (u, s, sold = false, t = NOW) => ({ u, s, sold, t });
const at = votes => marketFor(votes, { now: NOW });
const honest = [vote(100e3, 'Alder'), vote(100e3, 'Ash'), vote(105e3, 'Birch'), vote(110e3, 'Cedar'), vote(120e3, 'Dogwood')];
const judged = (unit, votes, seller) => verdict({ unit }, marketFor(votes, { now: NOW, except: seller }), null);

test('has nothing to say about an item never seen', () => {
  assert.equal(at([]), null);
  assert.equal(at(undefined), null);
});

test('asks use the lower quartile, because fake high asks are free', () => {
  assert.equal(at(honest).price, 100e3);
  assert.equal(at(honest).basis, 'asking');
});

test('a price is always one someone really set', () => {
  assert.equal(at([vote(15555, 'Alder'), vote(1555555, 'Birch')]).price, 15555);
});

const five = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm'];

test('needs five sellers to be firm', () => {
  assert.equal(at(five.slice(0, 4).map(s => vote(100, s))).firm, false);
  assert.equal(at(five.map(s => vote(100, s))).firm, true);
});

test('one 9,999,999 troll moves nothing, but stays in the range', () => {
  const m = at([...honest, vote(9999999, 'Troll')]);
  assert.equal(m.price, at(honest).price);
  assert.equal(m.high, 9999999);
});

test('one seller with five high listings has one vote', () => {
  const pumped = [...honest, ...[300, 310, 320, 330, 340].map(k => vote(k * 1e3, 'Troll'))];
  assert.equal(at(pumped).price, 100e3);
  assert.equal(at(pumped).sellers, 6);
  assert.equal(judged(120e3, pumped, 'Dogwood').text, 'fair');
});

test('a seller walking a price counts once, at their newest price', () => {
  const walked = [vote(150e3, 'Elm', false, NOW - 3e6), vote(149e3, 'Elm', false, NOW - 2e6), vote(148e3, 'Elm', false, NOW - 1e6), vote(147e3, 'Elm'), vote(100e3, 'Alder'), vote(110e3, 'Birch')];
  assert.equal(at(walked).price, 100e3);
  assert.equal(at([vote(90e3, 'Elm', false, NOW - 1e6), vote(147e3, 'Elm'), vote(150e3, 'Alder'), vote(160e3, 'Birch')]).cheapest, 147e3);
});

test('a superseded price stays in the range', () => {
  assert.equal(at([vote(15555, 'Alder', false, NOW - 1000), vote(1555555, 'Alder'), vote(16000, 'Birch')]).low, 15555);
});

test('wash sales on one day can not replace the asks', () => {
  const wash = [...honest, vote(200e3, 'Xylo', true), vote(200e3, 'Yew', true), vote(200e3, 'Zelkova', true)];
  const m = at(wash);
  assert.equal(m.basis, 'asking');
  assert.equal(m.price, 100e3);
  assert.equal(judged(120e3, wash, 'Dogwood').tag, 'quiet');
});

test('patient wash sales still can not make a fair listing a deal', () => {
  const wash = [...honest, ...['Uva', 'Vine', 'Xylo', 'Yew'].map(s => vote(200e3, s, true)), vote(200e3, 'Zelkova', true, NOW - DAY)];
  assert.equal(at(wash).basis, 'sold');
  assert.equal(at(wash).price, 200e3);
  assert.equal(judged(120e3, wash, 'Dogwood').text, 'fair');
});

// Sales by five sellers over two days, the least that makes a sold price firm
const sold5 = [vote(600, 'Alder', true, NOW - DAY), vote(600, 'Birch', true), vote(620, 'Cedar', true), vote(610, 'Dogwood', true), vote(590, 'Elm', true)];

test('sold beats asked once five sellers have sold over two days', () => {
  const sales = [...sold5, vote(1000, 'Fir'), vote(1100, 'Gum')];
  assert.deepEqual([at(sales).price, at(sales).basis, at(sales).firm], [600, 'sold', true]);
  const four = [...sold5.slice(0, 4), vote(1000, 'Fir'), vote(1100, 'Gum')];
  assert.deepEqual([at(four).price, at(four).firm, at(four).lowered], [600, false, true], 'four sellers sold is not enough to be firm, but lowers the price');
});

test('one seller selling a lot is still one seller', () => {
  const sales = [vote(600, 'Alder', true, NOW - DAY), vote(600, 'Alder', true), vote(600, 'Alder', true), vote(1000, 'Birch')];
  assert.equal(at(sales).basis, 'asking');
});

test('an item only seen sold still has a price, but not a firm one', () => {
  assert.deepEqual([at([vote(30, 'Alder', true)]).price, at([vote(30, 'Alder', true)]).basis, at([vote(30, 'Alder', true)]).firm], [30, 'sold', false]);
});

test('a listing later seen sold is no longer an ask', () => {
  const m = at([vote(50, 'Alder', false, NOW - 1000), vote(50, 'Alder', true), vote(80, 'Birch')]);
  assert.equal(m.cheapest, 80);
});

test('uses the shortest window with enough sellers, and says which', () => {
  const old = t => ['Fir', 'Gum', 'Hazel', 'Ivy', 'Juniper'].map(s => vote(1000, s, false, t));
  assert.equal(at([...honest, ...old(NOW - 5 * DAY)]).days, 3);
  assert.equal(at([...honest, ...old(NOW - 5 * DAY)]).price, 100e3);
  assert.equal(at(old(NOW - 5 * DAY)).days, 7);
  assert.equal(at(old(NOW - 10 * DAY)).days, 14);
  assert.equal(at(old(NOW - 15 * DAY)), null);
});

test('leaves out the seller being judged, even when their name was misread on their stall', () => {
  const stall = { channel: 4, map: 'Free Market', room: 9 };
  const votes = [{ ...vote(100, 'Alderwood'), ...stall }, vote(100, 'Birch'), vote(100, 'Cedar')];
  assert.equal(marketFor(votes, { now: NOW, except: { s: 'Alderw0od', ...stall } }).sellers, 2);
  // Another stall: a different player whose name is close
  assert.equal(marketFor(votes, { now: NOW, except: { s: 'Alderw0od', channel: 7, map: 'Free Market', room: 2 } }).sellers, 3);
  assert.equal(marketFor([vote(100, 'Alder')], { now: NOW, except: 'Alder' }), null);
});

test('one name read two ways on one stall is one seller, close names on two stalls are two', () => {
  const on = (s, more) => ({ ...vote(100, s), ...more });
  // The same channel and room, or the same shop title, is one stall
  assert.equal(at([on('Alderwood', { channel: 4, room: 9 }), on('Alderw0od', { channel: 4, room: 9 }), vote(100, 'Birch')]).sellers, 2);
  assert.equal(at([on('Alderwood', { shop: 'Cheap etc' }), on('Alderw0od', { shop: 'cheap etc' }), vote(100, 'Birch')]).sellers, 2);
  // Ludilove and Ludilove2 in different rooms are two players
  assert.equal(at([on('Ludilove', { channel: 4, room: 9 }), on('Ludilove2', { channel: 4, room: 12 }), vote(100, 'Birch')]).sellers, 3);
  // With nothing to say it's the same stall, close names stay two: hiding one's ask is worse
  assert.equal(at([vote(100, 'Alderwood'), vote(100, 'Alderw0od'), vote(100, 'Birch')]).sellers, 3);
  // The exact same name is always one
  assert.equal(at([on('Alder', { channel: 1, room: 1 }), on('Alder', { channel: 2, room: 5 }), vote(100, 'Birch')]).sellers, 2);
});

test('a cheaper ask from a close name on another stall is still the cheapest ask', () => {
  const votes = [
    { ...vote(4450, 'Ludilove2', false, NOW - 36e5), channel: 3, room: 2 },
    { ...vote(4450, 'Ludilove2', true, NOW), channel: 3, room: 2 },
    { ...vote(4200, 'Ludilove', false, NOW - 2 * 36e5), channel: 9, room: 14 },
  ];
  assert.equal(cheaperElsewhere(votes, Infinity, { now: NOW, within: 864e5 }).u, 4200);
});

test('unknown sellers share one vote and never make a price firm', () => {
  const m = at([vote(100, ''), vote(300, ''), vote(300, 'Alder'), vote(300, 'Birch')]);
  assert.equal(m.sellers, 2);
  assert.equal(m.firm, false);
});

test('warns when one seller holds most of what is for sale', () => {
  const cornered = [vote(100, 'Alder'), vote(120, 'Birch'), vote(300, 'Corner'), vote(310, 'Corner'), vote(320, 'Corner'), vote(330, 'Corner')];
  assert.equal(at(cornered).mostlyOne, true);
  assert.equal(at(honest).mostlyOne, false);
});

test('a deal has to be under the usual price and the cheapest ask', () => {
  const deal = judged(70e3, honest);
  assert.deepEqual([deal.tag, deal.text, deal.rank], ['deal', 'deal -30%', 0]);
  assert.match(deal.why, /vs 100K asking, 5 sellers, 3 days/);
});

test('from a usual price of 50K a deal starts at 10% under, below that at 20%', () => {
  assert.deepEqual([judged(90e3, honest).tag, judged(90e3, honest).label], ['deal', '-10%']);
  assert.equal(judged(91e3, honest).tag, 'quiet');
  const cheap = [vote(1000, 'Alder'), vote(1000, 'Ash'), vote(1050, 'Birch'), vote(1100, 'Cedar'), vote(1100, 'Dogwood')];
  assert.equal(judged(850, cheap).tag, 'quiet', '15% off 1,000 is 150 mesos');
  assert.deepEqual([judged(800, cheap).tag, judged(800, cheap).label], ['deal', '-20%']);
  const edge = [vote(50e3, 'Alder'), vote(50e3, 'Ash'), vote(52e3, 'Birch'), vote(55e3, 'Cedar'), vote(55e3, 'Dogwood')];
  assert.equal(judged(45e3, edge).tag, 'deal', 'exactly 50K counts as 50K or more');
});

test('a price far under the market asks for a check, not a purchase', () => {
  const check = judged(20e3, honest);
  assert.deepEqual([check.tag, check.text], ['warn', 'check item']);
});

test('shows how far over the usual price a listing is', () => {
  assert.equal(judged(140e3, honest).text, '+40%');
});

test('thin data gets a range, never a percentage', () => {
  const thin = judged(100, [vote(90, 'Alder'), vote(140, 'Birch')]);
  assert.equal(thin.text, '2 sellers, 90–140');
});

test('below the NPC price needs no market data', () => {
  const v = verdict({ unit: 40 }, null, 50);
  assert.deepEqual([v.tag, v.text, v.why], ['deal', 'below NPC', 'NPC pays 50']);
});

test('no data still gives the NPC price', () => {
  assert.deepEqual([verdict({ unit: 60 }, null, 50).text, verdict({ unit: 60 }, null, 50).why], ['no price data', 'NPC pays 50']);
});

test('sold and cut-off rows are never judged on price', () => {
  assert.equal(verdict({ unit: 1, sold: true }, null, 50).text, 'sold');
  assert.equal(verdict({ unit: 1, cut: true }, null, 50).text, 'hover to check');
  // a name read as no real item is never priced, not even against what an NPC pays
  assert.deepEqual([verdict({ unit: 1, unread: true }, null, 50).text, verdict({ unit: 1, unread: true }, null, 50).rail], ['hover to check', null]);
});

test('the stall card gets one short answer, and a second line only to act on', () => {
  const deal = judged(70e3, honest);
  assert.deepEqual([deal.label, deal.pct], ['-30%', -30]);
  assert.match(deal.note, /^Others ask 100K\./, 'a deal says what it beats, in words');
  assert.equal(judged(100e3, honest).label, 'fair');
  assert.equal(judged(100e3, honest).note, '', 'fair needs no second line');
  assert.deepEqual([judged(140e3, honest).label, judged(140e3, honest).note], ['+40%', '']);
  assert.match(judged(20e3, honest).note, /check it's the same item/);
  assert.equal(judged(100, [vote(90, 'Alder'), vote(140, 'Birch')]).label, 'few', 'thin data still gets no percentage');
  assert.deepEqual([verdict({ unit: 40 }, null, 50).label, verdict({ unit: 40 }, null, 50).note], ['deal', 'NPC pays 50.']);
  assert.equal(verdict({ unit: 1, sold: true }, null, 50).label, 'sold');
  assert.equal(verdict({ unit: 1, cut: true }, null, 50).label, 'check');
  assert.equal(verdict({ unit: 110e3, needsHover: true }, at(honest), null).label, 'hover');
  for (const v of [deal, judged(20e3, honest), judged(140e3, honest), verdict({ unit: 60 }, null, 50)]) {
    assert.ok(v.label.length <= 7, `${v.label} fits the answer column`);
  }
});

test('a troll price still fits the answer column, as a multiple', () => {
  const usual = { price: 0.5, basis: 'sold', firm: true, cheapest: 1, sellers: 3, days: 2, low: 0.4, high: 79999 };
  const troll = verdict({ unit: 79999 }, usual, null); // one arrow for 79,999, seen live
  assert.deepEqual([troll.tag, troll.label, troll.text], ['over', '×159K', '+15999700%'], 'the long wording keeps the percentage');
  const at = times => verdict({ unit: 100 * times }, { ...usual, price: 100, low: 100, high: 1e9 }, null).label;
  assert.equal(at(9.99), '+899%', 'under 10 times it stays a percentage');
  assert.equal(at(10), '×10');
  assert.equal(at(999.9), '×999', 'rounded down, never higher than it is');
  assert.equal(at(2.5e6), '×2M');
  for (const t of [1.3, 9.99, 10, 999.9, 1500, 999999, 2.5e6, 9e8]) assert.ok(at(t).length <= 6, `${at(t)} fits`);
});

test('a deal names the next cheapest ask when there is one', () => {
  const m = { price: 450e3, basis: 'sold', firm: true, cheapest: 520e3, sellers: 4, days: 3, low: 280e3, high: 900e3 };
  assert.equal(verdict({ unit: 280e3 }, m, null).note, 'Sold for 450K. Next cheapest ask 520K.');
});

test('gear gets no percentage until it is hovered, but below NPC still shows', () => {
  const m = at(honest);
  assert.deepEqual([verdict({ unit: 110e3, needsHover: true }, m, null).text, verdict({ unit: 110e3, needsHover: true }, m, null).why], ['hover for stats', 'seen 100K–120K']);
  assert.equal(verdict({ unit: 40, needsHover: true }, m, 50).text, 'below NPC');
});

test('finds the cheapest recent ask from someone else', () => {
  const votes = [{ ...vote(85e3, 'Alder', false, NOW - 12 * 6e4), channel: 4, room: 2 }, vote(90e3, 'Birch'), vote(120e3, 'Cedar')];
  assert.equal(cheaperElsewhere(votes, 100e3, { now: NOW }).room, 2);
  assert.equal(cheaperElsewhere(votes, 80e3, { now: NOW }), null);
  assert.equal(cheaperElsewhere(votes, 100e3, { now: NOW, except: 'Alder' }).u, 90e3);
});

test('an old ask is not worth walking to', () => {
  assert.equal(cheaperElsewhere([vote(85e3, 'Alder', false, NOW - 7 * 36e5)], 100e3, { now: NOW }), null);
});

test('a listing already seen sold is not cheaper elsewhere', () => {
  assert.equal(cheaperElsewhere([vote(85e3, 'Alder', false, NOW - 1000), vote(85e3, 'Alder', true)], 100e3, { now: NOW }), null);
});

test('gear compares by stats', () => {
  const a = { slots: 7, str: 4, critDamage: 3 };
  assert.equal(sameStats(a, { ...a }), true);
  assert.equal(sameStats(a, { ...a, str: 5 }), false);
  const votes = [{ ...vote(650e3, 'Alder'), stats: { slots: 7, str: 4, critDamage: 3 } }, { ...vote(25e3, 'Birch'), stats: { slots: 7, str: 1 } }, vote(20e3, 'Cedar')];
  assert.deepEqual(closestGear(votes, a, { limit: 2 }).map(v => v.u), [650e3, 25e3]);
  assert.deepEqual(closestGear(votes, a, { except: 'Alder' }).map(v => v.u), [25e3]);
});

test('a rail has nothing to show without a market', () => {
  assert.equal(priceRail(100, null), null);
});

test('a rail places the listing and the sold price between the lowest and highest seen', () => {
  const sold = five.map((s, i) => vote(100, s, true, NOW - (i % 2) * DAY));
  const rail = priceRail(1000, at([...sold, vote(10000, 'Fir')]));
  assert.equal(rail.low, 100);
  assert.equal(rail.high, 10000);
  assert.equal(rail.here, 50);
  assert.equal(rail.sold, 0);
  assert.equal(rail.thin, false);
});

test('a 9,999,999 troll stays on the rail without squashing normal prices', () => {
  const rail = priceRail(200e3, at([...honest, vote(9999999, 'Troll')]));
  assert.equal(rail.high, 9999999);
  assert.ok(rail.here > 10, 'double the low price stays far from it, where a plain scale gives 1%');
});

test('a listing outside everything seen widens the rail instead of falling off it', () => {
  const rail = priceRail(50e3, at(honest));
  assert.equal(rail.low, 50e3);
  assert.equal(rail.here, 0);
  assert.equal(priceRail(500e3, at(honest)).here, 100);
});

test('a single price sits in the middle of its rail', () => {
  assert.equal(priceRail(100, at([vote(100, 'Alder')])).here, 50);
});

test('a rail is thin until the market is firm', () => {
  assert.equal(priceRail(100, at([vote(100, 'Alder'), vote(120, 'Birch')])).thin, true);
  assert.equal(priceRail(100, at(honest)).thin, false);
});

test('a rail can show a market with no listing to place', () => {
  const rail = priceRail(null, at(honest));
  assert.equal(rail.here, null);
  assert.equal(rail.low, 100e3);
});

test('a verdict only carries a rail when the price can be compared', () => {
  const market = at(honest);
  assert.ok(verdict({ unit: 100e3 }, market, null).rail);
  assert.equal(verdict({ unit: 100e3, sold: true }, market, null).rail, null);
  assert.equal(verdict({ unit: 100e3, cut: true }, market, null).rail, null);
  assert.equal(verdict({ unit: 100e3, needsHover: true }, market, null).rail, null, 'gear before its stats are read');
  assert.equal(verdict({ unit: 100e3 }, null, null).rail, null);
});

const sold3 = ['Larch', 'Maple', 'Oak'].map((s, i) => vote(100e3, s, true, NOW - i * DAY));

test('the cheapest ask is the newest standing ask in the time picked, never a sold copy', () => {
  const old = vote(90e3, 'Alder', false, NOW - 3 * DAY);
  const votes = [old, ...honest.slice(1)];
  const cheapest = within => cheaperElsewhere(votes, Infinity, { now: NOW, within })?.u;
  assert.equal(cheapest(Infinity), 90e3);
  assert.ok(cheapest(DAY) > 90e3, 'an ask from 3 days ago is outside the last 24 hours');
  const gone = [vote(90e3, 'Alder', false, NOW - 1000), vote(90e3, 'Alder', true), vote(105e3, 'Birch')];
  assert.equal(cheaperElsewhere(gone, Infinity, { now: NOW, within: Infinity }).u, 105e3);
  assert.equal(cheaperElsewhere(sold3, Infinity, { now: NOW, within: Infinity }), null);
});

test('a set of 4 at 600,000 is not a deal next to sets at 650,000', () => {
  const votes = ['a', 'b', 'c', 'd', 'e'].map((s, i) => ({ u: 650000 + i * 10000, s, sold: false, t: Date.now() }));
  const market = marketFor(votes);
  assert.notEqual(verdict({ unit: 600000 }, market).tag, 'deal');
  assert.equal(verdict({ unit: 150000 }, market).tag, 'warn'); // what the old sum made of it
});

test('a usual price gets a confidence level from 1 to 3, raised only by what is costly to fake', () => {
  const level = (votes, opts) => usualSource(at(votes), opts);
  assert.deepEqual([level(honest).level, level(honest).word, level(honest).line], [2, 'Decent', 'asking'], 'asks alone never make it Solid');
  assert.match(level(honest).why, /^Listed by 5 sellers, but not yet seen sold by 5 sellers.*agree within 1.1×/);
  assert.equal(level(honest).short, "5 sellers", "the label names what decided the level");
  assert.equal(level(honest.slice(0, 4)).level, 1, 'four sellers is still thin');
  assert.equal(level([vote(100, 'Alder'), vote(140, 'Birch')]).level, 1);
  assert.match(level([vote(100, 'Alder'), vote(140, 'Birch')]).why, /^Only 2 sellers so far/);
  assert.equal(level([vote(100, ''), vote(300, '')]).level, 1);
  assert.match(level([vote(100, ''), vote(300, '')]).why, /No seller names were read/);
  const sales = [...sold5, vote(1000, 'Fir')];
  assert.deepEqual([level(sales).level, level(sales).line, level(sales).short], [3, 'sold', 'sold often'], 'five sellers sold over two days');
  const oneDay = sold5.map(v => ({ ...v, t: NOW }));
  assert.equal(level(oneDay).level, 2, 'sales all on one day are cheap to stage');
  assert.match(level(oneDay).why, /all on one day/);
  assert.equal(level(oneDay).short, 'sold, 1 day');
  assert.deepEqual([level([vote(100, 'Alder')]).short, level([vote(100, ''), vote(300, '')]).short], ['1 seller', 'unknown sellers']);
});

test('sellers far apart lose a level, but one troll price among many does not', () => {
  const level = votes => usualSource(at(votes));
  const apart = [vote(100, 'Alder'), vote(100, 'Birch'), vote(105, 'Cedar'), vote(400, 'Dogwood'), vote(400, 'Elm')];
  assert.equal(at(apart).spread, 4);
  assert.equal(level(apart).level, 1);
  assert.match(level(apart).why, /4\.0× apart/);
  assert.equal(level(apart).short, 'prices vary');
  assert.equal(level([...honest, vote(9999999, 'Troll')]).level, 2);
});

test('old data, one seller holding the stock, and mixed gear copies cap or lower the level', () => {
  const old = five.map((s, i) => vote(600, s, true, NOW - (9 + (i % 2)) * DAY));
  assert.equal(at(old).days, 14);
  assert.equal(usualSource(at(old)).level, 2);
  assert.match(usualSource(at(old)).why, /over a week old/);
  assert.equal(usualSource(at(old)).short, 'over a week old');
  const cornered = [vote(100, 'Alder'), vote(110, 'Birch'), vote(105, 'Cedar'), vote(108, 'Dogwood'), ...[100, 105, 110, 115, 120, 125].map(u => vote(u, 'Corner'))];
  assert.equal(at(cornered).mostlyOne, true);
  assert.equal(usualSource(at(cornered)).level, 1);
  assert.equal(usualSource(at(cornered)).short, "one seller's stock");
  const sales = sold5;
  assert.equal(usualSource(at(sales), { gear: true }).level, 2, 'a gear name mixes clean and scrolled copies');
  assert.match(usualSource(at(sales), { gear: true }).why, /Clean and scrolled copies are mixed/);
  assert.equal(usualSource(at(sales), { gear: true }).short, 'mixed condition');
});

test('an ask later seen sold is gone, so the card lists it once, as a sale', () => {
  const ask = vote(125, 'Dyle', false, NOW - 2 * 36e5), sale = vote(125, 'Dyle', true, NOW - 36e5);
  assert.equal(soldSince(ask, [ask, sale]), true);
  assert.equal(soldSince(sale, [ask, sale]), false); // the sale itself stays
  // Seen asking again after the sale: a relist, still on sale
  assert.equal(soldSince(vote(125, 'Dyle', false, NOW), [sale]), false);
  // Another price, or another seller's sale at the same price, doesn't end it
  assert.equal(soldSince(ask, [ask, vote(130, 'Dyle', true)]), false);
  assert.equal(soldSince(ask, [ask, vote(125, 'Lupin', true)]), false);
});

test('sellers more than 10× apart are said to be over 10× apart, not 18,182×', () => {
  const trolled = [vote(55, 'Alder'), vote(60, 'Birch'), vote(65, 'Cedar'), vote(999999, 'Dogwood'), vote(9999999, 'Elm')];
  assert.match(usualSource(at(trolled)).why, /prices are over 10× apart/);
});

test('the trend has a point for each day with 5 sellers over the 3 days to it', () => {
  const day = t => Math.floor(t / DAY) * DAY; // UTC days, so the test doesn't depend on where it runs
  const votes = [
    ...[300, 310, 320, 330, 340].map((u, i) => vote(u, five[i], true, NOW - 2 * DAY)),
    vote(345, 'Alder', true, NOW), vote(350, 'Fir', true, NOW),
    ...[400, 380, 360, 370, 390].map((u, i) => vote(u, ['Gum', 'Hazel', 'Ivy', 'Juniper', 'Kapok'][i], false, NOW)), vote(9999999, 'Troll', false, NOW),
  ];
  const days = dailyPrices(votes, { dayStart: day });
  assert.deepEqual(days.map(d => d.day), [day(NOW - 2 * DAY), day(NOW)]);
  assert.deepEqual(days[0].sold, { price: 320, sellers: 5 });
  assert.equal(days[0].ask, null); // no asks: a gap, not a guess
  // Today counts the 3 days to it. Alder's two sales are one vote, at their lower middle (300),
  // so 300, 310, 320, 330, 340, 350 gives 320
  assert.deepEqual(days[1].sold, { price: 320, sellers: 6 });
  // Asks lean low, so the troll doesn't lift the line
  assert.deepEqual(days[1].ask, { price: 370, sellers: 6 });
});

test('a day with under 5 sellers has no trend point', () => {
  const days = dailyPrices([...five.slice(0, 4).map((s, i) => vote(300 + i, s, true)), vote(320, '', true)], { dayStart: t => Math.floor(t / DAY) * DAY });
  assert.equal(days[0].sold, null);
});

test('an ask is only tied to a sale by what is sure', () => {
  const at = (u, s, sold, t, more = {}) => ({ ...vote(u, s, sold, t), ...more });
  // The same seller selling 50 at 130 each doesn't end their 100 at 130 each
  const hundred = at(130, 'Lupin', false, NOW - 36e5, { qty: 100 });
  assert.equal(soldSince(hundred, [hundred, at(130, 'Lupin', true, NOW, { qty: 50 })]), false);
  assert.equal(soldSince(hundred, [hundred, at(130, 'Lupin', true, NOW, { qty: 100 })]), true);
  // One of three identical rows sold leaves two for sale. All three sold ends it
  const three = at(4399, 'Titan', false, NOW - 36e5, { qty: 1, copies: 3 });
  assert.equal(soldSince(three, [three, at(4399, 'Titan', true, NOW, { qty: 1, copies: 1 })]), false);
  assert.equal(soldSince(three, [three, at(4399, 'Titan', true, NOW, { qty: 1, copies: 3 })]), true);
  // A hidden name plate could be any shop, so an unknown seller's ask is never tied to a sale
  assert.equal(soldSince(vote(125, '', false, NOW - 1000), [vote(125, '', true)]), false);
  assert.equal(soldSince(vote(125, '', false, NOW - 1000), [vote(125, 'Dyle', true)]), false);
});

// ---------- a few sales, far-below prices and the hover (Nov 12) ----------

test('three sellers\' sales lower a usual price taken from asks, never raise it', () => {
  const asks = [vote(2000, 'Fir'), vote(2100, 'Gum'), vote(2500, 'Holly')];
  const sold3 = [vote(340, 'Alder', true), vote(349, 'Birch', true), vote(400, 'Cedar', true)];
  const m = at([...asks, ...sold3]);
  assert.deepEqual([m.price, m.basis, m.lowered, m.from, m.firm], [349, 'sold', true, 3, false]);
  assert.equal(at([...asks, ...sold3.slice(0, 2)]).price, 2000, 'two sellers sold: one cheap sale would set it');
  const dear = at([...asks, vote(5000, 'Alder', true), vote(5200, 'Birch', true), vote(6000, 'Cedar', true)]);
  assert.deepEqual([dear.price, dear.basis, dear.lowered], [2000, 'asking', false], 'sales above the asks change nothing');
  const one = at([...asks, vote(300, 'Alder', true), vote(310, 'Alder', true), vote(320, 'Alder', true)]);
  assert.equal(one.price, 2000, 'one seller selling a lot is one seller');
});

test('a lowered price is never called solid', () => {
  const asks = five.map(s => vote(1000, s));
  const sales = ['Uva', 'Vine', 'Xylo', 'Yew', 'Zelkova'].map(s => vote(600, s, true)); // five sellers, one day
  const m = at([...asks, ...sales]);
  assert.deepEqual([m.price, m.lowered, m.firm], [600, true, true]);
  assert.equal(usualSource(m).level, 2);
  assert.match(usualSource(m).why, /below what others ask/);
});

test('far below the asks but near a sale is neither a warning nor a deal', () => {
  // Arrows for Bows, Nov 12: asked 0.4, two sellers sold at 0.3, others ask from 9,999
  const arrows = [...[9999, 30e3, 30e3, 50e3, 444e3].map((u, i) => vote(u, five[i])), vote(0.3, 'Uva', true), vote(0.3, 'Vine', true)];
  const v = judged(0.4, arrows);
  assert.deepEqual([v.label, v.tag], ['few', 'quiet']);
  assert.match(v.note, /^Sold for 0\.3, 2 sales\. Others ask 30K\.$/);
  assert.equal(judged(0.1, arrows).label, 'check', 'far under the sales too is still a surprise');
});

test('a far-below price becomes a deal once a hover has read the name', () => {
  const m = at(honest);
  assert.equal(verdict({ unit: 10e3 }, m, null).label, 'check');
  assert.match(verdict({ unit: 10e3 }, m, null).note, /hover it to check it's the same item/);
  const deal = verdict({ unit: 10e3, confirmed: true }, m, null);
  assert.deepEqual([deal.tag, deal.label, deal.rank], ['deal', '-90%', 0]);
  const thin = at(honest.slice(0, 4));
  assert.equal(verdict({ unit: 10e3, confirmed: true }, thin, null).label, 'few', 'not against a price that is not firm');
  const wide = at([vote(100e3, 'Alder'), vote(100e3, 'Ash'), vote(300e3, 'Birch'), vote(400e3, 'Cedar'), vote(900e3, 'Dogwood')]);
  const stays = verdict({ unit: 10e3, confirmed: true }, wide, null);
  assert.equal(stays.label, 'check');
  assert.match(stays.note, /prices vary/);
  const beaten = at([...honest, vote(5e3, 'Elm')]);
  assert.notEqual(verdict({ unit: 10e3, confirmed: true }, beaten, null).tag, 'deal', 'someone else asks less');
});

test('in your own shop a price that pays less than an NPC is a warning, not a deal', () => {
  // Orihalcon Ore, Nov 12: sold at 90 everywhere while an NPC pays 100
  assert.deepEqual([verdict({ unit: 90 }, null, 100).tag, verdict({ unit: 90 }, null, 100).label], ['deal', 'deal'], "someone else's shop");
  const own = verdict({ unit: 90, ownFee: 0.03 }, null, 100);
  assert.deepEqual([own.tag, own.label, own.rank], ['warn', 'NPC', 1]);
  assert.equal(own.note, 'An NPC pays 100. This pays you 87 after the 3% fee.');
  assert.equal(verdict({ unit: 101, ownFee: 0.03 }, null, 100).label, 'NPC', '101 pays 97 after the fee');
  assert.equal(verdict({ unit: 104, ownFee: 0.03 }, null, 100).label, 'no data', '104 pays 100.88');
  assert.equal(verdict({ unit: 90, ownFee: 0.03, sold: true }, null, 100).label, 'sold');
});
