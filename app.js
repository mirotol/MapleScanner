// Live capture, per-shop results, saving to the price database and the price panel.
const $ = id => document.getElementById(id);
const panel = $('panel'), panelBar = panel.querySelector('.bar'), panelTop = $('panelTop'), panelList = $('panelList'), panelFoot = $('panelFoot'), barText = $('barText'), barLive = $('barLive'), barChannel = $('barChannel');
const SCAN_MS = 500, SHOP_TIMEOUT_MS = 4000, MAX_NAME = 80;
// Every frame is watched for the Change Channel window (watch.js), because a keyboard change
// is over in less than 200 ms. Full scans stay slower, and only speed up without the watch.
const CAPTURE_FPS = 30, TICK_MS = 100, FAST_SCAN_MS = 200;
const SLOW_CAPTURE_FPS = 5; // with the watch off, as the full scans can't use more
let settings = { channelWatch: true }; // the defaults until the saved ones load, see serve.js
const captureFps = () => (settings.channelWatch ? CAPTURE_FPS : SLOW_CAPTURE_FPS);
const READS_TO_SAVE = 2; // a row must read the same on two scans, so a passing cursor isn't saved
const SALES_FEE = 0.03; // the game says so in every player shop
const SWITCH_WAIT_MS = 8000; // how long after the window closes a channel change can start loading
const FROZEN_MS = 5000;
const RECONNECT_MS = 30000, GIVE_UP_MS = 15000; // a frozen picture is reconnected, and only mentioned if that doesn't help

const reader = new ShopReader();
let stream = null;        // the game window being captured
let session = null;       // the shop currently (or last) on screen
let tooltip = null;       // the hovered item, if any
let held = null, heldAt = 0; // the hovered item, kept through one scan that misses its see-through tooltip
const HOVER_GONE_MS = 800;    // then it goes, on the second scan without it (about a second)
let message = 'Not scanning';
let problem = null;       // what's wrong and what to do, shown until it's fixed
let place = null;         // the map and Free Market room, as last read off the minimap
const channels = channelFollower(SWITCH_WAIT_MS);
let channel = null;       // only known once the Change Channel window has been open
let realNames = [];       // every item in the game, from osms-items.json. Only these are saved
let facts = itemFacts({}); // NPC prices, scroll rates and gear slots, from osms-items.json
const matches = new Map(); // what each read matched, because the same rows are read every scan

// ---------- shared prices ----------
// The listings come from the shared price database through the local server, which keeps them in
// memory (cloud.js). Nothing is stored on this PC.
let seen = {};            // { item name: recent votes, see marketFor }
let cloud = null;         // the price server's status: { online, waiting, blocked, connected }
let pending = [];         // listings waiting to be handed to the local server
let saving = false, dbOnline = true;
// Prices are asked for again this often while scanning, with nothing to save too: your own
// shop saves nothing, and the first answer after a start can come before the first sync, so
// every row there stayed "no data" until another shop was scanned (Nov 12).
const STATE_MS = 10e3;
let stateAt = 0;

async function loadState() {
  const state = await api('/api/state');
  matches.clear();
  seen = state.seen;
  cloud = state.status;
  stateAt = Date.now();
}

// Runs after every scan, so listings are kept and retried if the server stops for a while.
async function saveSightings() {
  if (saving || (dbOnline && !pending.length && Date.now() - stateAt < STATE_MS)) return;
  saving = true;
  const rows = pending;
  pending = [];
  try {
    if (rows.length) await api('/api/sightings', { rows });
    await loadState();
    dbOnline = true;
  } catch (err) {
    if (err instanceof TypeError) { // the server can't be reached
      pending = rows.concat(pending);
      dbOnline = false;
    } else {
      console.error(err);
    }
  }
  saving = false;
  render();
}

// The real name of a read when that's clear, otherwise null.
function knownName(name, cut = isCutOff(name)) {
  const key = `${cut}|${name}`;
  if (!matches.has(key)) matches.set(key, matchName(name, realNames, cut));
  return matches.get(key);
}

// ---------- prices ----------
const isGear = name => facts.slots(name) != null;
// The shop being looked at, so its seller's own listings are left out, even ones saved under a
// misread of their name, which only count as theirs on the same stall (sameSeller in market.js).
const thisShop = seller => (seller ? { s: seller, shop: session?.title ?? null, channel, map: place?.map ?? null, room: place?.room ?? null } : null);
const marketOf = (votes, name, seller) => marketFor(votes, { except: thisShop(seller) });

// The listings a row can fairly be compared with: gear only against the same stats.
function comparable(name, stats) {
  if (!isGear(name)) return seen[name];
  return stats ? (seen[name] ?? []).filter(v => v.stats && sameStats(v.stats, stats)) : [];
}

// Only a row read as a real item is saved, and only from the live game window: a picture can be
// edited, so a screenshot read (scanBlob) is never shared. The server checks again.
function remember(row, { seller, title }) {
  if (!stream || row.cut || !row.real || !row.price || row.name.length > MAX_NAME) return;
  pending.push({
    list: row.list, name: row.name, raw: row.raw, seller: seller ?? '', qty: row.qty, price: row.price,
    sold: !!row.sold, copies: row.copies, channel, map: place?.map, room: place?.room, shop: title, stats: row.stats ?? null,
  });
}

// ---------- merging frames into one shop ----------
// `at` is when the frame was taken: the scan itself can take longer than a loading screen starting
function applyScan(res, at = Date.now()) {
  const now = Date.now();
  if (!watchLive) channels.see(res, at, place); // the watch sees every frame, in order
  if (res?.place) { channels.arrived(res.place, at); place = res.place; }
  channel = channels.channel;
  const tip = res?.tooltip;
  const real = tip?.name ? knownTitle(tip.name, knownName) : null, tipName = real ?? tip?.name;
  // A misread title still helps match the shop row under it, but only a real item gets a card.
  // The game's own cursor, when it was found, gives the row even if the tooltip was moved.
  const pushed = !!tipName && !res?.cursor && tooltipMoved(tip?.room, !real || facts.described(tipName));
  const gear = tipName ? parseGearStats(tip.stats, facts.lines(tipName)) : null;
  tooltip = tipName ? { ...tip, name: tipName, real: !!real, gear: gear && facts.fits(tipName, gear) ? gear : null, pushed } : null;
  if (!res?.kind) {
    if (session && now - session.seenAt > SHOP_TIMEOUT_MS) session.closed = true;
    return;
  }
  const sameShop = session && !session.closed && session.kind === res.kind && isSameShop(session, res);
  if (!sameShop) {
    // rows: one per listing, as saved. lines: one per row in the shop, in its order, see placeRows
    session = { kind: res.kind, seller: null, title: null, sellers: new Map(), titles: new Map(), rows: [], lines: [], offset: 0, seenAt: now, closed: false };
    held = null;
  }
  session.seenAt = now;
  if (res.own != null) session.own = res.own; // whose shop the green button says it is
  countRead(session.sellers, res.seller);
  countRead(session.titles, res.title);
  session.seller = mostRead(session.sellers, READS_TO_SAVE);
  session.title = mostRead(session.titles, READS_TO_SAVE);

  // Rows are black on pale and read better than a tooltip's coloured title. But a row that's
  // no real item never replaces a title that is one: the title is what names that row.
  const hovered = tooltip && res.rows.find(r => r.hovered && !r.cut && !r.clipped && sameItem(r.name, tooltip.name) && (!tooltip.real || knownName(r.name)));
  if (hovered) tooltip.name = hovered.name;

  const rows = [];
  for (const r of res.rows) {
    const full = tooltipName(r, tooltip, knownName) ?? (r.cut ? completeName(r.name, r.iconTier, realNames) : null);
    const read = full ? { ...r, name: full, cut: false, clipped: false } : r;
    const known = knownName(read.name, read.cut);
    // a cut-off scroll name hides its tier, so it stays cut even when the name matches
    const name = known ?? read.name;
    rows.push({
      ...read,
      raw: r.cut || read.clipped ? null : r.name,
      name,
      real: !!known, // a name that's no real item is shown as read, never saved
      qty: facts.single(name) ? 1 : read.qty, // equipment never stacks, so a bigger amount is a misread
      cut: read.cut && (!known || /scroll/i.test(read.name)),
    });
  }
  const bySlot = []; // the listing read in each visible row of the shop
  const taken = new Set(); // the listings this frame's rows already are
  for (const row of mergeCopies(rows)) {
    let old = listingFor(row, session.rows, taken);
    if (!old) {
      session.rows.push(old = { ...row, reads: 1, saved: false });
    } else {
      old.copies = Math.max(old.copies, row.copies);
      old.reads++;
      const cleaner = !row.cut && !row.clipped && (old.cut || old.clipped || (row.real && !old.real) || (row.name !== old.name && norm(old.name).startsWith(norm(row.name))));
      if (cleaner) Object.assign(old, { name: row.name, raw: row.raw, real: row.real, cut: false, clipped: false, reads: 1 });
      if (old.reads >= READS_TO_SAVE) saveRow(old);
    }
    taken.add(old);
    old.seenAt = now; // on screen in this frame, see npcRows
    for (const r of rows) if (copyKey(r) === copyKey(row)) bySlot[r.slot] = old;
  }
  session.offset = placeRows(session.lines, bySlot, session.offset);
  if (tooltip) {
    // the card opens this line in place, or shows the item in its own slot when it isn't one
    const slot = res.hoverSlot ?? rows.find(r => r.hovered)?.slot;
    const under = slot == null ? null : session.lines[session.offset + slot];
    tooltip.overList = !!res.overList;
    tooltip.line = lineForTooltip(tooltip, under, session.lines, res.overList);
    noteStats(tooltip.line);
    // the title read as the same real item as the row, each on its own: the name is sure
    const hit = tooltip.line?.listing;
    if (tooltip.real && hit?.real && norm(hit.name) === norm(tooltip.name)) tooltip.line.named = true;
  }
}

