// Run with: node --test test/pricing.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { norm, fmt, chartRange, timeTicks, dateText, sameItem, matchName, completeName, sharedStart, startsName, tooltipName, knownTitle, placeRows, tooltipMoved, lineForTooltip, mergeCopies, channelFollower, itemFacts, passesStats, statBounds, iconTag, parseGearStats, gearState, agoText, countRead, mostRead, isSameShop, tierFromIcon, fullScrollName, parseMap, parseFmRoom, whereText } = require('../pricing.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSettings, saveSettings, SETTINGS } = require('../serve.js');

test('corrects misreads', () => {
  for (const [read, real] of [['Crosshow', 'Crossbow'], ['NMagic Potion', 'Magic Potion'], ['Magic Potion o', 'Magic Potion'], ['MagicPotion', 'Magic Potion']]) {
    assert.ok(sameItem(read, real), `${read} -> ${real}`);
  }
});

test('never joins different items', () => {
  for (const [a, b] of [
    ['Earring INT Scroll', 'Earring LUK Scroll'],
    ['Mokbi Throwing Stars', 'Wolbi Throwing Stars'],
    ['Subi Throwing Stars', 'Ilbi Throwing Stars'],
    ['Gloves Attack Scroll 10%', 'Gloves Attack Scroll 60%'],
    ['Blue Bamboo Hat', 'Brown Bamboo Hat'],
    ['Gold Ore', 'Bold Ore'],
  ]) assert.equal(sameItem(a, b), false, `${a} / ${b}`);
});

test('matches a cut-off name against the start of the real one', () => {
  assert.ok(sameItem('Overall Armor DEF Scr', 'Overall Armor DEF Scroll 60%', true));
  assert.equal(sameItem('Overall Armor DEF Scr', 'Gloves Attack Scroll', true), false);
});

const realNames = require('../osms-items.json').names;

test('the bundled item list can be matched against', () => {
  assert.ok(realNames.length > 2000);
  assert.equal(new Set(realNames.map(norm)).size, realNames.length);
});

test('finds the real name behind a read', () => {
  assert.equal(matchName('Blue Bamhoo Hat', realNames), 'Blue Bamboo Hat');
  assert.equal(matchName('hat hp scroll: lesser', realNames), 'Hat HP Scroll: Lesser');
});

test('an exact match beats a close one', () => {
  assert.equal(matchName('Lemon', realNames), 'Lemon');
  assert.equal(matchName('Red Calas', realNames), 'Red Calas');
});

test('leaves a read unknown when two names are close, or none', () => {
  assert.equal(matchName('Red Calat', realNames), null);
  assert.equal(matchName('Zzyzx Qwerty', realNames), null);
});

test('a four-letter word can be a letter off when no other name fits', () => {
  assert.equal(matchName('otar Earrings', realNames), 'Star Earrings');
  assert.equal(matchName('Blue Noon Shoes', realNames), 'Blue Moon Shoes');
  assert.equal(matchName('Star Earrings', realNames), 'Star Earrings', 'a real name stays as it is');
  assert.equal(matchName('Pash', ['Cass', 'Pass', 'Mash']), null, 'two names fit');
  assert.equal(matchName('Gole Ore', ['Gold Ore', 'Gold Ore 10%']), 'Gold Ore');
  assert.equal(matchName('Hat XP Scroll: Lesser', realNames), null, 'short words like HP and MP stay exact');
  assert.equal(sameItem('Gold Ore', 'Bold Ore'), false, 'still not the same item unless asked');
});

test('a slash read as a letter is still the name', () => {
  assert.equal(matchName('Silver f Black Stealer Pants', realNames), 'Silver / Black Stealer Pants');
  assert.equal(matchName('Red l Gold Stealer Pants', realNames), 'Red / Gold Stealer Pants');
  assert.equal(matchName('Silver / Black Stealer Pants', realNames), 'Silver / Black Stealer Pants');
  assert.equal(matchName('Silver f Gold Stealer Pants', realNames), null, 'the colours still have to fit');
  assert.equal(completeName('Silver f Black Stea', null, realNames), 'Silver / Black Stealer Pants');
  assert.equal(sameItem('Silver f', 'Silver / Black Stealer Pants', true), false, 'cut off there, f could start a word');
  assert.equal(sameItem('Blue f Moon Shoes', 'Blue Moon Shoes'), false, 'only where the name has a slash');
});

test('hovering a row whose name was not read gives it the tooltip\'s name', () => {
  const known = read => matchName(read, realNames);
  const tip = { name: 'Silver / Black Stealer Pants', real: true, pushed: false };
  const row = { name: 'Si1ver Rlack Stealer Pants', hovered: true };
  assert.equal(known(row.name), null);
  assert.equal(tooltipName(row, tip, known), tip.name);
  assert.equal(tooltipName({ ...row, hovered: false }, tip, known), null, 'only the hovered row');
  assert.equal(tooltipName(row, { ...tip, pushed: true }, known), null, 'a moved tooltip may be on another row');
  assert.equal(tooltipName(row, { ...tip, real: false }, known), null, 'a title that is no real item names nothing');
  assert.equal(tooltipName({ name: 'Zzyzx Qwerty', hovered: true }, tip, known), null, 'nothing like the title');
  assert.equal(tooltipName({ name: 'O1d Nap Piece (1/4)', hovered: true }, { name: 'Old Map Piece (2/4)', real: true }, known), null, 'numbers must be the same');
  assert.equal(tooltipName({ name: 'Gloves Attack Scro1l: Lesser', hovered: true }, { name: 'Gloves Attack Scroll: Greater', real: true }, known), null, 'another tier is not close enough');
  assert.equal(tooltipName({ name: 'Blue Moon Shoes', hovered: true }, { name: 'Blue Moon Shoes', real: true }, known), null, 'a real name needs no help');
  assert.equal(tooltipName({ name: 'Overall Armor DEF Scr', cut: true, hovered: true }, { name: 'Overall Armor DEF Scroll: Greater', real: true }, known), 'Overall Armor DEF Scroll: Greater', 'a cut-off name, as before');
});

