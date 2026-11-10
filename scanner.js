// Finds shop windows and tooltips in a game frame and reads them cell by cell.
// Positions below were measured on a 2000 px wide screenshot and are scaled by
// the size of the orange buttons found in the frame.

const LAYOUT = {
  player: {
    buttonW: 110,
    lists: [{ id: 'shop', anchor: 0, nameX: -147, priceX: -147, w: 233, nameY: 93, priceY: 118 }],
    seller: { x: -190, y: 61, w: 120, h: 20 },
    title: { x: -186, y: -128, w: 690, h: 26 },
    rows: 6, stride: 58.6, cellH: 24,
  },
  npc: {
    buttonW: 95,
    lists: [{ id: 'npcBuys', anchor: 1, nameX: -158, w: 230, nameY: 139 }], // the player's items
    rows: 6, stride: 58.6, cellH: 24,
  },
};

// ---------- finding things by colour ----------
function components(img, test, minArea) {
  const { width: w, height: h, data: d } = img;
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) if (test(d[p], d[p + 1], d[p + 2])) mask[i] = 1;
  const out = [], stack = [];
  for (let i = 0; i < w * h; i++) {
    if (mask[i] !== 1) continue;
    let area = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
    stack.push(i); mask[i] = 2;
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k / w) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[k - 1] === 1) { mask[k - 1] = 2; stack.push(k - 1); }
      if (x < w - 1 && mask[k + 1] === 1) { mask[k + 1] = 2; stack.push(k + 1); }
      if (y > 0 && mask[k - w] === 1) { mask[k - w] = 2; stack.push(k - w); }
      if (y < h - 1 && mask[k + w] === 1) { mask[k + w] = 2; stack.push(k + w); }
    }
    if (area >= minArea) out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return out;
}

const isOrange = (r, g, b) => r > 190 && g > 80 && g < 160 && b < 90;
const TOOLTIP_FILL = 0.35;
const isTooltip = (r, g, b) => b > r + 22 && b > g + 22 && Math.abs(r - g) < 26 && b > 70 && b < 200 && r < 140;

// A window capture can be larger than the window, with black around it.
function contentWidth(img) {
  const { width: w, height: h, data: d } = img;
  for (let x = w - 1; x > 0; x -= 4) for (let y = 0; y < h; y += 16) {
    const i = (y * w + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] > 30) return x + 1;
  }
  return w;
}

function findShop(img) {
  const W = contentWidth(img);
  const btns = components(img, isOrange, W * 0.05)
    .filter(c => c.w > W * 0.03 && c.w < W * 0.09 && c.w / c.h > 4 && c.w / c.h < 8.5);
  for (const a of btns) for (const b of btns) {
    if (a === b || Math.abs(a.w - b.w) > 5) continue;
    const player = a.w / LAYOUT.player.buttonW, npc = a.w / LAYOUT.npc.buttonW;
    const stacked = Math.abs(a.x - b.x) <= 3 && Math.abs(b.y - a.y - 29 * player) < 8 * player;
    if (stacked) return { kind: 'player', scale: player, anchors: [a] };
    const sideBySide = Math.abs(a.y - b.y) <= 3 && Math.abs(b.x - a.x - 337 * npc) < 12 * npc;
    if (sideBySide) return { kind: 'npc', scale: npc, anchors: [a, b] };
  }
  return null;
}

// Bluish things next to a tooltip join its shape, but only the tooltip fills whole
// rows and columns, so the box is cut back to those.
function tighten(img, box) {
  const inBox = (x, y) => { const i = (y * img.width + x) * 4; return isTooltip(img.data[i], img.data[i + 1], img.data[i + 2]); };
  const solid = (from, to, count) => {
    const kept = [];
    for (let k = from; k < to; k++) if (count(k)) kept.push(k);
    return kept;
  };
  const countAcross = (k, from, to, at) => { let n = 0; for (let j = from; j < to; j++) if (at(k, j)) n++; return n; };
  const cols = solid(box.x, box.x + box.w, x => countAcross(x, box.y, box.y + box.h, inBox) >= box.h * TOOLTIP_FILL);
  if (!cols.length) return box;
  const x0 = cols[0], x1 = cols[cols.length - 1] + 1;
  const rows = solid(box.y, box.y + box.h, y => countAcross(y, x0, x1, (k, j) => inBox(j, k)) >= (x1 - x0) * TOOLTIP_FILL);
  if (!rows.length) return box;
  return { ...box, x: x0, w: x1 - x0, y: rows[0], h: rows[rows.length - 1] + 1 - rows[0] };
}

