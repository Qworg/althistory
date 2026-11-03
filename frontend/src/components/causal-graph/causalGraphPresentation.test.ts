import { describe, it, expect, afterEach } from 'vitest'
import {
  eventNodeLabel,
  describeEvent,
  formatActorTarget,
  truncateLabel,
  readGraphCanvasTheme,
  LIGHT_GRAPH_THEME,
  NODE_LABEL_MAX_CHARS,
  nodeLabelSizing,
  pickVisibleLabels,
  MIN_ZOOMED_FONT_SIZE,
  GRAPH_PALETTES,
  graphThemeMode,
  graphTokenName
} from './causalGraphPresentation'

const event = {
  description: 'Babbage completes the Analytical Engine',
  actor: 'Charles Babbage',
  target: 'Analytical Engine',
  timestamp: '1843-11-20T00:00:00.000Z'
}

describe('causal graph node labels', () => {
  it('labels a node with what happened, shortened with an ellipsis', () => {
    const label = eventNodeLabel(event)
    expect(label).toBe('Babbage completes the Analy…')
    expect(label.length).toBe(NODE_LABEL_MAX_CHARS)
  })

  it('keeps a short description whole and collapses stray whitespace', () => {
    expect(eventNodeLabel({ ...event, description: '  Clerks   strike\n' })).toBe('Clerks strike')
  })

  it('tells apart two events between the same actor and target', () => {
    const a = eventNodeLabel({ ...event, description: 'Engine demonstrated to the Society' })
    const b = eventNodeLabel({ ...event, description: 'Engine sold to the Admiralty' })
    expect(a).not.toBe(b)
  })

  it('falls back to actor → target when there is no description', () => {
    expect(eventNodeLabel({ actor: 'Ada', target: 'Babbage', description: '' })).toBe('Ada → Babbage')
    // The fallback is shortened like any other label.
    expect(eventNodeLabel({ ...event, description: '' })).toBe('Charles Babbage → Analytica…')
    expect(formatActorTarget({ actor: 'Ada', target: '' })).toBe('Ada')
  })

  it('does not cut a label in the middle of trailing whitespace', () => {
    expect(truncateLabel('abcd efgh', 6)).toBe('abcd…')
  })

  it('describes an event in full: description, actor → target, UTC date', () => {
    // Midnight UTC west of Greenwich must not slide to the 19th.
    expect(describeEvent(event)).toBe(
      'Babbage completes the Analytical Engine. Charles Babbage → Analytical Engine. Nov 20, 1843'
    )
  })
})

describe('readGraphCanvasTheme', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--text-primary')
    document.documentElement.style.removeProperty('--surface-card')
  })

  it('falls back to the light tokens when no stylesheet defines them', () => {
    expect(readGraphCanvasTheme()).toEqual(LIGHT_GRAPH_THEME)
  })

  it('resolves the theme tokens set on <html> into concrete colours', () => {
    document.documentElement.style.setProperty('--text-primary', '#f8fafc')
    document.documentElement.style.setProperty('--surface-card', '#162036')
    const theme = readGraphCanvasTheme()
    expect(theme.ink).toBe('#f8fafc')
    expect(theme.surface).toBe('#162036')
  })

  it('picks the node and edge palette from .dark and .high-contrast on <html>', () => {
    const root = document.documentElement
    try {
      expect(readGraphCanvasTheme().colors).toEqual(GRAPH_PALETTES.light)
      root.classList.add('dark')
      expect(graphThemeMode()).toBe('dark')
      expect(readGraphCanvasTheme().colors).toEqual(GRAPH_PALETTES.dark)
      // Without a stylesheet the text falls back to the dark ink, not the light
      expect(readGraphCanvasTheme().ink).toBe('#f8fafc')
      root.classList.add('high-contrast')
      expect(readGraphCanvasTheme().mode).toBe('high-contrast-dark')
      expect(readGraphCanvasTheme().colors).toEqual(GRAPH_PALETTES['high-contrast-dark'])
      root.classList.remove('dark')
      expect(readGraphCanvasTheme().colors).toEqual(GRAPH_PALETTES['high-contrast-light'])
    } finally {
      root.classList.remove('dark', 'high-contrast')
    }
  })

  it('lets a --graph-* token on <html> override a palette colour', () => {
    expect(graphTokenName('edgeDirect')).toBe('--graph-edge-direct')
    document.documentElement.style.setProperty('--graph-edge-direct', '#123456')
    try {
      expect(readGraphCanvasTheme().colors.edgeDirect).toBe('#123456')
      expect(readGraphCanvasTheme().colors.edgeIndirect).toBe(GRAPH_PALETTES.light.edgeIndirect)
    } finally {
      document.documentElement.style.removeProperty('--graph-edge-direct')
    }
  })
})

