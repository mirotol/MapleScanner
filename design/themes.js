// Colour themes tried on the Prices page (design/themes.html, Nov 9). Each one sets the theme.css
// colours plus how a chosen filter, the column headers and the app's tabs look. Node can load this
// file too, so `node design/check-contrast.js` measures every text colour against its background.
const THEMES = [
  {
    id: 'now', name: 'Now', look: 'pill',
    about: 'The page as it is: a near-black chosen pill, bold labels on every pill.',
    colors: {
      night: '#fbf7ee', dusk: '#f0e8d6', ridge: '#d4c4a8', cloud: '#2a1a08', mist: '#6b5438',
      meso: '#c04f00', exp: '#26703a', hp: '#b42318', ember: '#8a5f00', sky: '#005db7', onBright: '#fffaf0',
      selBg: '#2a1a08', selFg: '#fbf7ee', selRing: 'transparent', selCount: '#d4c4a8',
      chipFg: '#2a1a08', thFg: '#6b5438', sortFg: '#2a1a08', tabOnBg: '#f0e8d6', tabOnFg: '#2a1a08',
      page: '#fbf7ee', panel: '#fbf7ee', headBg: 'transparent', search: '#f0e8d6',
    },
    chipWeight: 600,
  },
  {
    id: 'tint', name: 'Orange tint', look: 'pill',
    about: 'The chosen pill and tab get a pale orange fill with dark orange text. The other labels are lighter, and the sorted header is the only orange one.',
    colors: {
      night: '#fbf7ee', dusk: '#f0e8d6', ridge: '#d4c4a8', cloud: '#2a1a08', mist: '#6b5438',
      meso: '#c04f00', exp: '#26703a', hp: '#b42318', ember: '#8a5f00', sky: '#005db7', onBright: '#fffaf0',
      selBg: '#f9e0c7', selFg: '#943c00', selRing: '#e3a06a', selCount: '#943c00',
      chipFg: '#2a1a08', thFg: '#6b5438', sortFg: '#943c00', tabOnBg: '#f9e0c7', tabOnFg: '#943c00',
      page: '#fbf7ee', panel: '#fbf7ee', headBg: 'transparent', search: '#f0e8d6',
    },
    chipWeight: 500,
  },
  {
    id: 'underline', name: 'Orange underline', look: 'underline',
    about: 'Filters become plain tabs, like the inventory tabs in the game, with an orange line under the chosen one. Headers are small capitals.',
    colors: {
      night: '#fbf7ee', dusk: '#f0e8d6', ridge: '#d4c4a8', cloud: '#2a1a08', mist: '#6b5438',
      meso: '#c04f00', exp: '#26703a', hp: '#b42318', ember: '#8a5f00', sky: '#005db7', onBright: '#fffaf0',
      selBg: 'transparent', selFg: '#2a1a08', selRing: '#c04f00', selCount: '#6b5438',
      chipFg: '#6b5438', thFg: '#6b5438', sortFg: '#943c00', tabOnBg: 'transparent', tabOnFg: '#2a1a08',
      page: '#fbf7ee', panel: '#fbf7ee', headBg: 'transparent', search: '#f0e8d6',
    },
    chipWeight: 600,
  },
  {
    id: 'solid', name: 'Solid orange', look: 'pill',
    about: 'For comparison: the chosen pill and tab filled with the full OSMS orange. It shows what you chose, but it is as loud as the black one.',
    colors: {
      night: '#fbf7ee', dusk: '#f0e8d6', ridge: '#d4c4a8', cloud: '#2a1a08', mist: '#6b5438',
      meso: '#c04f00', exp: '#26703a', hp: '#b42318', ember: '#8a5f00', sky: '#005db7', onBright: '#fffaf0',
      selBg: '#c04f00', selFg: '#fffaf0', selRing: 'transparent', selCount: '#fffaf0',
      chipFg: '#2a1a08', thFg: '#6b5438', sortFg: '#943c00', tabOnBg: '#c04f00', tabOnFg: '#fffaf0',
      page: '#fbf7ee', panel: '#fbf7ee', headBg: 'transparent', search: '#f0e8d6',
    },
    chipWeight: 500,
  },
  {
    id: 'quiet', name: 'No accent', look: 'pill',
    about: 'No orange at all: the chosen pill is a darker beige with a tick. Orange stays only on buttons that do something.',
    colors: {
      night: '#fbf7ee', dusk: '#f0e8d6', ridge: '#d4c4a8', cloud: '#2a1a08', mist: '#6b5438',
      meso: '#c04f00', exp: '#26703a', hp: '#b42318', ember: '#8a5f00', sky: '#005db7', onBright: '#fffaf0',
      selBg: '#e5d7bc', selFg: '#2a1a08', selRing: '#bba57f', selCount: '#5a4529',
      chipFg: '#2a1a08', thFg: '#6b5438', sortFg: '#2a1a08', tabOnBg: '#e5d7bc', tabOnFg: '#2a1a08',
      page: '#fbf7ee', panel: '#fbf7ee', headBg: 'transparent', search: '#f0e8d6',
    },
    chipWeight: 500, tick: true,
  },
  {
    id: 'paper', name: 'Card on sand', look: 'pill', panel: true,
    about: 'The list sits on a white card over a sand page, with a light header band. The chosen pill is white with an orange ring.',
    colors: {
      night: '#fffdf8', dusk: '#f3ebdb', ridge: '#c6b28e', cloud: '#2a1a08', mist: '#6b5438',
      meso: '#c04f00', exp: '#26703a', hp: '#b42318', ember: '#8a5f00', sky: '#005db7', onBright: '#fffaf0',
      selBg: '#fffdf8', selFg: '#943c00', selRing: '#c04f00', selCount: '#943c00',
      chipFg: '#2a1a08', thFg: '#6b5438', sortFg: '#943c00', tabOnBg: '#fffdf8', tabOnFg: '#943c00',
      page: '#ede3cd', panel: '#fffdf8', headBg: '#f7f0e1', search: '#fffdf8',
    },
    chipWeight: 500,
  },
  {
    id: 'night', name: 'Night market', look: 'pill', dark: true,
    about: 'A warm dark version, closer to the game behind the stall card. Same meanings, with each colour lifted to read on brown.',
    colors: {
      night: '#1c1611', dusk: '#2b2219', ridge: '#4b3c2c', cloud: '#f4ead8', mist: '#b9a68a',
      meso: '#ff8c3a', exp: '#62c882', hp: '#ff7a6b', ember: '#e6b84a', sky: '#72b6ff', onBright: '#1c1611',
      selBg: '#402918', selFg: '#ffa864', selRing: '#7d4b24', selCount: '#e0965c',
      chipFg: '#f4ead8', thFg: '#b9a68a', sortFg: '#ffa864', tabOnBg: '#402918', tabOnFg: '#ffa864',
      page: '#1c1611', panel: '#1c1611', headBg: 'transparent', search: '#2b2219',
    },
    chipWeight: 500,
  },
];

if (typeof module !== 'undefined') module.exports = THEMES;
