// Makes the app's icons from the one drawing, site/favicon.svg (the website's icon too):
//   build/icon.ico     the installer's and the installed app's icon (electron-builder finds it there)
//   desktop/icon.png   the app's windows and taskbar button (desktop/main.js)
//   site/favicon.ico   for browsers that don't take an SVG icon, and anything asking for /favicon.ico
//   site/icon-512.png  the picture beside a shared link (shareTags in site/items.js)
//   site/apple-touch-icon.png   a phone's home screen. On the tile's cream to the edges, because
//                      iOS paints see-through corners black and rounds the corners itself
// Run it again after changing the drawing, and commit what it writes:
//   node tools/make-icon.js
// It draws with sharp, which is only here because wrangler brings it, so it's a tool for this
// computer and no part of the app or its build.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const drawing = fs.readFileSync(path.join(root, 'site', 'favicon.svg'));
const SIZES = [16, 24, 32, 48, 64, 128, 256]; // what Windows asks an .ico for

const png = size => sharp(drawing, { density: 72 * size / 128 * 4 }).resize(size, size).png().toBuffer();

// An .ico is a list of pictures, and since Vista each can be a whole PNG file.
function ico(pictures) {
  const head = Buffer.alloc(6 + 16 * pictures.length);
  head.writeUInt16LE(1, 2); // an icon
  head.writeUInt16LE(pictures.length, 4);
  let at = head.length;
  pictures.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    head.writeUInt8(size === 256 ? 0 : size, entry); // width, 0 for 256
    head.writeUInt8(size === 256 ? 0 : size, entry + 1); // height
    head.writeUInt16LE(1, entry + 4); // colour planes
    head.writeUInt16LE(32, entry + 6); // bits a pixel
    head.writeUInt32LE(data.length, entry + 8);
    head.writeUInt32LE(at, entry + 12);
    at += data.length;
  });
  return Buffer.concat([head, ...pictures.map(p => p.data)]);
}

(async () => {
  const pictures = await Promise.all(SIZES.map(async size => ({ size, data: await png(size) })));
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(pictures));
  fs.writeFileSync(path.join(root, 'desktop', 'icon.png'), pictures.at(-1).data);
  fs.writeFileSync(path.join(root, 'site', 'favicon.ico'), ico(pictures.filter(p => [16, 32, 48].includes(p.size))));
  fs.writeFileSync(path.join(root, 'site', 'apple-touch-icon.png'), await sharp(await png(180)).flatten({ background: '#fdf6ec' }).png().toBuffer());
  fs.writeFileSync(path.join(root, 'site', 'icon-512.png'), await png(512)); // shown where a link to the site is shared
  console.log(`Wrote build/icon.ico (${SIZES.join(', ')} px), desktop/icon.png, site/favicon.ico and site/apple-touch-icon.png`);
})();
