// Name matching, price rules and small helpers. Used by both pages and by the server.
const SEEN_DAYS = 14;

const norm = s => s.toLowerCase().replace(/[-_/]/g, ' ').replace(/[^a-z0-9% ]/g, '').replace(/\s+/g, ' ').trim();

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j), cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

// Numbers must match exactly (10% and 60% are different items), and short words
// can't change at all (INT and LUK, Mokbi and Wolbi are different items).
const wordClose = (a, b, loose) => {
  if (a === b) return true;
  if (/\d/.test(a + b)) return false;
  const off = lev(a, b) / Math.max(a.length, b.length);
  return loose ? off <= 0.25 : off < 0.25;
};

// Could `name` be a misread of `target`? With `cut`, name is the start of a longer name.
function sameItem(name, target, cut = false, loose = false) {
  let a = norm(name).split(' '), b = norm(target).split(' ');
  if (a.join('') === b.join('')) return true;
  if (cut) {
    if (a.length > b.length) return false;
    b = b.slice(0, a.length);
    b[b.length - 1] = b[b.length - 1].slice(0, a[a.length - 1].length);
  } else if (a.length > b.length && a[a.length - 1].length <= 2 && !/\d/.test(a[a.length - 1])) {
    a = a.slice(0, -1); // a stray mark read after the name
  }
  return a.length === b.length && a.every((w, i) => wordClose(w, b[i], loose));
}

// A shop cuts off long scroll names, but the icon colour gives the tier: orange
// Intermediate, yellow Greater, blue Lesser, grey Chaos. Hues near the border between
// orange and yellow are left unknown rather than guessed. A sold row's icon fades but
// keeps its hue, so it needs less colour. A faded grey has no hue left to tell it by.
const SCROLL_TIERS = ['Lesser', 'Intermediate', 'Greater', 'Chaos'];

function tierFromIcon({ hue, sat, colouredShare, grayShare }, sold = false) {
  if (colouredShare >= 0.15 && sat >= (sold ? 0.1 : 0.3)) {
    if (hue >= 190 && hue <= 250) return 'Lesser';
    if (hue <= 28 || hue >= 350) return 'Intermediate';
    if (hue >= 33 && hue <= 60) return 'Greater';
    return null;
  }
  return !sold && grayShare >= 0.15 ? 'Chaos' : null;
}

// The real name behind a read, or null. An exact match wins, otherwise exactly one
// name must be close: two would be a guess. A read that's no real name and close to
// none gets one more try that lets a four-letter word be a letter off, as the game's
// S can read as o ("otar Earrings"). A cut-off read is never exact, because more of
// the name is hidden, and it isn't given that try. names must be unique once normalised.
function matchName(read, names, cut = false) {
  if (!cut) {
    const q = norm(read), exact = names.find(n => norm(n) === q);
    if (exact) return exact;
  }
  let close = names.filter(n => sameItem(read, n, cut));
  if (!close.length && !cut) close = names.filter(n => sameItem(read, n, false, true));
  return close.length === 1 ? close[0] : null;
}

// Does a name begin with this read? A space can be lost ("One-Handed BluntWeap...").
const squeezed = s => norm(s).replace(/ /g, '');
const startsName = (start, name) => squeezed(name).startsWith(squeezed(start));

// The whole name of a cut-off read, when only one name starts with it, or only one
// has the icon's tier. Otherwise it stays unknown. A long word can be a letter off, as
// in a whole name ("Crosshow Attack Scr..." for Crossbow).
function completeName(read, iconTier, names) {
  const fits = names.filter(n => startsName(read, n) || sameItem(read, n, true));
  const tiered = iconTier ? fits.filter(n => n.endsWith(`: ${iconTier}`)) : [];
  if (tiered.length === 1) return tiered[0];
  return fits.length === 1 ? fits[0] : null;
}

