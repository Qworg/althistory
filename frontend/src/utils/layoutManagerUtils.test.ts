import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getLayoutFromShortcut,
  getShortcutForLayout,
  isActionShortcut,
  getActionFromShortcut,
  shouldIgnoreKeyboardShortcut,
  getLayoutsByCategory,
  getCategoryLabel,
  getDefaultLayoutOptions,
  mergeLayoutOptions,
  getPreviewLayoutOptions,
  isValidLayoutName,
  getAvailableLayoutNames,
  LAYOUT_SHORTCUTS,
  ACTION_SHORTCUTS,
  CATEGORY_LABELS,
  LAYOUT_TIMEOUT_MS,
  PREVIEW_TIMEOUT_MS,
  FIT_PADDING,
  DEFAULT_ZOOM,
  LayoutConfig,
  toCytoscapeLayoutOptions,
  PRIMARY_LAYOUT_NAMES,
  isPrimaryLayout,
  canvasStretch,
  CANVAS_STRETCH_LAYOUTS,
  MAX_CANVAS_STRETCH
} from './layoutManagerUtils'

describe('Layout Manager Utils', () => {
  describe('getLayoutFromShortcut', () => {
    it('returns layout name for valid shortcuts', () => {
      expect(getLayoutFromShortcut('1')).toBe('cose')
      expect(getLayoutFromShortcut('2')).toBe('breadthfirst')
      expect(getLayoutFromShortcut('3')).toBe('circle')
      expect(getLayoutFromShortcut('4')).toBe('grid')
      expect(getLayoutFromShortcut('5')).toBe('concentric')
      expect(getLayoutFromShortcut('6')).toBe('dagre')
      expect(getLayoutFromShortcut('7')).toBe('cose-bilkent')
      expect(getLayoutFromShortcut('8')).toBe('random')
    })

    it('returns null for invalid shortcuts', () => {
      expect(getLayoutFromShortcut('x')).toBeNull()
      expect(getLayoutFromShortcut('9')).toBeNull()
      expect(getLayoutFromShortcut('0')).toBeNull()
      expect(getLayoutFromShortcut('')).toBeNull()
    })
  })

  describe('getShortcutForLayout', () => {
    it('returns shortcut for valid layout names', () => {
      expect(getShortcutForLayout('cose')).toBe('1')
      expect(getShortcutForLayout('breadthfirst')).toBe('2')
      expect(getShortcutForLayout('circle')).toBe('3')
      expect(getShortcutForLayout('grid')).toBe('4')
    })

    it('returns null for layouts without shortcuts', () => {
      expect(getShortcutForLayout('unknown')).toBeNull()
      expect(getShortcutForLayout('')).toBeNull()
    })
  })

  describe('isActionShortcut', () => {
    it('identifies action shortcuts', () => {
      expect(isActionShortcut('f')).toBe(true)
      expect(isActionShortcut('F')).toBe(true)
      expect(isActionShortcut('r')).toBe(true)
      expect(isActionShortcut('R')).toBe(true)
    })

    it('returns false for non-action keys', () => {
      expect(isActionShortcut('1')).toBe(false)
      expect(isActionShortcut('x')).toBe(false)
      expect(isActionShortcut('a')).toBe(false)
      expect(isActionShortcut('')).toBe(false)
    })
  })

  describe('getActionFromShortcut', () => {
    it('returns action name for valid shortcuts', () => {
      expect(getActionFromShortcut('f')).toBe('fit')
      expect(getActionFromShortcut('F')).toBe('fit')
      expect(getActionFromShortcut('r')).toBe('reset')
      expect(getActionFromShortcut('R')).toBe('reset')
    })

    it('returns null for invalid shortcuts', () => {
      expect(getActionFromShortcut('x')).toBeNull()
      expect(getActionFromShortcut('1')).toBeNull()
      expect(getActionFromShortcut('')).toBeNull()
    })
  })

  describe('shouldIgnoreKeyboardShortcut', () => {
    beforeEach(() => {
      document.body.innerHTML = ''
    })

    afterEach(() => {
      document.body.innerHTML = ''
    })

    it('returns false when no input is focused', () => {
      const div = document.createElement('div')
      document.body.appendChild(div)
      div.focus()
      expect(shouldIgnoreKeyboardShortcut()).toBe(false)
    })

    it('returns true when input is focused', () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      expect(shouldIgnoreKeyboardShortcut()).toBe(true)
    })

    it('returns true when textarea is focused', () => {
      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.focus()
      expect(shouldIgnoreKeyboardShortcut()).toBe(true)
    })

    it('returns true when select is focused', () => {
      const select = document.createElement('select')
      document.body.appendChild(select)
      select.focus()
      expect(shouldIgnoreKeyboardShortcut()).toBe(true)
    })

    it('returns false when body is focused', () => {
      document.body.focus()
      expect(shouldIgnoreKeyboardShortcut()).toBe(false)
    })
  })

  describe('getLayoutsByCategory', () => {
    const mockLayouts: LayoutConfig[] = [
      { name: 'cose', label: 'Force', description: '', category: 'force', shortcutKey: '1', options: {} },
      {
        name: 'breadthfirst',
        label: 'Hierarchical',
        description: '',
        category: 'hierarchical',
        shortcutKey: '2',
        options: {}
      },
      { name: 'circle', label: 'Circle', description: '', category: 'circular', shortcutKey: '3', options: {} },
      {
        name: 'enhanced',
        label: 'Enhanced',
        description: '',
        category: 'force',
        shortcutKey: '7',
        options: {}
      }
    ]

    it('groups layouts by category', () => {
      const grouped = getLayoutsByCategory(mockLayouts)

      expect(grouped.force).toHaveLength(2)
      expect(grouped.hierarchical).toHaveLength(1)
      expect(grouped.circular).toHaveLength(1)
      expect(grouped.grid).toBeUndefined()
    })

    it('handles empty array', () => {
      expect(getLayoutsByCategory([])).toEqual({})
    })

    it('preserves layout order within categories', () => {
      const grouped = getLayoutsByCategory(mockLayouts)
      expect(grouped.force![0]!.name).toBe('cose')
      expect(grouped.force![1]!.name).toBe('enhanced')
    })
  })

  describe('getCategoryLabel', () => {
    it('returns correct labels for known categories', () => {
      expect(getCategoryLabel('force')).toBe('Force-Based')
      expect(getCategoryLabel('hierarchical')).toBe('Hierarchical')
      expect(getCategoryLabel('circular')).toBe('Circular')
      expect(getCategoryLabel('grid')).toBe('Grid-Based')
    })

    it('returns category name for unknown categories', () => {
      expect(getCategoryLabel('unknown')).toBe('unknown')
      expect(getCategoryLabel('custom')).toBe('custom')
    })
  })

  describe('getDefaultLayoutOptions', () => {
    it('returns default options for known layouts', () => {
      const coseOptions = getDefaultLayoutOptions('cose')
      expect(coseOptions.name).toBe('cose')
      expect(coseOptions.animationDuration).toBe(1000)
      expect(coseOptions.fit).toBe(true)
      expect(coseOptions.padding).toBe(FIT_PADDING)
    })

    it('returns minimal options for unknown layouts', () => {
      const unknownOptions = getDefaultLayoutOptions('unknown')
      expect(unknownOptions).toEqual({ name: 'unknown' })
    })

    it('returns correct options for breadthfirst', () => {
      const options = getDefaultLayoutOptions('breadthfirst')
      expect(options.name).toBe('breadthfirst')
      expect(options.directed).toBe(true)
      expect(options.spacingFactor).toBe(1.75)
    })

    it('returns correct options for circle', () => {
      const options = getDefaultLayoutOptions('circle')
      expect(options.name).toBe('circle')
      expect(options.avoidOverlap).toBe(true)
      expect(options.clockwise).toBe(true)
    })
  })

  describe('mergeLayoutOptions', () => {
    it('merges custom options with defaults', () => {
      const merged = mergeLayoutOptions('cose', { padding: 100, customOption: true })

      expect(merged.name).toBe('cose')
      expect(merged.padding).toBe(100)
      expect(merged.customOption).toBe(true)
      expect(merged.animationDuration).toBe(1000)
    })

    it('returns defaults when no custom options provided', () => {
      const merged = mergeLayoutOptions('cose')
      expect(merged).toEqual(getDefaultLayoutOptions('cose'))
    })

    it('handles unknown layouts with custom options', () => {
      const merged = mergeLayoutOptions('custom', { padding: 50 })
      expect(merged).toEqual({ name: 'custom', padding: 50 })
    })
  })

  describe('getPreviewLayoutOptions', () => {
    it('returns options with reduced animation and no fit', () => {
      const preview = getPreviewLayoutOptions('cose')

      expect(preview.animationDuration).toBe(300)
      expect(preview.fit).toBe(false)
      expect(preview.name).toBe('cose')
    })

    it('preserves other options from defaults', () => {
      const preview = getPreviewLayoutOptions('cose')

      expect(preview.nodeRepulsion).toBe(getDefaultLayoutOptions('cose').nodeRepulsion)
      expect(preview.padding).toBe(FIT_PADDING)
    })
  })

  describe('isValidLayoutName', () => {
    it('returns true for valid layout names', () => {
      expect(isValidLayoutName('cose')).toBe(true)
      expect(isValidLayoutName('breadthfirst')).toBe(true)
      expect(isValidLayoutName('circle')).toBe(true)
      expect(isValidLayoutName('grid')).toBe(true)
      expect(isValidLayoutName('concentric')).toBe(true)
      expect(isValidLayoutName('dagre')).toBe(true)
      expect(isValidLayoutName('cose-bilkent')).toBe(true)
      expect(isValidLayoutName('random')).toBe(true)
    })

    it('returns false for invalid layout names', () => {
      expect(isValidLayoutName('unknown')).toBe(false)
      expect(isValidLayoutName('')).toBe(false)
      expect(isValidLayoutName('invalid')).toBe(false)
    })
  })

  describe('getAvailableLayoutNames', () => {
    it('returns all available layout names', () => {
      const names = getAvailableLayoutNames()

      expect(names).toContain('cose')
      expect(names).toContain('breadthfirst')
      expect(names).toContain('circle')
      expect(names).toContain('grid')
      expect(names).toContain('concentric')
      expect(names).toContain('dagre')
      expect(names).toContain('cose-bilkent')
      expect(names).toContain('random')
      expect(names).toHaveLength(8)
    })
  })

  describe('Constants', () => {
    it('has correct LAYOUT_SHORTCUTS', () => {
      expect(Object.keys(LAYOUT_SHORTCUTS)).toHaveLength(8)
      expect(LAYOUT_SHORTCUTS['1']).toBe('cose')
    })

    it('has correct ACTION_SHORTCUTS', () => {
      expect(Object.keys(ACTION_SHORTCUTS)).toHaveLength(2)
      expect(ACTION_SHORTCUTS.f).toBe('fit')
      expect(ACTION_SHORTCUTS.r).toBe('reset')
    })

    it('has correct CATEGORY_LABELS', () => {
      expect(Object.keys(CATEGORY_LABELS)).toHaveLength(4)
      expect(CATEGORY_LABELS.force).toBe('Force-Based')
    })

    it('has correct timeout constants', () => {
      expect(LAYOUT_TIMEOUT_MS).toBe(30000)
      expect(PREVIEW_TIMEOUT_MS).toBe(2000)
    })

    it('has correct display constants', () => {
      // Small: 50px each side gave a quarter of a 400px canvas to margin
      expect(FIT_PADDING).toBe(30)
      expect(DEFAULT_ZOOM).toBe(1)
    })
  })

  describe('toCytoscapeLayoutOptions', () => {
    // Node labels are wider than the nodes; a layout that ignores them packs
    // the nodes so closely that neighbouring labels overlap.
    it('makes every layout leave room for node labels', () => {
      for (const name of getAvailableLayoutNames()) {
        const options = toCytoscapeLayoutOptions(getDefaultLayoutOptions(name)) as unknown as Record<string, unknown>
        expect(options.nodeDimensionsIncludeLabels, name).toBe(true)
      }
      const bare = toCytoscapeLayoutOptions({ name: 'dagre', fit: true }) as unknown as Record<string, unknown>
      expect(bare.nodeDimensionsIncludeLabels).toBe(true)
    })

    it('lets a caller opt out explicitly', () => {
      const options = toCytoscapeLayoutOptions({ name: 'grid', nodeDimensionsIncludeLabels: false }) as unknown as Record<string, unknown>
      expect(options.nodeDimensionsIncludeLabels).toBe(false)
    })
  })
})

