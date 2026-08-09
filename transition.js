/*
 * Full-screen ASCII curtain, used for two things:
 *
 *   1. Page navigation. idle -> cover -> (navigate) -> reveal -> idle.
 *      Because this is a static multi-page site rather than a client-side
 *      router, the handoff happens while the screen is 100% opaque: `cover`
 *      runs to a solid fill, then navigates; the next document paints
 *      already-covered (see the `pt-incoming` rules in ascii.css) and plays
 *      `reveal`. Everything random comes from a seeded PRNG, and the seed,
 *      clock and grid are handed to the next document through sessionStorage,
 *      so the glyph field continues across the navigation instead of resetting.
 *
 *   2. Theme toggle, via the exported AsciiCurtain.themeSweep(). Same phases in
 *      one document, so none of the handoff machinery applies.
 */
(() => {
  const CHARS = "01<>[]{}()/\\|=+*#%&$@!?;:.~01ABCDEF0123456789";
  const LEVELS = 24;          // opacity steps baked into the glyph atlas
  const CELL_W = 12;          // target cell size in CSS px
  const CELL_H = 17;
  const BAND = 0.16;          // how much of total progress one cell takes
  const SPREAD = 0.84;        // latest a cell may start (SPREAD + BAND === 1)
  const SHADE_STEPS = 6;      // alpha buckets for the backdrop fade
  const DUR_MS = 752;
  const THEME_MS = 451;       // snappier: no page load to cover for
  const REDUCED_DUR_MS = 200;
  const STORE_KEY = 'pt-state';

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DURATION = REDUCED_MOTION ? REDUCED_DUR_MS : DUR_MS;

  const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalize(raw) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = (max - min) || 1;
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = ((raw[i] - min) / span) * SPREAD;
    return out;
  }

  /*
   * Each variant returns a per-cell start delay in [0, SPREAD]. That field is
   * the entire personality of a transition -- the renderer below never changes.
   */

  // Organic blobs: value noise over a 7x5 lattice, smoothstep-interpolated.
  function vNoise(cols, rows, rnd) {
    const lat = new Float32Array(35);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const sm = t => t * t * (3 - 2 * t);
    const lp = (a, b, t) => a + (b - a) * t;
    const raw = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c / cols) * 6;
        const y = (r / rows) * 4;
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const tx = sm(x - xi);
        const ty = sm(y - yi);
        const i0 = yi * 7 + xi;
        const top = lp(lat[i0] ?? 0, lat[i0 + 1] ?? 0, tx);
        const bot = lp(lat[i0 + 7] ?? 0, lat[i0 + 8] ?? 0, tx);
        raw[r * cols + c] = lp(top, bot, ty) + (rnd() - 0.5) * 0.08;
      }
    }
    return normalize(raw);
  }

  /*
   * Circle spreading out from (or collapsing toward) a point in cell
   * coordinates. Distances are weighted by cell size so it stays round on
   * screen rather than following the grid's aspect ratio.
   */
  function radial(cols, rows, rnd, ox, oy, inward) {
    const raw = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = (c - ox) * CELL_W;
        const dy = (r - oy) * CELL_H;
        const d = Math.sqrt(dx * dx + dy * dy);
        raw[r * cols + c] = (inward ? -d : d) + (rnd() - 0.5) * 40;
      }
    }
    return normalize(raw);
  }

  // Variant: circle from a random off-centre point, expanding or collapsing.
  // (The theme sweep calls radial() directly, centred on the toggle button.)
  function vRadial(cols, rows, rnd) {
    const inward = rnd() < 0.5;
    const cx = (0.3 + 0.4 * rnd()) * cols;
    const cy = (0.3 + 0.4 * rnd()) * rows;
    return radial(cols, rows, rnd, cx, cy, inward);
  }

  // Falling streaks: vertical gradient offset per column.
  function vRain(cols, rows, rnd) {
    const colOff = new Float32Array(cols);
    for (let c = 0; c < cols; c++) colOff[c] = rnd() * 0.6;
    const up = rnd() < 0.25;
    const raw = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const y = (up ? rows - 1 - r : r) / (rows - 1 || 1);
        raw[r * cols + c] = y * 0.7 + colOff[c] + (rnd() - 0.5) * 0.04;
      }
    }
    return normalize(raw);
  }

  // Noise appears twice: it is the signature look, the rest are seasoning.
  const VARIANTS = [vNoise, vNoise, vRadial, vRain];

  // Pre-render every character at every opacity level once, so each of the
  // ~5000 cells per frame is a drawImage blit instead of a fillText.
  function buildAtlas(color, cellW, cellH, dpr) {
    return window.GlyphAtlas.build({
      chars: CHARS, color, cellW, cellH, dpr, levels: LEVELS, fontScale: 0.86,
    });
  }

  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-ascii-curtain', 'idle');
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  // Without a 2D context or the shared atlas there is nothing to draw. Bail
  // before intercepting any clicks, so links keep navigating normally -- but
  // unhide the body first, or `pt-incoming` would leave the page blank.
  if (!ctx || !window.GlyphAtlas) {
    document.documentElement.classList.remove('pt-incoming');
    return;
  }

  // --- Mutable state ---
  let paint = null;         // canvas geometry, colours, glyph atlas
  let fields = null;        // per-cell delays and glyph state
  let seed = 0;
  // Grid handed over from the previous document, so the incoming field lines up
  // cell-for-cell even if this page's scrollbar changes the usable width.
  let forcedGrid = null;
  // A clock that survives the navigation, so glyph churn never jumps.
  let clockOffset = 0;
  // True from the moment a sweep is requested until it finishes -- covers both
  // navigations and theme toggles, so a second trigger cannot interrupt one.
  let busy = false;

  let phase = 'idle';
  let phaseStart = 0;
  let activeDuration = DURATION;
  let rafId = null;
  let onDone = null;

  // Re-read on every cover so a mid-session theme toggle is picked up.
  function buildPaint(colors) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    // Pin the CSS size to the viewport: `inset: 0` alone resolves against the
    // scrollbar-excluded width, which would scale the field differently on a
    // scrolling page than on the landing page.
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cols = forcedGrid ? forcedGrid.cols : Math.max(1, Math.round(width / CELL_W));
    const rows = forcedGrid ? forcedGrid.rows : Math.max(1, Math.round(height / CELL_H));

    // `colors` lets the theme sweep paint in the incoming theme while the page
    // underneath is still the outgoing one.
    const styles = getComputedStyle(canvas);
    const bg = (colors && colors.bg) || styles.getPropertyValue('--ascii-transition-bg').trim() || '#000000';
    const fg = (colors && colors.fg) || styles.getPropertyValue('--ascii-transition-color').trim() || '#ffffff';

    const cellW = width / cols;
    const cellH = height / rows;

    paint = {
      width, height, cols, rows, cellW, cellH, bg,
      atlas: buildAtlas(fg, cellW, cellH, dpr),
    };
  }

  // Deterministic given the seed, so both documents build an identical field.
  // `origin` overrides the random variant with a circle centred on that cell.
  function buildFields(s, origin) {
    const { cols, rows } = paint;
    const rnd = mulberry32(s);
    const variant = VARIANTS[Math.floor(rnd() * VARIANTS.length)];

    const count = cols * rows;
    // Two independent fields: the reveal is not the cover played backwards.
    // For an explicit origin both spread outward from it, so the effect reads
    // as one ripple passing through rather than two unrelated motions.
    const build = origin
      ? () => radial(cols, rows, rnd, origin.x, origin.y, false)
      : () => variant(cols, rows, rnd);
    const coverOffsets = build();
    const revealOffsets = build();
    const seeds = new Uint16Array(count);
    const flicker = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seeds[i] = Math.floor(rnd() * 65536);
      flicker[i] = 150 + 250 * rnd();
    }

    // Scratch buffer reused every frame to bucket cells by coverage.
    fields = { coverOffsets, revealOffsets, seeds, flicker, buckets: new Int8Array(count) };
  }

  let stored = null;
  if (document.documentElement.classList.contains('pt-incoming')) {
    try { stored = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch (_) {}
  }

  if (stored && Number.isFinite(stored.cols) && Number.isFinite(stored.rows)) {
    forcedGrid = { cols: stored.cols, rows: stored.rows };
  }
  buildPaint();
  seed = stored && Number.isFinite(stored.s) ? stored.s >>> 0 : (Math.random() * 0xffffffff) >>> 0;
  buildFields(seed);
  if (stored && Number.isFinite(stored.c)) clockOffset = stored.c - performance.now();

  // Only ever re-measure while idle. Rebuilding mid-phase would swap the field
  // out from under the animation, which reads as a hard flash.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (phase !== 'idle') return;
      forcedGrid = null;
      buildPaint();
      buildFields(seed);
    }, 150);
  });

  // Reduced motion collapses the whole thing to a plain alpha fade.
  // (`which` rather than `phase`: the module-level `phase` is the live state,
  // and these draw whatever frame they are handed.)
  function drawPlain(which, progress) {
    ctx.clearRect(0, 0, paint.width, paint.height);
    ctx.globalAlpha = which === 'cover' ? progress : 1 - progress;
    ctx.fillStyle = paint.bg;
    ctx.fillRect(0, 0, paint.width, paint.height);
    ctx.globalAlpha = 1;
  }

  function drawAscii(which, progress, now) {
    const { cols, rows, cellW, cellH, width, height, bg, atlas } = paint;
    const { seeds, flicker, buckets } = fields;
    const covering = which === 'cover';
    const offsets = covering ? fields.coverOffsets : fields.revealOffsets;

    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg;

    // Pass 1: the backdrop. Cells are bucketed by coverage and each bucket is
    // one batched path fill, so it fades smoothly without going per-cell.
    if (covering && progress >= 1) {
      ctx.fillRect(0, 0, width, height);
    } else {
      // Bucket every cell once (0 means "draw nothing"), then one batched
      // path fill per non-empty bucket.
      for (let i = 0; i < buckets.length; i++) {
        const n = clamp01((progress - offsets[i]) / BAND);
        const coverage = covering ? n : 1 - n;
        buckets[i] = Math.ceil(coverage * SHADE_STEPS);
      }
      for (let b = SHADE_STEPS; b >= 1; b--) {
        let opened = false;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (buckets[r * cols + c] !== b) continue;
            if (!opened) { ctx.beginPath(); opened = true; }
            ctx.rect(
              Math.floor(c * cellW),
              Math.floor(r * cellH),
              Math.ceil(cellW) + 1,
              Math.ceil(cellH) + 1
            );
          }
        }
        if (opened) {
          ctx.globalAlpha = b / SHADE_STEPS;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    if (!atlas) return;

    // Pass 2: the glyphs.
    const aw = atlas.cellW;
    const ah = atlas.cellH;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const n = clamp01((progress - offsets[i]) / BAND);
        const d = covering ? n : 1 - n;
        if (d <= 0.02) continue;

        const s = seeds[i];
        const step = Math.floor((now + s) / flicker[i]);
        // Wavefront glow as a smooth bump rather than an on/off flag: sin^2 is
        // zero with zero slope at both ends, so a cell eases into and out of
        // its peak instead of snapping back to rest brightness.
        const glow = Math.sin(n * Math.PI);
        const breathe = 0.5 + 0.16 * Math.sin(0.0022 * now + s);
        const bright = breathe + (1 - breathe) * glow * glow;
        // Smoothstep the fade-in too, so cells never pop into existence.
        const fade = d >= 1 ? 1 : d * d * (3 - 2 * d);
        let level = Math.round(bright * fade * (LEVELS - 1));
        if (level <= 0) continue;
        if (level >= LEVELS) level = LEVELS - 1;

        const glyph = (s + step) % CHARS.length;
        ctx.drawImage(
          atlas.canvas,
          glyph * aw, level * ah, aw, ah,
          c * cellW, r * cellH, cellW, cellH
        );
      }
    }
  }

  function render(which, progress, now) {
    if (REDUCED_MOTION) drawPlain(which, progress);
    else drawAscii(which, progress, now + clockOffset);
  }

  function frame(now) {
    const progress = clamp01((now - phaseStart) / activeDuration);
    render(phase, progress, now);

    if (progress >= 1) {
      rafId = null;
      const done = onDone;
      onDone = null;
      if (done) done();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function run(nextPhase, done, durationMs) {
    phase = nextPhase;
    onDone = done;
    activeDuration = durationMs || DURATION;
    canvas.setAttribute('data-ascii-curtain', nextPhase);
    phaseStart = performance.now();
    if (rafId === null) rafId = requestAnimationFrame(frame);
  }

  function goIdle() {
    phase = 'idle';
    forcedGrid = null;
    canvas.setAttribute('data-ascii-curtain', 'idle');
    ctx.clearRect(0, 0, paint.width, paint.height);
  }

  // --- Incoming: this document was loaded behind a completed cover. ---
  if (stored) {
    try { sessionStorage.removeItem(STORE_KEY); } catch (_) {}
    // Paint the covered state before unhiding the body, so nothing flashes.
    canvas.setAttribute('data-ascii-curtain', 'reveal');
    render('reveal', 0, performance.now());
    document.documentElement.classList.remove('pt-incoming');
    requestAnimationFrame(() => run('reveal', goIdle));
  } else {
    document.documentElement.classList.remove('pt-incoming');
  }

  // --- Outgoing: cover fully, then navigate. ---
  function isInternalLink(a) {
    if (!a || !a.href) return false;
    if (a.target === '_blank' || a.hasAttribute('download')) return false;
    if (a.getAttribute('aria-current') === 'page') return false;

    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return false;
    // Only our own pages: assets like ./src/Wildfire.pdf should navigate normally.
    if (!/(\.html|\/)$/.test(url.pathname)) return false;
    // Same page (including in-page anchors) is not a transition.
    if (url.pathname === location.pathname) return false;
    return true;
  }

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const a = e.target.closest('a');
    if (!isInternalLink(a)) return;

    e.preventDefault();
    if (busy) return;
    busy = true;

    // Fresh seed per navigation: a new variant each time, handed to the next page.
    seed = (Math.random() * 0xffffffff) >>> 0;
    forcedGrid = null;
    buildPaint();
    buildFields(seed);

    const href = a.href;
    run('cover', () => {
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({
          s: seed,
          c: performance.now() + clockOffset,
          cols: paint.cols,
          rows: paint.rows,
        }));
      } catch (_) {}
      // The solid final frame was only just issued; navigating in this same
      // callback lets the browser start unloading before compositing it, which
      // leaves a half-transparent frame on screen through the swap. Wait for two
      // composited frames so the opaque cover is definitely on screen.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { location.href = href; });
      });
    });
  });

  // Coming back via bfcache would otherwise leave a stale covered canvas.
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      busy = false;
      goIdle();
    }
  });

  /*
   * Read the curtain colours a theme *would* produce, without showing it.
   * The attribute is swapped and restored inside one synchronous block, so the
   * browser recalculates style but never paints the intermediate state.
   */
  function colorsForTheme(theme) {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    if (theme) root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');

    const styles = getComputedStyle(canvas);
    const colors = {
      bg: styles.getPropertyValue('--ascii-transition-bg').trim(),
      fg: styles.getPropertyValue('--ascii-transition-color').trim(),
    };

    if (prev === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prev);
    return colors;
  }

  /*
   * Theme toggle: a ripple radiating from the toggle button, painted in the
   * incoming theme so the new colour arrives with the wave. `apply` is invoked
   * at full cover, where the actual swap is invisible.
   *
   * Returns false if it could not run, so the caller can fall back to switching
   * the theme instantly.
   */
  function themeSweep(opts) {
    if (REDUCED_MOTION) return false;
    if (busy || phase !== 'idle') return false;
    busy = true;

    seed = (Math.random() * 0xffffffff) >>> 0;
    forcedGrid = null;
    buildPaint(colorsForTheme(opts.theme));

    let origin = { x: paint.cols / 2, y: paint.rows / 2 };
    if (opts.origin && opts.origin.getBoundingClientRect) {
      const rect = opts.origin.getBoundingClientRect();
      origin = {
        x: (rect.left + rect.width / 2) / paint.cellW,
        y: (rect.top + rect.height / 2) / paint.cellH,
      };
    }
    buildFields(seed, origin);

    run('cover', () => {
      opts.apply();
      // paint.bg/atlas were already built for this theme, so the swap needs no
      // rebuild -- the reveal simply continues in the colours it started with.
      run('reveal', () => {
        busy = false;
        goIdle();
      }, THEME_MS);
    }, THEME_MS);
    return true;
  }

  window.AsciiCurtain = { themeSweep };
})();