// Every card has a small blue dot before its title, with its icon panel not far below.
// Unlike a tooltip's blue, which depends on what's behind it, these always look the same.
const isTitleDot = (r, g, b) => b > 190 && g > 130 && r < 170 && b - r > 60;

// An icon panel starts right under the dot and is much narrower than a pale shop row.
// Its whole width is 98.7 px at scale 1 (99 at 1.0, 105 at 1.064 and 1.073 on screenshots
// with a shop), so each card says its own scale. The picture's width can't: the game
// draws its windows at 1.064 in a 1922 wide window and 1.27 in a 2560 wide one, and a
// cropped picture says nothing at all.
const PANEL_W = 98.7;
// Smaller than the game ever draws let a cyan chat line and a 70 px pale run pass as a card.
const CARD_SCALES = [0.85, 1.5];
// A shop says the real scale (`known`), and a card that disagrees is something else.
function findCards(img, known = null) {
  const pale = (x, y) => {
    const i = (y * img.width + x) * 4;
    return img.data[i] > 170 && img.data[i + 1] > 170 && img.data[i + 2] > 170;
  };
  // the widest pale run starting near the dot's left edge, because an icon can cut into
  // the panel's top edge, but its bottom edge is always whole
  const panelBelow = d => {
    let widest = null;
    for (let y = d.y + 8; y < Math.min(img.height, d.y + 230); y++) {
      for (let x = Math.max(1, d.x - 6); x <= d.x + 14; x++) {
        if (!pale(x, y) || pale(x - 1, y)) continue;
        let end = x;
        while (end < img.width && pale(end, y)) end++;
        const w = end - x;
        if (end < img.width && w >= 0.6 * PANEL_W && w <= 2 * PANEL_W && w > (widest?.w ?? 0)) widest = { x, y, w };
      }
    }
    return widest;
  };
  const cards = [];
  for (const d of components(img, isTitleDot, 10)) {
    if (Math.min(d.w, d.h) < 5 || Math.max(d.w, d.h) > 20 || d.area < d.w * d.h * 0.6) continue;
    const panel = panelBelow(d);
    if (!panel) continue;
    const scale = panel.w / PANEL_W;
    if (scale < CARD_SCALES[0] || scale > CARD_SCALES[1] || (known && Math.abs(scale / known - 1) > 0.12)) continue;
    // the dot and where the panel starts must fit the size the panel gives. Dots measure
    // 6.5 to 7.5 × scale, and a smoothly enlarged one about 5.5. The 15 px + button by the
    // minimap's WORLD button is 11.8 × the scale a pale run below it gave (test/shot11.jpg).
    const fits = Math.min(d.w, d.h) >= 5 * scale && Math.max(d.w, d.h) <= 9.5 * scale &&
      panel.x >= d.x - 4 * scale && panel.x <= d.x + 8 * scale && panel.y >= d.y + 12 * scale && panel.y <= d.y + 165 * scale;
    if (fits) cards.push({ ...d, scale });
  }
  return cards.sort((a, b) => a.x - b.x);
}

// What's behind a tooltip can split its blue into pieces, or leave too little of it to
// count, so the shape only gives its size. The cards say where it is. The leftmost is
// the hovered item, and a second one is the equipped item it's compared with.
function findTooltip(img, scale, known = null) {
  const W = contentWidth(img);
  const fill = c => c.area / (c.w * c.h);
  const boxes = components(img, isTooltip, W * W * 0.003)
    .filter(c => c.w > W * 0.1 && c.h > W * 0.06 && fill(c) > 0.15)
    .map(c => ({ c, box: tighten(img, c) }))
    .filter(({ c, box }) => fill(c) > 0.3 || iconTop(img, box, scale) !== null)
    .map(({ box }) => box);
  const left = Math.min(...boxes.map(b => b.x));
  const shape = boxes.filter(b => b.x - left < W * 0.02).sort((a, b) => a.y - b.y)[0] || null;
  const near = 20 * scale;
  const inShape = d => shape && d.x >= shape.x - near && d.x < shape.x + shape.w && d.y >= shape.y - near && d.y < shape.y + shape.h;
  // Something blue on a player can pass for a dot (test/earrings-hover.webp), so the card in
  // the tooltip's shape comes first, and a compared card's dot is always level with its own.
  const cards = findCards(img, known);
  const card = cards.find(inShape) ?? cards[0];
  if (!card) return shape;
  const next = cards.find(d => d.x > card.x && Math.abs(d.y - card.y) <= 3);
  const holds = inShape(card);
  const s = card.scale, x = Math.round(card.x - 13 * s);
  const size = { x, y: Math.round(card.y - 20 * s), w: Math.round((next ?? card).x + 340 * s - x), h: Math.round(300 * s) };
  return { ...(holds ? shape : size), card, next };
}

