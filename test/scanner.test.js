// Tooltip cards drawn at known sizes. Real screenshots are checked in a browser page (see
// CLAUDE.md), because reading text needs Tesseract and a canvas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scanner = vm.createContext({ self: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'scanner.js'), 'utf8'), scanner);
const { findCards, findCursor } = scanner;

// A navy tooltip with a title dot and an icon panel under it, as the game draws them.
function picture(width, height, shapes) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([40, 50, 110, 255], i);
  for (const { x, y, w, h, rgb, round } of shapes) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = i + 0.5 - w / 2, dy = j + 0.5 - h / 2;
      if (round && dx * dx + dy * dy > (w / 2) * (h / 2)) continue;
      data.set([...rgb, 255], ((y + j) * width + x + i) * 4);
    }
  }
  return { width, height, data };
}
const DOT = [90, 180, 240], PALE = [230, 230, 230];
const card = (s, x = 100, y = 100, dot = Math.round(7.3 * s)) => [
  { x, y, w: dot, h: dot, rgb: DOT, round: true },
  { x: x + Math.round(2 * s), y: y + Math.round(26 * s), w: Math.round(98.7 * s), h: Math.round(95 * s), rgb: PALE },
];

test('a tooltip card says its own scale, whatever the window size', () => {
  // 1.064 in a 1922 wide window, 1.27 in a 2560 wide one: the width can't say which
  for (const s of [1, 1.064, 1.27]) {
    const found = findCards(picture(500, 400, card(s)));
    assert.equal(found.length, 1, `scale ${s}`);
    assert.ok(Math.abs(found[0].scale - s) < 0.02, `scale ${s} read as ${found[0].scale}`);
  }
});

test('a card that disagrees with the shop is something else', () => {
  assert.equal(findCards(picture(500, 400, card(1.27)), 1.064).length, 0);
  assert.equal(findCards(picture(500, 400, card(1.064)), 1.064).length, 1);
});

test('blue things with something pale below them are not cards', () => {
  // the 15 px + button by the minimap's WORLD button, over a pale run (test/shot11.jpg)
  const button = [{ x: 100, y: 100, w: 15, h: 15, rgb: DOT }, { x: 102, y: 133, w: 125, h: 60, rgb: PALE }];
  assert.equal(findCards(picture(500, 400, button)).length, 0);
  // a cyan chat line over a 70 px pale run, which would be a card smaller than the game draws
  const chat = [{ x: 100, y: 100, w: 5, h: 8, rgb: DOT }, { x: 101, y: 118, w: 70, h: 40, rgb: PALE }];
  assert.equal(findCards(picture(500, 400, chat)).length, 0);
});

test('a shop price is only kept when it could be real and is read whole', () => {
  const { parsePlayerPrice } = scanner;
  const read = t => JSON.parse(JSON.stringify(parsePlayerPrice(t)));
  // the game's highest ask, with the row cut off after it (Nov 9, a Lemon)
  assert.deepEqual(read('1 for 499,999,999,999 me...'), { qty: 1, price: 499999999999 });
  assert.deepEqual(read('1 for 4,500 me…'), { qty: 1, price: 4500 });
  // more than the game allows is a misread, such as an extra digit
  assert.equal(parsePlayerPrice('1 for 4,999,999,999,999 me...'), null);
  // a price cut short by the row's end would look like a deal
  assert.equal(parsePlayerPrice('1000 for 499,999,999,9...'), null);
  assert.equal(parsePlayerPrice('1000 for 499,999,999,9…'), null);
  assert.equal(parsePlayerPrice('1000 for 499,999,999…'), null);
});

// The game's glove: a finger and a palm, white, about 16 x 28 at scale 1 and 45% filled.
const WHITE = [255, 255, 255];
const glove = (x, y, s = 1) => [
  { x: x + Math.round(2 * s), y, w: Math.round(4 * s), h: Math.round(13 * s), rgb: WHITE },
  { x, y: y + Math.round(12 * s), w: Math.round(16 * s), h: Math.round(16 * s), rgb: WHITE, round: true },
];

test('finds the game cursor beside a tooltip, above it or over it', () => {
  for (const s of [1, 1.27]) {
    const tip = { x: 200, y: 300, w: 340, h: 300 };
    // above, as when the tooltip opens where it should
    let found = findCursor(picture(700, 900, glove(203, 270, s)), tip, s);
    assert.deepEqual(found, { x: 203, y: 270 }, `above at scale ${s}`);
    // over it, lower down, as when the game moved a tall tooltip up (test/shot7.jpg)
    found = findCursor(picture(700, 900, glove(203, 480, s)), tip, s);
    assert.deepEqual(found, { x: 203, y: 480 }, `over at scale ${s}`);
  }
});

