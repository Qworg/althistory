import { describe, expect, it } from 'vitest'
import { PLATE_ASCENT, PLATE_DESCENT, PLATE_INK_SLACK, PLATE_ONLY_ASCENT, PLATE_ONLY_DESCENT, PLATE_PAD, planPinnedLabel, planPinnedText, type PlacedLabelBox } from './pinnedLabel'

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

  it('hides the least text when two placements hide the same number of labels', () => {
    // A plate of 94px at x=300: starting at the mark it covers the 30-character label on the right; ending at it, the 5-character one on the left; centred, both.
    const labels = [label('long', 310, 345, -20, { length: 30 }), label('short', 255, 290, -20, { length: 5 })]
    expect(planPinnedLabel({ x: 300, markY: 100, width: 94, innerWidth: 700, rows: [-20], labels })).toMatchObject({ anchor: 'end', hidden: ['short'] })
  })

  it('prefers the placement whose leader passes behind fewer labels, after the fewest hidden', () => {
    // A label above the mark in row 1 holds x; a plate above it hangs its leader behind it, one under the track does not.
    const over = label('over', 250, 350, -20, { protectedLabel: true })
    const found = planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [-34, 24], labels: [over] })
    expect(found).toMatchObject({ offset: 24, hidden: [], crossings: 0 })
    // With only the row above available, it is taken, its one crossing counted.
    expect(planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [-34], labels: [over] })).toMatchObject({ offset: -34, crossings: 1 })
  })

  it('runs the ordinary rules before the last resort, though the last resort could hide fewer', () => {
    // Row 1: two adjacent labels, both of which only the centred plate covers wholly (an extent covering one touches the other: refused by the ordinary rules). Row 2: one wide label a plate would cover by less than half (refused by them too; hidden whole by the last resort, which then hides fewer).
    const labels = [label('s1', 260, 300, -20, { length: 5 }), label('s2', 300, 340, -20, { length: 5 }), label('wide', 100, 500, -34, { length: 40 })]
    const found = planPinnedText({ x: 300, markY: 100, innerWidth: 700, rows: [-20, -34], labels }, [{ text: 'Selected', width: 60 }])
    expect(found?.plan.hidden).toEqual(['s1', 's2'])
  })

  describe('the ranking of a plate\'s leader', () => {
    const row = (id: string, left: number, right: number, offset: number, extra: Partial<PlacedLabelBox> = {}) => label(id, left, right, offset, { length: 20, ...extra })

    it('counts the kept labels it passes behind, not obstacles, nor labels the plate hides, nor those above the plate', () => {
      // A label above the mark in row -20; a plate in row -34 hangs its leader behind it.
      const q = row('q', 250, 350, -20, { protectedLabel: true })
      expect(planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [-34], labels: [q] })?.crossings).toBe(1)
      // ...an obstacle (a link, a stem) is not a label.
      expect(planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [-34], labels: [{ ...q, obstacle: true }] })?.crossings).toBe(0)
      // ...a label the plate hides goes with its leader, so it is not crossed even if it reaches into the leader's way.
      const tall: PlacedLabelBox = { id: 't', left: 270, right: 330, top: 100 - 34 - 10.5 + 1, bottom: 100 - 34 + 3.5 + 9, length: 20 }
      const hides = planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [-34], labels: [tall] })
      expect(hides?.hidden).toEqual(['t'])
      expect(hides?.crossings).toBe(0)
      // ...and one above the plate is not between it and the mark.
      expect(planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [-20], labels: [row('above', 250, 350, -34, { protectedLabel: true })] })?.crossings).toBe(0)
    })

    it('counts a label between the mark and a plate under the track', () => {
      const between = row('between', 250, 350, 34, { protectedLabel: true })
      expect(planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [48], labels: [between] })?.crossings).toBe(1)
    })

    it('ranks the fewer crossings first across the texts, before the longer name', () => {
      // The wide name fits only above (one crossing); the narrow one fits under the track (none).
      const q = row('q', 250, 350, -20, { protectedLabel: true })
      const stem = (id: string, at: number): PlacedLabelBox => ({ id, left: at - 1, right: at + 1, top: 100 + 24 - 10.5, bottom: 100 + 24 + 3.5, length: 0, protectedLabel: true, obstacle: true })
      const found = planPinnedText({ x: 300, markY: 100, innerWidth: 700, rows: [-34, 24], labels: [q, stem('o1', 360), stem('o2', 240)] }, [
        { text: 'A wide name', width: 120 },
        { text: 'Narrow', width: 40 },
      ])
      expect(found?.text).toBe('Narrow')
      expect(found?.plan.offset).toBe(24)
    })

    it("ranks the leader that avoids the selection's own trace first across the texts, before the longer name", () => {
      // The wide name fits only under the track, its leader along a traced obstacle; the narrow one fits in row -20.
      const traced: PlacedLabelBox = { id: 'trace', left: 298, right: 302, top: 100 + 8, bottom: 100 + 30, length: 0, protectedLabel: true, obstacle: true, traced: true }
      const guard = (id: string, at: number): PlacedLabelBox => ({ id, left: at - 5, right: at + 5, top: 100 - 20 - 9.6, bottom: 100 - 20 + 3, length: 20, protectedLabel: true })
      const found = planPinnedText({ x: 300, markY: 100, innerWidth: 700, rows: [-20, 48], labels: [traced, guard('g1', 355), guard('g2', 245)] }, [
        { text: 'A wide name', width: 120 },
        { text: 'Narrow', width: 40 },
      ])
      expect(found?.text).toBe('Narrow')
      expect(found?.plan.offset).toBe(-20)
    })

    it("ranks a leader along the selection's own trace below one that avoids it", () => {
      // A traced obstacle lies between the mark and a plate under the track; the plate above, listed second, avoids it.
      const traced: PlacedLabelBox = { id: 'trace', left: 298, right: 302, top: 100 + 8, bottom: 100 + 30, length: 0, protectedLabel: true, obstacle: true, traced: true }
      const found = planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [48, -20], labels: [traced] })
      expect(found?.offset).toBe(-20)
      expect(found?.tracedHits).toBe(0)
      expect(planPinnedLabel({ x: 300, markY: 100, width: 60, innerWidth: 700, rows: [48], labels: [traced] })?.tracedHits).toBe(1)
    })
  })

  it('hides nothing when the last resort is not allowed', () => {
    const wide = label('wide', 100, 500, -20, { length: 40 })
    // The only row would cover the wide label by less than half: refused by the ordinary rules, hidden by the last resort.
    expect(planPinnedText({ x: 300, markY: 100, innerWidth: 700, rows: [-20], labels: [wide] }, [{ text: 'Selected', width: 60 }], false)).toBeNull()
    expect(planPinnedText({ x: 300, markY: 100, innerWidth: 700, rows: [-20], labels: [wide] }, [{ text: 'Selected', width: 60 }])?.plan.hidden).toEqual(['wide'])
  })
})

