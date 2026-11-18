import { describe, expect, it } from 'vitest'
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