// The full name of a cut-off scroll. What's left of the tier in the text comes
// first ("Earring LUK Scroll: Inter..."), then the icon's tier. The I of Intermediate
// can read as | or l ("Crossbow Attack Scroll: |..."), so a stroke that could be I or L
// only names a tier the icon agrees with, and is left unknown when the icon doesn't.
function fullScrollName(name, iconTier) {
  // only the kind with a tier: nothing may follow "Scroll" but a colon and the tier,
  // so "Return Scroll to Sleepywo..." doesn't count
  const m = name.match(/^(.*?\bScroll)(?:\s*[:;]\s*([A-Za-z|!1]*))?\s*[.…:;]*$/i);
  if (!m) return null;
  const read = (m[2] ?? '').toLowerCase();
  const ways = /^[|!1l]/.test(read) ? ['i', 'l'].map(c => c + read.slice(1)) : [read];
  const fits = read ? SCROLL_TIERS.filter(t => ways.some(w => t.toLowerCase().startsWith(w))) : [];
  const tier = fits.length === 1 ? fits[0] : fits.length ? (fits.includes(iconTier) ? iconTier : null) : iconTier;
  return tier ? `${m[1]}: ${tier}` : null;
}

// The real item behind a tooltip's title. A title can end in a gender mark, or a "(+3)" so
// orange it reads as "(IV) (#1)" or "[1", so those endings are dropped until a name fits.
function knownTitle(read, known) {
  for (let name = read, shorter; ; name = shorter) {
    const hit = known(name);
    if (hit) return hit;
    shorter = name.replace(/\s*[([{][^()[\]{}]*[)\]}]?\s*$/, '');
    if (shorter === name || !shorter) return null;
  }
}

const MAX_FM_ROOM = 20;

// What the minimap shows: two lines (street, map) or one ("Hidden Street : Free Market <1>").
function parseMap(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  // the minimap always gives a street and a map, so one line alone needs its colon
  if (lines.length === 1 && !lines[0].includes(':')) return null;
  const name = (lines.length > 1 ? lines[lines.length - 1] : lines[0].split(':').pop()).trim();
  const room = name.match(/^(.*?)\s*[<(]?\s*([\dIl|]{1,2})\s*[>)]?\W*$/);
  if (room && sim(norm(room[1]), 'free market') >= 0.75) {
    const number = parseInt(room[2].replace(/[Il|]/g, '1'), 10);
    return number >= 1 && number <= MAX_FM_ROOM ? { map: 'Free Market', room: number } : null;
  }
  if (norm(name).length <= 16 && sim(norm(name), 'free market') >= 0.5) return null; // a garbled room: better unknown
  const clean = name.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z0-9)']+$/, '');
  const looksLikeAMap = /^[A-Za-z0-9' .&()-]+$/.test(clean) && /[A-Za-z]{3}/.test(clean);
  return looksLikeAMap ? { map: clean, room: null } : null;
}

// The expanded minimap's bold white letters confuse the reader, unless it's told the
// line can only be a Free Market room. Anything else won't read as one, and is read normally.
const FM_LETTERS = 'FreMakt<>0123456789 ';
function parseFmRoom(text) {
  const m = text.trim().match(/^Fre+\s*[Makret]+\s*<?\s*(\d{1,2})\s*>?$/);
  const number = m ? parseInt(m[1], 10) : 0;
  return number >= 1 && number <= MAX_FM_ROOM ? { map: 'Free Market', room: number } : null;
}

// Where a shop is, as short as it can be said: "CH.4 · FM 1" or "CH.4 · Kerning City".
const whereText = ({ channel, map, room }) => [channel ? `CH.${channel}` : null, room ? `FM ${room}` : map].filter(Boolean).join(' ');

// Follows the Change Channel window, the only place the channel is on screen. A newly
// picked channel only counts once the loading screen shows, because the window can also be
// cancelled. With the keyboard a pick and its confirm take less than one frame, so the pick
// is often never seen (test/recordings in CLAUDE.md), and sometimes not even the window.
// So the window followed by a loading screen means a change to a channel that wasn't seen,
// and a loading screen that ends on the same map means the same: both leave it unknown. A
// Cash Shop trip looks like that too, which only costs opening the window once. Changing
// map is a loading screen that says nothing. The watch sees the loading screen within a
// frame, but a full scan reads the map from a frame taken before its slow read began, so a
// map only counts as arrived at when its frame came after the loading screen ended. Before,
// the last frames of the old map, read late, looked like arriving back on it.
function channelFollower(waitMs) {
  let channel = null, open = false, picked = null, until = 0, loading = false, leftFrom = null, loadedAt = 0;
  return {
    get channel() { return channel; },
    get watching() { return open || until > 0; },
    // a loading screen with nothing to explain it: the map it ends on tells a portal from a channel
    get needsPlace() { return leftFrom !== null && !loading; },
    see(res, now, place) {
      const seen = res?.channelWindow;
      if (seen) {
        if (seen.current) channel = seen.current;
        else if (!open) channel = seen.picked;
        picked = seen.picked;
        open = true;
        until = 0;
        leftFrom = null;
        return;
      }
      if (open) { open = false; until = now + waitMs; }
      if (!res?.dark) {
        if (loading) loadedAt = now;
        loading = false;
        if (now > until) until = 0;
        return;
      }
      if (loading) return; // one loading screen lasts many scans
      loading = true;
      if (until) channel = picked !== channel ? picked : null; // the window, then loading: a change
      else leftFrom = place ?? {}; // no map read yet says where it started, so it can't be ruled out
      until = 0;
    },
    // The picture stopped and came back, so anything could have happened in between.
    lost() {
      channel = null;
      open = false;
      until = 0;
      loading = false;
      leftFrom = null;
    },
    // `at` is when the map's frame was taken, on the same clock as `see`
    arrived(place, at = Infinity) {
      if (loading || at < loadedAt) return; // a frame from before or during the loading screen
      if (leftFrom && (!leftFrom.map || (place.map === leftFrom.map && place.room === leftFrom.room))) channel = null;
      leftFrom = null;
    },
  };
}

