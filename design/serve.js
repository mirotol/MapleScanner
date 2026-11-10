// Shows the design preview on http://localhost:8124/design/preview.html. Files only, no database.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  // theme.css too, so a mockup can show the card as it is now (design/stall.html)
  const allowed = ['design', 'test', 'fonts'].some(dir => file.startsWith(path.join(root, dir) + path.sep)) || file === path.join(root, 'theme.css');
  if (!allowed) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(8124, '127.0.0.1');