test('a cut-off read is shown as the start its real names share, never as it was read', () => {
  assert.equal(sharedStart('Overall Armor DEF Scr..', realNames), 'Overall Armor DEF Scroll');
  assert.equal(sharedStart('Crosshow Attack Scr...', realNames), 'Crossbow Attack Scroll', 'the misread letter is not shown');
  assert.equal(sharedStart('Zzyzx Qwerty Foo..', realNames), null, 'the start of no real name');
  assert.equal(sharedStart('Fet Foo..', realNames), null);
});

test('a cut-off read gets no extra leeway', () => {
  assert.equal(matchName('otar Earr', ['Star Earrings'], true), null);
});

test('a cut-off read is never taken as a shorter name', () => {
  assert.equal(matchName('Red Calas', ['Red Calas', 'Red Calas Pants'], true), null);
  assert.equal(matchName('Red Calas Pa', ['Red Calas', 'Red Calas Pants'], true), 'Red Calas Pants');
});

test('completes a cut-off name only when one name fits', () => {
  assert.equal(completeName('Overall Armor DEF Scr..', 'Greater', realNames), 'Overall Armor DEF Scroll: Greater');
  assert.equal(completeName('Overall Armor DEF Scr..', null, realNames), null, 'no tier from the icon');
  assert.equal(completeName('Gloves ..', 'Greater', realNames), null, 'more than one kind of scroll fits');
  assert.equal(completeName('Return Scroll to Sleepywo..', 'Greater', realNames), 'Return Scroll to Sleepywood', 'an icon colour on an item with no tiers');
  assert.equal(completeName('Claw Attack Sc..', null, ['Claw Attack Scroll', 'Claw Attack Scroll: Lesser', 'Claw Attack Scroll: Chaos']), null, 'an old name without a tier');
});

test('a space lost from a cut-off name still finds the whole name', () => {
  // seen live in the shop in test/cut-scroll-names.webp, though that saved picture keeps its space
  const blunt = ['Lesser', 'Intermediate', 'Greater', 'Chaos'].map(tier => `One-Handed Blunt Weapon Attack Scroll: ${tier}`);
  assert.equal(completeName('One-Handed BluntWeap...', 'Intermediate', blunt), 'One-Handed Blunt Weapon Attack Scroll: Intermediate');
  assert.equal(completeName('One-Handed BluntWeap...', null, blunt), null, 'the tier is still unknown');
  assert.ok(startsName('One-Handed BluntWeap...', blunt[0]));
  assert.ok(!startsName('One-Handed Blunt Axe', blunt[0]));
});


test('reads the scroll tier from the icon colour', () => {
  const icon = (hue, sat) => ({ hue, sat, colouredShare: 0.5, grayShare: 0 });
  assert.equal(tierFromIcon(icon(21, 0.54)), 'Intermediate'); // measured on Earring LUK Scroll: Intermediate
  assert.equal(tierFromIcon(icon(40, 0.6)), 'Greater');       // measured on Overall Armor DEX Scroll
  assert.equal(tierFromIcon(icon(215, 0.5)), 'Lesser');
  assert.equal(tierFromIcon({ hue: 0, sat: 0, colouredShare: 0.01, grayShare: 0.5 }), 'Chaos');
});

test('leaves the tier unknown rather than guessing', () => {
  assert.equal(tierFromIcon({ hue: 30, sat: 0.5, colouredShare: 0.5, grayShare: 0 }), null); // between orange and yellow
  assert.equal(tierFromIcon({ hue: 40, sat: 0.15, colouredShare: 0.4, grayShare: 0 }), null); // too pale for a row still for sale
  assert.equal(tierFromIcon({ hue: 120, sat: 0.6, colouredShare: 0.5, grayShare: 0 }), null);
});

test('a sold icon fades but keeps its hue', () => {
  const faded = (hue, sat) => ({ hue, sat, colouredShare: 0.25, grayShare: 0 });
  assert.equal(tierFromIcon(faded(20, 0.14), true), 'Intermediate'); // measured on a sold Intermediate scroll
  assert.equal(tierFromIcon(faded(40, 0.15), true), 'Greater');
  assert.equal(tierFromIcon({ hue: 0, sat: 0, colouredShare: 0, grayShare: 0.5 }, true), null); // no hue, so no guess
});

test('a tooltip title cut short still gives the whole tier', () => {
  assert.equal(fullScrollName('One-Handed Sword Attack Scroll: Intermediat', null), 'One-Handed Sword Attack Scroll: Intermediate');
});

test('builds the full scroll name, trusting the text over the colour', () => {
  assert.equal(fullScrollName('Earring LUK Scroll: Inter...', null), 'Earring LUK Scroll: Intermediate');
  assert.equal(fullScrollName('Cape LUK Scroll; Interme...', null), 'Cape LUK Scroll: Intermediate'); // a misread colon
  assert.equal(fullScrollName('Earring LUK Scroll: Inter...', 'Greater'), 'Earring LUK Scroll: Intermediate');
  assert.equal(fullScrollName('Overall Armor DEX Scroll:...', 'Greater'), 'Overall Armor DEX Scroll: Greater');
  assert.equal(fullScrollName('Overall Armor DEX Scroll...', 'Lesser'), 'Overall Armor DEX Scroll: Lesser');
  assert.equal(fullScrollName('Overall Armor DEX Scroll...', null), null);
  assert.equal(fullScrollName('Overall Armor DEF Sc...', 'Greater'), null);
});

test('the I of a cut-off tier read as a stroke goes by the icon', () => {
  // test/crossbow-cut-name.webp reads "Crosshow Attack Scroll: |..." with an orange icon
  assert.equal(fullScrollName('Crosshow Attack Scroll: |...', 'Intermediate'), 'Crosshow Attack Scroll: Intermediate');
  assert.equal(fullScrollName('Crossbow Attack Scroll: l...', 'Lesser'), 'Crossbow Attack Scroll: Lesser', 'I and L look alike');
  assert.equal(fullScrollName('Crossbow Attack Scroll: |...', 'Greater'), null, 'the icon says neither');
  assert.equal(fullScrollName('Crossbow Attack Scroll: |...', null), null);
  assert.equal(fullScrollName('Crossbow Attack Scroll: |nter...', null), 'Crossbow Attack Scroll: Intermediate');
  assert.equal(fullScrollName('Crossbow Attack Scroll: I...', null), 'Crossbow Attack Scroll: Intermediate');
  assert.equal(matchName('Crosshow Attack Scroll: Intermediate', realNames), 'Crossbow Attack Scroll: Intermediate');
});