test('anything else white near a tooltip is not the cursor', () => {
  const tip = { x: 200, y: 300, w: 340, h: 300 };
  assert.equal(findCursor(picture(700, 900, glove(230, 330)), tip, 1), null, 'too far right: the title starts there');
  assert.equal(findCursor(picture(700, 900, [{ x: 200, y: 270, w: 40, h: 37, rgb: WHITE }]), tip, 1), null, 'a pale sold row');
  assert.equal(findCursor(picture(700, 900, [{ x: 203, y: 400, w: 12, h: 14, rgb: WHITE }]), tip, 1), null, 'a letter');
  assert.equal(findCursor(picture(700, 900, [...glove(203, 270), ...glove(203, 480)]), tip, 1), null, 'two could be either');
});

// A shop row as the game draws it: dark text on blue-grey for sale, pale grey text on white sold.
const ROW = [200, 212, 224], INK = [40, 40, 40], SOLD_ROW = [246, 246, 246], SOLD_INK = [200, 200, 200];
const BLACK = [0, 0, 0];
function row(sold, over = []) {
  const letters = [];
  for (let x = 104; x < 260; x += 9) letters.push({ x, y: 104, w: 5, h: 15, rgb: sold ? SOLD_INK : INK });
  return picture(400, 160, [{ x: 100, y: 100, w: 233, h: 30, rgb: sold ? SOLD_ROW : ROW }, ...letters, ...over]);
}
// the glove with its black outline, which is all that shows of it on a white sold row
const outlined = (x, y) => [{ x: x - 1, y: y - 1, w: 18, h: 30, rgb: BLACK }, ...glove(x, y)];

test('the cursor over a row\'s text is found, and where it starts', () => {
  const { coverStart } = scanner;
  const cell = { x: 100, y: 100, w: 233, h: 24 };
  for (const sold of [false, true]) {
    assert.equal(coverStart(row(sold), cell, 1, sold), -1, `a clean ${sold ? 'sold ' : ''}row`);
    const at = coverStart(row(sold, outlined(170, 98)), cell, 1, sold);
    assert.ok(at >= 68 && at <= 73, `on the digits of a ${sold ? 'sold ' : ''}row: ${at}`);
  }
  // a white line across the cell, like the edge between two rows, is no cover
  assert.equal(coverStart(row(false, [{ x: 100, y: 100, w: 233, h: 2, rgb: WHITE }]), cell, 1, false), -1);
  assert.ok(coverStart(row(false, glove(170, 98, 1.27)), { ...cell, h: 30 }, 1.27, false) >= 0, 'at the 2560 size');
});

test('a price next to a cover only counts when "mesos" starts after it', () => {
  const { parsePlayerPrice } = scanner;
  const read = (text, covered) => { const p = parsePlayerPrice(text, covered); return p && { ...p }; };
  // what test/cursor-price-1.webp, earrings-hover.webp and robe-hover-3.webp read up to the glove
  assert.equal(parsePlayerPrice('1for19,', true), null);
  assert.equal(parsePlayerPrice('1 for 55,000', true), null, 'the cover may hide more digits');
  assert.deepEqual(read('1 for 15,000 me:', true), { qty: 1, price: 15000 });
  assert.deepEqual(read('1 for 240,000 mesc', true), { qty: 1, price: 240000 });
  assert.deepEqual(read('1 for 55,000', false), { qty: 1, price: 55000 }, 'nothing on the row');
});

// The green button above a shop's two orange ones, with its two words as pale blocks.
const GREEN = [177, 201, 41], LETTER = [225, 235, 170];
function shopButton(words, s = 1) {
  const at = n => Math.round(n * s);
  return picture(400, 200, [
    { x: 100, y: 100 - at(46), w: at(110), h: at(20), rgb: GREEN },
    ...words.map(([from, to]) => ({ x: 100 + at(from), y: 100 - at(46) + at(6), w: at(to - from), h: at(8), rgb: LETTER })),
  ]);
}

test('the green button says whose shop it is', () => {
  const { ownShop } = scanner;
  for (const s of [1, 1.27]) {
    const shop = { kind: 'player', scale: s, anchors: [{ x: 100, y: 100 }] };
    // SELLER INFO: a long word, then a short one. SOLD ITEMS: a short word, then a longer one.
    assert.equal(ownShop(shopButton([[12, 58], [65, 88]], s), shop), false, `someone else's at ${s}`);
    assert.equal(ownShop(shopButton([[14, 44], [51, 90]], s), shop), true, `your own at ${s}`);
    // nothing readable, such as a tooltip over it, or a gap in the middle: not known, so not saved
    assert.equal(ownShop(shopButton([], s), shop), null);
    assert.equal(ownShop(shopButton([[12, 49], [56, 88]], s), shop), null);
    assert.equal(ownShop(shopButton([[12, 58], [65, 88]], s), { ...shop, kind: 'npc' }), null);
  }
});
