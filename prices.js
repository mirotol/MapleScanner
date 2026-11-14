// The price database page: one list of items, and a card with everything about the one picked.
// Prices are decided in market.js. This page only picks which listings go in.
const $ = id => document.getElementById(id);
const HOUR_MS = 36e5, DAY_MS = 864e5;
const NOTE_MS = 6000;
const SHOW_ROWS = 50; // listings in the card before "Show all"
// The card's time chips, and the words for them in a label
const WINDOWS = [['1h', HOUR_MS, 'hour'], ['6h', 6 * HOUR_MS, '6 hours'], ['24h', DAY_MS, '24 hours'], ['3 days', 3 * DAY_MS, '3 days'], ['Week', 7 * DAY_MS, 'week'], ['30 days', 30 * DAY_MS, '30 days']];
const TABS = [['all', 'All'], ['equip', 'Equip'], ['use', 'Use'], ['setup', 'Setup'], ['etc', 'Etc'], ['cash', 'Cash']];
const STAT_LABELS = { attack: 'ATT', magic: 'M.ATT', wdef: 'W.Def', mdef: 'M.Def', str: 'STR', dex: 'DEX', int: 'INT', luk: 'LUK', hp: 'HP', mp: 'MP', accuracy: 'Acc', avoid: 'Avoid', speed: 'Speed', jump: 'Jump', crit: 'Crit', critDamage: 'Crit dmg', slots: 'Slots left' };

// The website (site/) shows this same page to everyone, with its own wording where the app's
// says "you".
const SITE = globalThis.PUBLIC_SITE === true;

let state = { items: [], aliases: {}, seen: {} };
let facts = itemFacts({}); // NPC prices, gear slots and item ids, from osms-items.json
let tab = 'all', group = null;
let card = null; // the open item: { name, history, win, show, sortBy, filter, statsOpen, all }

// An open card's address is a link to it. In the app's frame that's ?item=Iron Ore. On the
// website each item has a page of its own, /item/iron-ore, which the site's Worker answers with
// this page and that item's title and summary written in (site/items.js), so the title here is
// worded as it is there, and LIST_TITLE as in site/build.js.
const LIST_TITLE = 'MapleStory Classic Free Market prices · MapleScanner';
const itemAddress = name => (SITE ? `/item/${itemSlug(name)}` : `?item=${encodeURIComponent(name)}`);
// The item the address names, if it's one with listings
function addressItem() {
  const slug = SITE && /^\/item\/([^/]+)/.exec(location.pathname)?.[1];
  const name = slug ? state.items.find(i => itemSlug(i.name) === slug)?.name : new URLSearchParams(location.search).get('item');
  return name && itemOf(name) ? name : null;
}
// Shows `name`'s address, or the list's for none. On the website a card opened or closed is a
// step in the browser's history, so Back closes or reopens it (popstate, at the end).
function showAddress(name) {
  if (!SITE) return window.history.replaceState(null, '', name ? itemAddress(name) : location.pathname);
  const path = name ? itemAddress(name) : '/';
  document.title = name ? `${name} price · MapleStory Classic Free Market · MapleScanner` : LIST_TITLE;
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', location.origin + path);
  if (location.pathname === path && !location.search) return;
  // An old link (/?item=Iron Ore) becomes the new address in place
  window.history[location.search ? 'replaceState' : 'pushState'](null, '', path);
  $('itemSummary')?.remove(); // the server's words were for the item the page came with
}

const isGear = name => facts.slots(name) != null;
const itemOf = name => state.items.find(i => i.name === name);
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const ago = t => agoText(Date.now() - t);
// What one price is for: one item, or a whole set of throwing stars. Players know both, so only
// the card's heading says it.
const isSet = name => facts.recharges(name);
// A usual price's confidence as three dots (usualSource in market.js), with its level read out
// instead. Your own price has none.
const dotsTag = src => (src.level ? `<span class="dots" role="img" aria-label="${src.word}">${[1, 2, 3].map(i => `<i${i <= src.level ? ' class="on"' : ''}></i>`).join('')}</span>` : '');

// ---------- the list ----------

// Every word typed must be in the name. Names that start with it come first.
function matchRank(name, query) {
  const n = norm(name), words = norm(query).split(' ').filter(Boolean);
  if (!words.every(w => n.includes(w))) return -1;
  if (n.startsWith(words[0])) return 0;
  return n.split(' ').some(part => part.startsWith(words[0])) ? 1 : 2;
}

// A usual price under what an NPC pays is a loss to sell at, and it's still what was seen
// (Orihalcon Ore sold at 90 on every price site, Nov 12, while an NPC pays 100: cheap listings
// are bought to sell to the NPC, so the sales say 90). The price stays, with the NPC's beside it.
const underNpc = (usual, npc) => usual?.price != null && npc != null && usual.price < npc;

// An item's line: its usual price over every copy, and the cheapest ask of the last day.
// Gear too: a name mixes clean and scrolled copies, which the card's Stats filter separates.
function summarise(item) {
  const votes = state.seen[item.name];
  const usual = marketFor(votes);
  return {
    ...item,
    kind: facts.kind(item.name),
    usual,
    sure: usual?.price != null ? usualSource(usual, { gear: isGear(item.name) }) : null,
    low: cheaperElsewhere(votes, Infinity, { within: DAY_MS }),
  };
}
let rows = [];

