// The main window opens where and as big as it was last closed (desktop/window-state.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { windowOptions, saveWindowState, DEFAULT } = require('../desktop/window-state.js');

const MAIN = { x: 0, y: 0, width: 1920, height: 1040 };   // a 1080p screen without the taskbar
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 }; // a second screen to its right

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-'));
  return { dir, file: path.join(dir, 'window.json') };
}

test('opens where and as big as it was closed', () => {
  const { dir, file } = scratch();
  assert.deepEqual(windowOptions(file, [MAIN]), { ...DEFAULT, maximized: false }, 'the first time: the usual size, centred');
  saveWindowState(file, { x: 200, y: 100, width: 1400, height: 900 }, false);
  assert.deepEqual(windowOptions(file, [MAIN]), { x: 200, y: 100, width: 1400, height: 900, maximized: false });
  saveWindowState(file, { x: 200, y: 100, width: 1400, height: 900 }, true);
  assert.deepEqual(windowOptions(file, [MAIN]), { x: 200, y: 100, width: 1400, height: 900, maximized: true },
    'maximized again, with the size to go back to');
  fs.rmSync(dir, { recursive: true });
});

test('a window left on a screen that is gone opens centred on the main one', () => {
  const { dir, file } = scratch();
  saveWindowState(file, { x: 2300, y: 200, width: 1600, height: 1000 }, false);
  assert.deepEqual(windowOptions(file, [MAIN, RIGHT]), { x: 2300, y: 200, width: 1600, height: 1000, maximized: false },
    'still there: back on the second screen');
  assert.deepEqual(windowOptions(file, [MAIN]), { width: 1600, height: 1000, maximized: false }, 'unplugged: centred');
  saveWindowState(file, { x: 2300, y: 200, width: 2400, height: 1300 }, false);
  assert.deepEqual(windowOptions(file, [MAIN]), { width: 1920, height: 1040, maximized: false },
    "and never bigger than the main screen, so it isn't cut off");
  fs.rmSync(dir, { recursive: true });
});

test('a title bar dragged nearly off the screen opens centred, so it can be reached', () => {
  const { dir, file } = scratch();
  saveWindowState(file, { x: 1850, y: 100, width: 1100, height: 800 }, false);
  assert.deepEqual(windowOptions(file, [MAIN]), { width: 1100, height: 800, maximized: false }, 'only 70 px left on screen');
  saveWindowState(file, { x: 100, y: -790, width: 1100, height: 800 }, false);
  assert.deepEqual(windowOptions(file, [MAIN]), { width: 1100, height: 800, maximized: false }, 'title bar above the screen');
  saveWindowState(file, { x: 1700, y: 100, width: 1100, height: 800 }, false);
  assert.equal(windowOptions(file, [MAIN]).x, 1700, '220 px of title bar is enough to grab');
  fs.rmSync(dir, { recursive: true });
});

test('a damaged or odd file gives the usual window', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(windowOptions(file, [MAIN]), { ...DEFAULT, maximized: false });
  fs.writeFileSync(file, JSON.stringify({ width: 'big', height: 800 }));
  assert.deepEqual(windowOptions(file, [MAIN]), { ...DEFAULT, maximized: false });
  fs.writeFileSync(file, JSON.stringify({ width: 50, height: 40 }));
  assert.deepEqual(windowOptions(file, [MAIN]), { width: 400, height: 300, maximized: false }, 'too small to use: the smallest that is');
  fs.rmSync(dir, { recursive: true });
});
