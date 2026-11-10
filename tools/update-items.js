// Refreshes osms-items.json, the facts about real items bundled with the app. Cash Shop
// items are in the names too, because players resell them in shops. NPC prices, scroll
// rates and gear slots only come from items.json: a Cash Shop price is in NX.
// Run with: npm run items
// The app itself never goes online for this: it only reads the bundled file. Icons aren't
// bundled, as they're (c) Nexon: the server downloads each one once it's needed (serve.js).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { norm } = require('../pricing.js');

const BASE = 'https://osmsdataexplorer.com/data/api/v1/';
const OUT = path.join(__dirname, '..', 'osms-items.json');
const SOURCES = ['items.json', 'cash_shop.json'];

// One value for each name, leaving out a name whose records disagree, because men's and
// women's versions share a name and a wrong price is worse than none.
function byName(records, valueOf) {
  const values = new Map();
  for (const record of records) {
    const name = record.name.trim(), list = values.get(name) ?? [];
    values.set(name, [...list, valueOf(record) ?? null]);
  }
  const kept = [...values].filter(([, list]) => list[0] !== null && list.every(v => v === list[0]));
  return Object.fromEntries(kept.map(([name, list]) => [name, list[0]]).sort(([a], [b]) => a.localeCompare(b)));
}

// What an NPC pays, for items it will really buy. Stars are left out, because they
// recharge and what they fetch depends on how many are left.
const npcPays = ({ price, stats }) => (price > 0 && !stats?.notSale && !stats?.unitPrice ? price : null);
// Throwing stars recharge, so a shop's "4 for 600,000" is one set with 4 left, not 4
// sets. OSMS marks them with a recharge price per star.
const recharges = ({ stats }) => (stats?.unitPrice != null ? true : null);
const scrollRate = ({ scroll }) => scroll?.success_rate ?? null;
const gearSlots = ({ category, stats }) => (category === 'Equipment' && stats?.tuc > 0 ? stats.tuc : null);

// Gear whose tooltip ends at its slot line. A description adds lines under it, which matters
// when telling whether the game moved a tooltip up to fit (tooltipMoved in pricing.js). A name
// whose versions disagree is left out, and so counts as having one.
const noDescription = item => (gearSlots(item) !== null && !item.description?.trim() ? true : null);

// The stat lines a tooltip must show for this item. Small values are left out, because a
// stat can roll down to nothing and lose its line.
const MAIN_LINE_FROM = 5;
const LINE_KEYS = { incPAD: 'attack', incMAD: 'magic', incPDD: 'wdef', incMDD: 'mdef', incSTR: 'str', incDEX: 'dex', incINT: 'int', incLUK: 'luk', incMHP: 'hp', incMMP: 'mp', incACC: 'accuracy', incEVA: 'avoid', incSpeed: 'speed', incJump: 'jump' };
const mainLines = item => {
  if (gearSlots(item) === null) return null;
  return Object.keys(LINE_KEYS).filter(key => item.stats[key] >= MAIN_LINE_FROM).map(key => LINE_KEYS[key]).join(',') || null;
};

// A plain copy's stats, so a tooltip can say how a rolled or scrolled one differs.
const BASE_KEYS = { ...LINE_KEYS, incCRT: 'crit', incCRD: 'critDamage' };
const baseStats = item => {
  if (gearSlots(item) === null) return null;
  return Object.keys(BASE_KEYS).filter(key => item.stats[key] > 0).map(key => `${BASE_KEYS[key]}:${item.stats[key]}`).join(',') || null;
};

// Each name's item id, for its icon. Men's and women's versions share a name and look the
// same, so the lowest id is kept. Only records whose icon is at the usual place are used,
// because serve.js builds the address from the id.
const ICON = /^https:\/\/osmsdataexplorer\.com\/data\/current\/images\/items\/0*(\d+)\.png$/;
function iconIds(records, names) {
  const ids = new Map();
  for (const record of records) {
    const id = record.id ?? record.item_id, name = record.name.trim(), match = ICON.exec(record.icon_url ?? '');
    if (!names.has(name) || !match || Number(match[1]) !== id) continue;
    if (!ids.has(name) || id < ids.get(name)) ids.set(name, id);
  }
  return Object.fromEntries([...ids].sort(([a], [b]) => a.localeCompare(b)));
}

async function get(file) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: the server answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const meta = JSON.parse(await get('meta.json'));
  if (meta.schema_version !== 1) throw new Error(`Schema ${meta.schema_version} is new, so check the format first.`);
  const sha256 = SOURCES.map(file => meta.files[file].sha256).join(' ');
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  if (old?.sha256 === sha256 && old.recharge && old.icons && old.noDescription) return console.log(`Already up to date: ${old.names.length} names.`);

  const sources = {};
  for (const file of SOURCES) {
    const body = await get(file);
    if (crypto.createHash('sha256').update(body).digest('hex') !== meta.files[file].sha256) throw new Error(`${file} does not match its checksum.`);
    sources[file] = JSON.parse(body);
  }
  const items = sources['items.json'], records = SOURCES.flatMap(file => sources[file]);

  // Men's and women's versions share a name. Names that differ only by symbols
  // (Red " + ", Red " - ") can't be told apart once normalised, so they're left out.
  const counts = new Map();
  const names = [...new Set(records.map(i => i.name.trim()))].filter(norm).sort((a, b) => a.localeCompare(b));
  for (const name of names) counts.set(norm(name), (counts.get(norm(name)) ?? 0) + 1);
  const kept = names.filter(name => counts.get(norm(name)) === 1);

  const list = {
    credit: 'Data from OSMS Data Explorer (https://osmsdataexplorer.com), CC BY 4.0. Reduced to item names, NPC sell prices, scroll success rates, upgrade slots, main stat lines, plain gear stats, which gear has no description, which items recharge and item ids for icons.',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    gameContent: 'Game content is (c) Nexon and is not covered by that license. This is unofficial and not affiliated with Nexon.',
    clientBuild: meta.client_build,
    updatedAt: meta.data_updated_at,
    sha256,
    names: kept,
    npc: byName(items, npcPays),
    rates: byName(items, scrollRate),
    slots: byName(items, gearSlots),
    lines: byName(items, mainLines),
    base: byName(items, baseStats),
    noDescription: byName(items, noDescription),
    recharge: byName(items, recharges),
    icons: iconIds(records, new Set(kept)),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(list, null, 1)}\n`);
  console.log(`Saved ${kept.length} names, left out ${names.length - kept.length}. NPC prices: ${Object.keys(list.npc).length}. Icons: ${Object.keys(list.icons).length}.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
