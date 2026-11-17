import { describe, expect, it } from 'vitest'
import { planSelectionPlate, type PlateLink, type SelectionPlateInput } from './selectionPlate'
import { PLATE_ASCENT, PLATE_DESCENT, PLATE_PAD, type PlacedLabelBox } from './pinnedLabel'

const X = 300
const Y = 100
const ABOVE = [-20, -34, -48, -62] as const
const TOP = [-76] as const
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
    expect(planSelectionPlate(input({ labels: rowsFull, belowRows: [] }))?.plan.offset).toBe(-76)
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
    expect(planSelectionPlate(input({ labels: labelRowsWalled, preferAbove: true }))?.plan.offset).toBe(-76)
    // With nothing above, a docked sheet still gets a plate under the track.
    expect(planSelectionPlate(input({ labels: wall, preferAbove: true }))?.plan.offset).toBe(34)
  })

  it('puts the plate-only row before the rows under the track when they tie (nothing hidden, no crossings)', () => {
    // Obstacles block the label rows without being labels the leader passes behind, so the plate-only row and the first row under the track cost the same.
    const blocked = ABOVE.map((offset) => box(`o${offset}`, 0, 700, offset, { protectedLabel: true, obstacle: true }))
    expect(planSelectionPlate(input({ labels: blocked }))?.plan.offset).toBe(-76)
  })

  it('respects a soft obstacle (a sliver arc) in the first pass, and sets it aside rather than leave the selection unnamed', () => {
    const sliver = box('sliver', 0, 700, -76, { protectedLabel: true, obstacle: true })
    // The label rows are blocked by things that are not labels (so the plate-only row and the first row under the track cost the same and the earlier row wins a tie).
    const rowsBlocked = ABOVE.map((offset) => box(`o${offset}`, 0, 700, offset, { protectedLabel: true, obstacle: true }))
    expect(planSelectionPlate(input({ labels: rowsBlocked }))?.plan.offset).toBe(-76)
    // With the sliver there, the plate takes the row under the track rather than cover the sliver's edge.
    expect(planSelectionPlate(input({ labels: rowsBlocked, softObstacles: [sliver] }))?.plan.offset).toBe(34)
    // With nowhere else, the plate-only row is used over the sliver.
    expect(planSelectionPlate(input({ labels: rowsBlocked, softObstacles: [sliver], belowRows: [] }))?.plan.offset).toBe(-76)
  })

  it('sets a soft obstacle aside before it hides a neighbour: covering a sliver is better than hiding a label', () => {
    // Row -20 holds a wide label a plate would cover by less than a third (hidden only by the last resort); the plate-only row is under a sliver.
    const wide = box('wide', 100, 500, -20, { length: 40 })
    const sliver = box('sliver', 0, 700, -76, { protectedLabel: true, obstacle: true })
    const found = planSelectionPlate(input({ aboveRows: [-20], belowRows: [], labels: [wide], softObstacles: [sliver] }))
    expect(found?.plan.offset).toBe(-76)
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
})