// The game draws its own white glove cursor into the picture, over everything, tooltips too.
// A tooltip opens below and to the right of it, so the tooltip's left edge says where to look
// but not how high: the game moves a tall tooltip up to fit it on screen, and the glove is then
// over the tooltip (test/shot7.jpg). Measured on every hover screenshot in test/: the glove's
// white is 15 to 17 wide and 27 to 31 tall at scale 1, about 43% filled, and starts between 3
// left and 3 right of the tooltip's edge. JPEG blur can split it (test/shot6.jpg), which only
// leaves it unfound. Returns the top of the glove, the fingertip, or null.
const isGloveWhite = (r, g, b) => Math.min(r, g, b) >= 235;
function findCursor(img, tip, s) {
  const x = Math.max(0, Math.round(tip.x - 12 * s)), y = Math.max(0, Math.round(tip.y - 60 * s));
  const w = Math.min(img.width - x, Math.round(50 * s)), h = Math.min(img.height - y, Math.round(560 * s));
  if (w <= 0 || h <= 0) return null;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) data.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4), j * w * 4);
  const gloves = components({ width: w, height: h, data }, isGloveWhite, 60 * s * s).filter(c => {
    const left = x + c.x - tip.x, fill = c.area / (c.w * c.h);
    return c.x > 0 && left >= -6 * s && left <= 8 * s && c.w >= 12 * s && c.w <= 20 * s &&
      c.h >= 23 * s && c.h <= 35 * s && fill >= 0.3 && fill <= 0.6;
  });
  return gloves.length === 1 ? { x: x + gloves[0].x, y: y + gloves[0].y } : null;
}

// ---------- channel and map, both read off the picture ----------
const isChannelButton = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) <= 14 && r >= 95 && r <= 215;
const isPickedChannel = (r, g, b) => Math.abs(r - 54) <= 34 && Math.abs(g - 170) <= 34 && Math.abs(b - 221) <= 34;
const CHANNELS_PER_ROW = 8;

// The Change Channel window: a grid of buttons, so a button's place is its number.
// Your channel is the blue one until another is picked. Then yours turns dark grey.
// Sizes were measured on a 1922 px wide capture. A small copy of the frame works too, which is
// how every frame can be watched for the window (see watchFrame).
function findChannelWindow(img) {
  const W = contentWidth(img), k = W / 1922, near = n => Math.max(2, n * k);
  const button = c => c.w > W * 0.04 && c.w < W * 0.075 && c.w / c.h > 2.4 && c.w / c.h < 4.8;
  const greys = components(img, isChannelButton, 800 * k * k).filter(button);
  if (greys.length < 16) return null;
  const width = greys.map(c => c.w).sort((a, b) => a - b)[greys.length >> 1];
  const sized = greys.filter(c => Math.abs(c.w - width) <= width * 0.14);
  // real buttons come in rows and columns
  const grid = sized.filter(c => sized.filter(o => Math.abs(o.y - c.y) <= near(6)).length >= 4 && sized.filter(o => Math.abs(o.x - c.x) <= near(6)).length >= 3);
  if (grid.length < 16) return null;
  const picked = components(img, isPickedChannel, 800 * k * k).filter(button)
    .find(c => grid.some(g => Math.abs(g.y - c.y) <= near(8)) && grid.some(g => Math.abs(g.x - c.x) <= near(8)));
  if (!picked) return null;
  const left = Math.min(picked.x, ...grid.map(c => c.x)), top = Math.min(picked.y, ...grid.map(c => c.y));
  const step = values => Math.min(...values.filter(v => v > width * 0.25));
  const stepX = step(grid.map(c => c.x - left)), stepY = step(grid.map(c => c.y - top));
  const number = c => Math.round((c.y - top) / stepY) * CHANNELS_PER_ROW + Math.round((c.x - left) / stepX) + 1;
  const brightness = c => {
    const i = ((c.y + Math.round(near(6))) * img.width + c.x + Math.round(near(6))) * 4;
    return img.data[i];
  };
  const dark = grid.find(c => brightness(c) < 140);
  return { picked: number(picked), current: dark ? number(dark) : null };
}

const isWorldButton = (r, g, b) => r > 190 && g > 110 && g < 215 && b < 120 && r - b > 90;
const isBlueButton = (r, g, b) => b > 170 && b - r > 60;

