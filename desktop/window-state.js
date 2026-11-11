// Where the main window was and how big, so it opens the same way next time, like most apps
// (Nov 11). Kept in window.json in the app's data folder, beside settings.json. No Electron here,
// so Node can test it (test/window-state.test.js).
const fs = require('fs');
const path = require('path');

const DEFAULT = { width: 1100, height: 800 };
const MIN = { width: 400, height: 300 };
// How much of the title bar must still be on a screen to put the window back where it was. Less,
// and a screen that's been unplugged or moved would leave it out of reach, so it opens centred.
const VISIBLE = { width: 120, height: 40 };

const isNumber = n => Number.isFinite(n);

// The window's options from the saved file, checked against the screens there are now:
// { x, y, width, height } or just { width, height } to let Windows centre it, plus maximized.
// `displays` are each screen's workArea ({ x, y, width, height }), the first being the main one.
function windowOptions(file, displays) {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} // none yet, or damaged
  const maximized = saved?.maximized === true;
  if (!saved || ![saved.width, saved.height].every(isNumber)) return { ...DEFAULT, maximized };
  const main = displays[0];
  // Never bigger than the main screen, so a size from a bigger screen that's gone still fits.
  const width = Math.round(Math.min(Math.max(saved.width, MIN.width), main?.width ?? saved.width));
  const height = Math.round(Math.min(Math.max(saved.height, MIN.height), main?.height ?? saved.height));
  if (![saved.x, saved.y].every(isNumber)) return { width, height, maximized };
  const x = Math.round(saved.x), y = Math.round(saved.y);
  // The title bar, the top strip that's dragged: it has to be on some screen.
  const onScreen = displays.some(d =>
    Math.min(x + width, d.x + d.width) - Math.max(x, d.x) >= VISIBLE.width &&
    Math.min(y + VISIBLE.height, d.y + d.height) - Math.max(y, d.y) >= VISIBLE.height);
  return onScreen ? { x, y, width, height, maximized } : { width, height, maximized };
}

// `bounds` are the window's normal bounds, its size before it was maximized.
function saveWindowState(file, bounds, maximized) {
  const { x, y, width, height } = bounds;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ x, y, width, height, maximized: !!maximized })}\n`);
}

module.exports = { windowOptions, saveWindowState, DEFAULT };
