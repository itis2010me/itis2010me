const SWITCH_ON =
  '.---.\n' +
  '| o |\n' +
  '|   |\n' +
  "'---'";

const SWITCH_OFF =
  '.---.\n' +
  '|   |\n' +
  '| o |\n' +
  "'---'";

const toggle = document.getElementById('theme-toggle');

function setTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  toggle.textContent = dark ? SWITCH_OFF : SWITCH_ON;
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

toggle.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  setTheme(!isDark);
});

const saved = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
setTheme(saved ? saved === 'dark' : prefersDark);