// The minimap can be dragged anywhere, but it always has its WORLD button, usually with
// a blue button beside it.
function findWorldButtons(img) {
  const W = contentWidth(img);
  // looks across the buttons' area, because their middles hold a white + or -
  const blueBeside = c => {
    const s = c.w / 52, left = Math.max(0, Math.round(c.x - 44 * s));
    let blue = 0;
    for (let y = c.y; y < c.y + c.h; y++) for (let x = left; x < c.x; x++) {
      const i = (y * img.width + x) * 4;
      if (isBlueButton(img.data[i], img.data[i + 1], img.data[i + 2])) blue++;
    }
    return blue >= 40 * s * s;
  };
  // Rooms with no map have grey buttons instead, so blue only decides which to try first.
  // parseMap throws out anything that wasn't really the minimap.
  return components(img, isWorldButton, 150)
    .filter(c => c.w > W * 0.018 && c.w < W * 0.045 && c.w / c.h > 2.5 && c.w / c.h < 5)
    .sort((a, b) => blueBeside(b) - blueBeside(a));
}

const onMinimapPanel = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return Math.abs(img.data[i] - 153) <= 34 && Math.abs(img.data[i + 1] - 187) <= 34 && Math.abs(img.data[i + 2] - 204) <= 34;
};

// The minimap gets wider on some maps, so the text is found from the panel, not the
// button: going left along it, the map's icon is the first long stretch of something else.
function panelTextLeft(img, button, s) {
  const y = Math.round(button.y + 34 * s), gap = Math.round(30 * s);
  let left = button.x + Math.round(44 * s), missed = 0;
  for (let x = left; x > 0 && missed < gap; x--) {
    if (onMinimapPanel(img, x, y)) { left = x; missed = 0; } else missed++;
  }
  return left;
}

// Expanded, the map's name is on a pale blue panel below the button; collapsed, it's on the bar.
function mapTextBox(img, button) {
  const s = button.w / 52;
  let panel = 0, tried = 0; // across an area, as a single pixel could land on a letter
  for (let y = Math.round(button.y + 30 * s); y < button.y + 70 * s; y += 3) for (let x = button.x; x < button.x + button.w; x += 3) {
    tried++;
    if (y < img.height && onMinimapPanel(img, x, y)) panel++;
  }
  const expanded = panel >= tried * 0.4;
  const left = expanded ? panelTextLeft(img, button, s) : button.x - 430 * s, right = expanded ? button.x + button.w : button.x - 64 * s;
  const top = expanded ? button.y + 28 * s : button.y - 6 * s, height = expanded ? 50 * s : 28 * s;
  const x = Math.max(0, Math.round(left)), y = Math.max(0, Math.round(top));
  return { expanded, box: { x, y, w: Math.round(right) - x, h: Math.min(Math.round(height), img.height - y) } };
}

// A loading screen, such as when the channel changes.
function isDark(img) {
  let bright = 0, seen = 0;
  for (let i = 0; i < img.data.length; i += 4 * 97) {
    seen++;
    if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 60) bright++;
  }
  return bright < seen * 0.05;
}

// The title sits right above the item's icon panel, whose top edge is a solid pale line
// (text never fills a row like that). A crafted item has an extra line above the title,
// so the title's height in the tooltip changes.
function iconTop(img, box, scale) {
  const left = Math.round(box.x + 16 * scale), width = Math.round(90 * scale);
  const bottom = Math.min(img.height, box.y + Math.round(170 * scale));
  for (let y = box.y + Math.round(10 * scale); y < bottom; y++) {
    let pale = 0;
    for (let x = left; x < left + width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] > 170 && img.data[i + 1] > 170 && img.data[i + 2] > 170) pale++;
    }
    if (pale >= width * 0.85) return y;
  }
  return null;
}

// The colour of a shop row's item icon. Its grey tile and black outlines don't count.
function iconColour(img, r) {
  let coloured = 0, gray = 0, red = 0, green = 0, blue = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const i = (y * img.width + x) * 4, R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
    const max = Math.max(R, G, B), sat = max ? (max - Math.min(R, G, B)) / max : 0;
    if (max < 64) continue;
    if (sat >= 0.12) { coloured++; red += R; green += G; blue += B; } else if (max < 180) gray++;
  }
  const total = r.w * r.h;
  if (!coloured) return { hue: 0, sat: 0, colouredShare: 0, grayShare: gray / total };
  const R = red / coloured, G = green / coloured, B = blue / coloured;
  const max = Math.max(R, G, B), span = max - Math.min(R, G, B);
  const hue = !span ? 0 : max === R ? ((G - B) / span + 6) % 6 : max === G ? (B - R) / span + 2 : (R - G) / span + 4;
  return { hue: hue * 60, sat: max ? span / max : 0, colouredShare: coloured / total, grayShare: gray / total };
}