describe("a plate holds its text's ink (#42)", () => {
  // The measurement as the canvas gives it for IBM Plex Sans bold at 12px: ascenders 9 above the baseline, descenders 2 below, an accented capital 12.
  const plain = { ascent: 9, descent: 2 }
  const accented = { ascent: 12, descent: 2 }
  const PLATE_ONLY = -75
  const plateBox = (offset: number) => (offset === PLATE_ONLY ? { ascent: PLATE_ONLY_ASCENT, descent: PLATE_ONLY_DESCENT, fixed: true } : { ascent: PLATE_ASCENT, descent: PLATE_DESCENT })
  const rows = [-20, PLATE_ONLY]
  const wall = [label('w', 0, 700, -20, { protectedLabel: true })]
  const place = (ink: { ascent: number; descent: number }, labels = wall) => planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows, labels, plateBox, ink })

  it('puts ordinary text, whose ink fits, in the fixed plate-only row', () => {
    expect(place(plain)).toMatchObject({ offset: PLATE_ONLY, ascent: PLATE_ONLY_ASCENT, descent: PLATE_ONLY_DESCENT })
  })

  // The accented name at smaller sizes, as measured: ink shrinks with the size (11.5px: 11.5 above the baseline ... 9.3px at 9.7).
  const sizes = [
    { fontSize: 11, width: 90, ink: { ascent: 11, descent: 2.4 } },
    { fontSize: 10.5, width: 86, ink: { ascent: 9.4, descent: 2.3 } },
    { fontSize: 10, width: 82, ink: { ascent: 9.2, descent: 2.2 } },
  ]

  it('keeps accented capitals in the fixed plate-only row, drawn at the largest size whose ink fits, with the width of that size', () => {
    expect(12).toBeGreaterThan(PLATE_ONLY_ASCENT + PLATE_INK_SLACK)
    const found = planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows, labels: wall, plateBox, ink: accented, sizes })!
    expect(found).toMatchObject({ offset: PLATE_ONLY, fontSize: 10.5, ascent: PLATE_ONLY_ASCENT, descent: PLATE_ONLY_DESCENT })
    expect(found.right - found.left).toBe(86)
    // The ink at the chosen size is inside the plate (and its stroke).
    expect(sizes[1]!.ink.ascent).toBeLessThanOrEqual(found.ascent + PLATE_INK_SLACK)
    // Ordinary text is drawn at the usual size.
    expect(planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows, labels: wall, plateBox, ink: plain, sizes: [] })!.fontSize).toBeUndefined()
  })

  it('keeps the row, at the smallest size, when the ink fits at none: it never moves to another row or hides a neighbour for it', () => {
    const tall = sizes.map((size) => ({ ...size, ink: { ascent: 10.4, descent: 2 } }))
    // Row -20 is free here: the plate-only row is still the one taken when it is the nearest the rows offer it; offered alone it is kept.
    const found = planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels: [], plateBox, ink: accented, sizes: tall })!
    expect(found).toMatchObject({ offset: PLATE_ONLY, fontSize: 10, hidden: [] })
    const withWall = planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows, labels: wall, plateBox, ink: accented, sizes: tall })!
    expect(withWall).toMatchObject({ offset: PLATE_ONLY, fontSize: 10, hidden: [] })
  })

  it('a descender that dips below the plate is set smaller too', () => {
    const deep = [{ fontSize: 11, width: 90, ink: { ascent: 8, descent: 4.2 } }, { fontSize: 10, width: 82, ink: { ascent: 7.5, descent: 3.4 } }]
    expect(planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows, labels: wall, plateBox, ink: { ascent: 9, descent: 4.5 }, sizes: deep })).toMatchObject({ offset: PLATE_ONLY, fontSize: 10 })
  })

  it("draws an ordinary row's plate tall enough for accented capitals, without counting the growth as covering the row above", () => {
    const found = planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows: [-20], labels: [], plateBox, ink: accented })!
    expect(found.ascent).toBeGreaterThanOrEqual(accented.ascent)
    expect(found.descent).toBeGreaterThanOrEqual(accented.descent)
    // A label in the row above (baseline -34, its box ending 3 under it) is not covered by the usual 14px box, so the grown plate still goes here.
    const above = label('above', 250, 350, -34, { protectedLabel: true })
    expect(planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows: [-20], labels: [above], plateBox, ink: accented })).toMatchObject({ offset: -20 })
    // Ordinary text keeps the usual plate.
    expect(planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows: [-20], labels: [], plateBox, ink: plain })).toMatchObject({ ascent: PLATE_ASCENT, descent: PLATE_DESCENT })
  })

  it('always gives a plate-only box that contains the measured ink', () => {
    for (const ink of [plain, accented, { ascent: 12, descent: 4 }, { ascent: 5, descent: 0 }, { ascent: 9.5, descent: 3.5 }]) {
      for (const labels of [[], wall]) {
        const found = planPinnedLabel({ x: 300, markY: 100, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels, plateBox, ink, sizes })
        if (!found) continue
        // At whatever size it was drawn at, the ink fits, unless even the smallest does not.
        const drawn = found.fontSize === undefined ? ink : sizes.find((size) => size.fontSize === found.fontSize)!.ink
        if (found.fontSize !== 10) {
          expect(found.ascent + PLATE_INK_SLACK).toBeGreaterThanOrEqual(drawn.ascent)
          expect(found.descent + PLATE_INK_SLACK).toBeGreaterThanOrEqual(drawn.descent)
        }
      }
    }
  })

  describe("beside other labels' ink", () => {
    const Y = 100
    // Ink in the plate-only row (y0 = -75): the plate's top is -84, its usual bottom -72. A label in the top row (baseline -62) with accents reaches inkTop.
    const above = (inkTop: number) => [label('top', 200, 400, -62, { inkTop: Y + inkTop })]
    const plainSizes = [
      { fontSize: 11, width: 92, ink: { ascent: 8.1, descent: 2.1 } },
      { fontSize: 10, width: 84, ink: { ascent: 7.4, descent: 2.2 } },
    ]
    const only = (labels: PlacedLabelBox[], ink = plain, withSizes = plainSizes) =>
      planPinnedLabel({ x: 300, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels, plateBox, ink, sizes: withSizes })!

    it('changes nothing where no label reaches under the plate', () => {
      expect(only(above(-71))).toMatchObject({ offset: PLATE_ONLY, ascent: PLATE_ONLY_ASCENT, descent: PLATE_ONLY_DESCENT })
      expect(only(above(-71)).lift).toBeUndefined()
      expect(only(above(-71)).fontSize).toBeUndefined()
      expect(only([])).toMatchObject({ descent: PLATE_ONLY_DESCENT })
    })

    it("ends the plate at its own text's ink bottom (less the stroke's half) where a label's accents reach under it, and lifts the text when that is not enough", () => {
      // The label's ink reaches -73.2. The text's ink bottom is -75 + 2 = -73; the plate's stroke reaches 0.5 under its edge, so the baseline is lifted 0.2
      // for the stroke's outer edge to clear the label's ink (the ink's top then still lies inside the plate's top stroke).
      const found = only(above(-73.2))
      expect(found.lift).toBeCloseTo(0.2)
      expect(found.fontSize).toBeUndefined()
      expect(Y + PLATE_ONLY + found.descent + PLATE_INK_SLACK).toBeLessThanOrEqual(Y - 73.2 + 1e-9)
      expect(Y + PLATE_ONLY - found.lift! - plain.ascent).toBeGreaterThanOrEqual(Y + PLATE_ONLY - found.ascent - PLATE_INK_SLACK - 1e-9)
    })

    it('sets the text smaller where lifting at the usual size is not enough, and the plate narrows with it', () => {
      // At 12px the lift needed is 1 and the room 0.5; at 11px it is 1.1 and the room 1.4.
      const found = only(above(-74))
      expect(found.fontSize).toBe(11)
      expect(found.lift).toBeCloseTo(1.1)
      expect(found.right - found.left).toBe(92)
      expect(Y + PLATE_ONLY + found.descent + PLATE_INK_SLACK).toBeLessThanOrEqual(Y - 74 + 1e-9)
    })

    it('stays at the smallest size, lifted as far as it goes, where nothing is enough: it still names the selection and hides nothing', () => {
      // A plain name goes no smaller than 11px for a neighbour's accents (the stroke may lie over their tips); an accented one goes to 10px.
      const plainFound = only(above(-80))
      expect(plainFound).toMatchObject({ offset: PLATE_ONLY, fontSize: 11, hidden: [] })
      expect(plainFound.lift).toBeCloseTo(PLATE_ONLY_ASCENT + PLATE_INK_SLACK - 8.1)
      const accentedSizes = [
        { fontSize: 11, width: 92, ink: { ascent: 11, descent: 2.1 } },
        { fontSize: 10, width: 84, ink: { ascent: 10, descent: 2.2 } },
      ]
      const found = only(above(-80), accented, accentedSizes)
      expect(found).toMatchObject({ offset: PLATE_ONLY, fontSize: 10, hidden: [] })
      expect(found.right - found.left).toBe(84)
    })

    it('ignores a label whose ink is not under the plate, or that is hidden by it', () => {
      expect(only([label('far', 500, 650, -62, { inkTop: Y - 80 })]).lift).toBeUndefined()
    })

    it('counts a plain text beside a label with ink exactly 0.5 under the stroke as fitting: the comparison is at most, not less than', () => {
      // Ink of 9.5 above and 3.5 below fits the fixed plate (9 and 3, and the stroke's half each).
      expect(only([], { ascent: 9.5, descent: 3.5 }).fontSize).toBeUndefined()
      expect(only([], { ascent: 9.51, descent: 3.5 }).fontSize).toBe(11)
      expect(only([], { ascent: 9.5, descent: 3.51 }).fontSize).toBe(11)
    })
  })

  describe("an ordinary row's plate grown for accents", () => {
    const Y = 100
    const sizes = [
      { fontSize: 11, width: 90, ink: { ascent: 11, descent: 2.4 } },
      { fontSize: 10.5, width: 86, ink: { ascent: 9.4, descent: 2.3 } },
    ]
    const row20 = (labels: PlacedLabelBox[], ink = accented) =>
      planPinnedLabel({ x: 300, markY: Y, width: 100, innerWidth: 700, rows: [-20], labels, plateBox, ink, sizes })!

    it('grows by the ink and half the stroke, in both directions', () => {
      expect(row20([])).toMatchObject({ ascent: 12.5, descent: PLATE_DESCENT })
      expect(row20([], { ascent: 9, descent: 4 })).toMatchObject({ ascent: PLATE_ASCENT, descent: 4.5 })
      expect(row20([]).fontSize).toBeUndefined()
    })

    it("does not grow over the ink of the label above: the text is set smaller instead, and nothing is hidden for it", () => {
      // The row above (baseline -34) has descenders reaching 2.6 below it: -31.4. A plate grown to 12.5 above -20 reaches -32.5, over them.
      const above = label('above', 250, 350, -34, { inkBottom: Y - 34 + 2.6 })
      const found = row20([above])
      expect(found).toMatchObject({ offset: -20, fontSize: 10.5, hidden: [] })
      expect(found.ascent).toBe(PLATE_ASCENT)
      // Its top clears the ink above.
      expect(Y - 20 - found.ascent).toBeGreaterThanOrEqual(Y - 34 + 2.6)
      // A label above that is not over the plate does not matter.
      expect(row20([label('away', 500, 650, -34, { inkBottom: Y - 34 + 2.6 })]).fontSize).toBeUndefined()
    })
  })

  describe('the edges of the ink rules', () => {
    const Y = 100
    const sizes = [
      { fontSize: 11, width: 90, ink: { ascent: 11, descent: 2.4 } },
      { fontSize: 10.5, width: 86, ink: { ascent: 9.4, descent: 2.3 } },
    ]
    // Row -20 (baseline 80): its plate reaches 10.5 above (69.5) and 3.5 below; grown for the accented ink (12) it reaches 12.5 above (67.5).
    const row20 = (labels: PlacedLabelBox[], ink = accented) => planPinnedLabel({ x: 300, markY: Y, width: 100, innerWidth: 700, rows: [-20], labels, plateBox, ink, sizes })!
    const above = (inkBottom: number, extra: Partial<PlacedLabelBox> = {}) => label('above', 250, 350, -34, { inkBottom, ...extra })

    it("grows over a label's ink above only to where its top stroke's outer edge meets it", () => {
      // Grown for the ink the plate reaches 12.5 above the baseline (67.5), and its stroke half a pixel further (67): ink ending there clears.
      expect(row20([above(Y - 33)])).toMatchObject({ ascent: 12.5 })
      expect(row20([above(Y - 33)]).fontSize).toBeUndefined()
      // A tenth of a pixel more and the stroke lies over it: the text is set smaller instead (at 11px the plate reaches 11.5, the stroke 12: clear).
      expect(row20([above(Y - 32.9)]).fontSize).toBe(11)
    })

    it('where no size clears the ink above, caps the plate under it rather than cover it', () => {
      const tall = [
        { fontSize: 11, width: 90, ink: { ascent: 11.5, descent: 2.4 } },
        { fontSize: 10, width: 84, ink: { ascent: 11, descent: 2.2 } },
      ]
      // The label above has ink down to 68.5 (11.5 above the baseline at 80): no size clears 12 above the baseline, and the cap is 11 (stroke included).
      const found = planPinnedLabel({ x: 300, markY: Y, width: 100, innerWidth: 700, rows: [-20], labels: [above(Y - 31.5)], plateBox, ink: accented, sizes: tall })!
      expect(found.fontSize).toBe(10)
      expect(found.ascent).toBeCloseTo(11)
      expect(Y - 20 - found.ascent - PLATE_INK_SLACK).toBeGreaterThanOrEqual(Y - 31.5 - 1e-9)
    })

    it('a name with no accent of its own stops at 11px for a neighbour, and an accented one goes on to 10px', () => {
      const both = [
        { fontSize: 11, width: 90, ink: { ascent: 9.4, descent: 2.2 } },
        { fontSize: 10, width: 84, ink: { ascent: 8.6, descent: 2.2 } },
      ]
      // A plain name never grows its plate (it fits the usual one), so nothing there asks it to shrink at all.
      expect(planPinnedLabel({ x: 300, markY: Y, width: 100, innerWidth: 700, rows: [-20], labels: [above(Y - 31)], plateBox, ink: plain, sizes: both })!.fontSize).toBeUndefined()
      // The ladder: an accented name may use 10px, a plain one is offered only 12 and 11.
      const long = [{ fontSize: 11, width: 90, ink: { ascent: 10, descent: 2 } }, { fontSize: 10, width: 84, ink: { ascent: 9.2, descent: 2 } }]
      const onlyAccent = planPinnedLabel({ x: 300, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels: [], plateBox, ink: { ascent: 9.9, descent: 2 }, sizes: long })!
      expect(onlyAccent.fontSize).toBe(10)
    })

    it("judges the label above by its ink, not its box, and only a label above: not one beside or below the plate", () => {
      // The box ends at -31 (69, under the grown top at 67.5), the ink at 67: clear.
      expect(row20([above(Y - 33)]).fontSize).toBeUndefined()
      // A label in the row below, over the plate, with ink reaching far up: it does not stop the plate growing.
      expect(row20([label('below', 250, 350, -6, { inkBottom: Y + 20 })]).fontSize).toBeUndefined()
      // A label above that cannot be cleared at any size: the smallest is used.
      expect(row20([above(Y - 25)]).fontSize).toBe(10.5)
    })

    it('keeps the text at the usual width when only the drawn plate grows', () => {
      const found = row20([])
      expect(found.right - found.left).toBe(100)
    })

    it("ends the plate at its own ink where the ink of a label in the row below reaches up under it", () => {
      // The plate's usual bottom is 83.5; the label below (baseline -6) has accents reaching up to 82.8.
      const found = row20([label('below', 250, 350, -6, { inkTop: Y - 17.2 })], plain)
      expect(found.descent).toBeCloseTo(2.3)
      expect(Y - 20 + found.descent + PLATE_INK_SLACK).toBeLessThanOrEqual(Y - 17.2 + 1e-9)
      expect(row20([label('below', 250, 350, -6, { inkTop: Y - 5 })], plain).descent).toBe(PLATE_DESCENT)
      // It does not end above its own ink: the text's descenders (2) less the stroke's half stay in.
      expect(row20([label('below', 250, 350, -6, { inkTop: Y - 19 })], plain).descent).toBeCloseTo(1.5)
    })

    // The plate-only row, baseline -75 (25): the plate's top is 16, its usual bottom 28.
    const only = (labels: PlacedLabelBox[], ink = { ascent: 9, descent: 2 }, extra: Partial<Parameters<typeof planPinnedLabel>[0]> = {}) =>
      planPinnedLabel({ x: 300, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels, plateBox, ink, sizes: [{ fontSize: 11, width: 92, ink: { ascent: 8.1, descent: 2.1 } }, { fontSize: 10, width: 84, ink: { ascent: 7.4, descent: 2.2 } }], ...extra })!

    it('does not lift for a label the plate hides, or one above the plate', () => {
      // A small unprotected label covered whole by the plate (hidden), with ink reaching up to 18.
      const hidden = label('hidden', 250, 350, -73, { inkTop: Y - 82, length: 5 })
      const found = only([hidden])
      expect(found.hidden).toEqual(['hidden'])
      expect(found.lift).toBeUndefined()
      // A label up in the arc band: its ink is above the plate, not under it.
      expect(only([label('arc', 250, 350, -90, { inkTop: Y - 99 })]).lift).toBeUndefined()
    })

    it("sets the text smaller, not at the usual size, when the usual size's ink did not fit the plate even where nothing reaches under it", () => {
      // Ink of 12 above: the text starts at 11 (its 8.1 fits), and the room beside a label whose ink ends level with the usual bottom does not send it back to 12.
      const found = only([label('top', 200, 400, -62, { inkTop: Y - 72.5 })], { ascent: 12, descent: 2 })
      expect(found.fontSize).toBe(11)
    })

    it("keeps an end-anchored plate's right edge, and a start-anchored one's left, when the text is set smaller", () => {
      const sizes2 = [{ fontSize: 10, width: 80, ink: { ascent: 9.2, descent: 2 } }]
      const end = planPinnedLabel({ x: 698, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels: [], plateBox, ink: accented, sizes: sizes2 })!
      expect(end).toMatchObject({ anchor: 'end', fontSize: 10 })
      expect(end.right).toBeLessThanOrEqual(700)
      expect(end.right - end.left).toBe(80)
      const startAt = planPinnedLabel({ x: 4, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels: [], plateBox, ink: accented, sizes: sizes2 })!
      expect(startAt).toMatchObject({ anchor: 'start', fontSize: 10 })
      expect(startAt.left).toBeGreaterThanOrEqual(0)
      expect(startAt.right - startAt.left).toBe(80)
      // Where the narrowing happens beside a label's ink, too: the plate narrows about the middle.
      const mid = only([label('top', 200, 400, -62, { inkTop: Y - 74 })], { ascent: 9, descent: 2 })
      expect(mid.anchor).toBe('middle')
      expect((mid.left + mid.right) / 2).toBeCloseTo(300)
    })

    it('starts from the size that fits, and never goes back to a larger one, for the room beside a label', () => {
      // 12px ink of 12 above does not fit; at its usual size the room beside a label whose ink ends level with the plate's bottom would "fit" at once.
      const found = only([label('top', 200, 400, -62, { inkTop: Y - 72.5 })], { ascent: 12, descent: 2 })
      expect(found.fontSize).toBeDefined()
    })

    it("narrows an end- or start-anchored plate about its anchored edge when option B sets the text smaller than the size it started at", () => {
      const sizes2 = [{ fontSize: 11, width: 92, ink: { ascent: 8.1, descent: 2.1 } }, { fontSize: 10, width: 84, ink: { ascent: 7.4, descent: 2.2 } }]
      // A wide label whose ink reaches -74 lies under any plate in the row: 12px cannot clear it (lift 1 against a room of 0.5), 11px can.
      const wide = [label('wide', 0, 700, -62, { inkTop: Y - 74 })]
      const end = planPinnedLabel({ x: 698, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels: wide, plateBox, ink: { ascent: 9, descent: 2 }, sizes: sizes2 })!
      expect(end).toMatchObject({ anchor: 'end', fontSize: 11 })
      // The edge it is anchored at stays where the unnarrowed plate had it.
      expect(end.right).toBe(planPinnedLabel({ x: 698, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels: [], plateBox, ink: { ascent: 9, descent: 2 } })!.right)
      expect(end.right - end.left).toBe(92)
      const startAt = planPinnedLabel({ x: 4, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels: wide, plateBox, ink: { ascent: 9, descent: 2 }, sizes: sizes2 })!
      expect(startAt).toMatchObject({ anchor: 'start', fontSize: 11 })
      expect(startAt.left).toBe(planPinnedLabel({ x: 4, markY: Y, width: 100, innerWidth: 700, rows: [PLATE_ONLY], labels: [], plateBox, ink: { ascent: 9, descent: 2 } })!.left)
      expect(startAt.right - startAt.left).toBe(92)
    })

    it("judges an ordinary row's plate at the width of the text it starts from, not a smaller size's", () => {
      // The accented text's usual width is 100; its 11px form is 90. A protected label 49 to 52 right of the mark lies under the 100px plate's
      // centred extent (303 + 3 = 353 reaches it) and clear of a 90px one (300 + 45 + 3 = 348): the centred plate is refused, and the plate goes at the mark's end.
      const sizesAccent = [{ fontSize: 11, width: 90, ink: { ascent: 11, descent: 2.4 } }]
      const found = planPinnedLabel({ x: 300, markY: Y, width: 100, innerWidth: 700, rows: [-20], labels: [label('guard', 349, 352, -20, { protectedLabel: true })], plateBox, ink: accented, sizes: sizesAccent })!
      expect(found.anchor).not.toBe('middle')
    })
  })
})

