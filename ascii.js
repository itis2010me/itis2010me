const TEXT_CHARS = ["|", "'", "L", "'", "|"];
const EYE_INDICES = new Set([1, 3]);
const MOUTH_INDEX = 2;
const GRID_W = 56;
const GRID_H = 26;
const RAMP = ' .:-=+*#%@';
const FPS = 60;
const FRAME_MS = 1000 / FPS;

const SS_X = 4;
const SS_Y = 8;
const CV_W = GRID_W * SS_X;
const CV_H = GRID_H * SS_Y;

const canvas = document.createElement('canvas');
canvas.width = CV_W;
canvas.height = CV_H;
// sampleFace reads this canvas back every frame; the hint keeps Chrome on a
// CPU-backed surface instead of paying a GPU readback per getImageData call.
const ctx = canvas.getContext('2d', { willReadFrequently: true });

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

const HAS_FINE_POINTER = window.matchMedia('(pointer: fine)').matches;

const IS_RETURN_VISIT = sessionStorage.getItem('mascotSeen') === '1';
sessionStorage.setItem('mascotSeen', '1');
const INTRO_WAVE = IS_RETURN_VISIT ? 2.0 : 5.0;

const cursor = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
};

if (HAS_FINE_POINTER) {
  window.addEventListener('mousemove', e => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
  });
  window.addEventListener('mouseleave', () => {
    cursor.x = window.innerWidth / 2;
    cursor.y = window.innerHeight / 2;
  });
}

const GAZE_EASE = 0.12;
const EYE_MAX_DX = 4.5;
const EYE_MAX_DY = 2.5;
const FACE_MAX_DX = 2.5;
const FACE_MAX_DY = 3.0;
let easedNx = 0;
let easedNy = 0;

function gazeToMouth(nx) {
  if (nx < -0.7) return { ch: 'L', scale: 1.0 };
  if (nx < -0.4) return { ch: 'L', scale: 0.62 };
  if (nx < -0.15) return { ch: 'l', scale: 1.0 };
  if (nx < 0.15) return { ch: 'i', scale: 1.0 };
  if (nx < 0.55) return { ch: 'j', scale: 1.0 };
  return { ch: 'J', scale: 1.0 };
}