// The list's columns. A header sorts by its column and a second click turns it round. The first
// click goes the usual way: most or newest first, the cheapest ask first, names A to Z. An item
// with no value for that column goes last either way.
const COLUMNS = [
  { key: 'name', label: 'Item', value: i => i.name, dir: 1 },
  { key: 'usual', label: 'Usual price', cls: 'num', value: i => i.usual?.price, dir: -1 },
  // the surest first, and among equals the one more sellers stand behind
  { key: 'sure', label: 'Price confidence', cls: 'sure', value: i => (i.sure?.level ? i.sure.level + Math.min(i.usual.from, 999) / 1000 : null), dir: -1 },
  { key: 'low', label: 'Cheapest ask, 24 h', cls: 'num', value: i => i.low?.u, dir: 1 },
  { key: 'listed', label: 'Listed', cls: 'num wide', value: i => i.listings - i.soldListings, dir: -1 },
  { key: 'sold', label: 'Sold', cls: 'num wide', value: i => i.soldListings, dir: -1 },
  { key: 'last', label: 'Last seen', cls: 'num', value: i => i.last, dir: -1 },
];
let sort = { key: 'last', dir: -1 };

// The lowest price confidence to show, 0 for any. One switch, Hide ●○○, makes it 2, like poe.ninja's
// "Show low confidence": a switch reads as a filter, where three choices beside the tabs read as
// more tabs. Most items are Thin (69% of the real list on Nov 9), so it starts off. Sorting by the
// column puts ●●● first.
let minSure = 0;
const sureEnough = (i, min = minSure) => !min || (i.sure?.level ?? 0) >= min;
const inTab = i => (tab === 'all' || i.kind.tab === tab) && (!group || i.kind.group === group);