// Gear stats only show on hover, and count once they've read the same twice. Each copy in the
// shop has its own line and its own stats. The listing is saved with the first copy's stats,
// and a listing can be saved before it's hovered, so saving it again adds them.
function noteStats(line) {
  if (!line || !tooltip?.gear) return;
  countRead(line.statReads ??= new Map(), JSON.stringify(tooltip.gear));
  settleStats(line, READS_TO_SAVE);
}

// Stats only go on a line whose item they can belong to (statsFit in pricing.js).
const lineStats = l => (l.listing && facts.fits(l.listing.name, l.stats) ? l.stats : null);

function settleStats(line, reads) {
  const agreed = line.statReads && mostRead(line.statReads, reads);
  if (!agreed || line.stats || !line.listing || !facts.fits(line.listing.name, JSON.parse(agreed))) return;
  line.stats = JSON.parse(agreed);
  const listing = line.listing;
  if (!listing || listing.stats) return;
  listing.stats = line.stats;
  if (listing.saved) remember(listing, session);
}

// Only from a shop known to be someone else's: your own, while you set it up, isn't on the
// market yet, and a shop whose green button couldn't be told waits until it can.
function saveRow(row) {
  if (row.saved || row.cut || row.clipped) return;
  if (session.kind === 'player' && session.own !== false) return;
  row.saved = true;
  remember(row, session);
}

// ---------- panel ----------
// The stall card leads with the answer. Each row's verdict sits in one column on the left, so a
// glance down it is enough, and a row gets a second line only when there's something to act on.
// The hovered row opens where it is, so nothing else moves while the player reads it. Plain
// words, no charts. design/stall.html is the mockup this came from.
const minus = text => text.replace('-', '−');
const DEALS_MS = 6 * 36e5; // shops close, the same limit as "Cheaper"

// What's wrong, short enough for the card's bar, with the whole text on hover. A warning turns
// the bar orange; a note is only a reminder.
const trouble = (short, long = short, level = 'warn') => ({ short, long, level });

// A throwing star's "4 for 600,000" is one set with 4 left, so its price is the whole price.
// "1000 for 400 mesos" is a bundle: the game only sells whole bundles ("The number of items
// should be based on the number of items in a bundle", the user's captures, Nov 12). So the card
// shows and judges such a row by the bundle, 400 per 1,000, which is what the player pays, where
// it used to say 0.4 each and call a stall 100 mesos cheaper "+0.1". Other stalls' prices are
// still compared per item (itemFacts().unitPrice), then shown for this row's bundle.
const bundleOf = row => (row.qty > 1 && !facts.recharges(row.name) && !facts.single(row.name) ? row.qty : 1);
const perBundle = (votes, per) => (per === 1 || !votes ? votes : votes.map(v => ({ ...v, u: Math.round(v.u * per * 100) / 100 })));
const unitOf = row => (bundleOf(row) > 1 ? row.price : facts.unitPrice(row.name, row.qty, row.price));
const priceText = row => (bundleOf(row) > 1 ? `${whole(row.price)} <small>per ${whole(row.qty)}</small>` : whole(row.price));
// Another stall's ask, beside a row sold per bundles of `per`. When that stall sells another
// amount at a time it's said as sold there, because the least a player can spend there differs.
function askText(v, per) {
  const qty = v.qty ?? per;
  if (qty === per) return fmt(v.u);
  return qty === 1 ? `${fmt(v.u / per)} each` : `${whole(Math.round(v.u / per * qty))} for ${whole(qty)}`;
}
const sentence = text => (text ? `${text[0].toUpperCase()}${text.slice(1)}.` : '');

// Bought by the hundred and bought now: potions (food too) and arrows. For these the card says
// whether a row is the cheapest right now, from stalls that can be walked to, once the player
// turns that on in Settings (compareNow). Until then they get the usual price's words too.
const BULK_KINDS = ['Potion', 'Arrow'];
const bulk = name => (settings.compareNow ?? false) && BULK_KINDS.includes(facts.kind(name)?.kind);
const rightNow = (name, unit, seller, per = 1) => cheapestNow(perBundle(seen[name], per), unit, { except: thisShop(seller), here: place });
// Where a stall is, for someone already in reach of it: its seller and channel, and its room in
// the Free Market. Outside it only the same map is in reach, so the map's name would say nothing.
function stallText(v) {
  const spot = [v.channel ? `CH.${v.channel}` : null, v.room ? `FM ${v.room}` : null].filter(Boolean).join(' ');
  return [v.s, spot || 'channel not known', agoText(Date.now() - v.t)].filter(Boolean).join(', ');
}

function judge(row, seller) {
  const needsHover = isGear(row.name) && !row.stats;
  const per = bundleOf(row), npc = facts.npc(row.name);
  const now = bulk(row.name) && row.real && !row.sold && !row.cut ? rightNow(row.name, unitOf(row), seller, per) : null;
  const market = marketOf(perBundle(needsHover ? seen[row.name] : comparable(row.name, row.stats), per), row.name, seller);
  // a far-below price is only a deal once a hover has shown it's this item: gear by its stats
  const confirmed = isGear(row.name) ? !!row.stats : !!row.named;
  // rightNow rides along whatever the answer is, for the row's second line
  return { ...verdict({ unit: unitOf(row), sold: row.sold, cut: row.cut, unread: !row.real, needsHover, confirmed, ownFee: session?.own ? SALES_FEE : null, rightNow: now }, market, npc == null ? npc : npc * per), rightNow: now };
}

