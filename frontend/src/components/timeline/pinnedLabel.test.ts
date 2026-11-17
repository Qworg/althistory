import { describe, expect, it } from 'vitest'
import { PLATE_ASCENT, PLATE_DESCENT, PLATE_PAD, planPinnedLabel, planPinnedText, type PlacedLabelBox } from './pinnedLabel'

const ROWS = [-20, -34, -48, -62]
const label = (id: string, left: number, right: number, offset: number, extra: Partial<PlacedLabelBox> = {}): PlacedLabelBox => ({
  id,
  left,
  right,
  top: 100 + offset - 9.6,
  bottom: 100 + offset + 3,
  length: Math.round((right - left) / 6.72),
  ...extra,
})
const plan = (labels: PlacedLabelBox[], x = 300, width = 160, innerWidth = 700) => planPinnedLabel({ x, markY: 100, width, innerWidth, rows: ROWS, labels })

describe('planPinnedLabel', () => {
  it('takes the nearest row and the centred extent where nothing is in the way', () => {
    expect(plan([])).toMatchObject({ offset: -20, anchor: 'middle', hidden: [] })
  })

  it('never covers a label by less than half: it moves to a row or extent that leaves it alone', () => {
    // A label sticking 40px into the first row's centred plate (a quarter of it) is not covered or hidden.
    const found = plan([label('near', 330, 480, -20)])
    expect(found).not.toBeNull()
    expect(found!.hidden).toEqual([])
    expect(found!.offset !== -20 || found!.anchor !== 'middle').toBe(true)
  })

  it('hides a label it covers by half or more, whole, when that is the way to a place', () => {
    // Every row is taken across the plate's width by one wide label under it; row 0's is a short one the plate covers wholly.
    const rows = [label('short', 270, 340, -20), label('b', 150, 470, -34), label('c', 150, 470, -48), label('d', 150, 470, -62)]
    // Extents: centred 220..380 covers b, c, d by half or more of ... they are wider than the plate, so covered 160/320 = half.
    const found = plan(rows)
    expect(found).not.toBeNull()
    expect(found!.hidden.length).toBeGreaterThan(0)
    // The labels it keeps are untouched: none overlaps the plate.
    const plate = { left: found!.left - PLATE_PAD, right: found!.right + PLATE_PAD, top: 100 + found!.offset - PLATE_ASCENT, bottom: 100 + found!.offset + PLATE_DESCENT }
    for (const l of rows) if (!found!.hidden.includes(l.id)) expect(l.right <= plate.left || l.left >= plate.right || l.bottom <= plate.top || l.top >= plate.bottom).toBe(true)
  })

  it('never covers a protected label, and gives no plate when every place would', () => {
    const wall = ROWS.map((offset, i) => label(`p${i}`, 150, 470, offset, { protectedLabel: true }))
    expect(plan(wall)).toBeNull()
  })

  it('lets the plate\'s own leader pass behind a label, hiding nothing for it', () => {
    // A wide label over the mark in row 0 is covered by less than half by a plate there; a plate above it hangs its leader behind it.
    const wide = label('over', 100, 500, -20)
    expect(plan([wide])).toMatchObject({ offset: -34, hidden: [] })
    // A narrow one the row-0 plate covers wholly is hidden only if no row above is free: the leader passes behind it.
    const narrow = label('under', 290, 330, -20)
    expect(plan([narrow])).toMatchObject({ offset: -34, hidden: [] })
  })

  it('keeps the plate inside the plot at both edges', () => {
    const left = plan([], 4, 200, 700)
    expect(left!.left).toBeGreaterThanOrEqual(0)
    const right = plan([], 698, 200, 700)
    expect(right!.right).toBeLessThanOrEqual(700)
  })

  it('refuses a placement whose plate a kept label\'s leader runs through, and hides the leader with a hidden label', () => {
    // A leader hanging from a label in row 3 down to a mark at x=300 runs through every nearer row's plate there.
    const leader = { x: 300, top: 100 - 62 + 4, bottom: 100 - 10 }
    const hanging = label('far', 150, 450, -62, { leader, protectedLabel: true })
    expect(plan([hanging])).toBeNull()
    // The same label unprotected is covered wholly by the row-3 plate (hidden, leader and all): the plate goes there.
    const hideable = label('far', 270, 330, -62, { leader })
    expect(plan([hideable])).toMatchObject({ offset: -62, hidden: ['far'] })
  })
})