// ---------- preparing a cell for the text reader ----------
function grayStats(img, r) {
  const hist = new Uint32Array(256);
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const i = (y * img.width + x) * 4;
    hist[(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) | 0]++;
  }
  const total = r.w * r.h;
  const pct = p => { let n = 0; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= total * p) return v; } return 255; };
  return { lo: pct(0.02), hi: pct(0.9) };
}

// The game's cursor can rest in a row after the text. A gap wider than any space
// between words means the text has ended, so what follows it isn't read.
function endAtGap(img, r) {
  const { lo, hi } = grayStats(img, r), ink = (lo + hi) / 2, maxGap = r.h * 1.2;
  let last = -1;
  for (let x = 0; x < r.w; x++) {
    let dark = false;
    for (let y = r.y; y < r.y + r.h && !dark; y++) {
      const i = (y * img.width + r.x + x) * 4;
      dark = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2] < ink;
    }
    if (!dark) continue;
    if (last >= 0 && x - last > maxGap) break;
    last = x;
  }
  return last < 0 ? r : { ...r, w: Math.min(r.w, last + 1 + Math.round(r.h / 3)) };
}

// Small fingerprint so an unchanged cell is never read twice.
function cellHash(img, r) {
  let h = 2166136261;
  for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) {
    const i = (y * img.width + x) * 4;
    h = Math.imul(h ^ (img.data[i + 1] >> 3), 16777619);
  }
  return h >>> 0;
}

// A short title alone in the wide bar reads as nothing, so only the part with text is read.
function titleText(img, r, scale) {
  const dark = x => {
    for (let y = r.y; y < r.y + r.h; y++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] + img.data[i + 1] + img.data[i + 2] < 300) return true;
    }
    return false;
  };
  let from = r.x;
  while (from < r.x + r.w && !dark(from)) from++;
  if (from === r.x + r.w) return null;
  let to = r.x + r.w - 1;
  while (!dark(to)) to--;
  const pad = Math.round(6 * scale), x = Math.max(r.x, from - pad);
  return { ...r, x, w: Math.min(r.x + r.w, to + 1 + pad) - x };
}

// A name plate is white letters on navy, which are never more green or red than blue.
// Anything that is, is a hat, weapon or effect in front of the name.
function plateCovered(img, r, scale) {
  const inset = Math.round(8 * scale); // the plate's own edge
  let off = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x + inset; x < r.x + r.w; x++) {
    const i = (y * img.width + x) * 4;
    if (Math.max(img.data[i], img.data[i + 1]) > img.data[i + 2] + 12) off++;
  }
  return off > (r.w - inset) * r.h * 0.002;
}

const FADED_SPAN = 90, FADED_GAMMA = 1.8;

function prepareCell(source, img, r, { invert = false, scale = 4, brightOnly = false, whiteOnly = false } = {}) {
  let { lo, hi } = grayStats(img, r);
  if (brightOnly) { lo = 204; hi = 206; } // tooltips are see-through: keep the bright title, drop what's behind it
  if (whiteOnly) [lo, hi] = whiteOnly === true ? [170, 245] : whiteOnly; // white letters on the pale minimap panel, whose red is only about 153
  const pad = 12, c = document.createElement('canvas');
  c.width = r.w * scale + pad * 2; c.height = r.h * scale + pad * 2;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, r.x, r.y, r.w, r.h, pad, pad, r.w * scale, r.h * scale);
  const out = g.getImageData(0, 0, c.width, c.height), d = out.data, span = Math.max(1, hi - lo);
  const faded = !brightOnly && !invert && span < FADED_SPAN; // a sold row's pale digits blur into each other
  for (let i = 0; i < d.length; i += 4) {
    // titles can be coloured, and an orange one isn't bright by luminance
    const level = brightOnly ? Math.max(d[i], d[i + 1], d[i + 2]) : whiteOnly ? Math.min(d[i], d[i + 1], d[i + 2]) : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let y = (level - lo) / span * 255;
    y = Math.max(0, Math.min(255, y));
    if (faded) y = 255 * Math.pow(y / 255, FADED_GAMMA);
    if (invert) y = 255 - y;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  // the padding must match the cell background
  const bg = invert && !whiteOnly ? 0 : 255;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (x >= pad && x < c.width - pad && y >= pad && y < c.height - pad) continue;
    const i = (y * c.width + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = bg;
  }
  g.putImageData(out, 0, 0);
  return c;
}

