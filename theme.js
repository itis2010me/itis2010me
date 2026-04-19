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
  setTheme(!isDark);
});

const saved = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
setTheme(saved ? saved === 'dark' : prefersDark);