test('a cut-off name a letter off is still completed', () => {
  assert.equal(completeName('Crosshow Attack Scr...', 'Intermediate', realNames), 'Crossbow Attack Scroll: Intermediate');
  assert.equal(completeName('Crosshow Attack Scr...', null, realNames), null, 'the tier is still unknown');
  assert.equal(completeName('Overall Armor DEX Scr..', 'Greater', ['Overall Armor DEF Scroll: Greater']), null, 'short words stay exact');
});

test('leaves scrolls without tiers alone', () => {
  assert.equal(fullScrollName('Return Scroll to Sleepywo...', 'Intermediate'), null);
  assert.equal(fullScrollName('Return Scroll to Henesys', 'Greater'), null);
  assert.equal(fullScrollName('Return Scroll - Nearest Town', 'Lesser'), null);
});

test('reads the room and map from the minimap text', () => {
  assert.deepEqual(parseMap('Hidden Street\nFree Market <1>\n'), { map: 'Free Market', room: 1 });
  assert.deepEqual(parseMap('Hidden Street : Free Market <12>'), { map: 'Free Market', room: 12 });
  assert.deepEqual(parseMap('Hidden Street : FreeMarket <l>'), { map: 'Free Market', room: 1 });
  assert.deepEqual(parseMap('Hidden Street\nFree Market (3)'), { map: 'Free Market', room: 3 });
  assert.deepEqual(parseMap('Victoria Road\nKerning City\n'), { map: 'Kerning City', room: null });
  assert.deepEqual(parseMap('Hidden Street : Free Market Entrance'), { map: 'Free Market Entrance', room: null });
  assert.deepEqual(parseMap('Victoria Road : Henesys Weapon Store'), { map: 'Henesys Weapon Store', room: null });
  assert.deepEqual(parseMap('Victoria Road : Henesys Weapon Store'), { map: 'Henesys Weapon Store', room: null });
  assert.equal(parseMap(''), null);
  assert.equal(parseMap('~ |'), null);
  assert.equal(parseMap('redid 5," o)'), null); // read from something that isn't the minimap
  assert.equal(parseMap('Street : redid 5," o)'), null);
  assert.equal(parseMap('Some shop sign'), null);
  assert.equal(parseMap('Hidden Street\nFree IYnbket 7'), null); // garbled: unknown, not a made-up map
  assert.equal(parseMap('Hidden Street : Free Market <25>'), null); // no such room
});

test('reads a room only from a line that is clearly a Free Market', () => {
  assert.deepEqual(parseFmRoom('Free Market <3>'), { map: 'Free Market', room: 3 });
  assert.deepEqual(parseFmRoom('Free Market 12'), { map: 'Free Market', room: 12 });
  assert.equal(parseFmRoom('re a ket 1'), null);
  assert.equal(parseFmRoom('Free Market'), null);
  assert.equal(parseFmRoom('Free Market <77>'), null);
});

test('says where a shop is', () => {
  assert.equal(whereText({ channel: 4, map: 'Free Market', room: 1 }), 'CH.4 FM 1');
  assert.equal(whereText({ channel: 4, map: 'Kerning City', room: null }), 'CH.4 Kerning City');
  assert.equal(whereText({ channel: null, map: 'Free Market', room: 2 }), 'FM 2');
  assert.equal(whereText({}), '');
});

// A throwing star's count is what's left in one set. "4 for 600,000" sold one Ilbi set for
// 600,000, and reading it as 150,000 a star made a scam look like a deal.
test('a throwing star is priced by the set, and arrows by the arrow', () => {
  const facts = itemFacts(require('../osms-items.json'));
  for (const name of ['Wolbi Throwing Stars', 'ilbi throwing stars', 'Steely Throwing Knives', 'Icicle']) assert.ok(facts.recharges(name), name);
  for (const name of ['Arrows for Bows', 'Bronze Arrows for Crossbows', 'Red Potion', 'No Such Item']) assert.ok(!facts.recharges(name), name);
  assert.equal(facts.unitPrice('Wolbi Throwing Stars', 500, 2222), 2222);
  assert.equal(facts.unitPrice('Ilbi Throwing Stars', 4, 600000), 600000);
  assert.equal(facts.unitPrice('Arrows for Bows', 1000, 5000), 5);
  assert.equal(facts.unitPrice('Red Potion', 100, 5000), 50);
  // equipment never stacks, so "11 for 18,777" on a claw is a misread and one claw is 18,777
  assert.ok(facts.single('Reef Claw') && !facts.single('Red Potion') && !facts.single('Ilbi Throwing Stars'));
  assert.equal(facts.unitPrice('Reef Claw', 11, 18777), 18777);
});

test('NPC prices come from the item data, and only for items an NPC buys', () => {
  const list = require('../osms-items.json'), facts = itemFacts(list);
  assert.equal(facts.npc('Star Earrings'), 4500);
  assert.equal(facts.npc('star earrings'), 4500);
  assert.equal(facts.npc('Subi Throwing Stars'), null);
  assert.equal(facts.npc('No Such Item'), null);
  assert.equal(facts.slots('Emerald Earrings'), 5);
  assert.equal(facts.slots('Red Potion'), null);
  assert.deepEqual(facts.lines('Emerald Earrings'), ['mdef']);
  assert.deepEqual(facts.lines('No Such Item'), []);
  assert.ok(Object.keys(list.npc).length > 2000);
});

test('reads the numbers on a tooltip', () => {
  const lines = ['Type: Earring', 'STR: +4', 'Critical Damage: +3', 'Attack Speed: Fast', 'Remaining Enhancements: 5'];
  assert.deepEqual(parseGearStats(lines), { str: 4, critDamage: 3, slots: 5 });
  assert.deepEqual(parseGearStats(['INT: +6 (0 +6)', 'Remaining Enhancements: 0']), { int: 6, slots: 0 });
});

test('a tooltip without its slot line gives no stats', () => {
  assert.equal(parseGearStats(['Weapon Attack: +44']), null);
});