describe('nodeLabelSizing', () => {
  const px = (v: string) => Number.parseFloat(v)

  it('holds labels near 11.5px on screen at the zoom a graph is first fitted at', () => {
    for (const zoom of [0.45, 0.6, 0.8]) {
      const sizing = nodeLabelSizing(zoom)
      expect(px(sizing['font-size']) * zoom).toBeCloseTo(11.5, 1)
      // Comfortably above the size below which Cytoscape skips the label
      expect(px(sizing['font-size']) * zoom).toBeGreaterThan(MIN_ZOOMED_FONT_SIZE)
    }
  })

  it('still enlarges labels when zoomed in past 1:1', () => {
    expect(px(nodeLabelSizing(2)['font-size']) * 2).toBeGreaterThan(20)
  })

  it('lets labels drop below the draw threshold when zoomed far out', () => {
    const zoom = 0.25
    expect(px(nodeLabelSizing(zoom)['font-size']) * zoom).toBeLessThan(MIN_ZOOMED_FONT_SIZE)
  })

  it('treats a nonsense zoom as 1:1', () => {
    expect(nodeLabelSizing(0)['font-size']).toBe(nodeLabelSizing(1)['font-size'])
  })
})

describe('pickVisibleLabels', () => {
  const box = (x: number, y: number, w = 40, h = 14) => ({ x1: x, y1: y, x2: x + w, y2: y + h })

  it('keeps every label that has room', () => {
    const visible = pickVisibleLabels([
      { id: 'a', priority: 0, box: box(0, 0) },
      { id: 'b', priority: 0, box: box(100, 0) },
    ])
    expect([...visible].sort()).toEqual(['a', 'b'])
  })

  it('drops the less important of two overlapping labels', () => {
    const visible = pickVisibleLabels([
      { id: 'leaf', priority: 1, box: box(0, 0) },
      { id: 'hub', priority: 5, box: box(10, 4) },
    ])
    expect([...visible]).toEqual(['hub'])
  })

  it('always keeps the selected node (highest priority) in a crowd', () => {
    const crowd = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, priority: 3, box: box(i * 5, 0) }))
    const visible = pickVisibleLabels([...crowd, { id: 'chosen', priority: 10_000, box: box(12, 2) }])
    expect(visible.has('chosen')).toBe(true)
    expect(visible.size).toBeLessThan(crowd.length + 1)
  })

  it('treats labels closer than the gap as colliding', () => {
    const items = [
      { id: 'a', priority: 1, box: box(0, 0) },
      { id: 'b', priority: 0, box: box(42, 0) },
    ]
    expect(pickVisibleLabels(items, 0).size).toBe(2)
    expect(pickVisibleLabels(items, 3).size).toBe(1)
  })

  it('is stable for equal priorities', () => {
    const items = [
      { id: 'b', priority: 1, box: box(0, 0) },
      { id: 'a', priority: 1, box: box(5, 0) },
    ]
    expect([...pickVisibleLabels(items)]).toEqual(['a'])
  })
})
