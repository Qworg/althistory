/**
 * The width of a label's text as the browser draws it, so a plate behind a
 * name fits the text rather than an estimate of it (0.56 em a character runs
 * wide for "illi" and narrow for "WMW"). Measured on a canvas in the page's
 * font and cached per string; where there is no canvas (jsdom) it falls back
 * to the layout's estimate.
 */

const cache = new Map<string, number>()
const INK_SCALE = 10
const inkCache = new Map<string, { ascent: number; descent: number }>()
let epoch = 0
const listeners = new Set<() => void>()

/** The page's fonts have loaded: every cached width is stale, and whatever measured them measures again. */
export function fontsLoaded(): void {
  cache.clear()
  inkCache.clear()
  epoch++
  listeners.forEach((listener) => listener())
}

/** Changes when the fonts finish loading (every cached width is dropped). */
export const fontEpoch = (): number => epoch
export function subscribeFontEpoch(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
let context: CanvasRenderingContext2D | null | undefined
let family = ''

function canvas(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context
  context = null
  try {
    if (typeof document === 'undefined' || typeof navigator === 'undefined' || /jsdom/i.test(navigator.userAgent)) return context
    context = document.createElement('canvas').getContext('2d')
    family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    // Fonts that arrive after the first measure change every width.
    void document.fonts?.ready.then(fontsLoaded)
  } catch {
    context = null
  }
  return context
}

/** The text's width in px at a font size and weight. */
export function measureLabelWidth(text: string, fontSize: number, weight = 400): number {
  const key = `${weight}|${fontSize}|${text}`
  const known = cache.get(key)
  if (known !== undefined) return known
  const ctx = canvas()
  let width = text.length * fontSize * 0.56
  if (ctx) {
    ctx.font = `${weight} ${fontSize}px ${family}`
    const measured = ctx.measureText(text).width
    if (Number.isFinite(measured) && measured > 0) width = measured
  }
  cache.set(key, width)
  return width
}

/**
 * How far the text's ink reaches above its baseline and below it, in px: the
 * browser's `actualBoundingBoxAscent` and `actualBoundingBoxDescent` for the
 * string in the page's font. A capital with an accent (É, Å) rises about a
 * quarter of an em above an ordinary capital, so a plate sized for the font's
 * usual ascenders does not hold it. Where there is no canvas (jsdom) it is
 * estimated: 0.75 em for ascenders, 1 em where there is an accented capital,
 * and 0.2 em for a descender (g j p q y , ;).
 */
export function measureLabelInk(text: string, fontSize: number, weight = 400): { ascent: number; descent: number } {
  const key = `${weight}|${fontSize}|${text}`
  const known = inkCache.get(key)
  if (known) return known
  const ctx = canvas()
  let ink = {
    ascent: fontSize * (/[À-ÞĀ-ſ]/.test(text) ? 1 : 0.75),
    descent: /[gjpqy,;]/.test(text) ? fontSize * 0.2 : 0,
  }
  if (ctx) {
    // The larger of two measures. At the page's size the canvas hints glyphs to whole pixels, as the browser does when it draws small text
    // (an accented capital reads 12px at 11px and at 12px alike, and text at 11.5px is drawn as 12px). At ten times the size it does not,
    // which is the shape of the glyph. Taking the larger holds the ink whichever the drawing follows.
    const ink1 = (scale: number) => {
      ctx.font = `${weight} ${fontSize * scale}px ${family}`
      const m = ctx.measureText(text)
      return Number.isFinite(m.actualBoundingBoxAscent) && Number.isFinite(m.actualBoundingBoxDescent)
        ? { ascent: Math.max(0, m.actualBoundingBoxAscent / scale), descent: Math.max(0, m.actualBoundingBoxDescent / scale) }
        : null
    }
    const hinted = ink1(1)
    const shaped = ink1(INK_SCALE)
    if (hinted && shaped) ink = { ascent: Math.max(hinted.ascent, shaped.ascent), descent: Math.max(hinted.descent, shaped.descent) }
    else if (hinted ?? shaped) ink = (hinted ?? shaped)!
  }
  inkCache.set(key, ink)
  return ink
}