// How often each reading of a shop's title or seller came up during a visit.
function countRead(reads, text) {
  if (text) reads.set(text, (reads.get(text) || 0) + 1);
}
function mostRead(reads, least = 1) {
  let best = null, most = least - 1;
  for (const [text, count] of reads) if (count > most) { best = text; most = count; }
  return best;
}
// Shops can share a title and a seller can be hidden, so both have to agree when known.
function isSameShop({ titles, sellers }, { title, seller }) {
  const fits = (read, reads) => !read || !reads.size || sim(norm(read), norm(mostRead(reads))) > 0.7;
  return fits(title, titles) && fits(seller, sellers);
}

// The stall card has one line per row in the shop, in the shop's order, so line N is row N
// and identical copies each get their own line (and their own stats). The list scrolls, so a
// frame shows a window of it: `slots` is the listing read in each visible row, or null where
// nothing was read. The window goes where most of its rows agree with the lines already known,
// and a tie goes to the place nearest the last one, as scrolling is rare. It only moves to a
// place where at least one row agrees, so a misread row isn't taken for a scroll. Lines are
// added at either end for rows not seen before. A line takes a different listing only when that's read
// twice in a row, so one misread doesn't move it but a row turning sold does. A line's stats
// belong to its listing, so a line that takes another listing starts again without them. When
// no row agrees anywhere and two or more rows disagree where the window was, the list jumped
// a page or more to rows not seen yet, and there's no telling where they go. Then the lines
// start again from what's on screen: a page jump in a 12-row shop once put three robes on the
// lines of a Korean Fan, a Heckler and a Lionheart, with their stats (Nov 9). Returns where
// the window's first row is in `lines`.
function placeRows(lines, slots, last = 0) {
  const read = slots.map((listing, i) => [listing, i]).filter(([listing]) => listing != null);
  if (!read.length) return last;
  let at = last, best = -Infinity, anyAgree = false, clashes = 0;
  for (let o = -slots.length; o <= lines.length; o++) {
    let score = 0, agree = 0;
    for (const [listing, i] of read) {
      const known = lines[o + i]?.listing;
      if (known === listing) agree++;
      if (known) score += known === listing ? 1 : -1;
      if (o === last && known && known !== listing) clashes++;
    }
    if (agree) anyAgree = true;
    if (o !== last && !agree && lines.some(l => l.listing)) continue;
    if (score > best || (score === best && Math.abs(o - last) < Math.abs(at - last))) { at = o; best = score; }
  }
  if (!anyAgree && clashes >= 2) { lines.length = 0; at = 0; }
  if (at < 0) { lines.unshift(...Array.from({ length: -at }, newLine)); at = 0; }
  for (const [listing, i] of read) {
    while (lines.length <= at + i) lines.push(newLine());
    const line = lines[at + i];
    if (!line.listing || line.listing === listing) Object.assign(line, { listing, next: null, streak: 0 });
    else if (line.next === listing && ++line.streak >= 2) Object.assign(line, newLine(), { listing });
    else if (line.next !== listing) Object.assign(line, { next: listing, streak: 1 });
  }
  return at;
}
const newLine = () => ({ listing: null, next: null, streak: 0, stats: null, statReads: null });