// ---------- parsing ----------
const fixDigits = t => t.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
const toInt = t => { const n = parseInt(fixDigits(t).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };

// The comma in a price can read as a space ("4 500"), so a following group of 3 digits belongs to it.
const PRICE = String.raw`[\dOoIl|SB,.]+(?: [\dOoIl|SB]{3}(?![\dA-Za-z]))*`;
const PLAYER_PRICE = new RegExp(String.raw`([\dOoIl|SB,.]+)\s*f[o0]r\s*(${PRICE})`);

// The game turns any higher ask into this (tried Nov 9 with 999999999999999999), so a bigger
// number is a misread, such as an extra digit.
const MAX_ASK = 499999999999;

function parsePlayerPrice(text) {
  const m = text.match(PLAYER_PRICE);
  if (!m) return null;
  // The row ends in "…" when it's too long ("1 for 499,999,999,999 me..."). Run straight into the
  // price, the "…" means digits are missing, and a shortened price looks like a deal.
  if (/(\.\.|…)$/.test(m[2]) || /^(\.\.|…)/.test(text.slice(m.index + m[0].length))) return null;
  const qty = toInt(m[1]), price = toInt(m[2]);
  return qty && price != null && price <= MAX_ASK ? { qty, price } : null;
}
function cleanName(text) {
  return text.replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9)'%.:]+$/, '').trim();
}
// A seller picks any title, so symbols stay, unlike in a name.
function cleanTitle(text) {
  const title = text.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').replace(/^[\s|_~]+|[\s|_~]+$/g, '');
  return /[A-Za-z0-9]/.test(title) ? title : null;
}
const isCutOff = name => /(\.\.|:|…)\s*$/.test(name);

const UPGRADES = /\s*\(?\+\s*\d{1,2}\s*\)?\s*$/; // a tooltip title's "(+3)", which shops don't show

// "REQ STR : 75", but the Q often reads as another letter.
const REQUIREMENT = /\bRE\S?\s*(LEV|STR|DEX|INT|LUK|FAM)/i;

// A tooltip's letters are white and what's behind them is tinted, so white can be told from
// the blue, yellow chat and pale shop rows by the weakest colour. Measured on
// test/robe-hover-*.webp: behind the text it stays under about 90, and the letters pass 200.
const TIP_TEXT = [90, 180];
const TIP_READ_H = 470; // the taller of a tooltip's measured height and this: it can measure short
// From the title's middle to the last stat line, as measured on those same pictures.
const TIP_FIRST_LINE = 184, TIP_LINE = 23.4;

// ---------- reading ----------
class ShopReader {
  constructor() {
    this.cache = new Map();
    this.worker = null;
    this.psm = null;
    this.letters = '';
    this.reads = 0;
  }

  async ready(onStatus) {
    if (this.worker) return;
    onStatus?.('Loading the text reader (first time only)…');
    const local = file => new URL(`node_modules/${file}`, location.href).href;
    this.worker = await Tesseract.createWorker('eng', 1, {
      workerPath: local('tesseract.js/dist/worker.min.js'),
      corePath: local('tesseract.js-core'),
      langPath: local('@tesseract.js-data/eng/4.0.0_best_int'),
    });
    await this.worker.setParameters({ preserve_interword_spaces: '1' });
  }