test('a tooltip missing one of the main lines gives no stats', () => {
  const read = ['Type: Earrings', 'INT: +6 {0 +6)', 'Remaining Enhancements: 0'];
  assert.equal(parseGearStats(read, ['mdef']), null);
  assert.deepEqual(parseGearStats(['Type: Earrings', 'INT: +6 {0 +6)', 'Magic Def.: +27', 'Remaining Enhancements: 0'], ['mdef']), { int: 6, mdef: 27, slots: 0 });
});

test('a requirement misread as a stat does not count', () => {
  const lines = ['STR : 75', 'Weapon Attack: +56 (55 +1)', 'Remaining Enhancements: 7'];
  assert.deepEqual(parseGearStats(lines, ['attack']), { attack: 56, slots: 7 });
});

test('reads both parts of a real scrolled item', () => {
  const lines = ['Type: Outfit', 'STR: +4', 'Weapon Def.; +89 (85 +4)', 'Magic Def: +2 (0 +2)', 'Remaining Enhancements; 9'];
  assert.deepEqual(parseGearStats(lines, ['wdef']), { str: 4, wdef: 89, mdef: 2, slots: 9 });
});

test('attack speed is not speed', () => {
  assert.equal(parseGearStats(['Attack Speed: 5', 'Remaining Enhancements: 7']).speed, undefined);
});

test('reads a real Blue Sauna Robe, as the reader really gave it', () => {
  // test/robe-hover-3.webp, with thin colons lost, and the lines around the stats
  const lines = ['BEGINNER WARRIOR MAGICIAN BOWMAN THIEF', '* Type: Outfit', '» STR: +1', 'DEX +4 (1 +3)', 'INT: +1', 'LUK +1', 'MaxHP +10', 'MaxmP: +10', 'Weapon Det. +75', 'Remaining Enhancements 8', 'If worn inside the hotel sauna, HP and', 'MP +99 recovery'];
  assert.deepEqual(parseGearStats(lines, ['wdef', 'hp', 'mp']), { str: 1, dex: 4, int: 1, luk: 1, hp: 10, mp: 10, wdef: 75, slots: 8 });
});

test('a stat line that was seen but not understood gives no stats', () => {
  // "Lik" is a misread LUK: leaving it out would look like a copy with no LUK at all
  assert.equal(parseGearStats(['STR: +1', 'Lik +1', 'Weapon Def.: +75', 'Remaining Enhancements: 10'], ['wdef']), null);
});

test('a + read as # still counts', () => {
  assert.deepEqual(parseGearStats(['LUK: #1', 'Remaining Enhancements: 10']), { luk: 1, slots: 10 });
});

test('a tooltip title gives its real name through any ending', () => {
  const names = ['Blue Sauna Robe', 'Buddy Overall Jeans (Red)', 'Dark Force Mail (M)'];
  const known = read => matchName(read, names);
  for (const read of ['Blue Sauna Robe (M)', 'Blue Sauna Robe (Mj', 'Blue Sauna Robe (IV) (#1)', 'Blue Sauna Robe [1']) assert.equal(knownTitle(read, known), 'Blue Sauna Robe', read);
  assert.equal(knownTitle('Buddy Overall Jeans (Red)', known), 'Buddy Overall Jeans (Red)');
  assert.equal(knownTitle('Dark Force Mail (M)', known), 'Dark Force Mail (M)');
  assert.equal(knownTitle('Not An Item (M)', known), null);
});

const lineOf = listing => ({ listing, next: null, streak: 0, stats: null, statReads: null });

test('a tooltip goes to the line under it', () => {
  const robe = lineOf({ name: 'Blue Sauna Robe' }), other = lineOf({ name: 'Blue Sauna Robe' }), firewood = lineOf({ name: 'Firewood' });
  const tip = { name: 'Blue Sauna Robe' };
  assert.equal(lineForTooltip(tip, robe, [robe, other, firewood], true), robe);
  assert.equal(lineForTooltip(tip, other, [robe, other, firewood], true), other);
  assert.equal(lineForTooltip(tip, firewood, [robe, firewood], true), robe, 'the only match');
  assert.equal(lineForTooltip(tip, firewood, [robe, other, firewood], true), null, 'two matches');
  assert.equal(lineForTooltip(tip, null, [robe], false), null, "the player's own item");
});

test('a tooltip the game may have moved never picks between copies of one item', () => {
  const low = lineOf({ name: 'Blue Sauna Robe' }), high = lineOf({ name: 'Blue Sauna Robe' });
  const tip = { name: 'Blue Sauna Robe', pushed: true };
  assert.equal(lineForTooltip(tip, low, [low, high], true), null);
  assert.equal(lineForTooltip(tip, low, [low], true), low);
});

test('only an item that may have a description needs room for one under its stats', () => {
  // room under the stat lines, from scanner.js on the real screenshots
  assert.equal(tooltipMoved(83, false), false, 'test/earrings-two-copies.webp: Pink-Flowered Earrings just above the chat');
  assert.equal(tooltipMoved(6, false), true, 'test/shot7.jpg: Blue Moon Shoes moved up to the bottom edge');
  assert.equal(tooltipMoved(75, true), true, 'test/robe-hover-1.webp: a robe with two lines of description');
  assert.equal(tooltipMoved(83), true, 'an unknown item may have one');
  const facts = itemFacts({ slots: { 'Pink-Flowered Earrings': 5, 'Blue Sauna Robe': 10 }, noDescription: { 'Pink-Flowered Earrings': true } });
  assert.equal(facts.described('Pink-Flowered Earrings'), false);
  assert.equal(facts.described('Blue Sauna Robe'), true);
  assert.equal(facts.described('Magic Potion'), true);
});

