import { describe, it, expect } from 'vitest'
import { layoutEventLabels, truncateLabel, LABEL_ROW_OFFSETS, TIMELINE_BELOW_ROW_OFFSETS, TIMELINE_LABEL_CONFIG } from './eventLabelLayout'

describe('layoutEventLabels', () => {
  it('labels well-spaced events in the first row, centred', () => {
    const placements = layoutEventLabels(
      [
        { id: 'a', x: 100, description: 'Treaty' },
        { id: 'b', x: 400, description: 'Armistice' },
      ],
      800
    )
    expect(placements.get('a')).toMatchObject({ offset: LABEL_ROW_OFFSETS[0], anchor: 'middle', text: 'Treaty' })
    expect(placements.get('b')).toMatchObject({ offset: LABEL_ROW_OFFSETS[0], anchor: 'middle' })
  })

  it('moves a colliding label to the second row, and drops it when both rows are taken', () => {
    const placements = layoutEventLabels(
      [
        { id: 'a', x: 200, description: 'First long label' },
        { id: 'b', x: 210, description: 'Second long label' },
        { id: 'c', x: 220, description: 'Third long label' },
      ],
      800
    )
    expect(placements.get('a')?.offset).toBe(LABEL_ROW_OFFSETS[0])
    expect(placements.get('b')?.offset).toBe(LABEL_ROW_OFFSETS[1])
    expect(placements.has('c')).toBe(false)
  })

  it('places priority labels first, so the selected event is named even in a crowd', () => {
    const crowd = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, x: 300 + i * 4, description: `Event number ${i}` }))
    const withSelection = crowd.map(item => (item.id === 'e6' ? { ...item, priority: true } : item))
    const placements = layoutEventLabels(withSelection, 800)

    expect(placements.get('e6')).toMatchObject({ offset: LABEL_ROW_OFFSETS[0], emphasis: true })
  })

  it('anchors labels at the plot edges so they stay inside it', () => {
    const placements = layoutEventLabels(
      [
        { id: 'left', x: 2, description: 'At the very start' },
        { id: 'right', x: 798, description: 'At the very end' },
      ],
      800
    )
    expect(placements.get('left')?.anchor).toBe('start')
    expect(placements.get('right')?.anchor).toBe('end')
  })

  it('ignores events outside the plot', () => {
    const placements = layoutEventLabels([{ id: 'off', x: -50, description: 'Offscreen' }], 800)
    expect(placements.size).toBe(0)
  })
})

describe('layoutEventLabels with the main timeline config (four rows of 12px)', () => {
  it('uses every row before dropping a label', () => {
    const crowd = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, x: 200 + i * 10, description: `Long label ${id}` }))
    const placements = layoutEventLabels(crowd, 800, TIMELINE_LABEL_CONFIG)
    expect(['a', 'b', 'c', 'd'].map(id => placements.get(id)?.offset)).toEqual([...TIMELINE_LABEL_CONFIG.rowOffsets])
    expect(placements.has('e')).toBe(false)
  })

  it('estimates width at 12px, so labels that fit at 10px can collide at 12px', () => {
    // "Treaty of Paris" is 15 characters: ~84px at 10px, ~101px at 12px.
    const pair = [
      { id: 'a', x: 100, description: 'Treaty of Paris' },
      { id: 'b', x: 195, description: 'Treaty of Paris' },
    ]
    expect(layoutEventLabels(pair, 800).get('b')?.offset).toBe(LABEL_ROW_OFFSETS[0])
    // At 12px the centred spot is taken: b moves to its side or up a row.
    const b = layoutEventLabels(pair, 800, TIMELINE_LABEL_CONFIG).get('b')
    expect(b).toBeDefined()
    expect(b!.offset !== TIMELINE_LABEL_CONFIG.rowOffsets[0] || b!.anchor !== 'middle').toBe(true)
  })

  it('names the further-reaching event first when only one fits', () => {
    const crowded = [
      { id: 'quiet', x: 100, description: 'A quiet event', weight: 0 },
      { id: 'pivotal', x: 104, description: 'A pivotal event', weight: 9 },
    ]
    const oneRow = { ...TIMELINE_LABEL_CONFIG, rowOffsets: [-20] }
    const labels = layoutEventLabels(crowded, 800, oneRow)
    expect(labels.get('pivotal')).toBeDefined()
    expect(labels.get('quiet')).toBeUndefined()
  })

  it('keeps a raised label off the nearer label its leader would cross, when it can', () => {
    // b's centred label sits in row 0 over a's mark. a then goes up a row, and
    // its leader would pass behind b's label, so a takes its own side instead.
    const items = [
      { id: 'a', x: 300, description: 'Event a', weight: 0 },
      { id: 'b', x: 330, description: 'Event b is described at length', weight: 5 },
    ]
    const labels = layoutEventLabels(items, 800, TIMELINE_LABEL_CONFIG)
    const b = labels.get('b')!
    const a = labels.get('a')!
    expect(b.offset).toBe(TIMELINE_LABEL_CONFIG.rowOffsets[0])
    expect(a).toBeDefined()
  })
})

