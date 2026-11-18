import { describe, expect, it } from 'vitest'
import { MIN_PLATE_CHARS, planSelectionPlate, shortenedPlateTexts, type PlateLink, type SelectionPlateInput } from './selectionPlate'
import { PLATE_ASCENT, PLATE_DESCENT, PLATE_PAD, type PlacedLabelBox } from './pinnedLabel'

const X = 300
const Y = 100
const ABOVE = [-20, -34, -48, -62] as const
const TOP = [-75] as const
const BELOW = [34, 48] as const
const texts = [{ text: 'The selected name', width: 100 }]

const box = (id: string, left: number, right: number, offset: number, extra: Partial<PlacedLabelBox> = {}): PlacedLabelBox => ({
  id,
  left,
  right,
  top: Y + offset - 9.6,
  bottom: Y + offset + 3,
  length: 20,
  ...extra,
})
/** A protected label across every row above the track, so that no plate can go there. */
const wall = [...ABOVE, ...TOP].map((offset) => box(`wall${offset}`, 0, 700, offset, { protectedLabel: true }))

const input = (extra: Partial<SelectionPlateInput> = {}): SelectionPlateInput => ({
  x: X,
  selectedId: 'sel',
  markY: Y,
  innerWidth: 700,
  aboveRows: ABOVE,
  plateOnlyRows: TOP,
  belowRows: BELOW,
  linkBandHeight: 120,
  stemLength: 20,
  labels: [],
  marks: [{ id: 'sel', x: X }],
  links: [],
  texts,
  ...extra,
})
const link = (id: string, x1: number, x2: number, traced = false): PlateLink => ({ id, x1, x2, traced })
/** The plate's box. */
const plateOf = (found: NonNullable<ReturnType<typeof planSelectionPlate>>) => ({
  left: found.plan.left - PLATE_PAD,
  right: found.plan.right + PLATE_PAD,
  top: Y + found.plan.offset - PLATE_ASCENT,
  bottom: Y + found.plan.offset + PLATE_DESCENT,
})

