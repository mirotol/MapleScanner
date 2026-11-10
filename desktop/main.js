// The Windows app: runs the local server and shows its pages in app windows.
const { app, BrowserWindow, Menu, desktopCapturer, globalShortcut, ipcMain, screen, session } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const { start, readSettings, saveSettings, TEXT_SIZES } = require('../serve.js');

// The app was called "Maple Scanner" until Nov 10, and its data folder keeps that name so every
// existing price database is still found. productName alone would decide it otherwise.
app.setPath('userData', path.join(app.getPath('appData'), 'Maple Scanner'));

const BACKGROUND = '#fbf7ee'; // --night in theme.css, so no window flashes white while it opens
const TITLE_BAR = { color: BACKGROUND, symbolColor: '#6b5438', height: 44 };
const PANEL_WIDTH = 340, PANEL_HEIGHT = 720;

let main = null;
let panel = null;        // the popped-out stall card
let chosenWindow = null; // the game window picked in the scanner page
let settingsFile = null;
let hotkey = '';         // the saved key that shows and hides the stall card, '' for none
let hotkeyWorks = false; // false when another program already has it

async function listWindows() {
  const own = BrowserWindow.getAllWindows().map(w => w.getMediaSourceId());
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 } });
  return sources.filter(s => !own.includes(s.id)).map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
}

// Whether MapleStory.exe is running, asked only when its window isn't in the list. On Nov 7 a
// running game's window was missing from the list, and capture failed even with MapleScanner as
// administrator, until the game was restarted. Running as administrator isn't the cause: the
// game always runs as administrator and is captured fine by a MapleScanner that isn't.
// Only the process name is checked, nothing inside the game.
function gameRunning() {
  return new Promise(done => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq MapleStory.exe', '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 5000 },
      (error, stdout) => done(!error && /"MapleStory\.exe"/i.test(stdout)));
  });
}

// Answers the page's request to capture with the window picked there.
function allowCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['window'] });
    const source = sources.find(s => s.id === chosenWindow);
    callback(source ? { video: source } : {});
  });
}

// about:blank is the stall card. The page moves its price panel into it. It can't take focus,
// because the player's keyboard and mouse belong to the game.
function openPanel(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url !== 'about:blank') return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: PANEL_WIDTH, height: PANEL_HEIGHT, frame: false, resizable: false, maximizable: false, focusable: false,
        alwaysOnTop: true, backgroundColor: BACKGROUND, title: 'MapleScanner', autoHideMenuBar: true,
      },
    };
  });
  window.webContents.on('did-create-window', child => {
    panel = child;
    child.setAlwaysOnTop(true, 'screen-saver');
    const shown = () => main?.webContents.send('card-shown', child.isVisible());
    child.on('show', shown);
    child.on('hide', shown);
    child.on('closed', () => { panel = null; });
  });
}

// Fits the stall card to what's on show, without running off the bottom of the screen. The width
// and the tallest it gets follow the text size, and a card made wider stays on screen.
function fitPanel(width, height) {
  if (!panel || !Number.isFinite(width) || !Number.isFinite(height)) return;
  const scale = Math.min(Math.max(width / PANEL_WIDTH, Math.min(...TEXT_SIZES)), Math.max(...TEXT_SIZES));
  const bounds = panel.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  const wide = Math.round(PANEL_WIDTH * scale);
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - wide));
  const room = workArea.y + workArea.height - bounds.y;
  const tall = Math.round(Math.min(height, PANEL_HEIGHT * scale, room));
  if (tall !== bounds.height || wide !== bounds.width || x !== bounds.x) panel.setBounds({ ...bounds, x, width: wide, height: tall });
}

// The hotkey works while the game is in front. It's a Windows hotkey, so the game never gets that
// key while MapleScanner runs: the player picks one their own MapleStory keys don't use.
// The card is hidden rather than closed, and comes back without taking focus from the game.
function showCard() {
  if (!panel || panel.isVisible()) return;
  panel.showInactive();
  panel.setAlwaysOnTop(true, 'screen-saver');
}

function toggleCard() {
  if (!panel) return main?.webContents.send('pop-out');
  if (panel.isVisible()) panel.hide(); else showCard();
}

function useHotkey(accelerator) {
  globalShortcut.unregisterAll();
  if (!accelerator) return true;
  try {
    return globalShortcut.register(accelerator, toggleCard);
  } catch { // not a key Electron knows
    return false;
  }
}

// Saved only once Windows has given the app the key.
function setHotkey(accelerator) {
  if (typeof accelerator !== 'string') throw new Error('The hotkey must be text.');
  if (!useHotkey(accelerator)) {
    hotkeyWorks = useHotkey(hotkey);
    return { ok: false };
  }
  hotkey = accelerator;
  hotkeyWorks = true;
  return { ok: true, settings: saveSettings(settingsFile, { cardHotkey: hotkey }) };
}

function movePanel(dx, dy) {
  if (!panel) return;
  const bounds = panel.getBounds();
  panel.setBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy });
}

async function createMainWindow() {
  const data = app.getPath('userData');
  settingsFile = path.join(data, 'settings.json'); // where serve.js keeps it, next to the database
  hotkey = readSettings(settingsFile).cardHotkey;
  hotkeyWorks = useHotkey(hotkey);
  const { port } = await start({ dbFile: path.join(data, 'prices.db'), debugDir: path.join(data, 'debug') });
  const origin = `http://127.0.0.1:${port}`;

  main = new BrowserWindow({
    width: 1100,
    height: 800,
    backgroundColor: BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // keep scanning while the game has focus
    },
  });
  openPanel(main);
  // A reloaded page starts with the card at home, so an old pop-out would be left empty and out of
  // its reach. And if it reloaded while Settings waited for a new key, the hotkey is still paused.
  main.webContents.on('did-finish-load', () => {
    panel?.close();
    hotkeyWorks = useHotkey(hotkey);
  });
  main.on('closed', () => app.quit());
  await main.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (main?.isMinimized()) main.restore();
    main?.focus();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    ipcMain.handle('list-windows', listWindows);
    ipcMain.handle('choose-window', (event, id) => { chosenWindow = id; });
    ipcMain.handle('game-running', gameRunning);
    ipcMain.on('fit-panel', (event, width, height) => fitPanel(width, height));
    ipcMain.on('move-panel', (event, dx, dy) => movePanel(dx, dy));
    ipcMain.on('show-card', showCard);
    ipcMain.handle('hotkey', () => ({ key: hotkey, works: hotkeyWorks }));
    ipcMain.handle('set-hotkey', (event, accelerator) => setHotkey(accelerator));
    // While Settings waits for a new key, so the old one reaches the page instead of the card.
    ipcMain.on('pause-hotkey', (event, paused) => { if (paused) globalShortcut.unregisterAll(); else useHotkey(hotkey); });
    allowCapture();
    return createMainWindow();
  });
}
