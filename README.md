# MapleScanner

A Windows app that shows MapleStory Classic Free Market prices while you walk the stalls. It reads the shops on your screen and builds a price database on your own PC.

## It only reads the screen

Everything comes from the picture of the game window, the same as a screenshot. MapleScanner never touches the game's memory, files, network traffic or ports. The code is open so anyone can check this.

## Running from source

Needs Node.js 24 or newer and Windows.

```bash
npm install
npm start
```

- `npm test` runs the price, name, database and tooltip card tests.
- `node serve.js` runs the browser version on http://localhost:8123 (Edge or Chrome).
- `npm run dist` builds the Windows app into `dist/`.
- `npm run items` refreshes `osms-items.json` from OSMS Data Explorer.

The reading code was tuned on real game screenshots. Those stay on the author's computer and aren't in this repository, so `npm test` uses none of them.

## Credits

Item data from [OSMS Data Explorer](https://osmsdataexplorer.com), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It's reduced to item names, NPC prices, scroll success rates, upgrade slots, main stat lines, plain gear stats, which gear has no description, which items recharge, and item ids for icons. Icons are downloaded from it once each and kept on your PC. They aren't part of this repository.

Fonts: Nunito and Fredoka, under the SIL Open Font License (see `fonts/`). Text reading uses [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0).

MapleStory and its game content are © Nexon. This is an unofficial fan project, not affiliated with or endorsed by Nexon.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE). You can use, change and share the code, and anything you distribute that's built on it has to stay open under the same licence.
