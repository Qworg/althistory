/**
 * The width of a label's text as the browser draws it, so a plate behind a
 * name fits the text rather than an estimate of it (0.56 em a character runs
 * wide for "illi" and narrow for "WMW"). Measured on a canvas in the page's
 * font and cached per string; where there is no canvas (jsdom) it falls back
 * to the layout's estimate.
 */

const cache = new Map<string, number>()
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
    void document.fonts?.ready.then(() => cache.clear())
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
