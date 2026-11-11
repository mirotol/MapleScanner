// The buttons in the header of every page: the menu on a phone, and light or dark. Loaded in <head>, so a saved
// choice is in place before the page is drawn. Without one the site follows the visitor's system
// (theme.css). A choice is kept in this browser only, and picking what the system already shows
// goes back to following it, so a visitor who switches once and back isn't stuck.
(() => {
  const root = document.documentElement;
  const KEY = 'theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  const store = (value) => { try { value ? localStorage.setItem(KEY, value) : localStorage.removeItem(KEY); } catch {} };
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch {} // storage blocked: follow the system

  const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : system.matches);
  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

  function show(button) {
    const now = dark();
    button.innerHTML = now ? SUN : MOON; // what a click switches to
    button.title = button.ariaLabel = now ? 'Switch to light' : 'Switch to dark';
  }

  // The menu button, shown only on a phone (site.css): it opens the page links under the header.
  // Escape, a tap elsewhere or a wider window closes it.
  function menu() {
    const head = document.querySelector('.site-head');
    const button = document.getElementById('menuButton');
    if (!head || !button) return;
    const set = (open) => {
      head.classList.toggle('open', open);
      button.setAttribute('aria-expanded', open);
      button.ariaLabel = open ? 'Close menu' : 'Menu';
    };
    button.onclick = () => set(!head.classList.contains('open'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && head.classList.contains('open')) { set(false); button.focus(); } });
    document.addEventListener('click', e => { if (!head.contains(e.target)) set(false); });
    matchMedia('(max-width: 600px)').addEventListener('change', e => { if (!e.matches) set(false); });
  }

  // A switch fades in over a moment instead of flashing the screen (.theme-fade in theme.css).
  let fading = 0;
  function fade() {
    root.classList.add('theme-fade');
    clearTimeout(fading);
    fading = setTimeout(() => root.classList.remove('theme-fade'), 400);
  }

  addEventListener('DOMContentLoaded', () => {
    menu();
    const button = document.getElementById('themePick');
    if (!button) return;
    show(button);
    button.onclick = () => {
      fade();
      const next = dark() ? 'light' : 'dark';
      if ((next === 'dark') === system.matches) { delete root.dataset.theme; store(null); }
      else { root.dataset.theme = next; store(next); }
      show(button);
    };
    system.addEventListener('change', () => { if (!root.dataset.theme) fade(); show(button); });
  });
})();