function shownItems() {
  const q = $('search').value.trim();
  const list = rows.filter(i => inTab(i) && sureEnough(i) && (!q || matchRank(i.name, q) >= 0));
  const { value } = COLUMNS.find(c => c.key === sort.key);
  const compare = (a, b) => (typeof a === 'string' ? a.localeCompare(b) : a - b);
  list.sort((a, b) => {
    const x = value(a), y = value(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    return (x == null ? 0 : sort.dir * compare(x, y)) || (b.last ?? 0) - (a.last ?? 0);
  });
  if (q) list.sort((a, b) => matchRank(a.name, q) - matchRank(b.name, q)); // stable, so the sort holds within a rank
  return list;
}

function listHead() {
  return `<tr class="head">${COLUMNS.map(c => {
    const on = sort.key === c.key, way = sort.dir > 0 ? 'ascending' : 'descending';
    return `<th class="${c.cls ?? ''}${on ? ' sorted' : ''}"${on ? ` aria-sort="${way}"` : ''}><button class="colsort" data-col="${c.key}">${c.label}<span class="arrow" aria-hidden="true">${on ? (sort.dir > 0 ? '↑' : '↓') : ''}</span></button></th>`;
  }).join('')}</tr>`;
}

// On a phone the column headers are hidden, so the bar has a sort menu instead (prices.html),
// with a button to turn the order round. Both follow the headers' sort.
function showSort() {
  $('sortPick').value = sort.key;
  $('sortWay').textContent = sort.dir > 0 ? '↑' : '↓';
  $('sortWay').ariaLabel = $('sortWay').title = sort.dir > 0 ? 'Lowest first, tap for highest' : 'Highest first, tap for lowest';
}

// On a phone the tabs and type chips are rows that swipe sideways (prices.html). They're drawn
// again on every change, so this brings the chosen chip back into view, and leaves the row where
// it was when the chip is already showing.
function showChosen(row) {
  const on = row.querySelector('.chip.on');
  if (!on || row.scrollWidth <= row.clientWidth) return;
  const left = on.offsetLeft - row.offsetLeft, right = left + on.offsetWidth;
  if (left < row.scrollLeft) row.scrollLeft = left - 16;
  else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth + 32;
}

function renderList() {
  showSort();
  const q = $('search').value.trim();
  const searched = rows.filter(i => !q || matchRank(i.name, q) >= 0);
  const found = searched.filter(i => sureEnough(i));
  const tabSwiped = $('tabs').scrollLeft;
  $('tabs').innerHTML = TABS.map(([key, label]) => {
    const n = key === 'all' ? found.length : found.filter(i => i.kind.tab === key).length;
    if (!n && key !== tab && key !== 'all') return '';
    return `<button class="chip${tab === key ? ' on' : ''}" data-tab="${key}">${label}<small>${n}</small></button>`;
  }).join('');
  $('tabs').scrollLeft = tabSwiped;
  const groups = tab === 'all' ? [] : [...new Set(found.filter(i => i.kind.tab === tab).map(i => i.kind.group))].sort();
  const swiped = $('groups').scrollLeft;
  $('groups').innerHTML = groups.length > 1 ? groups.map(g => `<button class="chip${group === g ? ' on' : ''}" data-group="${esc(g)}">${esc(g)}<small>${found.filter(i => i.kind.tab === tab && i.kind.group === g).length}</small></button>`).join('') : '';
  $('groups').scrollLeft = swiped;
  showChosen($('tabs'));
  showChosen($('groups'));

  const shown = shownItems();
  if (!shown.length) {
    const here = searched.filter(inTab);
    const empty = !rows.length ? (SITE ? 'No prices yet. Shops scanned with MapleScanner appear here for everyone.' : 'No prices yet. Shops you and other players scan appear here for everyone.')
      : minSure && here.length ? 'Every price here is ●○○ so far. Turn off Hide ●○○ to see them.'
      : SITE ? 'No item matches. Only items seen in a shop are listed.' : 'No item matches. Names come from shops you\'ve opened.';
    $('list').innerHTML = `<tr><td class="empty">${empty}</td></tr>`;
    return;
  }
  $('list').innerHTML = listHead()
    + shown.map(i => {
      const s = i.sure;
      const npc = facts.npc(i.name);
      const usual = s ? `<b>${fmt(i.usual.price)}</b>${underNpc(i.usual, npc) ? `<span class="under wide">NPC pays ${fmt(npc)}</span>` : ''}` : '<span class="quiet">—</span>';
      const sure = s ? `<td class="sure level${s.level}" title="${esc(s.why)}">${dotsTag(s)}${esc(s.short)}</td>` : '<td class="sure"></td>';
      const low = i.low ? `${fmt(i.low.u)}<span class="under go">${esc(whereText(i.low) || 'place not known')}</span>` : '<span class="quiet">none</span>';
      // On a phone (prices.html) the row has no other columns: when it was last seen goes after
      // the kind, and under the price come the confidence, worded as in its column, and the
      // cheapest ask on a line of its own. Before (Nov 12) the dots stood before `ask 0.4`,
      // which read as the confidence's label.
      const seen = i.last ? `<span class="phone"> · ${ago(i.last)}</span>` : '';
      const under = `${s ? `<span class="phone under">${dotsTag(s)}${esc(s.short)}</span>` : ''
        }<span class="phone under">${i.low ? `cheapest ask ${fmt(i.low.u)}` : 'no ask'}</span>`;
      return `<tr class="item" data-name="${esc(i.name)}">
        <td class="item-name"><span class="named">${iconTag(facts.icon(i.name))}<span>${SITE ? `<a class="name" href="${itemAddress(i.name)}">${esc(i.name)}</a>` : `<span class="name">${esc(i.name)}</span>`}<span class="kind">${esc(i.kind.kind)}${seen}</span></span></span></td>
        <td class="num usual">${usual}${under}</td>
        ${sure}
        <td class="num ask">${low}</td>
        <td class="num wide">${(i.listings - i.soldListings).toLocaleString('en-US')}</td>
        <td class="num wide">${i.soldListings.toLocaleString('en-US')}</td>
        <td class="num quiet seen">${i.last ? ago(i.last) : '—'}</td></tr>`;
    }).join('');
}

// ---------- the item card ----------

// The card's listings as votes for market.js (historyVotes there)
const votesOf = (name, history) => historyVotes(name, history, facts);

const filterOn = f => !!f && (f.clean || Object.keys(f.range).length > 0);
const showing = (v, show) => (show === 'sold' ? v.sold : !v.gone && (show === 'all' || !v.sold));

async function openCard(name) {
  const history = await api(`/api/history?name=${encodeURIComponent(name)}`);
  const votes = votesOf(name, history);
  // Open on asks, unless there are none, and on the shortest time from 24 hours up that has some
  const show = votes.some(v => showing(v, 'listed')) ? 'listed' : 'all';
  const win = WINDOWS.slice(2).find(([, ms]) => votes.some(v => showing(v, show) && Date.now() - v.t <= ms))?.[1] ?? DAY_MS;
  lastChart = null; // an opened card always draws its chart in
  card = { name, history, win, show, sortBy: null, filter: null, statsOpen: false, all: false };
  renderCard(true);
  // An opening dialog focuses its first button, the ×, which then wore the focus ring as if
  // chosen (Nov 12). The card takes the focus itself, and Tab still goes to the × first.
  if (!$('card').open) { $('card').showModal(); $('card').focus(); }
  showAddress(name); // so the address is a link to this item
}

function statChips(name, stats) {
  if (!stats) return '<span class="quiet">—</span>';
  const base = facts.base(name) ?? {};
  const chips = Object.keys(STAT_LABELS).filter(k => k !== 'slots' && ((stats[k] ?? 0) || base[k])).map(k => {
    const gap = (stats[k] ?? 0) - (base[k] ?? 0);
    return `<span class="stat">${STAT_LABELS[k]} ${stats[k] ?? 0}${gap ? ` <span class="${gap > 0 ? 'up' : 'down'}">${gap > 0 ? '+' : '−'}${Math.abs(gap)}</span>` : ''}</span>`;
  });
  return chips.join('') + `<span class="stat">Slots ${stats.slots ?? '?'}/${facts.slots(name) ?? '?'}</span>`;
}

// A phone's width (prices.html draws the list and card differently there). The card is drawn
// again when it changes, for the chart's width.
const PHONE = matchMedia('(max-width: 560px)');
PHONE.addEventListener('change', () => renderCard());

// The chart's frame: a price scale fitted to `prices` (chartRange), round time
// marks (timeTicks), and the usual price and what an NPC pays as lines when they're on it.
function chartFrame(name, prices, usual, span) {
  const now = Date.now(), npc = facts.npc(name);
  // A phone draws the chart narrower, so its words aren't shrunk to a few pixels with it
  const W = PHONE.matches ? 380 : 900, H = PHONE.matches ? 210 : 230, L = 52, R = 14, T = 12, B = 26;
  const { lo, hi, step } = chartRange(prices, usual?.price ?? null);
  const x = t => L + (W - L - R) * (1 - (now - t) / span);
  const y = p => +(T + (H - T - B) * (1 - (Math.min(Math.max(p, lo), hi) - lo) / (hi - lo))).toFixed(1);
  let svg = '';
  for (let v = lo; v <= hi + step / 2; v += step) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  for (const { t, label } of timeTicks(now, span)) {
    svg += `<line class="grid day" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${label}</text>`;
  }
  svg += `<text x="${W - R}" y="${H - 6}" text-anchor="end">now</text>`;
  const npcShown = npc != null && npc >= lo && npc <= hi;
  if (npcShown) svg += `<line class="npc" x1="${L}" x2="${W - R}" y1="${y(npc)}" y2="${y(npc)}"/>`;
  if (usual?.price != null) svg += `<line class="usual" x1="${L}" x2="${W - R}" y1="${y(usual.price)}" y2="${y(usual.price)}"/>`;
  const lines = [usual?.price != null ? '<span><i class="l-usual"></i>Usual price</span>' : '', npcShown ? '<span><i class="l-npc"></i>NPC pays</span>' : ''].join('');
  const draw = (legend, marks) => `<div class="legend">${legend}${lines}</div><div class="plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Prices over time">${svg}${marks}</svg><div class="chart-tip" hidden></div></div>`;
  return { x, y, lo, hi, top: T, bottom: H - B, width: W, height: H, draw };
}

// The card's one chart (Nov 14, when the view with every listing as a dot went: the table under
// it has them all). What sold and what was asked over time, so a slow rise shows. Straight
// lines between points, because a smoothed curve draws prices nobody saw, broken where 3 points'
// time passes with none. The lines follow Asking, Sold and Both like the table does, and the
// shaded band, where the middle half of sellers sold, goes with the sold line. With no point to
// draw there's no chart, only a line saying so.
// The chart covers the time chip picked. From a week up there's a point a day, from the 3 days
// to it (dailyPrices in market.js), the usual price's own window. Under a week that would be a
// dot or two, so points come closer and look back less far (steppedPrices): how often, how far
// back, and that in words. Each point still needs 5 named sellers.
const MIN_MS = 6e4;
const TREND_STEPS = new Map([
  [HOUR_MS, [10 * MIN_MS, 30 * MIN_MS, '30 minutes']],
  [6 * HOUR_MS, [30 * MIN_MS, 2 * HOUR_MS, '2 hours']],
  [DAY_MS, [2 * HOUR_MS, 6 * HOUR_MS, '6 hours']],
  [3 * DAY_MS, [6 * HOUR_MS, DAY_MS, '24 hours']],
]);
const clockText = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const TREND_LINES = [['sold', 'Sold, middle of sales', 'sold'], ['ask', 'Asking, low end', 'listed']];
let trend = null; // what the chart on show was drawn from, for its tooltip (wireChart)
// What the last chart drawn showed. The card is drawn again for every click in it, and the
// chart only draws itself in (.fresh in prices.html) when it's another chart than before: a new
// item, time, Asking or Sold, or Stats filter, not a sort of the table under it.
let lastChart = null;

function trendHtml(name, votes, usual, win, show) {
  const now = Date.now(), span = win;
  const [step, look, words] = TREND_STEPS.get(win) ?? [DAY_MS, 3 * DAY_MS, '3 days'];
  const points = TREND_STEPS.has(win)
    ? steppedPrices(votes, { now, step, look }).map(p => ({ ...p, label: `${dateText(p.t)}, ${clockText(p.t)}` }))
    : dailyPrices(votes, { now }).map(d => ({ ...d, t: Math.min(now, d.day + DAY_MS / 2), label: dateText(d.day) }));
  const series = TREND_LINES.filter(([, , only]) => show === 'all' || show === only);
  const shown = points.filter(p => now - p.t <= span && series.some(([key]) => p[key]));
  trend = null;
  const drawn = [name, win, show, votes.length].join('|'), fresh = drawn !== lastChart;
  lastChart = drawn;
  if (!shown.length) return `<p class="quiet no-trend">Not enough sellers for a trend yet. A point needs 5 of them within ${words}.</p>`;
  const withSold = series.some(([key]) => key === 'sold');
  const f = chartFrame(name, shown.flatMap(d => series.flatMap(([key]) => (key === 'sold' ? [d.sold?.price, d.sold?.low, d.sold?.high] : [d.ask?.price]))).filter(p => p != null), usual, span);
  const joined = (a, b) => b.t - a.t <= 3 * step + HOUR_MS; // an hour over, for the day the clocks change
  let marks = '', band = false;
  // The band first, so the lines are drawn over it: one shape for each unbroken run of points
  const sold = withSold ? shown.filter(d => d.sold) : [];
  for (let i = 0; i < sold.length;) {
    let j = i;
    while (j + 1 < sold.length && joined(sold[j], sold[j + 1])) j++;
    const run = sold.slice(i, j + 1);
    if (run.length > 1 && run.some(d => d.sold.high > d.sold.low)) {
      band = true;
      const edge = (list, key) => list.map(d => `${f.x(d.t).toFixed(1)} ${f.y(d.sold[key])}`).join(' L');
      marks += `<path class="trend-band" d="M${edge(run, 'high')} L${edge([...run].reverse(), 'low')} Z"/>`;
    }
    i = j + 1;
  }
  for (const [key] of series) {
    const points = shown.filter(d => d[key]);
    let path = '';
    points.forEach((p, j) => { path += `${j && joined(points[j - 1], p) ? 'L' : 'M'}${f.x(p.t).toFixed(1)} ${f.y(p[key].price)}`; });
    marks += `<path class="trend ${key}" pathLength="1" d="${path}"/>`;
    for (const p of points) marks += `<circle class="trend-dot ${key}" cx="${f.x(p.t).toFixed(1)}" cy="${f.y(p[key].price)}" r="3"/>`;
  }
  marks += `<line class="trend-guide" y1="${f.top}" y2="${f.bottom}" visibility="hidden"/>`;
  const legend = series.filter(([key]) => shown.some(d => d[key])).map(([key, label]) => `<span><i class="l-trend ${key}"></i>${label}</span>`).join('')
    + (band ? '<span><i class="l-band"></i>Half of the sellers sold in here</span>' : '');
  trend = { days: shown.map(d => ({ ...d, x: f.x(d.t) })), series: series.map(([key]) => key), width: f.width, words };
  return `<div class="chart${fresh ? ' fresh' : ''}">${f.draw(legend, marks)}</div>`;
}

// One point of the trend, for the tooltip, with the time its sellers were counted over.
function tipHtml(d) {
  const row = (key, label, p, more) => (p && trend.series.includes(key)
    ? `<span class="row"><i class="l-trend ${key}"></i>${label} <b>${fmt(p.price)}</b></span><small>${more}${p.sellers} sellers in ${trend.words}</small>` : '');
  return `<b class="day">${d.label}</b>${
    row('sold', 'Sold', d.sold, d.sold && d.sold.high > d.sold.low ? `${fmt(d.sold.low)} to ${fmt(d.sold.high)}, ` : '')}${
    row('ask', 'Asking', d.ask, '')}`;
}

// A small tooltip follows the pointer, or a tap, as on stock charts: the nearest day with a
// point gets a thin line and its figures beside it. Placed by percentages of the chart, so the
// page's zoom (Text size) doesn't move it. The card isn't drawn again for it.
function wireChart() {
  const plot = $('card').querySelector('.chart .plot');
  if (!plot || !trend) return;
  const svg = plot.querySelector('svg'), guide = svg.querySelector('.trend-guide'), tip = plot.querySelector('.chart-tip');
  const hide = () => { tip.hidden = true; guide.setAttribute('visibility', 'hidden'); };
  const follow = e => {
    const box = svg.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width * trend.width;
    const d = trend.days.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
    guide.setAttribute('x1', d.x.toFixed(1)); guide.setAttribute('x2', d.x.toFixed(1)); guide.setAttribute('visibility', 'visible');
    tip.innerHTML = tipHtml(d);
    tip.hidden = false;
    // beside the line, on the side with more room, and level with the pointer
    // and never past the chart's bottom, which is short in a narrow window
    const room = Math.max(0, 1 - tip.offsetHeight / plot.offsetHeight);
    const left = d.x / trend.width, top = Math.min(Math.max((e.clientY - box.top) / box.height, 0), room);
    tip.classList.toggle('flip', left > 0.55);
    tip.style.left = `${(left * 100).toFixed(2)}%`;
    tip.style.top = `${(top * 100).toFixed(2)}%`;
  };
  svg.addEventListener('pointermove', follow);
  svg.addEventListener('pointerdown', follow);
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
}

function statsHtml(name, votes) {
  const f = card.filter ?? { clean: false, range: {} };
  const read = votes.filter(v => v.stats);
  const bounds = statBounds(read.map(v => v.stats), facts.base(name));
  const ranges = bounds.map(({ key, lo, hi }) => {
    const [from, to] = f.range[key] ?? [lo, hi];
    return `<div class="range"><span>${STAT_LABELS[key]}</span><input type="number" data-stat="${key}" data-end="0" value="${from}" aria-label="${STAT_LABELS[key]} from"><i>–</i><input type="number" data-stat="${key}" data-end="1" value="${to}" aria-label="${STAT_LABELS[key]} to"></div>`;
  }).join('');
  const on = filterOn(card.filter);
  const label = on ? (f.clean && !Object.keys(f.range).length ? 'Stats · clean' : 'Stats · filtered') : 'Stats';
  return `<div class="statpop"><button class="statbtn${on ? ' on' : ''}" data-do="toggleStats" aria-expanded="${card.statsOpen}">${label} ▾</button>
    <div class="pop"${card.statsOpen ? '' : ' hidden'}>
      <label class="toggle"><span>Clean only<small>No upgrade slot used</small></span><input type="checkbox" role="switch" data-do="clean"${f.clean ? ' checked' : ''}></label>
      ${read.length ? ranges : '<p class="quiet">No stats read yet. Hover gear in a shop and its stats are saved.</p>'}
      <div class="foot"><span>${plural(votes.filter(v => !v.stats && Date.now() - v.t <= card.win).length, 'listing')} without read stats, in this time</span><button data-do="clearStats">Clear</button></div>
    </div></div>`;
}

function rowsHtml(name, list, order) {
  const gear = isGear(name), set = facts.recharges(name);
  const visible = card.all ? list : list.slice(0, SHOW_ROWS);
  const head = `<tr class="head"><th class="sortable${order === 'when' ? ' sorted' : ''}" data-sort="when">When${order === 'when' ? ' ↓' : ''}</th><th>Where</th><th>Seller</th>${gear ? '<th>Stats</th>' : ''}<th class="num sortable${order === 'price' ? ' sorted' : ''}" data-sort="price">Price${order === 'price' ? ' ↑' : ''}</th></tr>`;
  const body = visible.map(v => {
    const each = set ? `1 set of ${v.qty.toLocaleString('en-US')}` : !gear && v.qty > 1 ? `each, ${v.qty.toLocaleString('en-US')} for ${fmt(v.price)}` : '';
    const copies = v.copies > 1 ? `${v.copies} copies` : '';
    const under = [each, copies].filter(Boolean).join(', ');
    return `<tr class="${v.sold ? 'sold' : ''}">
      <td class="when">${ago(v.t)}</td>
      <td class="where${whereText(v) ? '' : ' unknown'}">${esc(whereText(v)) || 'not known'}</td>
      <td class="seller">${esc(v.s || 'Unknown')}${v.shop ? `<small title="${esc(v.shop)}">${esc(v.shop)}</small>` : ''}</td>
      ${gear ? `<td class="stats">${statChips(name, v.stats)}</td>` : ''}
      <td class="num price">${v.sold ? '<span class="badge">sold</span>' : ''}${fmt(v.u)}${under ? `<small>${under}</small>` : ''}</td></tr>`;
  }).join('');
  const more = list.length > visible.length ? `<button class="more" data-do="showAll">Show all ${list.length.toLocaleString('en-US')}</button>` : '';
  return `<div class="wrap"><table class="rows">${head}${body}</table></div>${more}`;
}

function cardHtml() {
  const { name, win, show, filter } = card;
  const gear = isGear(name), npc = facts.npc(name), kind = facts.kind(name), set = isSet(name);
  const all = votesOf(name, card.history);
  const kept = all.filter(v => passesStats(v.stats, filter, facts.slots(name)));
  const usual = marketFor(kept);
  const now = Date.now(), inWin = kept.filter(v => now - v.t <= win);
  const winWords = WINDOWS.find(([, ms]) => ms === win)[2];
  const inLast = `last ${winWords}`;
  const low = cheaperElsewhere(kept, Infinity, { within: win });
  const lastSold = kept.filter(v => v.sold).sort((a, b) => b.t - a.t)[0];
  const seen = inWin.map(v => v.u);

  // A price far below the usual can be another item or a scam, like 4 stars sold as a set.
  // Gear only gets that warning once Stats compares like with like.
  const check = low && usual && (!gear || filterOn(filter)) && verdict({ unit: low.u }, usual, npc).label === 'check'
    ? ' <span class="tag warn" title="Far below the usual price. Check it\'s the same item.">check item</span>' : '';
  const src = usual?.price != null ? usualSource(usual, { gear: gear && !filterOn(filter) }) : null;
  const usualFig = src
    ? `<div class="fig main"><span>Usual price, ${set ? 'a set' : 'each'}</span><b>${fmt(usual.price)}</b><span>${
      usual.from ? plural(usual.from, 'seller') : 'sellers not read'} · ${usual.days} days${gear && !filterOn(filter) ? ' · every condition' : ''}</span>${underNpc(usual, npc) ? `<span class="npc-more">An NPC pays more: ${fmt(npc)}</span>` : ''}</div>`
    : '<div class="fig main"><span>Usual price</span><b class="dim">not enough yet</b></div>';
  // The card is where a curious player looks, so the reasoning is written out, not on a hover
  const sureFig = src?.level
    ? `<div class="fig sure level${src.level}"><span>Price confidence</span><b>${dotsTag(src)}${esc(src.short)}</b><span class="why">${esc(src.why)}</span></div>` : '';
  // The cheapest ask stays second, as the answer a buyer came for, so confidence comes after it
  const lowFig = low ? `<div class="fig ask"><span>Cheapest ask, ${inLast}</span><b>${fmt(low.u)}${check}</b><span class="go">${esc(whereText(low) || 'place not known')}, ${ago(low.t)}</span></div>`
    : `<div class="fig ask"><span>Cheapest ask, ${inLast}</span><b class="dim">none seen</b></div>`;
  const figures = [
    usualFig,
    lowFig,
    sureFig,
    lastSold ? `<div class="fig"><span>Last sold</span><b>${fmt(lastSold.u)}</b><span>${ago(lastSold.t)}</span></div>` : '',
    seen.length > 1 ? `<div class="fig"><span>Seen, ${inLast}</span><b>${fmt(Math.min(...seen))} to ${fmt(Math.max(...seen))}</b></div>` : '',
  ].join('');
  const factLine = [kind.kind, gear ? `${facts.slots(name)} slots` : null, facts.recharges(name) ? 'priced per set' : null, npc != null ? `NPC pays ${fmt(npc)}` : null].filter(Boolean).join(' · ');

  const list = inWin.filter(v => showing(v, show));
  const order = card.sortBy || (show === 'listed' ? 'price' : 'when');
  list.sort(order === 'price' ? (a, b) => a.u - b.u || b.t - a.t : (a, b) => b.t - a.t);
  const leftOut = filterOn(filter) ? all.filter(v => !v.stats && now - v.t <= win).length : 0;
  const heading = { listed: 'Asking', sold: 'Sold', all: 'Every listing and sale' }[show];

  const who = `<div class="who">${iconTag(facts.icon(name))}<div><h2>${esc(name)}</h2><p>${esc(factLine)}</p></div></div>`;
  const close = '<button class="close" data-do="close" aria-label="Close">×</button>';

  // On a phone only the item and the × stay in a bar at the top while the rest of the card,
  // prices too, scrolls under it (prices.html), and the head leaves the item and × out.
  return `<div class="card-bar">${who}${close}</div>
    <div class="card-head">
      ${who}
      <div class="figures">${figures}</div>
      ${close}
    </div>
    <div class="card-body">
      <p class="note card-note" role="status"></p>
      <div class="card-controls">
        <div class="seg" role="group" aria-label="Time">${WINDOWS.map(([label, ms]) => `<button class="${ms === win ? 'on' : ''}" data-win="${ms}">${label}</button>`).join('')}</div>
        <div class="seg" role="group" aria-label="Which listings">${[['listed', 'Asking'], ['sold', 'Sold'], ['all', 'Both']].map(([key, label]) => `<button class="${key === show ? 'on' : ''}" data-show="${key}">${label}</button>`).join('')}</div>
        <span class="spacer"></span>${gear ? statsHtml(name, all) : ''}
      </div>
      ${leftOut ? `<p class="left-out">${plural(leftOut, 'listing')} without read stats ${leftOut === 1 ? 'is' : 'are'} left out while Stats is on.</p>` : ''}
      ${trendHtml(name, kept, usual, win, show)}
      <div class="rows-head"><h3>${heading}</h3><span>${plural(list.length, 'listing')}, ${inLast}${order === 'price' ? ', cheapest first' : ', newest first'}</span>
        <div class="seg phone-sort" role="group" aria-label="Order">${[['when', 'Newest'], ['price', 'Cheapest']].map(([key, label]) => `<button class="${key === order ? 'on' : ''}" data-sort="${key}">${label}</button>`).join('')}</div></div>
      ${list.length ? rowsHtml(name, list, order) : '<p class="quiet">Nothing in this time and these filters.</p>'}
    </div>`;
}

// Redraws the card in place, keeping where it was scrolled to.
function renderCard(fresh = false) {
  if (!card) return;
  // on a phone the whole card scrolls (prices.html), elsewhere the part under its top
  const scroller = () => (PHONE.matches ? $('card') : $('card').querySelector('.card-body'));
  const scroll = fresh ? 0 : scroller()?.scrollTop ?? 0;
  $('card').innerHTML = cardHtml();
  scroller().scrollTop = scroll;
  wireChart();
}

// Every item ever listed comes from the shared price database (`full`), with the recent listings
// the local server keeps in memory. Offline, it shows what it had and says so.
async function reload() {
  state = await api('/api/state?full');
  rows = state.items.filter(i => i.listings > 0).map(summarise);
  if (card && !itemOf(card.name)) closeCard();
  if (card) { card.history = await api(`/api/history?name=${encodeURIComponent(card.name)}`); renderCard(); }
  renderList();
  const { status } = state;
  if (!status.connected) say('No price server is set, so there are no prices.', true);
  else if (status.online === false) say("Offline: can't reach the price server, so these are the prices from before the connection dropped.", true);
}

function closeCard() {
  card = null;
  if ($('card').open) $('card').close();
}

// A result fades after a while. An error stays until the next action. With the card open,
// it shows in the card, since the list is behind it.
let noteTimer = null;
function say(text, stays = false) {
  clearTimeout(noteTimer);
  const notes = [$('note'), $('card').querySelector('.card-note')].filter(Boolean);
  for (const n of notes) n.textContent = text;
  if (!stays) noteTimer = setTimeout(() => { for (const n of [$('note'), $('card').querySelector('.card-note')].filter(Boolean)) n.textContent = ''; }, NOTE_MS);
}

const actions = {
  close: closeCard,
  toggleStats() { card.statsOpen = !card.statsOpen; renderCard(); },
  clearStats() { card.filter = null; renderCard(); },
  showAll() { card.all = true; renderCard(); },
};

// ---------- events ----------

// The column headers stick under the search bar, which is taller when it wraps or shows a note.
// Its exact height, not offsetHeight's whole pixels, or the list shows through the gap.
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${$('topbar').getBoundingClientRect().height}px`)).observe($('topbar'));

// A new search, tab or sort is a different list, so it starts from its top rather than
// wherever the old one was scrolled to. The time-based redraws (reload) keep their place.
function newList() {
  renderList();
  window.scrollTo(0, 0);
}

// The X shows only while there's something to clear.
function clearSearch() {
  $('search').value = '';
  $('clearSearch').hidden = true;
  newList();
}
$('search').addEventListener('input', () => { $('clearSearch').hidden = !$('search').value; newList(); });
$('search').addEventListener('keydown', e => {
  if (e.key === 'Enter' && shownItems()[0]) openCard(shownItems()[0].name).catch(err => say(err.message, true)); // Enter opens the best match
  if (e.key === 'Escape') clearSearch();
});
$('clearSearch').addEventListener('click', () => { clearSearch(); $('search').focus(); });
$('list').addEventListener('click', e => {
  const col = e.target.closest('[data-col]');
  if (col) {
    const c = COLUMNS.find(c => c.key === col.dataset.col);
    sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : c.dir };
    newList();
    $('list').querySelector(`[data-col="${c.key}"]`)?.focus(); // the header was drawn again, so keep a keyboard user's place
    return;
  }
  const row = e.target.closest('tr.item');
  if (!row) return;
  // On the website the name is a link to the item's page: Ctrl or Shift click opens it as one
  if (e.target.closest('a')) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
  }
  openCard(row.dataset.name).catch(err => say(err.message, true));
});
$('tabs').addEventListener('click', e => {
  const chip = e.target.closest('[data-tab]');
  if (!chip) return;
  tab = chip.dataset.tab;
  group = null;
  $('groups').scrollLeft = 0; // another tab's types start from their first
  newList();
});
// the phone's sort menu: a new column goes its usual way first, like a header's first click
$('sortPick').innerHTML = COLUMNS.map(c => `<option value="${c.key}">${c.label}</option>`).join('');
$('sortPick').addEventListener('change', e => {
  sort = { key: e.target.value, dir: COLUMNS.find(c => c.key === e.target.value).dir };
  newList();
});
$('sortWay').addEventListener('click', () => {
  sort = { ...sort, dir: -sort.dir };
  newList();
});
$('hideThin').addEventListener('change', e => {
  minSure = e.target.checked ? 2 : 0;
  newList();
});
$('groups').addEventListener('click', e => {
  const chip = e.target.closest('[data-group]');
  if (!chip) return;
  group = group === chip.dataset.group ? null : chip.dataset.group;
  newList();
});

// A click on the dimmed page around the card closes it. Only a press that started there
// counts, so selecting text in the card and letting go outside doesn't.
const cardEl = $('card');
let pressedOutside = false;
cardEl.addEventListener('pointerdown', e => { pressedOutside = e.target === cardEl; });
cardEl.addEventListener('click', e => {
  if (e.target === cardEl) { if (pressedOutside) closeCard(); return; }
  const el = e.target.closest('[data-win],[data-show],[data-sort],button[data-do]');
  // The Stats panel closes on a click anywhere else in the card
  if (card?.statsOpen && !e.target.closest('.statpop')) { card.statsOpen = false; if (!el) return renderCard(); }
  if (!el) return;
  if (el.dataset.win) { card.win = Number(el.dataset.win); card.all = false; return renderCard(); }
  if (el.dataset.show) { card.show = el.dataset.show; card.sortBy = null; card.all = false; return renderCard(); }
  if (el.dataset.sort) { card.sortBy = el.dataset.sort; return renderCard(); }
  actions[el.dataset.do]?.(el);
});
cardEl.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.do !== 'clean' && !el.dataset.stat) return;
  const f = card.filter ?? { clean: false, range: {} };
  if (el.dataset.do === 'clean') f.clean = el.checked;
  else {
    const read = votesOf(card.name, card.history).filter(v => v.stats).map(v => v.stats);
    const bound = statBounds(read, facts.base(card.name)).find(b => b.key === el.dataset.stat);
    const range = f.range[bound.key] ?? [bound.lo, bound.hi];
    range[Number(el.dataset.end)] = Number(el.value);
    if (range[0] <= bound.lo && range[1] >= bound.hi) delete f.range[bound.key];
    else f.range[bound.key] = range;
  }
  card.filter = filterOn(f) ? f : null;
  renderCard();
});
cardEl.addEventListener('close', () => { card = null; showAddress(null); });
// Back and Forward on the website: the card follows the address
if (SITE) window.addEventListener('popstate', () => {
  const name = addressItem();
  if (name) openCard(name).catch(err => say(err.message, true));
  else { closeCard(); showAddress(null); }
});

api('osms-items.json').then(async list => {
  facts = itemFacts(list);
  await reload();
  // A link to one item (?item=Iron Ore, or /item/iron-ore on the website) opens its card
  const linked = addressItem();
  if (linked) await openCard(linked);
}).catch(err => say(err.message, true));

window.reload = reload; // the Prices tab calls this each time it's opened