test('identical rows are one listing but keep a line each, in shop order', () => {
  // four "Mithril Titans, 1 for 4,399" always opened the top one, whichever was hovered
  const titans = { name: 'Mithril Titans' }, boots = { name: 'Blue Lappy Boots' }, ryden = { name: 'Ryden' };
  const row = (slot, name, price) => ({ list: 'shop', slot, name, qty: 1, price, sold: false });
  const merged = mergeCopies([0, 1, 2, 3].map(i => row(i, 'Mithril Titans', 4399)).concat(row(4, 'Blue Lappy Boots', 1800)));
  assert.equal(merged.length, 2);
  assert.equal(merged[0].copies, 4);

  const lines = [];
  assert.equal(placeRows(lines, [titans, titans, titans, titans, boots, ryden]), 0);
  assert.deepEqual(lines.map(l => l.listing.name), ['Mithril Titans', 'Mithril Titans', 'Mithril Titans', 'Mithril Titans', 'Blue Lappy Boots', 'Ryden']);
  // the third copy is hovered, and its price is under the tooltip so it isn't read
  assert.equal(placeRows(lines, [titans, titans, null, titans, boots, ryden]), 0);
  assert.equal(lines.length, 6);
  assert.equal(lineForTooltip({ name: 'Mithril Titans' }, lines[2], lines, true), lines[2]);
});

test('a scrolled shop list lines up with the rows already read', () => {
  const [a, b, c, d, e, f, g, h] = 'ABCDEFGH'.split('').map(name => ({ name }));
  const lines = [];
  assert.equal(placeRows(lines, [c, d, e, f, g, h]), 0, 'first seen scrolled down');
  assert.equal(placeRows(lines, [a, b, c, d, e, f], 0), 0, 'scrolled to the top adds lines above');
  assert.deepEqual(lines.map(l => l.listing.name).join(''), 'ABCDEFGH');
  assert.equal(placeRows(lines, [b, c, d, e, f, g], 0), 1, 'scrolled down one');
  assert.equal(placeRows(lines, [null, null, null, e, f, g], 1), 1, 'part of the list unread');
  assert.equal(lines.length, 8);
});

test('a shop line changes only when read the same twice', () => {
  const sword = { name: 'Sword' }, soldSword = { name: 'Sword', sold: true }, misread = { name: 'Swerd' };
  const lines = [];
  placeRows(lines, [sword]);
  placeRows(lines, [misread]);
  assert.equal(lines[0].listing, sword, 'one misread');
  placeRows(lines, [sword]);
  placeRows(lines, [soldSword]);
  placeRows(lines, [soldSword]);
  assert.equal(lines[0].listing, soldSword, 'it sold');
});

test('a line that takes another listing loses the old one\'s stats', () => {
  const fan = { name: 'Korean Fan' }, robe = { name: 'Blue Sauna Robe' };
  const lines = [];
  placeRows(lines, [fan]);
  Object.assign(lines[0], { stats: { attack: 56, slots: 7 }, statReads: new Map([['x', 2]]) });
  placeRows(lines, [robe]);
  assert.deepEqual(lines[0].stats, { attack: 56, slots: 7 }, 'one read could be a misread');
  placeRows(lines, [robe]);
  assert.equal(lines[0].listing, robe);
  assert.equal(lines[0].stats, null);
  assert.equal(lines[0].statReads, null);
});

test('a page jump to rows not seen yet starts the lines again', () => {
  // jackzhou's shop, Nov 9: 12 rows, scrolled a whole page from the Hecklers to the robes
  const [noel, knuckle, napoleon, fan, heckler, lionheart, robe, robe99, potion] = ['Red Noel', 'Adamantium Knuckle', 'Black Napoleon', 'Korean Fan', 'Heckler', 'Lionheart', 'Blue Sauna Robe', 'Blue Sauna Robe 99', 'White Potion'].map(name => ({ name }));
  const lines = [];
  let at = placeRows(lines, [noel, knuckle, napoleon, fan, heckler, lionheart]);
  lines[3].stats = { attack: 56, accuracy: 1, slots: 7 };
  for (let i = 0; i < 2; i++) at = placeRows(lines, [robe, robe, robe99, potion, potion, potion], at);
  assert.equal(at, 0);
  assert.deepEqual(lines.map(l => l.listing.name), ['Blue Sauna Robe', 'Blue Sauna Robe', 'Blue Sauna Robe 99', 'White Potion', 'White Potion', 'White Potion']);
  assert.ok(lines.every(l => !l.stats), 'no Korean Fan stats on a robe');
  // a scroll that overlaps still lines up
  at = placeRows(lines, [lionheart, robe, robe, robe99, potion, potion], at);
  assert.equal(at, 0, 'one new row above');
  assert.deepEqual(lines.map(l => l.listing.name).slice(0, 2), ['Lionheart', 'Blue Sauna Robe']);
  // one misread row where the window was is not a jump
  const two = [];
  placeRows(two, [fan, heckler, lionheart]);
  placeRows(two, [{ name: 'Korean Fen' }, heckler, lionheart]);
  assert.equal(two[0].listing, fan);
});

test('says how a copy differs from a plain one', () => {
  const list = require('../osms-items.json'), facts = itemFacts(list);
  const earrings = facts.base('Emerald Earrings'), robe = facts.base('Blue Sauna Robe');
  assert.deepEqual(earrings, { mdef: 27, critDamage: 2 });
  assert.equal(gearState({ mdef: 27, critDamage: 2, slots: 5 }, 5, earrings), 'clean');
  assert.equal(gearState({ mdef: 28, critDamage: 1, slots: 5 }, 5, earrings), 'clean, +1 M.Def, \u22121 crit dmg');
  assert.equal(gearState({ str: 1, dex: 4, int: 1, luk: 1, hp: 10, mp: 10, wdef: 75, slots: 8 }, 10, robe), '8 of 10 slots left, +3 DEX');
  assert.equal(facts.base('Red Potion'), null);
});

const kerning = { map: 'Kerning City Construction Site', room: null };
const windowOn = (picked, current = null) => ({ channelWindow: { picked, current } });
const dark = { dark: true }, game = {};
function follow(steps, place = kerning) {
  const channels = channelFollower(8000);
  steps.forEach((res, i) => channels.see(res, i * 100, place));
  return channels;
}

test('a channel is learned from the window', () => {
  assert.equal(follow([game]).channel, null);
  assert.equal(follow([windowOn(4)]).channel, 4);
});

test('a picked channel counts once the loading screen shows', () => {
  assert.equal(follow([windowOn(4), windowOn(12, 4), game]).channel, 4, 'not loaded yet');
  assert.equal(follow([windowOn(4), windowOn(12, 4), game, dark]).channel, 12);
});