describe('primary layouts', () => {
  it('names force-directed and the two layered layouts, all of them real layouts with shortcuts', () => {
    expect(PRIMARY_LAYOUT_NAMES).toEqual(['cose', 'breadthfirst', 'dagre'])
    for (const name of PRIMARY_LAYOUT_NAMES) {
      expect(isValidLayoutName(name)).toBe(true)
      expect(getShortcutForLayout(name)).not.toBeNull()
    }
  })

  it('leaves every other layout (Random included) for "More layouts"', () => {
    expect(isPrimaryLayout('dagre')).toBe(true)
    expect(isPrimaryLayout('random')).toBe(false)
    expect(isPrimaryLayout('circle')).toBe(false)
  })
})

describe('using the canvas', () => {
  it('tunes the force layouts to spread a graph out rather than pack it into a ball', () => {
    const cose = getDefaultLayoutOptions('cose')
    // gravity 80 and 100px edges pulled the graph into ~40% of a wide canvas
    expect(cose.gravity as number).toBeLessThanOrEqual(1)
    expect(cose.idealEdgeLength as number).toBeGreaterThanOrEqual(150)
    expect(cose.nodeRepulsion as number).toBeGreaterThanOrEqual(1_000_000)
    expect(cose.componentSpacing as number).toBeGreaterThanOrEqual(100)
    const bilkent = getDefaultLayoutOptions('cose-bilkent')
    expect(bilkent.idealEdgeLength as number).toBeGreaterThanOrEqual(100)
    for (const name of getAvailableLayoutNames()) {
      expect(getDefaultLayoutOptions(name).padding, name).toBe(FIT_PADDING)
    }
  })

  it('stretches only the shapeless (force) layouts to the canvas', () => {
    expect(CANVAS_STRETCH_LAYOUTS).toEqual(['cose', 'cose-bilkent'])
  })

  it('widens a round cloud to fill a wide canvas', () => {
    // A 600x600 cloud in a 1200x500 canvas: widened 2.4x to the canvas aspect
    const { sx, sy } = canvasStretch({ w: 600, h: 600 }, { width: 1200, height: 500 })
    expect(sx).toBeCloseTo(2.4, 5)
    expect(sy).toBe(1)
  })

  it('heightens a flat graph to fill a tall canvas', () => {
    const { sx, sy } = canvasStretch({ w: 900, h: 300 }, { width: 400, height: 400 })
    expect(sx).toBe(1)
    expect(sy).toBe(MAX_CANVAS_STRETCH)
  })

  it('never shrinks, caps the stretch, and leaves degenerate shapes alone', () => {
    // Already the canvas's aspect
    expect(canvasStretch({ w: 200, h: 100 }, { width: 800, height: 400 })).toEqual({ sx: 1, sy: 1 })
    // A vertical chain would need a huge stretch: capped
    expect(canvasStretch({ w: 10, h: 1000 }, { width: 1000, height: 500 }).sx).toBe(MAX_CANVAS_STRETCH)
    // One node, or every node on one line
    expect(canvasStretch({ w: 0, h: 0 }, { width: 800, height: 400 })).toEqual({ sx: 1, sy: 1 })
    expect(canvasStretch({ w: 500, h: 0 }, { width: 800, height: 400 })).toEqual({ sx: 1, sy: 1 })
    // A hidden (zero-size) canvas
    expect(canvasStretch({ w: 500, h: 500 }, { width: 0, height: 0 })).toEqual({ sx: 1, sy: 1 })
  })
})
