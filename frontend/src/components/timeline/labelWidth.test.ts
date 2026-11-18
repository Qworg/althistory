import { afterEach, describe, expect, it, vi } from 'vitest'
import { measureLabelInk } from './labelWidth'
import { PLATE_INK_SLACK, PLATE_ONLY_ASCENT, PLATE_ONLY_DESCENT } from './pinnedLabel'

// jsdom has no canvas, so these are the estimates; the browser's measureText gives the real ones (see selectionPlate.test.ts for those, mocked).
describe('measureLabelInk (the estimate where there is no canvas)', () => {
  it('puts ordinary text inside the 12px plate-only plate, and an accented capital above it', () => {
    const plain = measureLabelInk('The salt-kings tax the…', 12, 600)
    expect(plain.ascent).toBeLessThanOrEqual(PLATE_ONLY_ASCENT + PLATE_INK_SLACK)
    expect(plain.descent).toBeLessThanOrEqual(PLATE_ONLY_DESCENT + PLATE_INK_SLACK)
    for (const name of ['Émile Ångström…', 'Åland votes', 'Ōsaka falls']) {
      expect(measureLabelInk(name, 12, 600).ascent).toBeGreaterThan(PLATE_ONLY_ASCENT + PLATE_INK_SLACK)
    }
  })

  it('scales with the font size and is cached per string', () => {
    expect(measureLabelInk('Émile', 24, 600).ascent).toBe(2 * measureLabelInk('Émile', 12, 600).ascent)
    expect(measureLabelInk('Émile', 12, 600)).toBe(measureLabelInk('Émile', 12, 600))
  })
})

// With a canvas (stubbed: jsdom has none): the ink is the larger of what the canvas reports at the page's size and at ten times it, scaled back.
describe('measureLabelInk (with a canvas)', () => {
  const fonts: string[] = []
  let reports: (size: number, text: string) => { ascent: number; descent: number } | null = () => null
  const load = async () => {
    vi.resetModules()
    const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome')
    const fake = {
      font: '',
      measureText(text: string) {
        fonts.push(this.font)
        const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)![1]!)
        const r = reports(size, text)
        return r ? { width: text.length * size * 0.5, actualBoundingBoxAscent: r.ascent, actualBoundingBoxDescent: r.descent } : { width: text.length * size * 0.5, actualBoundingBoxAscent: NaN, actualBoundingBoxDescent: NaN }
      },
    }
    const create = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? ({ getContext: () => fake } as unknown as HTMLCanvasElement) : Document.prototype.createElement.call(document, tag))) as typeof document.createElement)
    void agent
    void create
    return import('./labelWidth')
  }
  afterEach(() => {
    fonts.length = 0
    reports = () => null
    vi.restoreAllMocks()
  })

  it('takes the larger of the two measures, for the ascent and the descent each, at ten times the size for the second', async () => {
    // The hinted canvas rounds an accented capital up at the page's size (12) and gives its shape at ten times it (110 for 11): the larger is 12.
    // Its descent is the other way about (2 hinted, 26 for 2.6): the larger is 2.6.
    reports = (size) => (size > 50 ? { ascent: 110, descent: 26 } : { ascent: 12, descent: 2 })
    const { measureLabelInk } = await load()
    const ink = measureLabelInk('Émile', 12, 600)
    expect(ink.ascent).toBeCloseTo(12)
    expect(ink.descent).toBeCloseTo(2.6)
    // The two sizes measured: the page's and ten times it, in the weight asked for.
    expect(fonts.filter((font) => /^600 12px /.test(font))).toHaveLength(1)
    expect(fonts.filter((font) => /^600 120px /.test(font))).toHaveLength(1)
  })

  it('takes the shape where it is the larger, and scales it back', async () => {
    reports = (size) => (size > 50 ? { ascent: 118, descent: 31 } : { ascent: 11, descent: 3 })
    const { measureLabelInk } = await load()
    const ink = measureLabelInk('Émile', 12, 400)
    expect(ink.ascent).toBeCloseTo(11.8)
    expect(ink.descent).toBeCloseTo(3.1)
  })

  it('falls back to whichever measure is there when the other is not a number', async () => {
    reports = (size) => (size > 50 ? { ascent: 118, descent: 31 } : null)
    const first = await load()
    expect(first.measureLabelInk('Émile', 12, 600).ascent).toBeCloseTo(11.8)
    fonts.length = 0
    reports = (size) => (size > 50 ? null : { ascent: 11, descent: 3 })
    const second = await load()
    expect(second.measureLabelInk('Émile', 12, 600)).toEqual({ ascent: 11, descent: 3 })
  })

  it('caches a measure per string, size and weight, and measures again once the fonts have loaded', async () => {
    reports = () => ({ ascent: 9, descent: 2 })
    const { measureLabelInk, fontsLoaded } = await load()
    expect(measureLabelInk('Hello', 12, 600).ascent).toBeCloseTo(9)
    const calls = fonts.length
    expect(measureLabelInk('Hello', 12, 600)).toBe(measureLabelInk('Hello', 12, 600))
    expect(fonts.length).toBe(calls)
    // Another weight or size is another measure.
    measureLabelInk('Hello', 12, 400)
    measureLabelInk('Hello', 11, 600)
    expect(fonts.length).toBeGreaterThan(calls)
    // New fonts: the cached ink is dropped.
    reports = () => ({ ascent: 10, descent: 3 })
    fontsLoaded()
    expect(measureLabelInk('Hello', 12, 600)).toMatchObject({ ascent: 10, descent: 3 })
  })
})