describe('planPinnedText', () => {
  it('takes the first text whose plate fits: a shorter name where the whole one has no room', () => {
    // Walls of protected labels in every row leave a gap of 100px around the mark at x=300.
    const walls = ROWS.flatMap((offset, i) => [label(`l${i}`, 0, 250, offset, { protectedLabel: true }), label(`r${i}`, 350, 700, offset, { protectedLabel: true })])
    const found = planPinnedText({ x: 300, markY: 100, innerWidth: 700, rows: ROWS, labels: walls }, [
      { text: 'A name that is long', width: 160 },
      { text: 'A name that…', width: 110 },
      { text: 'A name…', width: 70 },
    ])
    expect(found?.text).toBe('A name…')
  })

  it('names the selection as a last resort by hiding a neighbour whole with its leader, never a protected one', () => {
    // A wide label in every row: a plate in any row would cover one by less than half, so the ordinary rules refuse them all.
    const wall = (protectedLabel: boolean) => ROWS.map((offset, i) => label(`w${i}`, 100, 500, offset, { leader: i > 0 ? { x: 301, top: 100 + offset + 4, bottom: 90 } : undefined, protectedLabel, length: 40 + i }))
    const input = (protectedLabel: boolean) => ({ x: 300, markY: 100, innerWidth: 700, rows: ROWS, labels: wall(protectedLabel) })
    expect(planPinnedLabel({ ...input(false), width: 120 })).toBeNull()
    const texts = [{ text: 'The selected name', width: 120 }, { text: 'The selected…', width: 80 }]
    const found = planPinnedText(input(false), texts)
    expect(found).not.toBeNull()
    // Named in full; only the one label it touches is hidden whole, in the row where the others' leaders do not run through the plate.
    expect(found!.text).toBe('The selected name')
    expect(found!.plan.hidden).toEqual(['w3'])
    // A protected wall is never hidden: no plate.
    expect(planPinnedText(input(true), texts)).toBeNull()
  })

  it("does not hide a label for the plate's own leader, which passes behind it", () => {
    // The case of Deep time's Triassic: protected labels fill the near rows around a free neighbour in row 0, and the only room is up in row 3, its leader behind that neighbour.
    const box = (id: string, left: number, right: number, offset: number, extra: Partial<PlacedLabelBox> = {}) => label(id, left, right, offset, { length: 20, ...extra })
    const labels = [
      box('U', 90, 110, -20),
      box('R1', 0, 89, -20, { protectedLabel: true }),
      box('R2', 111, 200, -20, { protectedLabel: true }),
      box('Q', 0, 200, -34, { protectedLabel: true }),
      box('P', 0, 200, -48, { protectedLabel: true }),
    ]
    const found = planPinnedText({ x: 100, markY: 100, innerWidth: 400, rows: ROWS, labels }, [{ text: 'Selected', width: 50 }])
    expect(found?.plan.hidden).toEqual([])
    expect(found?.plan.offset).toBe(-62)
  })

  it('ranks placements by the fewest labels hidden across the texts, before the longest name', () => {
    // A mark at the left edge: a plate can only start at it. A label sits just right of the mark.
    const edge = label('edge', 60, 120, -20, { length: 12 })
    const input = { x: 5, markY: 100, innerWidth: 700, rows: [-20], labels: [edge] }
    // The long name (100) covers the label wholly (hiding it); the short one (40) hides nothing: it wins though shorter.
    const found = planPinnedText(input, [
      { text: 'A long name that covers', width: 100 },
      { text: 'Short', width: 40 },
    ])
    expect(found?.text).toBe('Short')
    expect(found?.plan.hidden).toEqual([])
    // Where both hide the same, the longer wins.
    const both = planPinnedText({ ...input, labels: [label('edge', 20, 120, -20, { length: 12 })] }, [
      { text: 'A long name that covers', width: 100 },
      { text: 'Short', width: 40 },
    ])
    expect(both?.text).toBe('A long name that covers')
  })
})