  async read(source, img, r, opts = {}) {
    const key = `${opts.invert ? 1 : 0}${opts.brightOnly ? 1 : 0}${opts.whiteOnly || 0}${opts.letters ?? ''}:${opts.psm || 7}:${r.w}x${r.h}:${cellHash(img, r)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const psm = String(opts.psm || 7);
    if (psm !== this.psm) { await this.worker.setParameters({ tessedit_pageseg_mode: psm }); this.psm = psm; }
    const letters = opts.letters ?? '';
    if (letters !== this.letters) { await this.worker.setParameters({ tessedit_char_whitelist: letters }); this.letters = letters; }
    // A data URL, because handing Tesseract a canvas costs a fixed 1 s per read (it waits on toBlob).
    const { data } = await this.worker.recognize(prepareCell(source, img, r, opts).toDataURL('image/png'));
    this.reads++;
    const text = data.text.trim();
    if (this.cache.size > 4000) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, text);
    return text;
  }

  async readShop(source, img, shop, tooltip) {
    const L = LAYOUT[shop.kind], s = shop.scale, rows = [];
    const rect = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    const inFrame = r => r.x >= 0 && r.y >= 0 && r.x + r.w <= img.width && r.y + r.h <= img.height;
    const covered = r => tooltip && r.x < tooltip.x + tooltip.w && r.x + r.w > tooltip.x && r.y < tooltip.y + tooltip.h && r.y + r.h > tooltip.y;
    // The part of a cell a tooltip leaves visible, or null when text runs under it.
    const visible = r => {
      if (!covered(r)) return r;
      const w = tooltip.x - r.x - Math.round(4 * s);
      if (w < r.w * 0.45) return null;
      const edgeW = Math.round(6 * s);
      const { lo, hi } = grayStats(img, { x: r.x + w - edgeW, y: r.y, w: edgeW, h: r.h });
      return hi - lo < 40 ? { ...r, w } : null;
    };

    // A tooltip opens just below and to the right of the cursor, unless the game moved it up,
    // so the cursor itself says the row when it's found
    const cursor = tooltip ? findCursor(img, tooltip, s) : null;
    const underCursor = (a, list, i) => {
      if (!tooltip) return false;
      const left = a.x + (list.nameX - 50) * s, right = left + (list.w + 100) * s;
      const top = a.y + (list.nameY + i * L.stride) * s, cursorY = cursor ? cursor.y + 2 * s : tooltip.y - 30 * s;
      return tooltip.x >= left && tooltip.x <= right && cursorY >= top && cursorY < top + L.stride * s;
    };

    // The row under the cursor, even when the tooltip hides its price so it isn't read
    let hoverSlot = null;
    for (const list of L.lists) {
      const a = shop.anchors[list.anchor];
      for (let i = 0; i < L.rows; i++) {
        const dy = i * L.stride;
        if (hoverSlot === null && underCursor(a, list, i)) hoverSlot = i;
        const nameR = rect(a.x + list.nameX * s, a.y + (list.nameY + dy) * s, list.w * s, L.cellH * s);
        const priceR = shop.kind === 'player' ? rect(a.x + list.priceX * s, a.y + (list.priceY + dy) * s, (list.w + list.nameX - list.priceX) * s, L.cellH * s) : null;
        if (!inFrame(nameR) || (priceR && !inFrame(priceR))) continue;
        const nameV = visible(nameR), priceV = priceR && visible(priceR);
        if (!nameV || (priceR && !priceV)) continue;
        const stats = grayStats(img, nameV);
        if (stats.hi - stats.lo < 40) continue; // empty slot
        const name = cleanName(await this.read(source, img, endAtGap(img, nameV)));
        // NPC prices come from the item data, so only a player's price is read
        const parsed = priceV ? parsePlayerPrice(await this.read(source, img, endAtGap(img, priceV))) : { qty: 1, price: null };
        if (name.length < 3 || !parsed) continue;
        const sold = shop.kind === 'player' && stats.hi > 232;
        const icon = rect(a.x + (list.nameX - 60) * s, a.y + (list.nameY - 4 + dy) * s, 52 * s, 50 * s);
        const iconTier = isCutOff(name) && inFrame(icon) ? tierFromIcon(iconColour(img, icon), sold) : null;
        const full = isCutOff(name) && fullScrollName(name, iconTier);
        rows.push({
          list: list.id, slot: i,
          name: full || name,
          partial: full ? name : null, // what was really read, so a tooltip can still correct the tier
          iconTier,
          cut: isCutOff(name) && !full,
          clipped: nameV !== nameR, // part of the name may be under a tooltip
          hovered: underCursor(a, list, i),
          sold,
          ...parsed,
        });
      }
    }

    let seller = null, title = null;
    const area = q => rect(shop.anchors[0].x + q.x * s, shop.anchors[0].y + q.y * s, q.w * s, q.h * s);
    if (L.seller) {
      const r = area(L.seller);
      if (inFrame(r) && !covered(r) && !plateCovered(img, r, s)) seller = cleanName(await this.read(source, img, r, { invert: true })) || null;
    }
    if (L.title) {
      const r = area(L.title), text = inFrame(r) && !covered(r) ? titleText(img, r, s) : null;
      if (text) title = cleanTitle(await this.read(source, img, text));
    }
    // A tooltip can hide the very row it belongs to, so this says it came from the shop's
    // list and not from the player's own inventory.
    const overList = !!tooltip && L.lists.some(list => {
      const left = shop.anchors[list.anchor].x + (list.nameX - 50) * s;
      return tooltip.x >= left && tooltip.x <= left + (list.w + 100) * s;
    });
    return { seller, title, rows, overList, hoverSlot, cursor };
  }

  async readTooltip(source, img, box, scale) {
    const clip = r => {
      const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
      return { x, y, w: Math.min(img.width - x, Math.round(r.w)), h: Math.min(img.height - y, Math.round(r.h)) };
    };
    const { card, next } = box;
    const icon = card ? null : iconTop(img, box, scale);
    // lines can sit above and below a title, so the dot says where it is, not the icon panel
    const titleY = card ? card.y + card.h / 2 - 18 * scale : icon === null ? box.y + 6 * scale : icon - 38 * scale;
    const left = card ? card.x - 13 * scale : box.x, titleX = card ? card.x + card.w : left + 20 * scale;
    const right = next ? next.x - 26 * scale : box.x + box.w;
    const title = clip({ x: titleX, y: titleY, w: right + (next ? 0 : 4 * scale) - titleX, h: 36 * scale }); // a long title reaches the edge
    const read = cleanName(await this.read(source, img, title, { invert: true, brightOnly: true })).replace(/[\s:.]+$/, '');
    const plain = cleanName(read.replace(UPGRADES, ''));
    const name = fullScrollName(plain, null) ?? plain;
    // the lower part of a tooltip can be over something that hides its colour, so read past the box
    const body = clip({ x: left + 8 * scale, y: titleY + 38 * scale, w: right - left - 16 * scale, h: Math.max(box.h, TIP_READ_H * scale) });
    const text = await this.read(source, img, body, { invert: true, psm: 6, scale: 3, whiteOnly: TIP_TEXT });
    const stats = text.split('\n').filter(l => l.trim() && !REQUIREMENT.test(l));
    // Near the bottom of the screen the game may have moved this up, so where it sits
    // doesn't say which row it's for. The space left under its stat lines says (tooltipMoved
    // in pricing.js, which knows whether a description comes after them). Its height is
    // worked out because see-through blue can measure short. Type and the slot line have no plus sign.
    const lines = stats.filter(l => /\+\s*\d/.test(l)).length + 2;
    const room = (img.height - titleY) / scale - (18 + TIP_FIRST_LINE + lines * TIP_LINE);
    // where it was read from, for recordings: a misread title is usually a strip in the wrong place
    const where = { dot: card && { x: card.x, y: card.y, w: card.w, h: card.h }, title, scale: +scale.toFixed(3), room: Math.round(room) };
    return { name, stats, room, where };
  }

  async readMap(source, img) {
    for (const button of findWorldButtons(img).slice(0, 3)) {
      const { expanded, box } = mapTextBox(img, button);
      if (box.w < 40 || box.h < 10) continue;
      if (expanded) {
        const line = { ...box, y: Math.round(box.y + box.h * 0.46), h: Math.round(box.h * 0.54) };
        const room = parseFmRoom(await this.read(source, img, line, { invert: true, whiteOnly: true, letters: FM_LETTERS }));
        if (room) return room;
      }
      const place = parseMap(await this.read(source, img, box, { psm: expanded ? 6 : 7, invert: expanded, whiteOnly: expanded }));
      if (place) return place;
    }
    return null;
  }

  // One full pass over a frame. The map is read with a shop, or when asked for.
  async scan(source, { wantPlace = false } = {}) {
    const g = source.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, source.width, source.height);
    const shop = findShop(img);
    const scale = shop?.scale ?? source.width / 2000;
    const tipBox = findTooltip(img, scale, shop?.scale);
    const channelWindow = shop ? null : findChannelWindow(img);
    const dark = !shop && !channelWindow && isDark(img);
    const place = !shop && wantPlace && !dark && !channelWindow ? await this.readMap(source, img) : null;
    if (!shop && !tipBox) return { kind: null, seller: null, title: null, rows: [], tooltip: null, channelWindow, dark, place };
    const result = { kind: shop?.kind ?? null, seller: null, title: null, rows: [], tooltip: null, channelWindow, dark, place };
    if (shop) {
      Object.assign(result, await this.readShop(source, img, shop, tipBox));
      result.place = await this.readMap(source, img);
    }
    // with no shop, a card's own icon panel gives the size, not the guess from the picture's width
    if (tipBox) result.tooltip = await this.readTooltip(source, img, tipBox, shop?.scale ?? tipBox.card?.scale ?? scale);
    return result;
  }
}

self.ShopReader = ShopReader; // self, because watch.js loads this in a worker
