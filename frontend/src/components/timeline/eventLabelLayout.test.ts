import { describe, it, expect } from 'vitest'
import { layoutEventLabels, truncateLabel, LABEL_ROW_OFFSETS, TIMELINE_LABEL_CONFIG } from './eventLabelLayout'

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