// Where this item was cheaper a moment ago. There's no search in the game, so this saves a walk.
function cheaperLine(row, j, seller) {
  if (row.sold || row.cut || !row.real || (isGear(row.name) && !row.stats)) return '';
  // bought in bulk: only when the answer is that it's dearer here, and only a stall in reach
  const per = bundleOf(row);
  if (bulk(row.name)) return j.tag === 'more' ? `<span class="lot-go">${askText(j.rightNow.low, per)} at ${esc(stallText(j.rightNow.low))}</span>` : '';
  const better = cheaperElsewhere(perBundle(comparable(row.name, row.stats), per), unitOf(row), { except: thisShop(seller) });
  if (!better) return '';
  const where = whereText(better) || 'place not known';
  return `<span class="lot-go">Cheaper: ${askText(better, per)} at ${esc(where)}, ${agoText(Date.now() - better.t)}</span>`;
}

// What identifies this copy: a star set, a scroll's rate, how worked gear is.
function rowFacts(r) {
  const rate = facts.rate(r.name);
  return [
    facts.recharges(r.name) ? `1 set with ${r.qty} left` : '',
    rate == null ? '' : `${rate}% scroll`,
    r.stats ? gearState(r.stats, facts.slots(r.name), facts.base(r.name)) : '',
  ].filter(Boolean);
}

// where: the place a price was seen, on a line of its own under it, because a long map name
// beside the price squeezed the label to a word a line and ran over it (Nov 12)
const fact = (label, value, where = '') => `<div class="fact"><span>${label}</span><span>${value}</span></div>${where ? `<div class="fact-where">${esc(where)}</div>` : ''}`;

// The facts behind an item's price, for an opened row or the player's own item.
// unit: the row's own price, when it's a row, and per: its bundle (bundleOf), which every price
// here is then for.
function priceFacts(name, stats, seller, { npc = false, unit = null, per = 1 } = {}) {
  const gear = isGear(name);
  const votes = perBundle(gear ? comparable(name, stats) : seen[name], per);
  const market = marketOf(gear && !stats ? seen[name] : votes, name, seller);
  const lines = per > 1 ? [`<div class="state">Prices per ${whole(per)}, as sold here.</div>`] : [];
  if (bulk(name)) {
    // the cheapest right now first, then the usual price, which says whether today is a dear day
    const now = rightNow(name, unit ?? Infinity, seller, per);
    if (now) lines.push(fact(now.best ? 'Next cheapest right now' : 'Cheapest right now', askText(now.low, per), stallText(now.low)));
    else lines.push(fact('Right now', 'nobody else seen'));
    const sales = market && `${market.soldCount} sale${market.soldCount === 1 ? '' : 's'}`;
    if (market?.firm) lines.push(fact(`Usual price <small>${market.basis === 'sold' ? `sold, ${sales}` : 'from asks'}</small>`, fmt(market.price)));
    else if (market?.sold != null) lines.push(fact(`Sold, ${sales}`, fmt(market.sold)));
    if (now && now.low.u !== now.high) lines.push(fact('Seen this hour', `${fmt(now.low.u)} to ${fmt(now.high)}`));
    else if (market && market.low !== market.high) lines.push(fact('Seen', `${fmt(market.low)} to ${fmt(market.high)}`));
  } else if (gear && !stats) {
    if (market) lines.push(fact('Seen, any stats', `${fmt(market.low)} to ${fmt(market.high)}`));
  } else if (market) {
    if (market.sold != null) lines.push(fact(`${gear ? 'Same stats sold' : 'Sold'}, ${market.soldCount} sale${market.soldCount === 1 ? '' : 's'}`, fmt(market.sold)));
    const near = cheaperElsewhere(votes, Infinity, { except: thisShop(seller) });
    if (near) lines.push(fact(seller ? 'Cheapest other ask' : 'Cheapest ask', askText(near, per), whereText(near) || ''));
    else if (market.cheapest != null) lines.push(fact(seller ? 'Cheapest other ask' : 'Cheapest ask', fmt(market.cheapest)));
    if (market.low !== market.high) lines.push(fact('Seen', `${fmt(market.low)} to ${fmt(market.high)}`));
  } else {
    lines.push(fact(gear ? 'Same stats' : 'Market', 'no data yet'));
    // gear too rare to have a price of its own
    const nearest = stats ? closestGear(seen[name], stats, { except: thisShop(seller) }) : [];
    if (nearest.length) lines.push(`<div class="lot-group">Closest stats seen</div>${nearest.map(v => fact(esc(gearState(v.stats, facts.slots(name), facts.base(name))), fmt(v.u))).join('')}`);
  }
  if (npc && facts.npc(name) != null) lines.push(fact('NPC pays', fmt(facts.npc(name) * per)));
  return lines.join('');
}

// The name a row is shown under. Only a real item's name is ever shown, or for a cut-off row
// the start its real names share: a misread ("Fet Food") would be an item that doesn't exist.
const starts = new Map();
function shownName(r) {
  if (r.real) return r.name;
  if (!r.cut && !r.clipped) return null;
  if (!starts.has(r.name)) starts.set(r.name, sharedStart(r.name, realNames));
  const start = starts.get(r.name);
  return start ? `${start}…` : null;
}
function rowName(r) {
  const name = shownName(r);
  return name ? iconName(r.real ? facts.icon(r.name) : null, name) : `${iconTag(null)}<span class="name unread">Unread item</span>`;
}

function rowHtml({ r, j }, open) {
  const known = sentence(rowFacts(r).join(', '));
  // a percentage on something bought in bulk means there was no other stall to set it against
  const alone = bulk(r.name) && !j.rightNow && place?.map && (j.tag === 'deal' || j.tag === 'over') ? 'Nobody else seen this hour.' : '';
  const note = [known, j.note, alone].filter(Boolean).join(' ');
  const more = open && r.real
    ? `<div class="lot-facts">${known ? `<div class="state">${esc(known)}</div>` : isGear(r.name) && !r.stats ? '<div class="state">Reading its stats</div>' : ''}${priceFacts(r.name, r.stats, session.seller, { unit: unitOf(r), per: bundleOf(r) })}</div>`
    : `${note ? `<span class="lot-note">${esc(note)}</span>` : ''}${cheaperLine(r, j, session.seller)}`;
  return `<div class="lot${open ? ' open' : ''}${r.sold ? ' sold' : ''}">
    <span class="say ${j.tag}">${esc(minus(j.label))}</span><span class="what named">${rowName(r)}</span><span class="cost">${priceText(r)}</span>${more}</div>`;
}

// One line per row in the shop, in the shop's order, so the card always matches what the player
// sees. Identical copies are saved as one listing, but each line has its own hover stats.
const judgedRows = () => session.lines.filter(l => l.listing).map(l => {
  const r = { ...l.listing, stats: lineStats(l), named: l.named };
  return { l, r, j: judge(r, session.seller) };
});
const shopName = () => session.seller ?? session.title ?? 'Player shop';

// The deals walked past this session, for the card to show between shops. A row that later
// reads as sold, or as no longer a deal, drops out.
const dealsSeen = new Map();
function noteDeals(rows) {
  const who = session.seller ?? session.title;
  if (!who || session.own) return;
  const where = whereText({ channel, map: place?.map, room: place?.room });
  for (const { r, j } of rows) {
    const key = `${who}|${r.name}|${r.qty}|${r.price}`;
    if (r.sold || j.tag !== 'deal') { dealsSeen.delete(key); continue; }
    dealsSeen.set(key, { name: r.name, label: j.label, pct: j.pct ?? -Infinity, price: priceText(r), where, seller: session.seller, t: Date.now() });
  }
}