// The line a tooltip belongs to. A line that doesn't match gives way to the only one in the
// shop that does, because the game moves a tooltip up to fit it on screen, which points at
// the wrong row, and a tooltip can cover its own row so it isn't read. An orange title reads
// badly, so close is enough here. A moved tooltip can also point at the wrong copy of the same
// item, and two matches could be a sold copy and an unsold one, or Red and Blue versions, so
// those stay unknown. A tooltip that isn't over the list is the player's own.
const TITLE_CLOSE = 0.7;

// Whether the game may have moved a tooltip up to fit it on screen. `room` is the space under
// its last stat line, at scale 1 (scanner.js). A description takes about 70 more, so an item
// that may have one counts as moved sooner. Only gear that OSMS lists with none is known to
// have none: a Pink-Flowered Earrings tooltip just above the chat counted as moved, and so
// never opened its row when the shop had two.
const TIP_DESCRIPTION = 70, TIP_MARGIN = 30;
const tooltipMoved = (room, described = true) => room <= TIP_MARGIN + (described ? TIP_DESCRIPTION : 0);

function lineForTooltip({ name, pushed }, hovered, lines, overList) {
  const fits = l => !!l?.listing && (sameItem(l.listing.name, name) || sim(norm(l.listing.name), norm(name)) >= TITLE_CLOSE);
  const named = lines.filter(fits);
  if (fits(hovered) && (!pushed || named.length === 1)) return hovered;
  if (!overList) return null;
  return named.length === 1 ? named[0] : null;
}

// Identical rows in one frame are one listing with a copies count, which is how they're saved.
const copyKey = row => `${row.list}|${row.name}|${row.qty}|${row.price}|${row.sold}`;
function mergeCopies(rows) {
  const frame = new Map();
  for (const row of rows) {
    const key = copyKey(row);
    const same = frame.get(key);
    if (!same) frame.set(key, { ...row, copies: 1 });
    else { same.copies++; same.hovered ||= row.hovered; }
  }
  return [...frame.values()];
}

// Which of the game's inventory tabs an item is in, a group to narrow it by, and what kind of
// thing it is, all from its item id: the first digit is the tab and the next few the kind.
// Equipment with no upgrade slots is a Cash Shop look, so it goes under Cash.
const SLOT_KINDS = { 100: 'Hat', 101: 'Face', 102: 'Eyes', 103: 'Earrings', 104: 'Top', 105: 'Overall', 106: 'Bottom', 107: 'Shoes', 108: 'Gloves', 109: 'Shield', 110: 'Cape', 111: 'Ring', 112: 'Pendant', 170: 'Weapon', 180: 'Pet equip' };
const WEAPON_KINDS = { 130: 'One-handed sword', 131: 'One-handed axe', 132: 'One-handed mace', 133: 'Dagger', 137: 'Wand', 138: 'Staff', 140: 'Two-handed sword', 141: 'Two-handed axe', 142: 'Two-handed mace', 143: 'Spear', 144: 'Polearm', 145: 'Bow', 146: 'Crossbow', 147: 'Claw', 148: 'Knuckle', 149: 'Gun' };
const USE_KINDS = { 200: 'Potion', 201: 'Potion', 202: 'Potion', 203: 'Return scroll', 204: 'Scroll', 206: 'Arrow', 207: 'Throwing star', 210: 'Summoning sack' };
function itemKind(id, hasSlots) {
  if (!Number.isInteger(id)) return { tab: 'other', group: 'Other', kind: 'Other' };
  const tab = Math.floor(id / 1e6), group = Math.floor(id / 1e4);
  if (tab === 1) {
    const kind = WEAPON_KINDS[group] ?? SLOT_KINDS[group] ?? 'Equip';
    return { tab: hasSlots ? 'equip' : 'cash', group: WEAPON_KINDS[group] ? 'Weapon' : kind, kind };
  }
  if (tab === 2) { const kind = USE_KINDS[group] ?? 'Other'; return { tab: 'use', group: kind, kind }; }
  if (tab === 3) { const kind = group === 301 ? 'Chair' : 'Setup'; return { tab: 'setup', group: kind, kind }; }
  if (tab === 4) { const kind = group === 401 || group === 402 ? 'Ore' : 'Etc'; return { tab: 'etc', group: kind, kind }; }
  if (tab === 5) { const kind = group === 500 ? 'Pet' : 'Cash item'; return { tab: 'cash', group: kind, kind }; }
  return { tab: 'other', group: 'Other', kind: 'Other' };
}