function getState(t, dtSec) {
  const BOOT = 1.6;
  const reveals = TEXT_CHARS.map((_, i) => {
    const delay = i * 0.25;
    return Math.max(0, Math.min(1, (t - delay) / 0.45));
  });

  let blink = 0;
  let eyeDx = 0;
  let eyeDy = 0;
  let faceDx = 0;
  let faceDy = 0;
  let mouth = 'L';
  let mouthScale = 1.0;
  let leftEye = null;
  let rightEye = null;
  let bobY = 0;

  let targetNx, targetNy;
  const waveNx = Math.sin(t * 0.4) * 0.6 + Math.sin(t * 0.17) * 0.3;
  const waveNy = Math.sin(t * 0.27 + 1.0) * 0.4 + Math.sin(t * 0.13 + 0.5) * 0.2;
  if (HAS_FINE_POINTER) {
    const INTRO_FADE = 0.8;
    const sinceBoot = Math.max(0, t - BOOT);
    let blend;
    if (sinceBoot < INTRO_WAVE) blend = 0;
    else if (sinceBoot < INTRO_WAVE + INTRO_FADE) blend = (sinceBoot - INTRO_WAVE) / INTRO_FADE;
    else blend = 1;
    const cursorNx = Math.max(-1, Math.min(1, (cursor.x - window.innerWidth / 2) / (window.innerWidth / 2)));
    const cursorNy = Math.max(-1, Math.min(1, (cursor.y - window.innerHeight / 2) / (window.innerHeight / 2)));
    targetNx = waveNx * (1 - blend) + cursorNx * blend;
    targetNy = waveNy * (1 - blend) + cursorNy * blend;
  } else {
    targetNx = waveNx;
    targetNy = waveNy;
  }
  // Frame-rate independent easing: GAZE_EASE is the per-60fps-frame rate, so
  // a longer frame eases proportionally further rather than slowing the gaze.
  const ease = 1 - Math.pow(1 - GAZE_EASE, (dtSec || 0) * 60);
  easedNx += (targetNx - easedNx) * ease;
  easedNy += (targetNy - easedNy) * ease;

  if (t > BOOT) {
    const tt = t - BOOT;

    eyeDx = easedNx * EYE_MAX_DX;
    eyeDy = easedNy * EYE_MAX_DY;
    faceDx = easedNx * FACE_MAX_DX;
    faceDy = easedNy * FACE_MAX_DY;
    const m = gazeToMouth(easedNx);
    mouth = m.ch;
    mouthScale = m.scale;

    const blinkPhase = tt % 3.7;
    if (blinkPhase < 0.18) {
      blink = Math.sin(blinkPhase / 0.18 * Math.PI);
    }

    const doublePhase = tt % 15.0;
    if (doublePhase < 0.15) {
      blink = Math.max(blink, Math.sin(doublePhase / 0.15 * Math.PI));
    } else if (doublePhase > 0.23 && doublePhase < 0.38) {
      blink = Math.max(blink, Math.sin((doublePhase - 0.23) / 0.15 * Math.PI));
    }

    const winkPhase = (tt + 1.4) % 9.0;
    if (winkPhase < 0.32) leftEye = '_';
  }

  return { reveals, blink, eyeDx, eyeDy, faceDx, faceDy, mouth, mouthScale, leftEye, rightEye, bobY };
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
    const reveal = s.reveals[i];
    if (reveal <= 0.01) continue;

    const faceX = p.x + s.faceDx;
    const faceY = p.y + s.bobY + s.faceDy;

    if (EYE_INDICES.has(i)) {
      const override = i === 1 ? s.leftEye : s.rightEye;
      const eyeX = faceX + s.eyeDx;
      const eyeY = faceY + s.eyeDy;
      if (override !== null) {
        const shut = override === '-' || override === '_';
        drawGlyph(override, eyeX, eyeY + (shut ? -fontSize * 0.55 : 0), shut ? 0.5 : 1, reveal);
      } else {
        // Cross-fade the open eye into the closed one along the blink curve.
        // Thresholding it (the old `blink > 0.3`) threw away the smooth easing
        // that getState already computes and snapped the lid in one frame.
        const b = s.blink;
        drawGlyph(p.char, eyeX, eyeY, 1, reveal * (1 - b));
        drawGlyph('_', eyeX, eyeY - fontSize * 0.55, 0.5, reveal * b);
      }
    } else if (i === MOUTH_INDEX) {
      drawGlyph(s.mouth, faceX, faceY, s.mouthScale, reveal);
    } else {
      drawGlyph(p.char, faceX, faceY, 1, reveal);
    }
  }
  ctx.globalAlpha = 1;
}

function drawGlyph(ch, x, y, scaleX, alpha) {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;
  if (scaleX === 1) {
    ctx.fillText(ch, x, y);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scaleX, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
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
    // Cap at ~60fps, but compare against a slightly relaxed threshold. Testing
    // an exact 16.667ms makes real vsync deltas land fractionally under it, so
    // every other frame is dropped -- ~39fps with alternating 16.7/33.3ms gaps,
    // which reads as judder. The tolerance still halves 120Hz cleanly to 60.
    if (dt >= FRAME_MS * 0.9) {
      elapsed += dt / 1000;
      lastTick = now;
      renderFace(getState(elapsed, dt / 1000));
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
  // Large delta so the eased gaze converges: this is a single settled pose.
  renderFace(getState(10, 1));
  out.textContent = canvasToAscii();
}

// Pause only when the tab is actually hidden, not merely unfocused -- the
// mascot should keep animating while it is still on screen behind another
// window. (Browsers stop rAF for hidden tabs anyway; this mainly keeps `elapsed`
// from leaping forward by the whole time spent away once the tab returns.)
document.addEventListener('visibilitychange', () => {
  paused = document.hidden;
  if (!paused) lastTick = -1;
});
