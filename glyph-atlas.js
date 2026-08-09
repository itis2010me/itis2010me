/*
 * Shared glyph atlas.
 *
 * Pre-renders a character set at N opacity levels onto a single offscreen
 * canvas, so drawing a cell becomes one drawImage blit instead of a fillText.
 * Used by the page-transition curtain (transition.js).
 *
 * The landing-page mascot deliberately does NOT use this: it renders as real
 * text in a <pre>, where every cell is a crisp, fully-opaque character. Blitting
 * it through the atlas was tried and reverted -- partial opacity turns discrete
 * characters into continuous tone, which reads as a grey image made of letters
 * rather than as ASCII art.
 */
window.GlyphAtlas = (() => {
  const DEFAULT_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  function build(opts) {
    const chars = opts.chars;
    const levels = opts.levels;
    const dpr = opts.dpr || 1;
    const w = Math.ceil(opts.cellW * dpr);
    const h = Math.ceil(opts.cellH * dpr);

    const cv = document.createElement('canvas');
    cv.width = w * chars.length;
    cv.height = h * levels;

    const c = cv.getContext('2d');
    if (!c) return null;

    c.font = `${Math.round(opts.cellH * (opts.fontScale || 0.86) * dpr)}px ${opts.font || DEFAULT_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = opts.color || '#000000';

    for (let level = 0; level < levels; level++) {
      c.globalAlpha = (level + 1) / levels;
      const y = level * h + h / 2;
      for (let i = 0; i < chars.length; i++) c.fillText(chars[i], i * w + w / 2, y);
    }

    c.globalAlpha = 1;
    // cellW/cellH are the *device-pixel* size of one atlas cell, which is what
    // callers need for the drawImage source rect.
    return { canvas: cv, cellW: w, cellH: h, chars, levels };
  }

  return { build };
})();
