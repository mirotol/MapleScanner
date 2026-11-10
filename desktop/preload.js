// The only app features the scanner page can reach.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  listWindows: () => ipcRenderer.invoke('list-windows'),
  chooseWindow: id => ipcRenderer.invoke('choose-window', id),
  gameRunning: () => ipcRenderer.invoke('game-running'),
  fitPanel: (width, height) => ipcRenderer.send('fit-panel', width, height),
  movePanel: (dx, dy) => ipcRenderer.send('move-panel', dx, dy),
  showCard: () => ipcRenderer.send('show-card'),
  hotkey: () => ipcRenderer.invoke('hotkey'),
  setHotkey: accelerator => ipcRenderer.invoke('set-hotkey', accelerator),
  pauseHotkey: paused => ipcRenderer.send('pause-hotkey', paused),
  onPopOut: run => ipcRenderer.on('pop-out', () => run()),
  onCardShown: run => ipcRenderer.on('card-shown', (event, shown) => run(shown)),
});