function bestDeals(now = Date.now()) {
  return [...dealsSeen.values()].filter(d => now - d.t <= DEALS_MS).sort((a, b) => a.pct - b.pct).slice(0, 3);
}

// The hovered line, when the tooltip is over this shop's list and its row is known.
function hoveredLine() {
  const line = held?.line;
  return line && session && !session.closed && session.lines.includes(line) ? line : null;
}

// noting: false for the example card in Settings, whose made-up deals must never be remembered
function playerRows(noting = true) {
  const rows = judgedRows(), hot = hoveredLine();
  if (noting) noteDeals(rows);
  const deals = rows.filter(x => x.j.rank === 0).length;
  // "SHOP" is the default stall title, so the seller is the heading and a real title goes under it
  const title = session.seller && session.title && !/^shop$/i.test(session.title.trim()) ? `“${session.title}”` : '';
  const where = whereText({ map: place?.map, room: place?.room });
  const forSale = rows.filter(x => !x.r.sold).length;
  // sold rows stay where they are in the shop, greyed as in the game
  return `<div class="shop-head"><div class="who"><h3>${esc(shopName())}</h3>${deals ? `<span class="count">${deals} deal${deals > 1 ? 's' : ''}</span>` : ''}</div>
    <p>${[title, where, session.own ? 'Your shop, not shared' : `${forSale} for sale`].filter(Boolean).map(esc).join(' · ')}</p></div>
    <div class="lots">${rows.map(x => rowHtml(x, x.l === hot)).join('')}</div>`;
}

function npcRows() {
  // The list keeps every item scrolled past, but an unread row only while it's on screen: a
  // frame caught while the list scrolled can read a row that was never there, and it would stay.
  const onShow = r => r.real || r.seenAt === session.seenAt;
  const sellRow = r => {
    // a name that's no real item has no price to show: the same "check" as in a player's shop
    if (!r.real) {
      const j = verdict({ cut: r.cut, unread: true }, null, null);
      return `<div class="lot"><span class="say ${j.tag}">${esc(j.label)}</span><span class="what named">${rowName(r)}</span><span class="cost"></span><span class="lot-note">${esc(j.note)}</span></div>`;
    }
    const npc = facts.npc(r.name), market = isGear(r.name) ? null : marketOf(seen[r.name], r.name, null);
    const fmNet = market?.firm ? market.price * (1 - SALES_FEE) : null;
    const better = fmNet != null && npc != null && fmNet > npc * 1.2;
    const say = better ? '<span class="say deal">FM</span>' : '<span class="say"></span>'; // only the better place is marked
    const note = better ? `Sells for about ${fmt(market.price)} on the Free Market.` : market && !market.firm ? `Only ${market.sellers} seller${market.sellers === 1 ? '' : 's'} on the Free Market so far, from ${fmt(market.low)}.` : '';
    return `<div class="lot">${say}<span class="what named">${iconName(facts.icon(r.name), r.name)}</span><span class="cost">${fmt(npc)}</span>${note ? `<span class="lot-note">${esc(note)}</span>` : ''}</div>`;
  };
  return `<div class="shop-head"><div class="who"><h3>NPC shop</h3></div><p>What the NPC pays, and where it sells for more</p></div>
    <div class="lots">${session.rows.filter(onShow).map(sellRow).join('') ||'<p class="idle">Nothing read yet.</p>'}</div>`;
}

// An item that isn't a line on the card: the player's own, or one in this shop whose row can't
// be told (the game may have moved its tooltip, and there are two copies), in a fixed place so
// the list doesn't move.
function itemCard(tip, label) {
  const name = knownName(tip.name) ?? tip.name, gear = isGear(name), stats = gear ? tip.gear : null;
  const rate = facts.rate(name);
  const state = stats ? gearState(stats, facts.slots(name), facts.base(name)) : rate != null ? `${rate}% scroll` : '';
  return `<div class="mine"><div class="label">${label}</div><h4 class="named">${iconName(facts.icon(name), name)}</h4>
    ${state ? `<p class="state">${esc(sentence(state))}</p>` : ''}${priceFacts(name, stats, session?.seller ?? null, { npc: true })}</div>`;
}

function idleHtml() {
  const now = Date.now(), deals = bestDeals(now);
  const hint = `<p class="idle">${stream ? 'Walk into a shop to check it.' : 'Press Start scanning.'}</p>`;
  if (!deals.length) return hint;
  const line = d => [d.where || 'place not known', d.seller, agoText(now - d.t)].filter(Boolean).join(', ');
  return `<div class="shop-head"><div class="who"><h3 class="dim">Best deals this session</h3></div></div>
    <div class="lots">${deals.map(d => `<div class="lot"><span class="say deal">${esc(minus(d.label))}</span><span class="what named">${iconName(facts.icon(d.name), d.name)}</span><span class="cost">${d.price}</span><span class="lot-go">${esc(line(d))}</span></div>`).join('')}</div>${hint}`;
}

// One slot, so the most urgent problem shows. It stays until fixed and needs no click.
function problemText() {
  if (problem) return problem;
  if (!dbOnline) return trouble('MapleScanner stopped', "The app's local server stopped answering. Restart MapleScanner.");
  if (cloud && !cloud.connected) return trouble('No price server', 'No price server is set, so there are no prices and scans are not shared.');
  if (cloud?.blocked) return trouble('Sharing stopped', 'This install can no longer share its scans. Prices still show.', 'note');
  if (cloud?.online === false) {
    const waiting = cloud.waiting ? `, ${cloud.waiting} waiting` : '';
    return trouble(`Offline${waiting}`, `Can't reach the price server. Prices are from before the connection dropped. New scans${waiting ? ` (${cloud.waiting})` : ''} wait in memory and are sent when it's back, but are lost if the app closes first.`);
  }
  if (stream && wasFrozen) return trouble('Picture frozen, reconnecting', 'The game picture stopped changing. MapleScanner is reconnecting by itself.');
  if ((stream || (session && !session.closed && session.kind !== 'npc')) && !channel) return trouble('Open Change Channel once', 'Open Change Channel in the game once, so shops save their channel.', 'note');
  return null;
}

const small = () => panel.classList.contains('small');

// Shrunk, the bar still names the shop and its best deal.
// A warning always takes the bar. A reminder doesn't when shrunk, as CH ? already says it.
function barHtml(issue) {
  const shop = small() && session && !session.closed && session.kind !== 'npc';
  if (issue && (issue.level === 'warn' || !shop)) return esc(issue.short);
  if (!shop) return esc(message);
  const deals = judgedRows().filter(x => x.j.tag === 'deal' && !x.r.sold).sort((a, b) => a.j.rank - b.j.rank);
  const best = deals[0] && `<span class="deals">${esc(deals[0].r.name)} ${esc(minus(deals[0].j.label))}</span>${deals.length > 1 ? ` +${deals.length - 1}` : ''}`;
  return `<b>${esc(shopName())}</b>${best ? ` · ${best}` : ''}`;
}

// What listings are being saved with, on show even when the card is shrunk.
function showChannel() {
  barChannel.hidden = !stream && !channel;
  barChannel.textContent = channel ? `CH.${channel}` : 'CH ?';
  barChannel.classList.toggle('unknown', !channel);
  barChannel.setAttribute('aria-label', channel ? `Channel ${channel}` : 'Channel unknown');
}