test('a long loading screen keeps the new channel', () => {
  const channels = follow([windowOn(4), windowOn(12, 4), dark, dark, dark, game]);
  channels.arrived(kerning);
  assert.equal(channels.channel, 12);
});

test('a cancelled window keeps the channel', () => {
  const channels = channelFollower(8000);
  channels.see(windowOn(4), 0, kerning);
  channels.see(windowOn(12, 4), 100, kerning);
  channels.see(game, 200, kerning);
  channels.see(game, 9000, kerning);
  channels.see(dark, 9100, kerning); // later, changing map
  channels.arrived({ map: 'Kerning City', room: null });
  assert.equal(channels.channel, 4);
});

test('a pick that fell between two scans leaves the channel unknown at once, not stale', () => {
  // a keyboard change in a recording: the window on 33, then the next frame loads
  const channels = follow([windowOn(33), game, game, dark]);
  assert.equal(channels.channel, null);
  assert.equal(channels.needsPlace, false, 'nothing left to find out');
  channels.see(windowOn(32), 1000, kerning);
  assert.equal(channels.channel, 32, 'the next look at the window gives it back');
});

test('a change with no window seen at all is caught by the map after loading', () => {
  const channels = channelFollower(8000);
  channels.see(windowOn(28), 0, kerning);
  channels.see(game, 100, kerning);
  channels.see(game, 9000, kerning); // long after the window
  channels.see(dark, 9100, kerning);
  assert.equal(channels.channel, 28, 'could still be a portal');
  assert.equal(channels.needsPlace, false, 'not while loading');
  channels.see(game, 9300, kerning);
  assert.equal(channels.needsPlace, true);
  channels.arrived(kerning);
  assert.equal(channels.channel, null);
  assert.equal(channels.needsPlace, false);
});

test('a loading screen before any map was read leaves the channel unknown', () => {
  const channels = follow([windowOn(4), game, dark, game], null);
  channels.arrived(kerning);
  assert.equal(channels.channel, null);
});

test('a window opened on a stale channel corrects it', () => {
  assert.equal(follow([windowOn(4), game, windowOn(12)]).channel, 12);
});

// the window long ago, then a loading screen
function portal(place) {
  const channels = channelFollower(8000);
  channels.see(windowOn(4), 0, place);
  channels.see(game, 100, place);
  channels.see(game, 9000, place);
  channels.see(dark, 9100, place);
  channels.see(game, 9300, place);
  return channels;
}

test('a loading screen that changes map keeps the channel', () => {
  const channels = portal(kerning);
  channels.arrived({ map: 'Free Market', room: 3 });
  assert.equal(channels.channel, 4);
});

// the watch sees the loading screen at once, while a full scan of a frame from just before is still reading
test('a slow read of the old map, finished during the loading screen, is not an arrival', () => {
  const channels = channelFollower(8000);
  channels.see(windowOn(4), 0, kerning);
  channels.see(game, 100, kerning);
  channels.see(game, 9000, kerning);
  channels.see(dark, 9100, kerning);
  channels.arrived(kerning, 9050);
  assert.equal(channels.channel, 4);
  channels.see(game, 9800, kerning);
  channels.arrived({ map: 'Free Market', room: 3 }, 9850);
  assert.equal(channels.channel, 4);
});

test('a slow read of the old map, finished after a short loading screen, is not an arrival', () => {
  const channels = channelFollower(8000);
  channels.see(windowOn(4), 0, kerning);
  channels.see(game, 100, kerning);
  channels.see(game, 9000, kerning);
  channels.see(dark, 9100, kerning);
  channels.see(game, 9200, kerning);
  channels.arrived(kerning, 9050); // its frame was taken before the loading screen
  assert.equal(channels.channel, 4);
  assert.equal(channels.needsPlace, true, 'still waiting for the map it loaded into');
  channels.arrived({ map: 'Free Market', room: 3 }, 9250);
  assert.equal(channels.channel, 4);
});

test('a frame taken after the loading screen still catches an unseen channel change', () => {
  const channels = portal(kerning);
  channels.arrived(kerning, 9300);
  assert.equal(channels.channel, null);
});

test('another Free Market room is another map', () => {
  const channels = portal({ map: 'Free Market', room: 3 });
  channels.arrived({ map: 'Free Market', room: 4 });
  assert.equal(channels.channel, 4);
});

test('a picture that stopped leaves the channel unknown, even with the window open', () => {
  // test/change-channel.webp: the window was open on 25 when the picture stopped, and shows 26
  const channels = follow([windowOn(25)]);
  channels.lost();
  assert.equal(channels.channel, null);
  channels.see(windowOn(26), 1000, kerning);
  assert.equal(channels.channel, 26);
});

test('a scan is only sped up around the window', () => {
  const channels = channelFollower(8000);
  assert.equal(channels.watching, false);
  channels.see(windowOn(4), 0, kerning);
  assert.equal(channels.watching, true);
  channels.see(game, 100, kerning);
  assert.equal(channels.watching, true, 'the pick can still load');
  channels.see(game, 9000, kerning);
  assert.equal(channels.watching, false);
});