describe('planSelectionPlate', () => {
  it('takes the nearest row above the track when nothing is in the way: above wins a tie with the rows under it', () => {
    expect(planSelectionPlate(input())?.plan.offset).toBe(-20)
  })

  it('goes in the plate-only row above the label rows when the label rows are full', () => {
    const rowsFull = [...ABOVE].map((offset) => box(`r${offset}`, 0, 700, offset, { protectedLabel: true }))
    expect(planSelectionPlate(input({ labels: rowsFull, belowRows: [] }))?.plan.offset).toBe(-75)
  })

  it('goes under the track when every row above is blocked, in the first row under it that is free', () => {
    const found = planSelectionPlate(input({ labels: wall }))
    expect(found?.plan.offset).toBe(34)
  })

  it("is not stopped by the selection's own stem, but is by another mark's", () => {
    // A link-free track keeps room for one row under it (24), where stems reach.
    const link24 = { belowRows: [24] as readonly number[], linkBandHeight: null, labels: wall }
    expect(planSelectionPlate(input(link24))?.plan.offset).toBe(24)
    expect(planSelectionPlate(input({ ...link24, marks: [{ id: 'sel', x: X }, { id: 'near', x: 320 }, { id: 'left', x: 280 }] }))).toBeNull()
    // A mark whose stem is clear of the plate's reach does not stop it.
    expect(planSelectionPlate(input({ ...link24, marks: [{ id: 'sel', x: X }, { id: 'far', x: 600 }] }))?.plan.offset).toBe(24)
  })

  it('prefers the rows above the track alone where the sheet is docked, though a row under it would hide nothing', () => {
    // Row -20 holds one small unprotected label the plate would cover; the other rows above are walled.
    const small = box('small', 270, 330, -20, { length: 8 })
    const labels = [...wall.filter((w) => w.id !== 'wall-20'), small]
    expect(planSelectionPlate(input({ labels }))?.plan.offset).toBe(34)
    const docked = planSelectionPlate(input({ labels, preferAbove: true }))
    expect(docked?.plan.offset).toBe(-20)
    expect(docked?.plan.hidden).toEqual(['small'])
    // A docked sheet takes the plate-only row above the labels before any row under the track, though that row's leader passes behind four labels.
    const labelRowsWalled = ABOVE.map((offset) => box(`w${offset}`, 0, 700, offset, { protectedLabel: true }))
    expect(planSelectionPlate(input({ labels: labelRowsWalled, preferAbove: true }))?.plan.offset).toBe(-75)
    // With nothing above, a docked sheet still gets a plate under the track.
    expect(planSelectionPlate(input({ labels: wall, preferAbove: true }))?.plan.offset).toBe(34)
  })

  it('puts the plate-only row before the rows under the track when they tie (nothing hidden, no crossings)', () => {
    // Obstacles block the label rows without being labels the leader passes behind, so the plate-only row and the first row under the track cost the same.
    const blocked = ABOVE.map((offset) => box(`o${offset}`, 0, 700, offset, { protectedLabel: true, obstacle: true }))
    expect(planSelectionPlate(input({ labels: blocked }))?.plan.offset).toBe(-75)
  })

  it('respects a soft obstacle (a sliver arc) in the first pass, and sets it aside rather than leave the selection unnamed', () => {
    // As Timeline draws a narrow bar: its top 16px above its foot, which is the plate-only row's plate top (Y - 75 - 9), and a pixel past it.
    const sliver: PlacedLabelBox = { id: 'sliver', left: 0, right: 700, top: Y - 100, bottom: Y - 83, length: 0, protectedLabel: true, obstacle: true }
    // The label rows are blocked by things that are not labels (so the plate-only row and the first row under the track cost the same and the earlier row wins a tie).
    const rowsBlocked = ABOVE.map((offset) => box(`o${offset}`, 0, 700, offset, { protectedLabel: true, obstacle: true }))
    expect(planSelectionPlate(input({ labels: rowsBlocked }))?.plan.offset).toBe(-75)
    // With the sliver there, the plate takes the row under the track rather than cover the sliver's edge.
    expect(planSelectionPlate(input({ labels: rowsBlocked, softObstacles: [sliver] }))?.plan.offset).toBe(34)
    // With nowhere else, the plate-only row is used over the sliver.
    expect(planSelectionPlate(input({ labels: rowsBlocked, softObstacles: [sliver], belowRows: [] }))?.plan.offset).toBe(-75)
  })

  it('sets a soft obstacle aside before it hides a neighbour: covering a sliver is better than hiding a label', () => {
    // Row -20 holds a wide label a plate would cover by less than a third (hidden only by the last resort); the plate-only row is under a sliver.
    const wide = box('wide', 100, 500, -20, { length: 40 })
    // As Timeline draws a narrow bar: its top 16px above its foot, which is the plate-only row's plate top (Y - 75 - 9), and a pixel past it.
    const sliver: PlacedLabelBox = { id: 'sliver', left: 0, right: 700, top: Y - 100, bottom: Y - 83, length: 0, protectedLabel: true, obstacle: true }
    const found = planSelectionPlate(input({ aboveRows: [-20], belowRows: [], labels: [wide], softObstacles: [sliver] }))
    expect(found?.plan.offset).toBe(-75)
    expect(found?.plan.hidden).toEqual([])
    // Without the sliver, the same: nothing is hidden.
    expect(planSelectionPlate(input({ aboveRows: [-20], belowRows: [], labels: [wide] }))?.plan.hidden).toEqual([])
  })

  describe('links under the track', () => {
    it('reads where a link reaches: one that stays in the first row under the track leaves the second', () => {
      // A link three pixels wide hangs 16px: it blocks the first row (y 23 to 37) and only grazes the second.
      const found = planSelectionPlate(input({ labels: wall, links: [link('short', X, X + 3)] }))
      expect(found?.plan.offset).toBe(48)
      // It is not the selection's: the plate's leader runs past it without counting it as the trace.
      expect(found?.plan.tracedHits).toBe(0)
    })

    it("counts the selection's own loop, which the plate's leader passes, as its trace", () => {
      // A loop at the mark blocks the first row under the track and only grazes the second; the leader to a plate in the second runs through it.
      const found = planSelectionPlate(input({ labels: wall, links: [link('loop', X, X)] }))
      expect(found?.plan.offset).toBe(48)
      expect(found?.plan.tracedHits).toBe(1)
    })

    it('puts each link\'s obstacle in its own row: a link far to one side leaves the plate on the side away from it', () => {
      expect(planSelectionPlate(input({ labels: wall, links: [link('far', 312, 12)] }))?.plan.anchor).toBe('end')
      expect(planSelectionPlate(input({ labels: wall, links: [link('far', 284, 584)] }))?.plan.anchor).toBe('start')
    })

    it('in the first pass a plate covers no link at all', () => {
      // A link far from the plate leaves a place; a link on either side of the mark leaves only plates that cover one.
      const clear = planSelectionPlate(input({ labels: wall, links: [link('far', 560, 640)] }))
      expect(clear?.plan.offset).toBe(34)
      expect(clear?.plan.anchor).toBe('middle')
      const pinned = planSelectionPlate(input({ labels: wall, links: [link('left', 262, 100), link('right', 320, 380)] }))
      // No plate in either row avoids both (pass one); the second pass, which ignores them, takes the nearest row.
      expect(pinned?.plan.offset).toBe(34)
      expect(pinned?.plan.anchor).toBe('middle')
    })

    it("failing that, covers untraced links locally, but never the selection's trace or a loop", () => {
      // A loop at the mark blocks the first row under the track; an untraced link on each side blocks every plate in the second.
      // 'mid' is not a loop (30px wide): the second pass ignores it too.
      const links = [link('loop', X, X), link('left', 262, 100), link('right', 320, 380), link('mid', 280, 310)]
      const found = planSelectionPlate(input({ labels: wall, links }))
      expect(found).not.toBeNull()
      // The second row, since the loop (blocking the first) is part of the trace; covering the untraced links on either side.
      expect(found!.plan.offset).toBe(48)
      expect(found!.plan.anchor).toBe('middle')
      const plate = plateOf(found!)
      expect(plate.left < 262 && plate.right > 320).toBe(true)
    })

    it("never covers the selection's own traced link: with one leaving its mark straight down, no row under the track will do", () => {
      expect(planSelectionPlate(input({ labels: wall, links: [link('own', X, 420, true)] }))).toBeNull()
      // A traced link elsewhere is as much an obstacle.
      expect(planSelectionPlate(input({ labels: wall, links: [link('own', 330, 420, true)] }))?.plan.anchor).toBe('end')
    })

    it('keeps a pad around each curve: a plate whose edge is a pixel from a link is refused', () => {
      // The plate starting at the mark has its left edge (with its padding) at 295; a link leaving at 294 passes within the pad.
      const near = planSelectionPlate(input({ labels: wall, links: [link('near', 294, 100), link('nearer', 297, 100)] }))
      expect(near?.plan.anchor).not.toBe('start')
    })
  })

  describe('the order of the passes', () => {
    const walled = (extra: PlacedLabelBox[]) => [
      ...ABOVE.filter((offset) => offset !== -20).map((offset) => box(`w${offset}`, 0, 700, offset, { protectedLabel: true })),
      box('w-75', 0, 700, -75, { protectedLabel: true }),
      ...extra,
    ]

    it('links win over hiding nothing: a plate hides a label it covers before it covers an untraced link', () => {
      // Row -20 holds a small unprotected label a plate there covers whole (hidden by the ordinary rules); an untraced link under the mark
      // blocks both rows under the track in passes 1 and 2. Pass 3, which would cover the link and hide nothing, comes after the hiding.
      const found = planSelectionPlate(input({ labels: walled([box('small', 280, 330, -20, { length: 8 })]), links: [link('u', 250, 350)] }))
      expect(found?.plan.hidden).toEqual(['small'])
      expect(found!.plan.offset).toBe(-20)
    })

    it('with no link in the way, a plate that hides nothing beats one that hides a label', () => {
      // The same, without the link: the rows under the track are free (pass 1), so the plate goes there, hiding nothing.
      const found = planSelectionPlate(input({ labels: walled([box('small', 280, 330, -20, { length: 8 })]) }))
      expect(found?.plan.hidden).toEqual([])
      expect(found!.plan.offset).toBeGreaterThan(0)
    })

    it('a later pass that hides nothing beats an earlier one that hides a label (pass 2 after pass 1)', () => {
      // Pass 1 respects the sliver over the plate-only row, so its plate goes in row -20 and hides the small label; pass 2 sets the sliver aside
      // and puts the plate in the plate-only row, hiding nothing.
      const sliver: PlacedLabelBox = { id: 'arc:s', left: 0, right: 700, top: Y - 100, bottom: Y - 83, length: 0, protectedLabel: true, obstacle: true }
      const labels = [
        ...ABOVE.filter((offset) => offset !== -20).map((offset) => box(`w${offset}`, 0, 700, offset, { protectedLabel: true })),
        box('small', 280, 330, -20, { length: 8 }),
      ]
      const found = planSelectionPlate(input({ labels, softObstacles: [sliver], belowRows: [] }))
      expect(found?.plan.hidden).toEqual([])
      expect(found?.plan.offset).toBe(-75)
    })

    it('ordinary hiding in a later pass beats the last resort in the first', () => {
      // Row -20: two wide labels any plate touches by a sliver (the ordinary rules refuse; the last resort hides both). Row -75, under a sliver
      // arc (soft): one small label a plate there covers whole (the ordinary rules hide it, in pass 2).
      const labels = [box('L1', 0, 290, -20, { length: 40 }), box('L2', 310, 700, -20, { length: 40 }), box('S', 285, 315, -75, { length: 5 })]
      const sliver: PlacedLabelBox = { id: 'arc:s', left: 0, right: 700, top: Y - 100, bottom: Y - 83, length: 0, protectedLabel: true, obstacle: true }
      const found = planSelectionPlate(input({ aboveRows: [-20], belowRows: [], labels, softObstacles: [sliver] }))
      expect(found?.plan.hidden).toEqual(['S'])
    })

    it('runs the last resort when every pass that hides nothing is walled', () => {
      // Every row above holds a wide unprotected label a plate covers by less than half (the ordinary rules refuse it, the last resort hides it);
      // under the track the selection's own traced links, straight down, block both rows in every pass.
      const labels = [...ABOVE, -75].map((offset) => box(`wide${offset}`, 0, 700, offset, { length: 60 }))
      const found = planSelectionPlate(input({ labels, links: [link('t1', 300, 310, true), link('t2', 200, 400, true)] }))
      expect(found).not.toBeNull()
      expect(found!.plan.hidden.length).toBeGreaterThan(0)
    })
  })

  describe('a shorter name before a covered link (#41)', () => {
    const full = { text: 'The selected name that is long…', width: 150 }
    const short = { text: 'The selected…', width: 70 }
    // Untraced links leave the track either side of the mark, 60px and 120px out: every placement of the full name (centred, or
    // ending or starting at the mark) covers one of them; the short name, centred, fits between.
    const sides = [link('left', 240, 100), link('right', 420, 600)]
    const noLabelRows = { labels: wall }

    it('picks the shorter text for a clear spot over covering an untraced link with the full one', () => {
      const without = planSelectionPlate(input({ ...noLabelRows, texts: [full], links: sides }))
      // Before the shorter forms: the plate can only be put over the links.
      const over = plateOf(without!)
      expect(over.left < 242 || over.right > 418).toBe(true)
      const found = planSelectionPlate(input({ ...noLabelRows, texts: [full], shortTexts: [short], links: sides }))
      expect(found?.text).toBe(short.text)
      const plate = plateOf(found!)
      expect(plate.left > 242 && plate.right < 418).toBe(true)
      expect(found!.plan.hidden).toEqual([])
    })

    it('does not shorten when the full text fits a clear spot', () => {
      const found = planSelectionPlate(input({ ...noLabelRows, texts: [full], shortTexts: [short], links: [link('far', 560, 640)] }))
      expect(found?.text).toBe(full.text)
    })

    it('does not shorten when the full text fits in the nearest row', () => {
      expect(planSelectionPlate(input({ texts: [full], shortTexts: [short] }))).toMatchObject({ text: full.text, plan: { offset: -20 } })
    })

    it('shortens before it hides a neighbour: the shorter name beside a label beats the full name over it', () => {
      // Row -20 holds a small label either side of the mark, clear of the short plate; every placement of the full plate covers one whole. The other rows are walled.
      const labels = [...wall.filter((w) => w.id !== 'wall-20'), box('smallL', 225, 255, -20, { length: 6 }), box('smallR', 345, 375, -20, { length: 6 })]
      const hides = planSelectionPlate(input({ labels, belowRows: [], texts: [full] }))
      expect(hides?.plan.hidden).toHaveLength(1)
      const found = planSelectionPlate(input({ labels, belowRows: [], texts: [full], shortTexts: [short] }))
      expect(found?.text).toBe(short.text)
      expect(found?.plan.hidden).toEqual([])
    })

    it('leaves the last resort as it was: with no clear spot even for the short name, the plate still covers an untraced link', () => {
      const dense = [link('a', 270, 100), link('b', 290, 120), link('c', 310, 480), link('d', 330, 600)]
      const found = planSelectionPlate(input({ ...noLabelRows, texts: [full], shortTexts: [short], links: dense }))
      expect(found).not.toBeNull()
    })
  })

  describe('shortenedPlateTexts', () => {
    const measure = (text: string) => ({ text, width: text.length * 6.7 })
    it('gives forms of 11 to 13 characters ending in an ellipsis, longest first, never below the minimum', () => {
      const forms = shortenedPlateTexts('Manchester clerks hold a meeting of the guild', measure)
      expect(forms.length).toBeGreaterThan(0)
      for (const form of forms) {
        expect(form.text.endsWith('…')).toBe(true)
        expect(form.text.length).toBeGreaterThanOrEqual(MIN_PLATE_CHARS)
        expect(form.text.length).toBeLessThanOrEqual(13)
      }
      expect(forms[0]!.text).toBe('Manchester…')
      expect(forms.map((form) => form.width)).toEqual(forms.map((form) => form.text.length * 6.7))
    })

    it('offers nothing shorter than the minimum, whatever the first words are', () => {
      for (const name of ['An ox ate the grain fully', 'A B C D E F G H I J K', 'Up in the air and away']) {
        for (const form of shortenedPlateTexts(name, measure)) expect(form.text.length).toBeGreaterThanOrEqual(MIN_PLATE_CHARS)
      }
    })

    it('leaves out forms already known and names too short to cut', () => {
      expect(shortenedPlateTexts('Manchester clerks hold a meeting', measure, ['Manchester…'])).toEqual([])
      expect(shortenedPlateTexts('Short name', measure)).toEqual([])
    })
  })

describe('accented capitals (#42)', () => {
  const accented = { text: 'Émile Ångström…', width: 100, ink: { ascent: 12, descent: 2 } }
  const plain = { text: 'The selected name', width: 100, ink: { ascent: 9, descent: 2 } }
  // The label rows are blocked by things that are not labels, so the plate-only row and the first row under the track compete.
  const rowsBlocked = ABOVE.map((offset) => box(`o${offset}`, 0, 700, offset, { protectedLabel: true, obstacle: true }))

  it('puts ordinary text in the plate-only row and accented capitals under the track: the 12px plate cannot hold them', () => {
    expect(planSelectionPlate(input({ labels: rowsBlocked, texts: [plain] }))?.plan.offset).toBe(-75)
    const found = planSelectionPlate(input({ labels: rowsBlocked, texts: [accented] }))
    expect(found?.plan.offset).toBe(34)
  })

  it('where only the plate-only row is free, accented capitals are named there all the same: poking out is better than no name', () => {
    expect(planSelectionPlate(input({ labels: rowsBlocked, texts: [accented], belowRows: [] }))).toMatchObject({ text: accented.text, plan: { offset: -75 } })
  })

  it('still names nothing where no row is free at all', () => {
    expect(planSelectionPlate(input({ labels: wall, texts: [accented], belowRows: [] }))).toBeNull()
  })

  it("does not cover the top label row's accents: a plate in the plate-only row would cover 2px of their tops", () => {
    // The top row's label (baseline -62) has an accented capital rising 12px: its box reaches -74, past the plate-only plate's bottom (-72).
    const topAccent = box('topAccent', 0, 700, -62, { top: Y - 62 - 12, protectedLabel: true })
    const rows3 = ABOVE.slice(0, 3).map((offset) => box(`o${offset}`, 0, 700, offset, { protectedLabel: true, obstacle: true }))
    expect(planSelectionPlate(input({ labels: [...rows3, topAccent], texts: [plain], belowRows: [] }))).toBeNull()
    // A row under the track is taken instead, when there is one.
    expect(planSelectionPlate(input({ labels: [...rows3, topAccent], texts: [plain] }))?.plan.offset).toBe(34)
    // Where there is none, the last attempt sets the accents aside rather than leave the selection unnamed.
    const usual = box('topAccent', 0, 700, -62, { protectedLabel: true })
    expect(planSelectionPlate(input({ labels: [...rows3, topAccent], labelsWithoutInk: [...rows3, usual], texts: [plain], belowRows: [] }))?.plan.offset).toBe(-75)
    // With its ordinary box the plate sits clear of it (the case before the label's ink was measured).
    expect(planSelectionPlate(input({ labels: [...rows3, box('top', 0, 700, -62, { protectedLabel: true })], texts: [plain], belowRows: [] }))?.plan.offset).toBe(-75)
  })
})
})