// The name a hovered item's card shows, or null. A title that's no real item is a misread
// ("Meat" read as "Vie at") or something on the map taken for a tooltip ("gh WA" at the
// Free Market Entrance), and a card for it says nothing true.
const tooltipCard = tip => (tip?.real ? tip.name : null);

let shownTop = null, shownList = null, shownFoot = null, shownBar = null;
function render() {
  if (tooltipCard(tooltip)) { held = tooltip; heldAt = Date.now(); }
  else if (Date.now() - heldAt > HOVER_GONE_MS) held = null;
  const open = session && !session.closed;
  const issue = problemText();
  // In the main window there's room for the whole problem. Popped out, the bar says it.
  const top = issue && !popped ? `<div class="problem">${esc(issue.long)}</div>` : '';
  let list, foot = '';
  if (!open) list = held ? itemCard(held, 'Your item') : idleHtml();
  else if (session.kind === 'npc') list = npcRows();
  else {
    list = playerRows();
    if (held && !hoveredLine()) foot = itemCard(held, held.overList ? 'Hovered item' : 'Your item');
  }
  // Written only when changed, so the list keeps its scroll position between scans.
  if (top !== shownTop) panelTop.innerHTML = shownTop = top;
  const listChanged = list !== shownList;
  if (listChanged) panelList.innerHTML = shownList = list;
  if (foot !== shownFoot) panelFoot.innerHTML = shownFoot = foot;
  const barLine = barHtml(issue);
  if (barLine !== shownBar) barText.innerHTML = shownBar = barLine;
  panelBar.classList.toggle('bad', issue?.level === 'warn');
  panelBar.title = issue?.long ?? '';
  panelList.classList.toggle('stale', !!(stream && wasFrozen)); // rows that may be out of date
  showChannel();
  barLive.className = `live${issue?.level === 'warn' ? ' bad' : stream ? ' on' : ''}`;
  fitPopOut();
  // again once the popped-out window has taken its new height
  if (listChanged) { followHover(); setTimeout(followHover, 200); }
}

// A card dragged low on the screen is shorter than its list, which then scrolls. The hovered row
// is the one being read, so the list scrolls just far enough to show all of it (the user's wish,
// Nov 12: hovering the sixth row opened it out of sight). Only when the list was redrawn, so a
// player's own scrolling isn't fought. Measured on screen and divided by the page's zoom,
// because scrollTop isn't zoomed (see the text size in Settings).
function followHover() {
  const open = panelList.querySelector('.lot.open');
  if (!open || !panelList.clientHeight) return;
  const box = panelList.getBoundingClientRect(), row = open.getBoundingClientRect();
  const zoom = box.height / panelList.offsetHeight || 1;
  if (row.top < box.top) panelList.scrollTop -= (box.top - row.top) / zoom;
  else if (row.bottom > box.bottom) panelList.scrollTop += Math.min(row.bottom - box.bottom, row.top - box.top) / zoom;
}

// ---------- live capture ----------
const frame = document.createElement('canvas');
const video = document.createElement('video');
video.muted = true;
let busy = false, timer = null;
let latest = null;        // newest frame from the track, when the browser can read it directly
const probe = document.createElement('canvas');
probe.width = 64; probe.height = 36;
let lastPicture = null, pictureAt = 0, wasFrozen = false;
let reconnecting = false, nextReconnect = 0;

// Reads frames straight from the track. Without this the hidden <video> below is used.
async function readTrack(track) {
  if (!window.MediaStreamTrackProcessor) return;
  const frames = new MediaStreamTrackProcessor({ track }).readable.getReader();
  for (;;) {
    const { value, done } = await frames.read();
    if (done) return;
    if (track.readyState === 'ended') { value.close(); return; }
    latest?.close();
    latest = value;
  }
}

// ---------- channel watch ----------
let watcher = null, watchTrack = null, watchLive = false;

// The worker reads a copy of the capture by itself, so the page's scans can't hold frames up.
// It keeps at most 2 waiting, and drops older ones, so a slow look can never stall the capture.
function startWatcher(track) {
  stopWatcher();
  if (!window.MediaStreamTrackProcessor) return; // then the full scans watch, more slowly
  watchTrack = track.clone();
  const frames = new MediaStreamTrackProcessor({ track: watchTrack, maxBufferSize: 2 }).readable;
  watcher = new Worker('watch.js');
  watcher.postMessage({ frames }, [frames]);
  watcher.onmessage = ({ data }) => {
    if (data.error) return console.error(data.error);
    watchLive = true;
    const before = channel;
    channels.see(data, Date.now(), place);
    channel = channels.channel;
    if (channel !== before) render();
  };
}

function stopWatcher() {
  watcher?.terminate();
  watchTrack?.stop();
  watcher = watchTrack = null;
  watchLive = false;
}

// A running game always has something moving, so an identical picture means the capture froze.
function frozenMs(canvas) {
  const g = probe.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, probe.width, probe.height);
  const now = g.getImageData(0, 0, probe.width, probe.height).data, t = performance.now();
  if (!lastPicture || now.some((v, i) => v !== lastPicture[i])) { lastPicture = now; pictureAt = t; }
  return t - pictureAt;
}

async function scanCanvas(canvas, at = Date.now()) {
  await reader.ready(t => { message = t; render(); });
  // The map is read whenever it's on show, so it's known before any loading screen. Unchanged
  // text isn't read again, so this costs little.
  const res = await reader.scan(canvas, { wantPlace: true });
  applyScan(res, at);
  saveSightings();
  return res;
}

let nextScan = 0;
async function tick() {
  const width = latest ? latest.displayWidth : video.videoWidth;
  const height = latest ? latest.displayHeight : video.videoHeight;
  const started = performance.now();
  if (busy || !stream || !width || started < nextScan) return;
  nextScan = started + (channels.watching && !watchLive ? FAST_SCAN_MS : SCAN_MS);
  busy = true;
  try {
    if (frame.width !== width || frame.height !== height) { frame.width = width; frame.height = height; }
    frame.getContext('2d', { willReadFrequently: true }).drawImage(latest ?? video, 0, 0);
    const takenAt = Date.now();
    const frozen = frozenMs(frame);
    if (wasFrozen && frozen <= FROZEN_MS) channels.lost(); // it may have come back on another channel
    wasFrozen = frozen > FROZEN_MS;
    if (wasFrozen) reconnect().catch(console.error);
    await scanCanvas(frame, takenAt);
    channel = channels.channel;
    message = 'Scanning';
    problem = frozen > (window.desktop ? GIVE_UP_MS : FROZEN_MS) ? trouble('Picture frozen: restart scanning', `The game picture has been frozen for ${Math.round(frozen / 1000)} seconds. Stop scanning, then start again.`) : null;
  } catch (err) {
    console.error(err);
    problem = trouble('Scan failed', `Scan failed: ${err.message}`);
  }
  busy = false;
  render();
}

// Timers in a hidden tab slow down, so a worker keeps the beat while the game has focus.
function startTimer() {
  const src = `setInterval(() => postMessage(0), ${TICK_MS})`;
  timer = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  timer.onmessage = tick;
}

function stopCapture() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  timer?.terminate(); timer = null;
  stopWatcher();
  video.srcObject = null;
  latest?.close(); latest = null;
  lastPicture = null;
  wasFrozen = false;
  $('share').textContent = 'Start scanning';
  message = 'Not scanning';
  problem = null;
  render();
}

// exact, because other windows can have it in their titles, like a Discord channel
function onlyGameWindow(windows) {
  const game = windows.filter(w => /^\s*maple\s*story\s*$/i.test(w.name));
  return game.length === 1 ? game[0].id : null;
}

