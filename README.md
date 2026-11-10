# MapleScanner

A Windows app that shows MapleStory Classic Free Market prices while you walk the stalls. It reads the shops on your screen, and every player's scans go into one shared price database, so everyone gets prices from everyone.

## It only reads the screen

Everything comes from the picture of the game window, the same as a screenshot. MapleScanner never touches the game's memory, files, network traffic or ports. The code is open so anyone can check this.

## What it sends

MapleScanner needs internet to show prices. It sends the shop listings it read off your screen (item, seller, amount, price, channel, room and shop title) with an anonymous key made when the app is installed. The key identifies the install, not you, and the server keeps only a hash of it, so bad data can be traced and removed. Your IP address isn't stored. Seller names are public, as they are in the game. Nothing else leaves your PC: no screenshots, no account details, nothing about the game itself.

## Installing

Download `MapleScanner-Setup-<version>.exe` from [Releases](https://github.com/mirotol/MapleScanner/releases) and run it. The app checks GitHub for a newer version each time it starts, downloads it in the background and installs it when you close the app.

The installer isn't code-signed yet, so Windows shows "Windows protected your PC". Choose **More info**, then **Run anyway**.

## Running from source

Needs Node.js 24 or newer and Windows.

```bash
npm install
npm start
```

- `npm test` runs the price, name, tooltip card and price server tests.
- `npm run cloud:dev` runs the price server (a Cloudflare Worker with D1, in `cloud/`) locally on http://127.0.0.1:8787. Apply its schema first with `npx wrangler d1 migrations apply maplescanner --local --config cloud/wrangler.jsonc`.
- `CLOUD_URL=http://127.0.0.1:8787 node serve.js` runs the browser version on http://localhost:8123 (Edge or Chrome) against it.
- `npm run site:dev` builds the website (`site/`, for maplescanner.app) and serves it on http://127.0.0.1:8790. Opened locally, its Prices page reads from the local price server above.
- `npm run dist` builds the Windows installer into `dist/`.
- `npm run items` refreshes `osms-items.json` from OSMS Data Explorer.

The reading code was tuned on real game screenshots. Those stay on the author's computer and aren't in this repository, so `npm test` uses none of them.

## Credits

Item data from [OSMS Data Explorer](https://osmsdataexplorer.com), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It's reduced to item names, NPC prices, scroll success rates, upgrade slots, main stat lines, plain gear stats, which gear has no description, which items recharge, and item ids for icons. Icons are downloaded from it once each and kept on your PC. They aren't part of this repository.

Fonts: Nunito and Fredoka, under the SIL Open Font License (see `fonts/`). Text reading uses [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0).

MapleStory and its game content are © Nexon. This is an unofficial fan project, not affiliated with or endorsed by Nexon.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE). You can use, change and share the code, and anything you distribute that's built on it has to stay open under the same licence.
