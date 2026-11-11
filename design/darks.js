// Dark themes tried on the Prices page (Nov 11), shown by design/themes.html?set=darks and measured by
// `node design/check-contrast.js darks`. Each keeps the app's look (Orange underline) and meanings:
// orange for what you chose and the app's own buttons, green good, red over, amber look closer, blue
// where to walk. Every colour is lifted to read on its dark page.
const dark = (id, name, about, c) => ({
  id, name, look: 'underline', dark: true, about, chipWeight: 600,
  colors: {
    ...c,
    selBg: 'transparent', selFg: c.cloud, selRing: c.meso, selCount: c.mist,
    chipFg: c.mist, thFg: c.mist, sortFg: c.mesoText, tabOnBg: 'transparent', tabOnFg: c.cloud,
    page: c.night, panel: c.night, headBg: 'transparent', search: c.dusk,
  },
});

const THEMES = [
  dark('market', '1. Night market', 'Warm near-black brown with cream text: the cream theme turned inside out.', {
    night: '#1c1611', dusk: '#2b2219', ridge: '#4b3c2c', cloud: '#f4ead8', mist: '#b9a68a',
    meso: '#ff8c3a', mesoText: '#ffa864', exp: '#62c882', hp: '#ff7a6b', ember: '#e6b84a', sky: '#72b6ff', onBright: '#1c1611',
  }),
  dark('cocoa', '2. Cocoa', 'A lighter, softer brown. Less contrast than Night market, so it glares less in a dark room.', {
    night: '#2a231d', dusk: '#382f27', ridge: '#57493b', cloud: '#ede3d1', mist: '#b8a891',
    meso: '#f08a3c', mesoText: '#ffaa6a', exp: '#74cf92', hp: '#ff8577', ember: '#e8c060', sky: '#82bfff', onBright: '#2a231d',
  }),
  dark('charcoal', '3. Charcoal', 'Neutral grey with a warm off-white text. Plain, like most dark apps; the orange does the talking.', {
    night: '#1d1d1f', dusk: '#2a2a2d', ridge: '#46464a', cloud: '#ece8e1', mist: '#a9a49c',
    meso: '#ff8c3a', mesoText: '#ffa864', exp: '#62c882', hp: '#ff7a6b', ember: '#e6b84a', sky: '#72b6ff', onBright: '#1d1d1f',
  }),
  dark('tooltip', '4. Tooltip navy', "The game's own tooltip blue, the app's very first look, with the orange kept for choices.", {
    night: '#121d2f', dusk: '#1b2a42', ridge: '#344a6c', cloud: '#eef3fb', mist: '#9fb1ca',
    meso: '#ff9a4a', mesoText: '#ffb070', exp: '#6fd497', hp: '#ff8a7d', ember: '#f0c65a', sky: '#7cc4ff', onBright: '#121d2f',
  }),
  dark('moss', '5. Henesys moss', 'A dark green-grey, like a forest map at night. Warmer than navy, cooler than brown.', {
    night: '#171d18', dusk: '#222a23', ridge: '#3b483c', cloud: '#edf0e4', mist: '#a8b49f',
    meso: '#ff9440', mesoText: '#ffac68', exp: '#7ad692', hp: '#ff8072', ember: '#e8c25a', sky: '#7dbcff', onBright: '#171d18',
  }),
  // After the Gruvbox palette (morhetz/gruvbox, MIT): its own greys, fg, orange, green, red, yellow, blue.
  // The red is lifted a little on the medium and soft backgrounds, where #fb4934 is too dark for small text.
  dark('gruvbox', '6. Gruvbox', "Gruvbox's medium background #282828 with its cream text and faded, retro colours.", {
    night: '#282828', dusk: '#3c3836', ridge: '#504945', cloud: '#ebdbb2', mist: '#bdae93',
    meso: '#fe8019', mesoText: '#fe8019', exp: '#b8bb26', hp: '#fc5c47', ember: '#fabd2f', sky: '#83a598', onBright: '#282828',
  }),
  dark('gruvbox-hard', '7. Gruvbox hard', "Gruvbox's darkest background #1d2021: more contrast, a little cooler.", {
    night: '#1d2021', dusk: '#32302f', ridge: '#504945', cloud: '#ebdbb2', mist: '#a89984',
    meso: '#fe8019', mesoText: '#fe8019', exp: '#b8bb26', hp: '#fb4934', ember: '#fabd2f', sky: '#83a598', onBright: '#1d2021',
  }),
  dark('gruvbox-soft', '8. Gruvbox soft', "Gruvbox's softest background #32302f, the gentlest on the eyes.", {
    night: '#32302f', dusk: '#45403d', ridge: '#5a524c', cloud: '#ebdbb2', mist: '#c2b498',
    meso: '#fe8019', mesoText: '#fe8019', exp: '#b8bb26', hp: '#fd6e5b', ember: '#fabd2f', sky: '#83a598', onBright: '#32302f',
  }),
];

if (typeof module !== 'undefined') module.exports = THEMES;