// The Windows app has no browser picker, so it picks the game window itself.
async function pickGameWindow() {
  const windows = await window.desktop.listWindows();
  const game = onlyGameWindow(windows);
  if (game) return game;
  // a running game missing from the list has needed a restart
  $('pickerAdmin').hidden = !(await window.desktop.gameRunning());
  $('pickerList').innerHTML = windows.map(w => `<button value="${esc(w.id)}"><img src="${w.thumbnail}" alt=""><span>${esc(w.name)}</span></button>`).join('');
  const dialog = $('picker');
  dialog.showModal();
  return new Promise(done => { dialog.onclose = () => done(dialog.returnValue); });
}

async function openStream() {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: captureFps(), displaySurface: 'window', cursor: 'never' }, audio: false });
  const track = stream.getVideoTracks()[0];
  track.addEventListener('ended', stopCapture);
  readTrack(track).catch(console.error);
  if (settings.channelWatch) startWatcher(track); else stopWatcher();
  video.srcObject = stream;
  await video.play();
}

// What Stop and Start would do, without asking the player to leave the game. A capture can
// stop around a channel change, while the game carries on.
async function reconnect() {
  const now = performance.now();
  if (!window.desktop || reconnecting || now < nextReconnect) return;
  reconnecting = true;
  nextReconnect = now + RECONNECT_MS;
  try {
    const game = onlyGameWindow(await window.desktop.listWindows());
    if (!game) return;
    await window.desktop.chooseWindow(game);
    const old = stream;
    await openStream();
    old?.getTracks().forEach(t => t.stop());
  } finally {
    reconnecting = false;
  }
}

$('share').onclick = async () => {
  if (stream) return stopCapture();
  try {
    if (window.desktop) {
      const id = await pickGameWindow();
      if (!id) throw new Error('No window picked');
      await window.desktop.chooseWindow(id);
    }
    await openStream();
  } catch (err) {
    console.error(err);
    if (stream) stopCapture(); // it failed after the capture started
    // the browser's own picker says NotAllowedError when it's closed
    const cancelled = err.message === 'No window picked' || (!window.desktop && err.name === 'NotAllowedError');
    problem = cancelled
      ? trouble('Scanning cancelled', 'Scanning was cancelled. Press Start scanning to try again.', 'note')
      : trouble("Can't capture: restart the game", `Couldn't capture the game window (${err.name}: ${err.message}). Restart MapleStory, then press Start scanning again.`);
    return render();
  }
  startTimer();
  $('share').textContent = 'Stop scanning';
  message = 'Scanning';
  problem = null;
  render();
};

// ---------- pop-out ----------
const POPPED_WIDTH = 340, POPPED_HEIGHT = 720;
let popped = null;

// The Windows app fits the small window to what's on show, so it isn't an empty box between shops.
function fitPopOut() {
  if (!popped || !window.desktop) return;
  const height = el => el.offsetHeight;
  // The list's contents, because the list itself stretches to fill the window.
  const list = [...panelList.children].reduce((sum, el) => sum + height(el), 0);
  const size = textSize();
  window.desktop.fitPanel(POPPED_WIDTH * size, size * (height(bar) + (small() ? 0 : height(panelTop) + list + height(panelFoot))));
}

// The hotkey hides the popped-out card without closing it, so the button brings it back.
let cardHidden = false;
function showPopButton() {
  $('pop').disabled = !!popped && !cardHidden;
  $('pop').textContent = popped && cardHidden ? 'Show stall card' : 'Pop out stall card';
}

$('pop').onclick = async () => {
  if (popped) return cardHidden && window.desktop?.showCard();
  if (!window.desktop && !window.documentPictureInPicture) {
    problem = trouble('Pop out needs Chrome or Edge', 'Pop out needs Chrome or Edge 116 or newer.');
    return render();
  }
  let pip;
  try {
    pip = window.desktop ? window.open('about:blank', 'panel') : await documentPictureInPicture.requestWindow({ width: Math.round(POPPED_WIDTH * textSize()), height: Math.round(POPPED_HEIGHT * textSize()) });
  } catch (err) {
    console.error(err);
    problem = trouble("Pop out couldn't open", "Pop out couldn't open here. Use Chrome or Edge as a normal browser window.");
    return render();
  }
  pip.document.title = 'MapleScanner';
  const theme = pip.document.createElement('link');
  theme.rel = 'stylesheet';
  theme.href = new URL('theme.css', location.href).href;
  theme.onload = render; // the card can only measure itself once it's styled
  pip.document.head.append(theme);
  zoomDocument(pip.document);
  themeDocument(pip.document);
  panel.classList.add('pip');
  pip.document.body.append(panel);
  popped = pip;
  cardHidden = false;
  showPopButton();
  render();
  pip.addEventListener('pagehide', () => {
    popped = null;
    panel.classList.remove('pip', 'small');
    $('holder').append(panel);
    showPopButton();
    render();
  });
};
window.desktop?.onPopOut(() => $('pop').click()); // the hotkey, before the card was ever popped out
window.desktop?.onCardShown(shown => { cardHidden = !shown; showPopButton(); });

// Moved by hand, because a Windows title bar drag gives the card focus even though it can't
// take any otherwise, and the keyboard and mouse would leave the game.
const bar = panelBar;
let dragFrom = null;
bar.addEventListener('pointerdown', e => {
  if (!window.desktop || !popped || e.target.closest('button')) return;
  dragFrom = { x: e.screenX, y: e.screenY };
  bar.setPointerCapture(e.pointerId);
});
bar.addEventListener('pointermove', e => {
  if (!dragFrom) return;
  window.desktop.movePanel(e.screenX - dragFrom.x, e.screenY - dragFrom.y);
  dragFrom = { x: e.screenX, y: e.screenY };
});
bar.addEventListener('pointerup', () => { dragFrom = null; fitPopOut(); });
bar.addEventListener('pointercancel', () => { dragFrom = null; });

$('panelShrink').onclick = () => { panel.classList.toggle('small'); render(); };
$('panelClose').onclick = () => popped?.close();

// ---------- screenshots ----------
// For checking the reading code on a saved screenshot from the developer tools (window.app.scanBlob).
// It shows on the stall card like a live read, but nothing read from a picture is ever saved or
// shared, because a picture can be edited (see remember). Players have no way to give it one.
async function scanBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
  await scanCanvas(c);
  if (session) { // a screenshot only gets one read
    session.seller = mostRead(session.sellers);
    session.title = mostRead(session.titles);
    for (const l of session.lines) settleStats(l, 1);
  }
  render();
}

// ---------- tabs ----------
// Prices sits in a frame, so scanning carries on while it's open.
const TABS = { scanner: ['tabScanner', 'scannerTab'], prices: ['tabPrices', 'pricesFrame'], settings: ['tabSettings', 'settingsTab'], about: ['tabAbout', 'aboutTab'] };
function showTab(name) {
  for (const [tab, [button, page]] of Object.entries(TABS)) {
    $(page).hidden = tab !== name;
    $(button).classList.toggle('on', tab === name);
    $(button).setAttribute('aria-selected', tab === name);
  }
  if (name !== 'prices') return;
  const frame = $('pricesFrame');
  if (frame.getAttribute('src')) frame.contentWindow.reload?.();
  else frame.src = 'prices.html';
}
for (const tab of Object.keys(TABS)) $(TABS[tab][0]).onclick = () => showTab(tab);

