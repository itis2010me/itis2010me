const TEXT_CHARS = ["|", "'", "L", "'", "|"];
const EYE_INDICES = new Set([1, 3]);
const MOUTH_INDEX = 2;
const GRID_W = 56;
const GRID_H = 26;
const RAMP = ' .:-=+*#%@';
const FPS = 30;
const FRAME_MS = 1000 / FPS;

const SS_X = 2;
const SS_Y = 4;
const CV_W = GRID_W * SS_X;
const CV_H = GRID_H * SS_Y;

const canvas = document.createElement('canvas');
canvas.width = CV_W;
canvas.height = CV_H;
const ctx = canvas.getContext('2d');

const fontFamily = '"Arial Black", "Impact", "Helvetica Neue", sans-serif';
let fontSize = Math.floor(CV_H * 1.0);
ctx.font = `900 ${fontSize}px ${fontFamily}`;
while (fontSize > 8 && ctx.measureText("|'L'|").width > CV_W * 0.85) {
  fontSize--;
  ctx.font = `900 ${fontSize}px ${fontFamily}`;
}

ctx.textBaseline = 'middle';
ctx.textAlign = 'left';

const widths = TEXT_CHARS.map(c => ctx.measureText(c).width);
const totalW = widths.reduce((a, b) => a + b, 0);

const charPositions = [];
{
  let xCursor = (CV_W - totalW) / 2;
  for (let i = 0; i < TEXT_CHARS.length; i++) {
    charPositions.push({
      char: TEXT_CHARS[i],
      x: xCursor + widths[i] / 2,
      y: CV_H / 2,
    });
    xCursor += widths[i];
  }
}

const out = document.getElementById('out');

const cursor = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
};

window.addEventListener('mousemove', e => {
  cursor.x = e.clientX;
  cursor.y = e.clientY;
});

window.addEventListener('mouseleave', () => {
  cursor.x = window.innerWidth / 2;
  cursor.y = window.innerHeight / 2;
});

const GAZE_EASE = 0.12;
const EYE_MAX_DX = 4.5;
const EYE_MAX_DY = 2.5;
let easedNx = 0;
let easedNy = 0;

function gazeToMouth(nx) {
  if (nx < -0.55) return 'L';
  if (nx < -0.2) return 'l';
  if (nx < 0.2) return 'i';
  if (nx < 0.55) return 'j';
  return 'J';
}

function getState(t) {
  const BOOT = 1.6;
  const reveals = TEXT_CHARS.map((_, i) => {
    const delay = i * 0.25;
    return Math.max(0, Math.min(1, (t - delay) / 0.45));
  });

  let blink = 0;
  let eyeDx = 0;
  let eyeDy = 0;
  let mouth = 'L';
  let leftEye = null;
  let rightEye = null;
  let bobY = 0;

  const targetNx = Math.max(-1, Math.min(1, (cursor.x - window.innerWidth / 2) / (window.innerWidth / 2)));
  const targetNy = Math.max(-1, Math.min(1, (cursor.y - window.innerHeight / 2) / (window.innerHeight / 2)));
  easedNx += (targetNx - easedNx) * GAZE_EASE;
  easedNy += (targetNy - easedNy) * GAZE_EASE;

  if (t > BOOT) {
    const tt = t - BOOT;

    eyeDx = easedNx * EYE_MAX_DX;
    eyeDy = easedNy * EYE_MAX_DY;
    mouth = gazeToMouth(easedNx);

    const blinkPhase = tt % 3.7;
    if (blinkPhase < 0.18) {
      blink = Math.sin(blinkPhase / 0.18 * Math.PI);
    }

    const winkPhase = (tt + 1.4) % 9.0;
    if (winkPhase < 0.32) leftEye = '-';
  }

  return { reveals, blink, eyeDx, eyeDy, mouth, leftEye, rightEye, bobY };
}

function renderFace(s) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CV_W, CV_H);
  ctx.font = `900 ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';

  for (let i = 0; i < charPositions.length; i++) {
    const p = charPositions[i];
    let ch = p.char;
    let dx = 0;
    let dy = 0;
    if (EYE_INDICES.has(i)) {
      const override = i === 1 ? s.leftEye : s.rightEye;
      let closed = false;
      if (override !== null) {
        ch = override;
        if (override === '-' || override === '_') closed = true;
      } else if (s.blink > 0.3) {
        ch = '-';
        closed = true;
      }
      if (closed) dy = -fontSize * 0.22;
      dx = s.eyeDx;
      dy += s.eyeDy;
    } else if (i === MOUTH_INDEX) {
      ch = s.mouth;
    }
    ctx.globalAlpha = s.reveals[i];
    if (ctx.globalAlpha > 0.01) {
      ctx.fillText(ch, p.x + dx, p.y + s.bobY + dy);
    }
  }
  ctx.globalAlpha = 1;
}

function canvasToAscii() {
  const data = ctx.getImageData(0, 0, CV_W, CV_H).data;
  const cellArea = SS_X * SS_Y;
  const rows = [];
  for (let r = 0; r < GRID_H; r++) {
    let row = '';
    for (let c = 0; c < GRID_W; c++) {
      let sum = 0;
      for (let dy = 0; dy < SS_Y; dy++) {
        for (let dx = 0; dx < SS_X; dx++) {
          const px = c * SS_X + dx;
          const py = r * SS_Y + dy;
          sum += 255 - data[(py * CV_W + px) * 4];
        }
      }
      const darkness = sum / (cellArea * 255);
      const idx = Math.min(RAMP.length - 1, Math.floor(darkness * RAMP.length));
      row += RAMP[idx];
    }
    rows.push(row);
  }
  return rows.join('\n');
}

let elapsed = 0;
let lastTick = -1;
let paused = false;

function tick(now) {
  if (lastTick < 0) lastTick = now;
  if (!paused) {
    const dt = now - lastTick;
    if (dt >= FRAME_MS) {
      elapsed += dt / 1000;
      lastTick = now;
      renderFace(getState(elapsed));
      out.textContent = canvasToAscii();
    }
  } else {
    lastTick = now;
  }
  requestAnimationFrame(tick);
}

renderFace(getState(0));
out.textContent = canvasToAscii();

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  requestAnimationFrame(tick);
} else {
  renderFace(getState(10));
  out.textContent = canvasToAscii();
}

window.addEventListener('blur', () => { paused = true; });
window.addEventListener('focus', () => { paused = false; lastTick = -1; });
