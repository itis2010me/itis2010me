const SUN = '<span style="font-size:18px">☀</span>';
const MOON = '<span style="font-size:18px">☽</span>';

const SWITCH_ON =
  '  ' + SUN + '  \n' +
  '.---.\n' +
  '| o |\n' +
  '|   |\n' +
  "'---'\n" +
  '  ' + MOON + '  ';

const SWITCH_OFF =
  '  ' + SUN + '  \n' +
  '.---.\n' +
  '|   |\n' +
  '| o |\n' +
  "'---'\n" +
  '  ' + MOON + '  ';

const toggle = document.getElementById('theme-toggle');

function setTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  toggle.innerHTML = dark ? SWITCH_OFF : SWITCH_ON;
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

toggle.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = !isDark;

  // Ripple the new theme out from the toggle when the curtain is available.
  // It flips the theme itself at full cover; falling through means switching
  // instantly (curtain not loaded, reduced motion, or one already running).
  const curtain = window.AsciiCurtain;
  if (curtain && curtain.themeSweep && curtain.themeSweep({
    theme: next ? 'dark' : 'light',
    origin: toggle,
    apply: () => setTheme(next),
  })) return;

  setTheme(next);
});

const saved = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
setTheme(saved ? saved === 'dark' : prefersDark);