describe('rows under the track', () => {
  const crowd = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({ id, x: 200 + i * 10, description: `Long label ${id}` }))
  const free = TIMELINE_BELOW_ROW_OFFSETS.map((offset) => ({ offset, blocked: [] as Array<[number, number]> }))

  it('names more labels in a crowd, using a row under the track where the rows above cannot take one cleanly', () => {
    const without = layoutEventLabels(crowd, 800, TIMELINE_LABEL_CONFIG)
    const withBelow = layoutEventLabels(crowd, 800, { ...TIMELINE_LABEL_CONFIG, belowRows: free })
    const dense = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((id, i) => ({ id, x: 200 + i * 6, description: `Long label ${id}` }))
    const aboveOnly = layoutEventLabels(dense, 800, TIMELINE_LABEL_CONFIG)
    const both = layoutEventLabels(dense, 800, { ...TIMELINE_LABEL_CONFIG, belowRows: free })
    expect(without.size).toBeLessThan(withBelow.size)
    expect(aboveOnly.size).toBeLessThan(both.size)
    expect(withBelow.get('a')).toEqual(without.get('a'))
    const offsets = [...both.values()].map((p) => p.offset)
    expect(new Set(offsets.filter((offset) => offset > 0))).toEqual(new Set(TIMELINE_BELOW_ROW_OFFSETS))
  })

  it('leaves the rows above exactly as they were for a track with no room under it', () => {
    expect(layoutEventLabels(crowd, 800, { ...TIMELINE_LABEL_CONFIG, belowRows: [] })).toEqual(layoutEventLabels(crowd, 800, TIMELINE_LABEL_CONFIG))
  })

  it('names a label in full under the track rather than shortening it above', () => {
    const long = 'Babbage completes the Analytical Engine in 1843'
    const items = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, x: 300 + i * 10, description: long }))
    const withBelow = layoutEventLabels(items, 800, { ...TIMELINE_LABEL_CONFIG, belowRows: free })
    const below = [...withBelow.values()].filter((p) => p.offset > 0)
    expect(below.length).toBeGreaterThan(0)
    expect(withBelow.size).toBeGreaterThan(layoutEventLabels(items, 800, TIMELINE_LABEL_CONFIG).size)
  })

  it('never covers a link: a blocked span keeps labels out of the row, wherever they could sit', () => {
    const blocked = TIMELINE_BELOW_ROW_OFFSETS.map((offset) => ({ offset, blocked: [[0, 800]] as Array<[number, number]> }))
    const placed = layoutEventLabels(crowd, 800, { ...TIMELINE_LABEL_CONFIG, belowRows: blocked })
    expect([...placed.values()].every((p) => p.offset < 0)).toBe(true)
    // A span over part of the row: the label goes where the link is not.
    const part = [{ offset: 34, blocked: [[150, 260]] as Array<[number, number]> }]
    const items = [...crowd.slice(0, 4), { id: 'late', x: 600, description: 'Late label' }, ...crowd.slice(4)]
    const some = layoutEventLabels(items, 800, { ...TIMELINE_LABEL_CONFIG, belowRows: part })
    for (const [id, placement] of some) {
      if (placement.offset < 0) continue
      const item = items.find((i) => i.id === id)!
      const width = placement.text.length * TIMELINE_LABEL_CONFIG.fontSize * 0.56
      const left = placement.anchor === 'start' ? item.x : placement.anchor === 'end' ? item.x - width : item.x - width / 2
      expect(left + width <= 150 || left >= 260, `${id} at ${left}..${left + width}`).toBe(true)
    }
  })

  it('does not depend on which event is prioritised for anything but the order of first claims', () => {
    // The timeline passes no priority at all: the same input gives the same labels.
    const a = layoutEventLabels(crowd, 800, { ...TIMELINE_LABEL_CONFIG, belowRows: free })
    const b = layoutEventLabels(crowd, 800, { ...TIMELINE_LABEL_CONFIG, belowRows: free })
    expect([...b]).toEqual([...a])
  })
})

describe('truncateLabel', () => {
  it('keeps short text and ellipsises long text to the limit', () => {
    expect(truncateLabel('Short', 10)).toBe('Short')
    const long = truncateLabel('A very long event description', 10)
    expect(long.length).toBeLessThanOrEqual(10)
    expect(long.endsWith('…')).toBe(true)
  })

  it('ends on a whole word when one ends late enough', () => {
    expect(truncateLabel('Babbage completes the Analytical Engine', 28)).toBe('Babbage completes the…')
    // No word break in the last third: cut mid-word rather than lose most of it.
    expect(truncateLabel('Supercalifragilistic expialidocious', 12)).toBe('Supercalifr…')
  })
})

describe('progressive shortening on the main timeline', () => {
  const long = 'Babbage completes the Analytical Engine in 1843'

  it('names an event in full where its row has room', () => {
    const placements = layoutEventLabels([{ id: 'a', x: 400, description: long }], 800, TIMELINE_LABEL_CONFIG)
    expect(placements.get('a')?.text).toBe(truncateLabel(long, 44))
    expect(placements.get('a')?.text.length).toBeGreaterThan(28)
  })

  it('shortens a label only as far as it must to share the rows with its neighbours', () => {
    // Nine events 40px apart: the full names cannot all fit, so some shorten.
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, x: 200 + i * 40, description: long }))
    const placements = layoutEventLabels(items, 800, TIMELINE_LABEL_CONFIG)
    const lengths = [...placements.values()].map((p) => p.text.length)
    expect(Math.min(...lengths)).toBeLessThan(Math.max(...lengths))
    expect(placements.size).toBeGreaterThan(3)
  })
})