test('settings start on, are kept in a file, and refuse what they don\'t know', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-')), file = path.join(dir, 'settings.json');
  assert.deepEqual(readSettings(file), SETTINGS);
  assert.equal(readSettings(file).channelWatch, true, 'on until the player turns it off');
  assert.deepEqual(saveSettings(file, { channelWatch: false }), { ...SETTINGS, channelWatch: false });
  assert.equal(readSettings(file).channelWatch, false, 'kept for the next start');
  assert.equal(readSettings(file).cardHotkey, 'Scrolllock', 'a hotkey until the player picks another');
  assert.equal(saveSettings(file, { cardHotkey: '' }).cardHotkey, '', 'no hotkey is a choice too');
  assert.equal(readSettings(file).cardHotkey, '', 'and stays off');
  assert.equal(readSettings(file).channelWatch, false, 'one change leaves the others alone');
  assert.throws(() => saveSettings(file, { channelWatch: 'no' }));
  assert.throws(() => saveSettings(file, { colour: 'red' }));
  assert.equal(readSettings(file).channelWatch, false, 'a refused change leaves the file alone');
  assert.equal(readSettings(file).textSize, 1, 'normal size until the player picks another');
  assert.equal(saveSettings(file, { textSize: 1.3 }).textSize, 1.3);
  assert.throws(() => saveSettings(file, { textSize: 7 }), 'only the sizes on offer');
  assert.equal(readSettings(file).textSize, 1.3, 'kept for the next start');
  fs.writeFileSync(file, JSON.stringify({ textSize: 0.2 }));
  assert.equal(readSettings(file).textSize, 1, "a size that isn't on offer gives the default");
  assert.equal(readSettings(file).theme, 'auto', "Windows' light or dark mode until the player picks one");
  assert.equal(saveSettings(file, { theme: 'dark' }).theme, 'dark');
  assert.equal(readSettings(file).theme, 'dark', 'kept for the next start');
  assert.throws(() => saveSettings(file, { theme: 'purple' }), 'only the themes on offer');
  fs.writeFileSync(file, JSON.stringify({ theme: 'night' }));
  assert.equal(readSettings(file).theme, 'auto', "a theme that isn't on offer gives the default");
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(readSettings(file), SETTINGS, 'a damaged file gives the defaults');
  fs.rmSync(dir, { recursive: true });
});

test('says how worked an item is', () => {
  assert.equal(gearState({ slots: 7 }, 7), 'clean');
  assert.equal(gearState({ slots: 0 }, 5), '0 of 5 slots left');
  assert.equal(gearState({ slots: 5 }, null), '5 slots left');
});

test('says how long ago', () => {
  assert.deepEqual([agoText(1000), agoText(12 * 6e4), agoText(2 * 36e5)], ['just now', '12 min ago', '2 h ago']);
});

test('read stats must fit the item: its slots and its main lines', () => {
  const facts = itemFacts(require('../osms-items.json'));
  assert.equal(facts.fits('Blue Sauna Robe', { wdef: 75, hp: 10, mp: 10, str: 1, slots: 10 }), true);
  assert.equal(facts.fits('Blue Sauna Robe', { wdef: 75, hp: 10, mp: 10, slots: 0 }), true, 'every slot used');
  assert.equal(facts.fits('Blue Sauna Robe', { attack: 56, accuracy: 1, slots: 7 }), false, 'a Korean Fan\'s');
  assert.equal(facts.fits('Blue Sauna Robe', { wdef: 75, hp: 10, mp: 10, slots: 11 }), false, 'more slots than it has');
  assert.equal(facts.fits('Heckler', { attack: 63, slots: 7 }), true);
  assert.equal(facts.fits('Heckler', { attack: 63 }), false, 'no slot line');
  assert.equal(facts.fits('Heckler', null), false);
});

test('a stat a scroll added, like Jump on shoes, still fits', () => {
  const facts = itemFacts(require('../osms-items.json'));
  const read = ['Type: Shoes', 'LUK: +2', 'Weapon Def.: +11', 'Magic Def.: +12', 'Avoidability: +4', 'Speed: +2', 'Jump: +2', 'Remaining Enhancements: 4'];
  const stats = parseGearStats(read, facts.lines('Blue Moon Shoes'));
  assert.equal(facts.fits('Blue Moon Shoes', stats), true);
  assert.equal(gearState(stats, facts.slots('Blue Moon Shoes'), facts.base('Blue Moon Shoes')), '4 of 5 slots left, +2 jump');
});

const visit = (titles, sellers) => {
  const reads = { titles: new Map(), sellers: new Map() };
  titles.forEach(t => countRead(reads.titles, t));
  sellers.forEach(s => countRead(reads.sellers, s));
  return reads;
};

test('a seller or title only counts once it repeats, and the most common reading wins', () => {
  const reads = new Map();
  countRead(reads, 'Nef');
  countRead(reads, null);
  assert.equal(mostRead(reads, 2), null);
  assert.equal(mostRead(reads), 'Nef');
  for (let i = 0; i < 3; i++) countRead(reads, 'iNext');
  countRead(reads, 'Nef');
  assert.equal(mostRead(reads, 2), 'iNext');
});

test('a hidden seller stays the same shop while the title agrees', () => {
  const reads = visit(['The Good Stuff'], ['iNext']);
  assert.ok(isSameShop(reads, { title: 'The Good Stuff', seller: null }));
  assert.ok(isSameShop(reads, { title: 'The Goad Stuff', seller: 'Next' }));
  assert.ok(isSameShop(reads, { title: null, seller: null }));
  assert.ok(isSameShop(visit([], []), { title: 'NX', seller: 'iNext' }));
});

test('a different title or a different seller is a different shop', () => {
  assert.ok(!isSameShop(visit(['cheap cheap'], ['Zzoki']), { title: 'BUY ME OUT', seller: null }));
  assert.ok(!isSameShop(visit(['NX'], ['Bistu']), { title: 'NX', seller: 'Fennekin' }));
});

test('icons: a name gives the id its icon is saved under, and one with none keeps an empty slot', () => {
  const facts = itemFacts(require('../osms-items.json'));
  assert.equal(facts.icon('Brown Skullcap'), 1002000);
  assert.equal(facts.icon('brown  skullcap'), 1002000);
  assert.equal(facts.icon('Not An Item'), null);
  assert.match(iconTag(1002000), /src="\/icon\/1002000\.png"/);
  assert.equal(iconTag(null), '<span class="icon"></span>');
});