// Fixed facts about items from osms-items.json, by normalised name. Unknown is null.
function itemFacts(list) {
  const book = map => new Map(Object.entries(map ?? {}).map(([name, value]) => [norm(name), value]));
  const npc = book(list.npc), slots = book(list.slots), rates = book(list.rates), lines = book(list.lines), base = book(list.base), recharge = book(list.recharge), icons = book(list.icons), plain = book(list.noDescription);
  const recharges = name => recharge.has(norm(name));
  // Equipment never stacks, so a gear listing is always one item. "11 for 18,777" on a claw
  // is a misread "1 for 18,777", and the price is the whole price.
  const single = name => slots.has(norm(name));
  return {
    npc: name => npc.get(norm(name)) ?? null,
    // Throwing stars recharge, so a shop's "4 for 600,000" is one set with 4 left, not 4 sets
    // at 150,000. That's an old scam, so the whole price is what one star set costs.
    recharges,
    single,
    unitPrice: (name, qty, price) => (recharges(name) || single(name) ? price : price / qty),
    slots: name => slots.get(norm(name)) ?? null,
    // the item id its icon is saved under, for iconTag
    icon: name => icons.get(norm(name)) ?? null,
    kind: name => itemKind(icons.get(norm(name)), slots.has(norm(name))),
    rate: name => rates.get(norm(name)) ?? null,
    // whether a tooltip may have a description under its stats: yes unless OSMS says it's gear with none
    described: name => !plain.has(norm(name)),
    lines: name => lines.get(norm(name))?.split(',') ?? [],
    // whether read stats can be this item's (statsFit)
    fits: (name, stats) => statsFit(stats, slots.get(norm(name)) ?? null, lines.get(norm(name))?.split(',') ?? []),
    // a plain copy's stats, written "mdef:27,critDamage:2"
    base: name => {
      const text = base.get(norm(name));
      return text ? Object.fromEntries(text.split(',').map(pair => pair.split(':')).map(([key, value]) => [key, Number(value)])) : null;
    },
  };
}

