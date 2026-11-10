// Watches every captured frame for the Change Channel window and loading screens. With the
// keyboard, opening the window, picking and confirming take less than one frame at 5 a second
// (recordings of Nov 7), so the full scan, which takes over 100 ms, can't be the one to look.
// Half size without smoothing keeps the gaps between the channel buttons, which a smoothed or
// smaller copy loses (measured on test/channel-picked-2560.webp and the other window pictures).
// The page hands over a stream of its own, because frames passed through the page wait behind
// its scans. With the game in front this watches about 27 of its 30 frames a second, and 29
// with the scans paused (measured Nov 7). A game in the background sends fewer frames.
// Handing over the capture track itself doesn't work here, so the stream starts on the page.
importScripts('scanner.js');

// Not willReadFrequently: on the graphics card the frame is shrunk there, and only the small
// copy is read back. Asking for a canvas that's quick to read copied all of each frame first.
const canvas = new OffscreenCanvas(1, 1);
const g = canvas.getContext('2d');

function look(frame) {
  const time = frame.timestamp, started = performance.now();
  try {
    const w = Math.round((frame.displayWidth ?? frame.width) / 2), h = Math.round((frame.displayHeight ?? frame.height) / 2);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    g.imageSmoothingEnabled = false;
    g.drawImage(frame, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    const read = performance.now();
    const channelWindow = findChannelWindow(img);
    const dark = !channelWindow && isDark(img);
    postMessage({ time, channelWindow, dark, readMs: Math.round(read - started), findMs: Math.round(performance.now() - read) });
  } catch (err) {
    postMessage({ time, error: String(err) });
  } finally {
    frame.close();
  }
}

// frames: a stream of video frames. frame: one picture, for checking this on screenshots.
onmessage = async ({ data: { frames, frame } }) => {
  if (frame) return look(frame);
  const reader = frames.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    look(value);
  }
};
