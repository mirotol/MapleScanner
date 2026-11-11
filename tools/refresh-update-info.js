// After the installer is signed, its bytes have changed, so the updater's checksum in latest.yml and
// the .blockmap next to it (for downloading only what changed) no longer match it. This makes them
// again from the signed file. Used by .github/workflows/release.yml.
//   node tools/refresh-update-info.js dist
const fs = require('fs');
const path = require('path');
// electron-builder's own blockmap code, the same it uses when it builds the installer
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

async function refresh(dir) {
  const latestFile = path.join(dir, 'latest.yml');
  let latest = fs.readFileSync(latestFile, 'utf8');
  const name = /^path: (.+)$/m.exec(latest)?.[1].trim();
  if (!name) throw new Error(`${latestFile} names no installer.`);
  const installer = path.join(dir, name);
  const { sha512, size } = await buildBlockMap(installer, 'gzip', `${installer}.blockmap`);
  const swap = (pattern, value, count) => {
    const found = latest.match(new RegExp(pattern.source, 'gm'))?.length ?? 0;
    if (found !== count) throw new Error(`Expected ${count} lines like ${pattern} in latest.yml, found ${found}.`);
    latest = latest.replace(new RegExp(pattern.source, 'gm'), value);
  };
  swap(/^( *)sha512: .+$/, `$1sha512: ${sha512}`, 2);
  swap(/^( *)size: \d+$/, `$1size: ${size}`, 1);
  fs.writeFileSync(latestFile, latest);
  return { installer: name, sha512, size };
}

if (require.main === module) {
  refresh(process.argv[2] || 'dist').then(r => console.log(`Refreshed latest.yml and the blockmap for ${r.installer}: ${r.size} bytes`), err => { console.error(err); process.exit(1); });
}

module.exports = { refresh };