// ---------- settings ----------
// The example card beside the stall card's settings: a made-up shop in the Free Market, drawn
// by the real card's own code so it always shows what the settings do. The page's shop, prices
// and place are swapped for made-up ones while it's drawn and put back after, which is safe
// because drawing never waits for anything. Every seller and price here is invented.
function exampleCard() {
  const now = Date.now(), MIN = 6e4, DAY = 864e5;
  const names = ['Aster', 'Birch', 'Cedar', 'Dahlia', 'Elm'];
  // five sellers' asks from the last days make the usual price, and stalls seen this hour are in reach
  const usual = (prices, qty = 1) => prices.map((u, i) => ({ u, qty, s: names[i], sold: false, t: now - (1 + i % 3) * DAY, map: 'Free Market', room: 1 + i, channel: 1 + i }));
  const stall = (u, s, min, ch, room, qty = 1) => ({ u, qty, s, sold: false, t: now - min * MIN, map: 'Free Market', room, channel: ch });
  const row = (name, qty, price) => ({ list: 'shop', name, qty, price, sold: false, real: true, cut: false, clipped: false });
  const real = { session, seen, place, held, channel };
  try {
    seen = {
      'Orange Potion': [...usual([135, 138, 140, 142, 150]), stall(130, 'Herbie', 3, 5, 7), stall(145, 'Pottery', 20, 5, 2)],
      Elixir: [...usual([900, 910, 920, 950, 990]), stall(920, 'Pottery', 12, 5, 2)],
      'Arrows for Bows': [...usual([0.5, 0.5, 0.6, 0.6, 0.7], 1000), stall(0.4, 'Fletch', 8, 2, 3, 1000)], // 1000 for 400
      // sold one at a time here, and by the bundle at the cheaper stall
      'Arrows for Crossbows': [...usual([1, 1, 1, 2, 2]), stall(0.4, 'Fletch', 8, 2, 3, 1000)],
      'Iron Ore': [...usual([340, 350, 360, 370, 380]), stall(300, 'Herbie', 3, 5, 7)],
    };
    const rows = [row('Orange Potion', 1, 139), row('Elixir', 1, 899), row('Arrows for Bows', 1000, 500), row('Arrows for Crossbows', 1, 1), row('Iron Ore', 1, 350)];
    session = { kind: 'player', seller: 'Sunny', title: 'Pots and arrows', own: false, closed: false, rows, lines: rows.map(listing => ({ listing })) };
    place = { map: 'Free Market', room: 3 };
    channel = 5;
    held = null;
    return `<div class="bar"><span class="live on"></span><span class="text">Scanning</span><span class="channel">CH.5</span></div><div class="list">${playerRows(false)}</div>`;
  } finally {
    ({ session, seen, place, held, channel } = real);
  }
}

function showSettings() {
  try { $('exampleCard').innerHTML = exampleCard(); } catch (err) { console.error(err); } // the item list may not be loaded yet
  $('settingChannelWatch').checked = settings.channelWatch;
  $('settingAutoUpdate').checked = settings.autoUpdate ?? true;
  $('settingShareScans').checked = settings.shareScans ?? true;
  $('settingCompareNow').checked = settings.compareNow ?? false;
  $('settingTextSize').value = String(settings.textSize ?? 1);
  $('settingTheme').value = settings.theme ?? 'auto';
  showTextSize();
  showTheme();
}

// ---------- about and updates ----------
// The app checks GitHub for new versions itself (desktop/main.js) and tells the page each step.
// The About tab shows where it is, and the end of the tab bar shows a download in progress and
// then Restart now. The stall card shows none of it, so nothing interrupts play.
let update = null; // { state, current, version, percent, checked, error }, only in the Windows app

function updateView(u) {
  if (!window.desktop) return { text: 'The browser version runs from the source code, so it updates with it (git pull).' };
  const v = u?.version ?? '';
  switch (u?.state) {
    case 'dev': return { text: 'Running from the source code (npm start), so it updates with it, not here.' };
    case 'latest': return { text: `You have the latest version. Checked at ${new Date(u.checked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`, action: ['Check for updates', 'check'] };
    case 'available': return { text: `Version ${v} is available.`, action: ['Download', 'download'] };
    case 'downloading': return {
      text: `Downloading version ${v}: ${u.percent ?? 0}%. Keep playing: it installs when you restart.`,
      action: ['Downloading…', null], pill: `Downloading update ${u.percent ?? 0}%`,
    };
    case 'ready': return {
      text: `Version ${v} is ready. Restart now to start using it, or it installs the next time you close MapleScanner.`,
      action: ['Restart now', 'restart', true], pill: 'Restart to update', ready: true,
    };
    case 'error': return { text: `Couldn't update: ${String(u.error).slice(0, 160)}`, action: ['Try again', 'check'] };
    default: return { text: 'Checking for updates…', action: ['Checking…', null] };
  }
}

function showUpdate() {
  const view = updateView(update), button = $('updateAction'), pill = $('updatePill');
  $('updateText').textContent = view.text;
  button.hidden = !view.action;
  if (view.action) {
    const [label, run, primary] = view.action;
    button.textContent = label;
    button.disabled = !run;
    button.classList.toggle('primary', !!primary);
    button.dataset.run = run ?? '';
  }
  pill.hidden = !view.pill;
  pill.textContent = view.pill ?? '';
  pill.classList.toggle('ready', !!view.ready);
  pill.title = view.ready ? 'Installs the new version and starts it again. Scanning stops for a few seconds.' : 'See the update on the About tab';
}

const runUpdate = run => window.desktop?.update?.[run]?.().then(u => { if (u) { update = u; showUpdate(); } });
$('updateAction').onclick = e => runUpdate(e.currentTarget.dataset.run);
$('updatePill').onclick = () => (update?.state === 'ready' ? runUpdate('restart') : showTab('about'));

async function setAutoUpdate(on) {
  const toggle = $('settingAutoUpdate'), note = $('aboutNote');
  toggle.disabled = true;
  try {
    settings = await api('/api/settings', { autoUpdate: on });
    note.textContent = '';
    if (on && update?.state === 'available') await runUpdate('download');
  } catch (err) {
    note.textContent = `Couldn't save the setting: ${err.message}`;
  }
  showSettings();
  toggle.disabled = false;
}
$('settingAutoUpdate').onchange = e => setAutoUpdate(e.target.checked);

async function loadAbout() {
  $('aboutVersion').textContent = (await api('/api/about').catch(() => null))?.version ?? '';
  const updates = window.desktop?.update;
  $('autoUpdateSetting').hidden = !updates;
  if (updates) {
    updates.onChange(u => { update = u; showUpdate(); });
    update = await updates.status();
  }
  showUpdate();
}

// ---------- text size ----------
// Sizes are in pixels all through theme.css, so the page is zoomed as a whole. The Prices frame
// zooms with it, the popped-out card is its own window and gets its own. --zoom is for what
// mustn't scale: the room kept for the Windows buttons, and vh, which zoom scales as well.
// Zoom leaves offsetHeight in unzoomed pixels, so fitPopOut multiplies.
const textSize = () => settings.textSize ?? 1;
function zoomDocument(doc) {
  if (!doc?.documentElement) return;
  doc.documentElement.style.zoom = textSize();
  doc.documentElement.style.setProperty('--zoom', textSize());
}
function showTextSize() {
  zoomDocument(document);
  zoomDocument(popped?.document);
  render();
}

async function setTextSize(size) {
  const select = $('settingTextSize'), note = $('settingsNote');
  select.disabled = true;
  try {
    settings = await api('/api/settings', { textSize: size });
    note.textContent = '';
  } catch (err) {
    note.textContent = `Couldn't save the setting: ${err.message}`;
  }
  showSettings();
  select.disabled = false;
}
$('settingTextSize').onchange = e => setTextSize(Number(e.target.value));