// The numbers on a tooltip, or null when the card wasn't read in full. A see-through
// tooltip can hide any line, and two reads can miss the same one, so the item's main
// lines must all be there, or it would look like a different item. A thin colon can be
// lost ("DEX +1") and an f can be a t ("Weapon Det"), and + reads as # as it does in titles.
const GEAR_LINES = [[/^Weapon Attack/i, 'attack'], [/^Magic Attack/i, 'magic'], [/^Weapon De[ft]/i, 'wdef'], [/^Magic De[ft]/i, 'mdef'], [/^STR/i, 'str'], [/^DEX/i, 'dex'], [/^INT/i, 'int'], [/^LUK/i, 'luk'], [/^(Max\s*)?HP/i, 'hp'], [/^(Max\s*)?MP/i, 'mp'], [/^Accuracy/i, 'accuracy'], [/^(Avoidability|Evasion)/i, 'avoid'], [/^Speed/i, 'speed'], [/^Jump/i, 'jump'], [/^Critical Rate/i, 'crit'], [/^Critical Damage/i, 'critDamage'], [/^Knockback/i, 'knockback'], [/^Remaining Enhancements/i, 'slots']];
const BONUS = /[+#]\s*(\d+)/;
function parseGearStats(lines, mainLines = []) {
  const stats = {};
  for (const read of lines) {
    const line = read.replace(/^[^A-Za-z]+/, ''); // the dot before each line
    const key = GEAR_LINES.find(([label]) => label.test(line))?.[1];
    if (key === 'slots') {
      const left = line.match(/Enhancements\W*(\d+)/i);
      if (left) stats.slots = parseInt(left[1], 10);
      break; // the last stat line, and only the description comes after it
    }
    // every bonus has a plus sign, unlike a requirement misread as a stat ("STR : 75")
    const number = line.match(BONUS);
    if (!number) continue;
    if (!key) return null; // a bonus that can't be told would make this look like another item
    if (stats[key] === undefined) stats[key] = parseInt(number[1], 10);
  }
  return ['slots', ...mainLines].every(key => stats[key] !== undefined) ? stats : null;
}

// Whether read stats can belong to an item: never more slots left than it has, and every main
// line it always shows. Only what's sure from OSMS, because how much a scroll can add depends
// on the scroll, and a wrong limit would throw away heavily scrolled gear. Stats moved onto the
// wrong item's line fail both easily: a Heckler's on a Blue Sauna Robe had no W.Def or STR (Nov 9).
function statsFit(stats, totalSlots, mainLines = []) {
  if (!stats || typeof stats !== 'object' || !Number.isInteger(stats.slots) || stats.slots < 0) return false;
  if (totalSlots != null && stats.slots > totalSlots) return false;
  return mainLines.every(key => Number.isFinite(stats[key]));
}

// How this copy differs from a plain one, because "clean" alone hides a rolled stat
// (Emerald Earrings at 1 crit damage and at 2 are both clean, but don't sell the same).
const STAT_NAMES = { attack: 'attack', magic: 'magic', wdef: 'W.Def', mdef: 'M.Def', str: 'STR', dex: 'DEX', int: 'INT', luk: 'LUK', hp: 'HP', mp: 'MP', accuracy: 'accuracy', avoid: 'avoid', speed: 'speed', jump: 'jump', crit: 'crit', critDamage: 'crit dmg' };
function statChanges(stats, base) {
  return Object.keys(STAT_NAMES).flatMap(key => {
    const gap = (stats[key] ?? 0) - (base[key] ?? 0);
    return gap ? [`${gap > 0 ? '+' : '\u2212'}${Math.abs(gap)} ${STAT_NAMES[key]}`] : [];
  });
}

// Worked or not comes from the slot line, the one that reads reliably on any background.
const gearState = (stats, baseSlots, base = null) => [
  stats.slots === baseSlots ? 'clean' : `${stats.slots}${baseSlots == null ? '' : ` of ${baseSlots}`} slots left`,
  ...(base ? statChanges(stats, base) : []),
].join(', ');

// The Prices card's Stats filter: clean only (no slot used), and a min and max for any stat.
// A copy whose stats weren't read can't be judged, so with a filter on it's left out.
// filter: { clean, range: { attack: [48, 52], slots: [5, 7] } }, or null for none.
function passesStats(stats, filter, baseSlots) {
  if (!filter) return true;
  if (!stats) return false;
  if (filter.clean && stats.slots !== baseSlots) return false;
  return Object.entries(filter.range ?? {}).every(([key, [lo, hi]]) => (stats[key] ?? 0) >= lo && (stats[key] ?? 0) <= hi);
}

// The stats worth a filter for one item: its plain copy's, any others seen on its listings,
// and slots, each with the lowest and highest seen.
function statBounds(statsList, base) {
  const keys = new Set([...Object.keys(base ?? {}), ...statsList.flatMap(s => Object.keys(s))]);
  keys.delete('slots');
  return [...[...keys].filter(k => k in STAT_NAMES), 'slots'].map(key => {
    const values = statsList.map(s => s[key] ?? 0);
    return { key, lo: values.length ? Math.min(...values) : 0, hi: values.length ? Math.max(...values) : 0 };
  }).filter(b => b.key === 'slots' || b.hi > 0 || (base?.[b.key] ?? 0) > 0);
}

const agoText = ms => (ms < 6e4 ? 'just now' : ms < 36e5 ? `${Math.round(ms / 6e4)} min ago` : ms < 48 * 36e5 ? `${Math.round(ms / 36e5)} h ago` : `${Math.round(ms / 864e5)} days ago`);

// An item's icon, which the local server downloads from OSMS once and keeps. Unknown items
// and failed downloads keep an empty slot of the same size, so names stay in line. A broken
// image with no alt text draws nothing. The address is whole, because the popped-out card is
// an about:blank window, written into by this page.
const ICON_ORIGIN = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? location.origin : '';
const iconTag = id => (Number.isInteger(id) ? `<img class="icon" src="${ICON_ORIGIN}/icon/${id}.png" alt="" width="22" height="22" draggable="false">` : '<span class="icon"></span>');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// An icon and a name, side by side in a .named box (theme.css), so a long name wraps beside the
// icon instead of under it.
const iconName = (id, name) => `${iconTag(id)}<span class="name">${esc(name)}</span>`;
// The exact amount, written as the game writes it, so a row can be matched to the screen.
const whole = n => Math.round(n).toLocaleString('en-US');
// A price that rounds up to the next unit takes it, so 999,999 is 1M, not 1000K.
const fmt = n => {
  if (n == null) return '—';
  const short = (size, places) => +(n / size).toFixed(places);
  if (n >= 1e9 || short(1e6, 2) >= 1000) return `${short(1e9, 2)}B`;
  if (n >= 1e6 || short(1e3, 1) >= 1000) return `${short(1e6, 2)}M`;
  if (n >= 1e4) return `${short(1e3, 1)}K`;
  return n < 10 ? String(+n.toFixed(2)) : Math.round(n).toLocaleString('en-US');
};

// A round step for an axis, at least `rough`: 1, 2, 2.5 or 5 times a power of ten.
const niceStep = rough => {
  const mag = 10 ** Math.floor(Math.log10(rough));
  return mag * [1, 2, 2.5, 5, 10].find(f => f * mag >= rough);
};

// A price chart's scale, fitted to the prices rather than starting at zero, because dots
// don't need a zero line like bars do and a 4,200 to 6,500 spread on 0 to 10K left most of
// the chart empty (Nov 10). It covers every price from a third of the lower quarter (or of
// the usual price, if lower) up to 4× the usual one (or the lower quarter, with no usual
// price). Past those, a troll ask like 9,999,999 or a misprice of 20 goes to an edge instead
// of squashing the rest flat. A flat price still gets a band of 20% of it, so a 2% wiggle
// doesn't fill the chart. Rounded so the axis reads in steps like 50, 100, 150.
function chartRange(prices, usual) {
  const all = [...prices].sort((a, b) => a - b);
  const q1 = all[(all.length - 1) >> 2];
  const anchor = usual ?? q1 ?? 1;
  const kept = all.filter(p => p >= Math.min(q1 ?? anchor, anchor) / 3 && p <= anchor * 4);
  let lo = Math.min(anchor, ...kept), hi = Math.max(anchor, ...kept);
  if (hi - lo < anchor * 0.2) [lo, hi] = [(lo + hi) / 2 - anchor * 0.1, (lo + hi) / 2 + anchor * 0.1];
  const step = niceStep(Math.max(hi - lo, 1e-9) / 5);
  lo = Math.max(0, Math.floor(lo / step) * step);
  hi = Math.ceil(hi / step) * step;
  return { lo, hi: hi > lo ? hi : lo + step, step };
}

// Where to mark time on a chart that ends now and goes back `span` ms. Up to a day and a half
// it counts back in round hours (6 h ago, 12 h ago). Past that it marks midnights by date
// (9 Nov), because "33 h ago" and "41 days ago" were hard to place (Nov 10). Ticks too near
// either end are left out, so they don't run into "now" or the chart's edge.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// A day as the charts write it: 9 Nov. Fixed month names, as browsers disagree on Sep or Sept.
const dateText = t => `${new Date(t).getDate()} ${MONTHS[new Date(t).getMonth()]}`;
function timeTicks(now, span) {
  const HOUR = 36e5, DAY = 864e5, ticks = [];
  const room = t => now - t > span * 0.08 && now - t < span * 0.95;
  if (span <= 36 * HOUR) {
    const step = [0.25, 0.5, 1, 2, 3, 6, 12].map(h => h * HOUR).find(s => span / s <= 6);
    for (let back = step; back < span; back += step) if (room(now - back)) ticks.push({ t: now - back, label: agoText(back) });
  } else {
    const days = [1, 2, 7, 14, 28].find(d => span / (d * DAY) <= 10);
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    // Weekly steps land on Mondays, so the marks don't move from one day to the next
    if (days >= 7) midnight.setDate(midnight.getDate() - ((midnight.getDay() + 6) % 7));
    for (const d = midnight; now - d.getTime() < span; d.setDate(d.getDate() - days)) {
      if (room(d.getTime())) ticks.push({ t: d.getTime(), label: dateText(d) });
    }
  }
  return ticks.reverse();
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}`);
  return data;
}

if (typeof module !== 'undefined') module.exports = { SEEN_DAYS, norm, sim, fmt, chartRange, timeTicks, dateText, whole, sameItem, matchName, statsFit, completeName, startsName, knownTitle, placeRows, tooltipMoved, lineForTooltip, copyKey, mergeCopies, channelFollower, itemFacts, itemKind, passesStats, statBounds, iconTag, iconName, parseGearStats, gearState, STAT_NAMES, agoText, countRead, mostRead, isSameShop, tierFromIcon, fullScrollName, parseMap, parseFmRoom, whereText };