test('icons: downloaded once, kept on disk, only for known items, and nothing on failure', async () => {
  const { iconStore } = require('../serve.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const asked = [];
  let answer = () => ({ ok: true, arrayBuffer: async () => png });
  const download = async url => { asked.push(url); return answer(); };
  const items = { clientBuild: 'a', icons: { 'Brown Skullcap': 1002000, Other: 2000000, Broken: 3000000 } };
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'not an icon');

  const icons = iconStore(dir, items, download);
  assert.deepEqual(await Promise.all([icons(1002000), icons(1002000)]), [png, png]); // two pages at once, one download
  assert.deepEqual(asked, ['https://osmsdataexplorer.com/data/current/images/items/01002000.png']);
  assert.deepEqual(await iconStore(dir, items, download)(1002000), png); // after a restart, from disk
  assert.equal(asked.length, 1);
  assert.equal(await icons(1234), null); // not in osms-items.json, so never fetched
  assert.equal(asked.length, 1);

  answer = () => ({ ok: false, status: 404 });
  assert.equal(await icons(2000000), null);
  assert.equal(await icons(2000000), null); // not asked again straight away
  assert.equal(asked.length, 2);
  answer = () => ({ ok: true, arrayBuffer: async () => Buffer.from('<html>') });
  assert.equal(await icons(3000000), null); // not a PNG
  assert.ok(!fs.existsSync(path.join(dir, '3000000.png')));

  // new game data starts the icons over, and leaves anything else in the folder
  answer = () => ({ ok: true, arrayBuffer: async () => png });
  assert.deepEqual(await iconStore(dir, { ...items, clientBuild: 'b' }, download)(1002000), png);
  assert.equal(asked.length, 4);
  assert.ok(fs.existsSync(path.join(dir, 'mine.txt')));
});

test('sorts items into the game\'s inventory tabs by their id', () => {
  const facts = itemFacts(require('../osms-items.json'));
  const kind = name => facts.kind(name);
  assert.deepEqual(kind('Cromi'), { tab: 'equip', group: 'Weapon', kind: 'Wand' });
  assert.deepEqual(kind('Emerald Earrings'), { tab: 'equip', group: 'Earrings', kind: 'Earrings' });
  assert.equal(kind('"A" Cap').tab, 'cash', 'equipment with no upgrade slots is a Cash Shop look');
  assert.equal(kind('Ilbi Throwing Stars').group, 'Throwing star');
  assert.equal(kind('Gloves Attack Scroll: Intermediate').group, 'Scroll');
  assert.equal(kind('Ice Chair').tab, 'setup');
  assert.equal(kind('Bronze Ore').group, 'Ore');
  assert.equal(kind('Megaphone').tab, 'cash');
  assert.equal(kind('Not an item').tab, 'other');
});

test('the stats filter leaves out copies it can\'t judge', () => {
  const clean = { clean: true, range: {} };
  assert.ok(passesStats({ attack: 49, slots: 7 }, clean, 7));
  assert.equal(passesStats({ attack: 52, slots: 5 }, clean, 7), false, 'a scrolled copy');
  assert.equal(passesStats(null, clean, 7), false, 'stats never read');
  assert.ok(passesStats(null, null, 7), 'no filter lets everything through');
  const range = { clean: false, range: { attack: [50, 60] } };
  assert.ok(passesStats({ attack: 52, slots: 5 }, range, 7));
  assert.equal(passesStats({ attack: 48, slots: 7 }, range, 7), false);
  assert.equal(passesStats({ slots: 7 }, { range: { dex: [1, 5] } }, 7), false, 'a stat a copy lacks counts as 0');
});

test('offers a filter for each stat an item has', () => {
  const bounds = statBounds([{ attack: 48, slots: 7 }, { attack: 54, dex: 2, slots: 4 }], { attack: 48 });
  assert.deepEqual(bounds, [{ key: 'attack', lo: 48, hi: 54 }, { key: 'dex', lo: 0, hi: 2 }, { key: 'slots', lo: 4, hi: 7 }]);
  assert.deepEqual(statBounds([], { wdef: 44 }), [{ key: 'wdef', lo: 0, hi: 0 }, { key: 'slots', lo: 0, hi: 0 }], 'nothing read yet');
});

test('a price that rounds up takes the next unit', () => {
  assert.deepEqual([999999, 9999999, 999999999, 499999999999, 150000, 12345].map(fmt), ['1M', '10M', '1B', '500B', '150K', '12.3K']);
  assert.deepEqual([9999, 135, 1.5].map(fmt), ['9,999', '135', '1.5']);
});

test('a troll ask or a misprice goes off the chart instead of setting its scale', () => {
  const range = (prices, usual) => { const r = chartRange(prices, usual); return [r.lo, r.hi]; };
  // Orange Mushroom Cap: asks of 77, 999,999 and 9,999,999 with a usual price of 55
  assert.deepEqual(range([77, 999999, 9999999], 55), [55, 80]);
  // Iron Ore: round prices 250 to 420, a misprice of 20 and an 80,000 troll
  assert.deepEqual(range([250, 300, 310, 350, 400, 420, 20, 80000], 340), [250, 450]);
  // With no usual price, the lower quarter anchors it, so one troll among few still can't
  assert.deepEqual(range([100, 120, 140, 9999999], null), [100, 140]);
  // A price rising to 2.2M over a usual 1.88M stays on the chart
  assert.deepEqual(range([1.41e6, 1.7e6, 1.9e6, 2.22e6], 1.88e6), [1.4e6, 2.4e6]);
});

test('the price scale fits the prices instead of starting at zero', () => {
  // Power Elixir, 4,200 to 6,500, used to sit in a 0 to 10K chart
  assert.deepEqual(chartRange([4200, 5000, 6500], 5250), { lo: 4000, hi: 6500, step: 500 });
  // Every condition of a gear name, clean at 8K to scrolled at 250K, keeps zero in
  assert.equal(chartRange([8e3, 18e3, 20e3, 25e3, 189e3, 250e3], 189e3).lo, 0);
  // One price still gets a band around it, so a small change doesn't fill the chart
  assert.deepEqual(chartRange([2400], 2400), { lo: 2100, hi: 2700, step: 100 });
});

test('time marks count back in hours for a day, then mark dates', () => {
  const now = new Date(2026, 10, 10, 9, 30).getTime(), HOUR = 36e5, DAY = 24 * HOUR;
  assert.deepEqual(timeTicks(now, DAY).map(t => t.label), ['18 h ago', '12 h ago', '6 h ago']);
  assert.deepEqual(timeTicks(now, 3 * DAY).map(t => t.label), ['8 Nov', '9 Nov', '10 Nov']);
  // Long spans step a week at a time, on Mondays
  const weeks = timeTicks(now, 55 * DAY);
  assert.ok(weeks.every(t => new Date(t.t).getDay() === 1));
  assert.deepEqual(weeks.map(t => t.label).slice(-2), ['26 Oct', '2 Nov']);
  assert.equal(dateText(new Date(2026, 8, 28).getTime()), '28 Sep');
});