// ---------- theme ----------
// theme.css has a light and a dark colour set and shows the one the system asks for. Light or Dark
// in Settings overrides that with data-theme, on each document: the page, the Prices frame and the
// popped-out card are three. The Windows app also tells Electron, which sets the system's answer for
// all its windows and colours the title bar (desktop/main.js).
// A change fades in over a moment instead of flashing the screen (.theme-fade in theme.css).
const fading = new WeakMap();
function fadeTheme(root) {
  root.classList.add('theme-fade');
  clearTimeout(fading.get(root));
  fading.set(root, setTimeout(() => root.classList.remove('theme-fade'), 400));
}
function themeDocument(doc, fade = true) {
  const root = doc?.documentElement;
  if (!root) return;
  const theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : undefined;
  if (root.dataset.theme === theme) return;
  if (fade) fadeTheme(root);
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
}
const themeDocuments = () => [document, popped?.document, $('pricesFrame').contentDocument].filter(doc => doc?.documentElement);
function showTheme() {
  for (const doc of themeDocuments()) themeDocument(doc);
  window.desktop?.setTheme?.(settings.theme ?? 'auto');
}
// A new Prices page takes the theme as it opens, with nothing to fade from.
$('pricesFrame').addEventListener('load', e => themeDocument(e.target.contentDocument, false));
// On Match Windows, Windows switching between light and dark fades too.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!settings.theme || settings.theme === 'auto') for (const doc of themeDocuments()) fadeTheme(doc.documentElement);
});

async function setTheme(theme) {
  const select = $('settingTheme'), note = $('settingsNote');
  select.disabled = true;
  try {
    settings = await api('/api/settings', { theme });
    note.textContent = '';
  } catch (err) {
    note.textContent = `Couldn't save the setting: ${err.message}`;
  }
  showSettings();
  select.disabled = false;
}
$('settingTheme').onchange = e => setTheme(e.target.value);

// Takes effect at once, even while scanning.
async function setChannelWatch(on) {
  const toggle = $('settingChannelWatch'), note = $('settingsNote');
  toggle.disabled = true;
  try {
    settings = await api('/api/settings', { channelWatch: on });
    note.textContent = '';
    const track = stream?.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints({ frameRate: captureFps() }).catch(console.error);
      if (settings.channelWatch) startWatcher(track); else stopWatcher();
    }
  } catch (err) {
    note.textContent = `Couldn't save the setting: ${err.message}`;
  }
  showSettings();
  toggle.disabled = false;
}
$('settingChannelWatch').onchange = e => setChannelWatch(e.target.checked);

// The card is drawn again at once, with the other answer for potions and arrows.
$('settingCompareNow').onchange = async e => {
  try {
    settings = await api('/api/settings', { compareNow: e.target.checked });
    $('settingsNote').textContent = '';
    render();
  } catch (err) {
    $('settingsNote').textContent = `Couldn't save the setting: ${err.message}`;
  }
  showSettings();
};

// The local server starts or stops uploading at once (serve.js). Off, scans still show on the stall
// card, they just aren't sent.
async function setShareScans(on) {
  const toggle = $('settingShareScans'), note = $('settingsNote');
  toggle.disabled = true;
  try {
    settings = await api('/api/settings', { shareScans: on });
    note.textContent = '';
  } catch (err) {
    note.textContent = `Couldn't save the setting: ${err.message}`;
  }
  showSettings();
  toggle.disabled = false;
}
$('settingShareScans').onchange = e => setShareScans(e.target.checked);

// ---------- card hotkey ----------
// Only in the Windows app, which registers the key with Windows (desktop/main.js). The game
// doesn't get that key while the app runs, so the player picks one their key setup doesn't use.
const HOTKEY_KEYS = {
  ScrollLock: 'Scrolllock', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};
const KEY_NAMES = { Scrolllock: 'Scroll Lock', PageUp: 'Page Up', PageDown: 'Page Down', numadd: 'Num +', numsub: 'Num −', nummult: 'Num *', numdiv: 'Num /', numdec: 'Num .' };
const MODIFIERS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'];

// A key press as an Electron accelerator, or null for one that can't be a hotkey. Letters
// follow the keyboard layout, as Windows' own key codes do. The number row and numpad don't.
function acceleratorOf(e) {
  const key = HOTKEY_KEYS[e.code]
    ?? (/^F([1-9]|1\d|2[0-4])$/.test(e.code) ? e.code
      : /^Numpad\d$/.test(e.code) ? `num${e.code.slice(6)}`
      : /^Digit\d$/.test(e.code) ? e.code.slice(5)
      : /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : null);
  return key && [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
}
const keyName = key => key.split('+').map(k => KEY_NAMES[k] ?? (/^num\d$/.test(k) ? `Num ${k.slice(3)}` : k)).join(' + ');

let hotkey = { key: '', works: true }, choosing = false;

function showHotkey(note = hotkey.key && !hotkey.works ? `Windows won't give MapleScanner ${keyName(hotkey.key)}, so it does nothing. Another program may be using it. Pick another key.` : '') {
  const button = $('hotkeyKey');
  button.textContent = choosing ? 'Press a key' : hotkey.key ? keyName(hotkey.key) : 'None';
  button.classList.toggle('listening', choosing);
  $('hotkeyOff').disabled = !hotkey.key || choosing;
  $('hotkeyNote').textContent = note;
  $('popHint').textContent = hotkey.key && hotkey.works ? `or press ${keyName(hotkey.key)} in the game` : '';
}

// While waiting, the old key is let go, so pressing it again reaches this page.
function chooseHotkey(on, note) {
  choosing = on;
  window.desktop.pauseHotkey(on);
  showHotkey(note ?? (on ? 'Press the key you want, or Esc to keep the old one.' : undefined));
}

async function saveHotkey(key) {
  let note;
  try {
    const result = await window.desktop.setHotkey(key);
    if (result.ok) {
      settings = result.settings;
      hotkey = { key, works: true };
    } else {
      note = `Windows won't give MapleScanner ${keyName(key)}. Another program may be using it. Pick another key.`;
    }
  } catch (err) {
    note = `Couldn't save the hotkey: ${err.message}`;
  }
  showHotkey(note);
}

$('hotkeyKey').onclick = () => chooseHotkey(!choosing);
const stopChoosing = () => { if (choosing) chooseHotkey(false); };
$('hotkeyKey').onblur = stopChoosing;
window.addEventListener('blur', stopChoosing); // a key pressed in another window never comes here
$('hotkeyOff').onclick = () => saveHotkey('');
window.addEventListener('keydown', e => {
  if (!choosing) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') return chooseHotkey(false);
  if (MODIFIERS.includes(e.key)) return; // wait for the key that goes with it
  const key = acceleratorOf(e);
  if (!key) return showHotkey('That key can\'t be used. Try an F key, a letter, a number, the numpad, Insert, Home, Page Up or Scroll Lock.');
  chooseHotkey(false);
  saveHotkey(key);
}, true);

async function loadHotkey() {
  if (!window.desktop) return;
  hotkey = await window.desktop.hotkey();
  $('hotkeySetting').hidden = false;
  showHotkey();
}

// ---------- start ----------
(async () => {
  loadHotkey().catch(console.error);
  try {
    const list = await api('osms-items.json');
    realNames = list.names;
    facts = itemFacts(list);
    settings = await api('/api/settings').catch(err => { console.error(err); return settings; });
    showSettings();
    loadAbout().catch(console.error);
    await loadState();
  } catch (err) {
    console.error(err);
    dbOnline = false;
  }
  render();
})();

window.app = { scanBlob, reader, get channel() { return channel; }, get place() { return place; }, get session() { return session; }, get tooltip() { return tooltip; } };
