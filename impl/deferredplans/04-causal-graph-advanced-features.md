# Causal Graph Advanced Features Testing Plan

## Overview

**Category:** Causal Graph Advanced Features  
**Affected Tests:** 17 tests across 4 components  
**Priority:** LOW - Advanced features for power users  
**Estimated Effort:** 2-3 weeks  
**Risk Level:** Low - Optional advanced functionality

## Problem Statement

Complex causal graph UI components have advanced user interactions and algorithmic functionality that are challenging to test:

| Component | Failed Tests | Primary Issues |
|-----------|-------------|----------------|
| CausalGraphLayoutManager | 6 | Keyboard shortcuts, button states, async transitions |
| CausalPathExplorer | 5 | Algorithmic results, navigation UI, weight calculations |
| CausalRelationshipInteractions | 1 | Complex interaction patterns |
| CausalSuggestionManager | 5 | AI/ML integration, feedback system, confidence scoring |

### Root Cause Analysis

1. **Algorithmic Results Testing:**
   - Complex causal path calculations produce values difficult to assert
   - Mathematical precision issues (e.g., expecting 0.7 but getting 0.3024)
   - API mock data doesn't match expected computation patterns

2. **UI State Complexity:**
   - Keyboard shortcut handling with focus management
   - Async state transitions during layout changes
   - Mouse hover state management for previews

3. **Integration Dependencies:**
   - Heavy reliance on Cytoscape instance
   - API calls for suggestion algorithms
   - Global store state interactions

---

## Phase 1: Algorithm Logic Extraction (Days 1-4)

### 1.1 Extract Causal Path Calculations

**File: `frontend/src/utils/causalPathCalculations.ts`**

```typescript
import { CausalPath, CausalRelationship, Event } from '@/types'

/**
 * Calculate cumulative strength for a causal path
 * Uses product of weights and confidences
 */
export function calculateCumulativeStrength(relationships: CausalRelationship[]): number {
  if (relationships.length === 0) return 0
  
  return relationships.reduce((cumulative, relationship) => {
    const strength = relationship.weight * relationship.confidence
    return cumulative * strength
  }, 1)
}

/**
 * Calculate step-by-step cumulative weights for a path
 */
export function calculateStepWeights(relationships: CausalRelationship[]): number[] {
  const weights: number[] = [1] // First step is always 1 (100%)
  let cumulative = 1
  
  for (const relationship of relationships) {
    cumulative *= relationship.weight * relationship.confidence
    weights.push(cumulative)
  }
  
  return weights
}

/**
 * Sort paths by cumulative strength (strongest first)
 */
export function sortPathsByStrength(paths: CausalPath[]): CausalPath[] {
  return [...paths].sort((a, b) => {
    const strengthA = calculateCumulativeStrength(a.relationships)
    const strengthB = calculateCumulativeStrength(b.relationships)
    return strengthB - strengthA
  })
}

/**
 * Get the strongest path from a set of paths
 */
export function getStrongestPath(paths: CausalPath[]): CausalPath | null {
  if (paths.length === 0) return null
  return sortPathsByStrength(paths)[0] || null
}

/**
 * Transform a causal path into navigation steps
 */
export interface CausalChainStep {
  event: Event
  relationship?: CausalRelationship
  cumulativeWeight: number
  stepIndex: number
}

export function transformPathToSteps(path: CausalPath): CausalChainStep[] {
  const steps: CausalChainStep[] = []
  let cumulativeWeight = 1

  // First event (starting point)
  if (path.events.length > 0) {
    steps.push({
      event: path.events[0]!,
      cumulativeWeight: 1,
      stepIndex: 0
    })
  }

  // Subsequent events with their relationships
  for (let i = 1; i < path.events.length; i++) {
    const relationship = path.relationships[i - 1]
    if (relationship) {
      cumulativeWeight *= relationship.weight * relationship.confidence
    }
    
    steps.push({
      event: path.events[i]!,
      relationship,
      cumulativeWeight,
      stepIndex: i
    })
  }

  return steps
}

/**
 * Format cumulative weight as percentage string
 */
export function formatWeightAsPercentage(weight: number): string {
  return `${(weight * 100).toFixed(1)}%`
}
```

### 1.2 Create Algorithm Unit Tests

**File: `frontend/src/utils/causalPathCalculations.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import {
  calculateCumulativeStrength,
  calculateStepWeights,
  sortPathsByStrength,
  getStrongestPath,
  transformPathToSteps,
  formatWeightAsPercentage
} from './causalPathCalculations'
import { CausalRelationship, CausalPath, Event } from '@/types'

const createRelationship = (weight: number, confidence: number): CausalRelationship => ({
  id: '1',
  cause_event_id: '1',
  effect_event_id: '2',
  weight,
  confidence,
  evidence: 'test',
  relationship_type: 'direct',
  created_at: '2023-01-01',
  updated_at: '2023-01-01'
})

const createEvent = (id: string): Event => ({
  id,
  description: `Event ${id}`,
  actor: `Actor ${id}`,
  target: `Target ${id}`,
  timestamp: '2023-01-01',
  created_at: '2023-01-01',
  updated_at: '2023-01-01'
})

describe('Causal Path Calculations', () => {
  describe('calculateCumulativeStrength', () => {
    it('returns 0 for empty relationships', () => {
      expect(calculateCumulativeStrength([])).toBe(0)
    })

    it('calculates single relationship strength correctly', () => {
      const relationships = [createRelationship(0.8, 0.9)]
      expect(calculateCumulativeStrength(relationships)).toBeCloseTo(0.72, 2)
    })

    it('calculates chain of relationships correctly', () => {
      const relationships = [
        createRelationship(0.8, 0.9), // 0.72
        createRelationship(0.6, 0.7)  // 0.42
      ]
      // 0.72 * 0.42 = 0.3024
      expect(calculateCumulativeStrength(relationships)).toBeCloseTo(0.3024, 4)
    })

    it('handles perfect confidence correctly', () => {
      const relationships = [
        createRelationship(0.5, 1.0),
        createRelationship(0.5, 1.0)
      ]
      expect(calculateCumulativeStrength(relationships)).toBe(0.25)
    })
  })

  describe('calculateStepWeights', () => {
    it('returns [1] for empty relationships', () => {
      expect(calculateStepWeights([])).toEqual([1])
    })

    it('calculates step-by-step weights', () => {
      const relationships = [
        createRelationship(0.8, 0.9), // 0.72
        createRelationship(0.5, 1.0)  // 0.5
      ]
      const weights = calculateStepWeights(relationships)
      
      expect(weights).toHaveLength(3)
      expect(weights[0]).toBe(1)
      expect(weights[1]).toBeCloseTo(0.72, 2)
      expect(weights[2]).toBeCloseTo(0.36, 2)
    })
  })

  describe('sortPathsByStrength', () => {
    it('sorts paths from strongest to weakest', () => {
      const weakPath: CausalPath = {
        events: [],
        relationships: [createRelationship(0.3, 0.5)],
        totalWeight: 0,
        confidence: 0
      }
      const strongPath: CausalPath = {
        events: [],
        relationships: [createRelationship(0.9, 0.9)],
        totalWeight: 0,
        confidence: 0
      }
      
      const sorted = sortPathsByStrength([weakPath, strongPath])
      
      expect(sorted[0]).toBe(strongPath)
      expect(sorted[1]).toBe(weakPath)
    })

    it('handles empty array', () => {
      expect(sortPathsByStrength([])).toEqual([])
    })
  })

  describe('getStrongestPath', () => {
    it('returns null for empty array', () => {
      expect(getStrongestPath([])).toBeNull()
    })

    it('returns the strongest path', () => {
      const weakPath: CausalPath = {
        events: [],
        relationships: [createRelationship(0.3, 0.5)],
        totalWeight: 0,
        confidence: 0
      }
      const strongPath: CausalPath = {
        events: [],
        relationships: [createRelationship(0.9, 0.9)],
        totalWeight: 0,
        confidence: 0
      }
      
      expect(getStrongestPath([weakPath, strongPath])).toBe(strongPath)
    })
  })

  describe('transformPathToSteps', () => {
    it('transforms path to navigation steps', () => {
      const path: CausalPath = {
        events: [createEvent('1'), createEvent('2'), createEvent('3')],
        relationships: [
          createRelationship(0.8, 0.9),
          createRelationship(0.6, 0.7)
        ],
        totalWeight: 0,
        confidence: 0
      }
      
      const steps = transformPathToSteps(path)
      
      expect(steps).toHaveLength(3)
      expect(steps[0]!.stepIndex).toBe(0)
      expect(steps[0]!.cumulativeWeight).toBe(1)
      expect(steps[0]!.relationship).toBeUndefined()
      
      expect(steps[1]!.stepIndex).toBe(1)
      expect(steps[1]!.cumulativeWeight).toBeCloseTo(0.72, 2)
      expect(steps[1]!.relationship).toBeDefined()
      
      expect(steps[2]!.stepIndex).toBe(2)
      expect(steps[2]!.cumulativeWeight).toBeCloseTo(0.3024, 4)
    })

    it('handles empty path', () => {
      const path: CausalPath = {
        events: [],
        relationships: [],
        totalWeight: 0,
        confidence: 0
      }
      
      expect(transformPathToSteps(path)).toEqual([])
    })
  })

  describe('formatWeightAsPercentage', () => {
    it('formats weight as percentage string', () => {
      expect(formatWeightAsPercentage(0.72)).toBe('72.0%')
      expect(formatWeightAsPercentage(1)).toBe('100.0%')
      expect(formatWeightAsPercentage(0.3024)).toBe('30.2%')
    })
  })
})
```

---

## Phase 2: Layout Manager Testing Strategy (Days 5-8)

### 2.1 Extract Layout Logic

**File: `frontend/src/utils/layoutManagerUtils.ts`**

```typescript
export interface LayoutConfig {
  name: string
  label: string
  description: string
  category: 'force' | 'hierarchical' | 'circular' | 'grid'
  shortcutKey: string
  options: any
}

// Keyboard shortcut mapping
export const LAYOUT_SHORTCUTS: Record<string, string> = {
  '1': 'cose',
  '2': 'breadthfirst',
  '3': 'circle',
  '4': 'grid',
  'f': 'fit',
  'r': 'reset'
}

// Action handlers
export const ACTION_SHORTCUTS: Record<string, string> = {
  'f': 'fit',
  'r': 'reset'
}

export function getLayoutFromShortcut(key: string): string | null {
  return LAYOUT_SHORTCUTS[key] ?? null
}

export function isActionShortcut(key: string): boolean {
  return key in ACTION_SHORTCUTS
}

export function shouldIgnoreKeyboardShortcut(): boolean {
  const activeElement = document.activeElement
  const tagName = activeElement?.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

export function getLayoutsByCategory(layouts: LayoutConfig[]): Record<string, LayoutConfig[]> {
  return layouts.reduce((acc, layout) => {
    if (!acc[layout.category]) {
      acc[layout.category] = []
    }
    acc[layout.category].push(layout)
    return acc
  }, {} as Record<string, LayoutConfig[]>)
}
```

### 2.2 Create Layout Manager Unit Tests

**File: `frontend/src/utils/layoutManagerUtils.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getLayoutFromShortcut,
  isActionShortcut,
  shouldIgnoreKeyboardShortcut,
  getLayoutsByCategory,
  LAYOUT_SHORTCUTS
} from './layoutManagerUtils'

describe('Layout Manager Utils', () => {
  describe('getLayoutFromShortcut', () => {
    it('returns layout name for valid shortcuts', () => {
      expect(getLayoutFromShortcut('1')).toBe('cose')
      expect(getLayoutFromShortcut('2')).toBe('breadthfirst')
      expect(getLayoutFromShortcut('3')).toBe('circle')
      expect(getLayoutFromShortcut('4')).toBe('grid')
    })

    it('returns null for invalid shortcuts', () => {
      expect(getLayoutFromShortcut('x')).toBeNull()
      expect(getLayoutFromShortcut('5')).toBeNull()
    })
  })

  describe('isActionShortcut', () => {
    it('identifies action shortcuts', () => {
      expect(isActionShortcut('f')).toBe(true)
      expect(isActionShortcut('r')).toBe(true)
    })

    it('returns false for non-action keys', () => {
      expect(isActionShortcut('1')).toBe(false)
      expect(isActionShortcut('x')).toBe(false)
    })
  })

  describe('shouldIgnoreKeyboardShortcut', () => {
    beforeEach(() => {
      // Create a test container
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
  })

  describe('getLayoutsByCategory', () => {
    it('groups layouts by category', () => {
      const layouts = [
        { name: 'cose', category: 'force' },
        { name: 'breadthfirst', category: 'hierarchical' },
        { name: 'circle', category: 'circular' },
        { name: 'enhanced', category: 'force' }
      ] as any[]

      const grouped = getLayoutsByCategory(layouts)

      expect(grouped.force).toHaveLength(2)
      expect(grouped.hierarchical).toHaveLength(1)
      expect(grouped.circular).toHaveLength(1)
    })

    it('handles empty array', () => {
      expect(getLayoutsByCategory([])).toEqual({})
    })
  })
})
```

### 2.3 Refactor Layout Manager Component Tests

**File: `frontend/src/components/causal-graph/CausalGraphLayoutManager.test.tsx` (Updated)**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CausalGraphLayoutManager } from './CausalGraphLayoutManager'
import { useGlobalStore } from '@/stores/globalStore'
import { createMockCytoscape } from '@/test/__mocks__/cytoscape'

vi.mock('@/stores/globalStore')
const mockUseGlobalStore = vi.mocked(useGlobalStore)

describe('CausalGraphLayoutManager', () => {
  let mockCy: ReturnType<typeof createMockCytoscape>
  const mockUpdateSessionData = vi.fn()

  beforeEach(() => {
    mockCy = createMockCytoscape()
    mockUseGlobalStore.mockReturnValue({
      sessionData: {
        viewportState: {
          causalGraph: {
            layout: 'cose',
            nodePositions: {}
          }
        }
      },
      updateSessionData: mockUpdateSessionData
    } as any)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Rendering', () => {
    it('renders layout categories', () => {
      render(<CausalGraphLayoutManager cytoscapeInstance={mockCy as any} />)
      
      expect(screen.getByText('Graph Layout')).toBeInTheDocument()
      expect(screen.getByText('FORCE-BASED')).toBeInTheDocument()
      expect(screen.getByText('HIERARCHICAL')).toBeInTheDocument()
      expect(screen.getByText('CIRCULAR')).toBeInTheDocument()
      expect(screen.getByText('GRID-BASED')).toBeInTheDocument()
    })

    it('shows current active layout', () => {
      render(<CausalGraphLayoutManager cytoscapeInstance={mockCy as any} />)
      
      const forceDirectedButton = screen.getByRole('button', { name: /force-directed/i })
      expect(forceDirectedButton).toHaveClass('bg-blue-100')
    })
  })

  describe('Layout Application', () => {
    it('applies layout when button is clicked', async () => {
      const user = userEvent.setup()
      const onLayoutChange = vi.fn()
      
      render(
        <CausalGraphLayoutManager 
          cytoscapeInstance={mockCy as any} 
          onLayoutChange={onLayoutChange}
        />
      )
      
      const hierarchicalButton = screen.getByRole('button', { name: /hierarchical/i })
      await user.click(hierarchicalButton)
      
      await waitFor(() => {
        expect(mockCy.layout).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'breadthfirst' })
        )
      })
    })

    it('calls onLayoutChange callback', async () => {
      const user = userEvent.setup()
      const onLayoutChange = vi.fn()
      
      render(
        <CausalGraphLayoutManager 
          cytoscapeInstance={mockCy as any} 
          onLayoutChange={onLayoutChange}
        />
      )
      
      await user.click(screen.getByRole('button', { name: /hierarchical/i }))
      
      await waitFor(() => {
        expect(onLayoutChange).toHaveBeenCalledWith('breadthfirst')
      })
    })
  })

  describe('Keyboard Shortcuts', () => {
    it('applies layout on number key press', () => {
      render(<CausalGraphLayoutManager cytoscapeInstance={mockCy as any} />)
      
      fireEvent.keyDown(document, { key: '2' })
      
      expect(mockCy.layout).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'breadthfirst' })
      )
    })

    it('handles fit shortcut', () => {
      render(<CausalGraphLayoutManager cytoscapeInstance={mockCy as any} />)
      
      fireEvent.keyDown(document, { key: 'f' })
      
      expect(mockCy.fit).toHaveBeenCalledWith(undefined, 50)
    })

    it('handles reset shortcut', () => {
      render(<CausalGraphLayoutManager cytoscapeInstance={mockCy as any} />)
      
      fireEvent.keyDown(document, { key: 'r' })
      
      expect(mockCy.zoom).toHaveBeenCalledWith(1)
      expect(mockCy.center).toHaveBeenCalled()
    })

    it('ignores shortcuts when input is focused', () => {
      render(<CausalGraphLayoutManager cytoscapeInstance={mockCy as any} />)
      
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      
      fireEvent.keyDown(input, { key: '2' })
      
      // Should not have been called because input is focused
      expect(mockCy.layout).not.toHaveBeenCalled()
      
      document.body.removeChild(input)
    })
  })

  describe('Quick Actions', () => {
    it('provides fit and reset buttons', async () => {
      const user = userEvent.setup()
      
      render(<CausalGraphLayoutManager cytoscapeInstance={mockCy as any} />)
      
      const fitButton = screen.getByRole('button', { name: /fit/i })
      const resetButton = screen.getByRole('button', { name: /reset/i })
      
      await user.click(fitButton)
      expect(mockCy.fit).toHaveBeenCalled()
      
      await user.click(resetButton)
      expect(mockCy.zoom).toHaveBeenCalledWith(1)
    })
  })

  describe('Null Cytoscape Instance', () => {
    it('does not apply layout when instance is null', async () => {
      const user = userEvent.setup()
      
      render(<CausalGraphLayoutManager cytoscapeInstance={null} />)
      
      await user.click(screen.getByRole('button', { name: /hierarchical/i }))
      
      // Should not throw, just not call
      expect(mockCy.layout).not.toHaveBeenCalled()
    })
  })
})
```

---

## Phase 3: Suggestion Manager Testing (Days 9-12)

### 3.1 Extract Suggestion Logic

**File: `frontend/src/utils/suggestionManagerUtils.ts`**

```typescript
import { CausalSuggestion, CausalRelationship } from '@/types'

export interface SuggestionState {
  isVisible: boolean
  isProcessing: boolean
  userFeedback?: SuggestionFeedback
}

export interface SuggestionFeedback {
  rating: 'helpful' | 'not_helpful' | 'needs_improvement'
  comment: string
  improvementSuggestion: string
}

/**
 * Check if a relationship already exists
 */
export function relationshipExists(
  causeId: string,
  effectId: string,
  relationships: CausalRelationship[]
): boolean {
  return relationships.some(rel => 
    rel.cause_event_id === causeId && 
    rel.effect_event_id === effectId
  )
}

/**
 * Get confidence level styling
 */
export function getConfidenceStyle(confidence: number): {
  bgColor: string
  textColor: string
  label: string
} {
  if (confidence >= 0.8) {
    return { bgColor: 'bg-green-100', textColor: 'text-green-800', label: 'High' }
  } else if (confidence >= 0.5) {
    return { bgColor: 'bg-yellow-100', textColor: 'text-yellow-800', label: 'Medium' }
  } else {
    return { bgColor: 'bg-red-100', textColor: 'text-red-800', label: 'Low' }
  }
}

/**
 * Format suggestion weight for display
 */
export function formatSuggestionWeight(weight: number): string {
  return `W: ${weight.toFixed(2)}`
}

/**
 * Validate feedback form
 */
export function validateFeedback(feedback: SuggestionFeedback): string[] {
  const errors: string[] = []
  
  if (!feedback.rating) {
    errors.push('Please select a rating')
  }
  
  if (feedback.rating === 'needs_improvement' && !feedback.improvementSuggestion.trim()) {
    errors.push('Please provide an improvement suggestion')
  }
  
  return errors
}

/**
 * Sort suggestions by confidence
 */
export function sortSuggestionsByConfidence(suggestions: CausalSuggestion[]): CausalSuggestion[] {
  return [...suggestions].sort((a, b) => b.confidence - a.confidence)
}
```

### 3.2 Create Suggestion Manager Unit Tests

**File: `frontend/src/utils/suggestionManagerUtils.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import {
  relationshipExists,
  getConfidenceStyle,
  formatSuggestionWeight,
  validateFeedback,
  sortSuggestionsByConfidence
} from './suggestionManagerUtils'
import { CausalRelationship, CausalSuggestion } from '@/types'

describe('Suggestion Manager Utils', () => {
  describe('relationshipExists', () => {
    const relationships: CausalRelationship[] = [
      {
        id: '1',
        cause_event_id: 'event-1',
        effect_event_id: 'event-2',
        weight: 0.8,
        confidence: 0.9,
        evidence: '',
        relationship_type: 'direct',
        created_at: '',
        updated_at: ''
      }
    ]

    it('returns true when relationship exists', () => {
      expect(relationshipExists('event-1', 'event-2', relationships)).toBe(true)
    })

    it('returns false when relationship does not exist', () => {
      expect(relationshipExists('event-1', 'event-3', relationships)).toBe(false)
    })

    it('returns false for empty relationships', () => {
      expect(relationshipExists('event-1', 'event-2', [])).toBe(false)
    })
  })

  describe('getConfidenceStyle', () => {
    it('returns green style for high confidence', () => {
      const style = getConfidenceStyle(0.9)
      expect(style.bgColor).toBe('bg-green-100')
      expect(style.label).toBe('High')
    })

    it('returns yellow style for medium confidence', () => {
      const style = getConfidenceStyle(0.6)
      expect(style.bgColor).toBe('bg-yellow-100')
      expect(style.label).toBe('Medium')
    })

    it('returns red style for low confidence', () => {
      const style = getConfidenceStyle(0.3)
      expect(style.bgColor).toBe('bg-red-100')
      expect(style.label).toBe('Low')
    })

    it('handles boundary values correctly', () => {
      expect(getConfidenceStyle(0.8).label).toBe('High')
      expect(getConfidenceStyle(0.5).label).toBe('Medium')
      expect(getConfidenceStyle(0.49).label).toBe('Low')
    })
  })

  describe('formatSuggestionWeight', () => {
    it('formats weight with two decimal places', () => {
      expect(formatSuggestionWeight(0.8)).toBe('W: 0.80')
      expect(formatSuggestionWeight(0.123456)).toBe('W: 0.12')
      expect(formatSuggestionWeight(1)).toBe('W: 1.00')
    })
  })

  describe('validateFeedback', () => {
    it('returns empty array for valid feedback', () => {
      const errors = validateFeedback({
        rating: 'helpful',
        comment: 'Good suggestion',
        improvementSuggestion: ''
      })
      expect(errors).toHaveLength(0)
    })

    it('requires rating', () => {
      const errors = validateFeedback({
        rating: '' as any,
        comment: '',
        improvementSuggestion: ''
      })
      expect(errors).toContain('Please select a rating')
    })

    it('requires improvement suggestion when rating is needs_improvement', () => {
      const errors = validateFeedback({
        rating: 'needs_improvement',
        comment: '',
        improvementSuggestion: ''
      })
      expect(errors).toContain('Please provide an improvement suggestion')
    })
  })

  describe('sortSuggestionsByConfidence', () => {
    it('sorts suggestions from highest to lowest confidence', () => {
      const suggestions = [
        { confidence: 0.5 },
        { confidence: 0.9 },
        { confidence: 0.7 }
      ] as CausalSuggestion[]

      const sorted = sortSuggestionsByConfidence(suggestions)

      expect(sorted[0]!.confidence).toBe(0.9)
      expect(sorted[1]!.confidence).toBe(0.7)
      expect(sorted[2]!.confidence).toBe(0.5)
    })

    it('does not mutate original array', () => {
      const suggestions = [
        { confidence: 0.5 },
        { confidence: 0.9 }
      ] as CausalSuggestion[]

      sortSuggestionsByConfidence(suggestions)

      expect(suggestions[0]!.confidence).toBe(0.5)
    })
  })
})
```

---

## Phase 4: Component Test Simplification (Days 13-16)

### 4.1 CausalPathExplorer Test Refactor

Focus on:
- Test navigation logic through unit tests
- Simplify component tests to verify rendering
- Mock API responses with realistic data

```typescript
// Simplified component tests
describe('CausalPathExplorer Component', () => {
  describe('Rendering', () => {
    it('renders nothing when not exploring', () => {
      render(<CausalPathExplorer />)
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    })

    it('renders explorer when paths are found', async () => {
      mockFindChain.mockResolvedValue([mockPath])
      render(<CausalPathExplorer focusEventId="1" />)
      
      await waitFor(() => {
        expect(screen.getByRole('region', { name: /causal chain explorer/i })).toBeInTheDocument()
      })
    })

    it('shows no paths message when none found', async () => {
      mockFindChain.mockResolvedValue([])
      render(<CausalPathExplorer focusEventId="1" />)
      
      await waitFor(() => {
        expect(screen.getByText(/no causal chains found/i)).toBeInTheDocument()
      })
    })
  })

  describe('Navigation', () => {
    it('displays step counter', async () => {
      mockFindChain.mockResolvedValue([mockPath])
      render(<CausalPathExplorer focusEventId="1" />)
      
      await waitFor(() => {
        expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument()
      })
    })
  })

  describe('Callbacks', () => {
    it('calls onPathSelect when path is found', async () => {
      const onPathSelect = vi.fn()
      mockFindChain.mockResolvedValue([mockPath])
      
      render(<CausalPathExplorer focusEventId="1" onPathSelect={onPathSelect} />)
      
      await waitFor(() => {
        expect(onPathSelect).toHaveBeenCalledWith(expect.objectContaining({
          events: expect.any(Array)
        }))
      })
    })
  })
})
```

### 4.2 Create Integration Test Suite

For complex interactions, use integration tests with real browser behavior:

```typescript
// frontend/src/test/integration/causalGraph.integration.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CausalGraphComponent } from '@/components/causal-graph/CausalGraphComponent'
import { TestProviders } from '@/test/utils'

// These tests run against a more complete mock environment
describe('Causal Graph Integration', () => {
  it('complete workflow: load graph, select node, explore paths', async () => {
    const user = userEvent.setup()
    
    render(
      <TestProviders>
        <CausalGraphComponent 
          showNavigationControls
          enablePathExploration
        />
      </TestProviders>
    )
    
    // Wait for graph to initialize
    await waitFor(() => {
      expect(screen.getByRole('application', { name: /causal graph/i })).toBeInTheDocument()
    })
    
    // Verify graph renders
    expect(screen.getByTestId('causal-graph-container')).toBeInTheDocument()
  })
})
```

---

## Phase 5: Test Infrastructure Improvements (Days 17-20)

### 5.1 Create Test Data Generators

**File: `frontend/src/test/generators/causalDataGenerators.ts`**

```typescript
import { Event, CausalRelationship, CausalPath, CausalSuggestion } from '@/types'

let idCounter = 0

export function generateEventId(): string {
  return `event-${++idCounter}`
}

export function generateEvent(overrides: Partial<Event> = {}): Event {
  const id = overrides.id ?? generateEventId()
  return {
    id,
    description: `Event ${id}`,
    actor: `Actor ${Math.floor(Math.random() * 10)}`,
    target: `Target ${Math.floor(Math.random() * 10)}`,
    timestamp: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  }
}

export function generateRelationship(
  causeEvent: Event,
  effectEvent: Event,
  overrides: Partial<CausalRelationship> = {}
): CausalRelationship {
  return {
    id: `rel-${causeEvent.id}-${effectEvent.id}`,
    cause_event_id: causeEvent.id,
    effect_event_id: effectEvent.id,
    weight: Math.random() * 0.5 + 0.5, // 0.5-1.0
    confidence: Math.random() * 0.3 + 0.7, // 0.7-1.0
    evidence: 'Generated evidence',
    relationship_type: 'direct',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  }
}

export function generateCausalPath(length: number = 3): CausalPath {
  const events = Array.from({ length }, () => generateEvent())
  const relationships = events.slice(0, -1).map((event, i) => 
    generateRelationship(event, events[i + 1]!)
  )
  
  return {
    events,
    relationships,
    totalWeight: relationships.reduce((acc, r) => acc * r.weight, 1),
    confidence: relationships.reduce((acc, r) => acc * r.confidence, 1)
  }
}

export function generateSuggestion(overrides: Partial<CausalSuggestion> = {}): CausalSuggestion {
  return {
    id: `suggestion-${++idCounter}`,
    cause_event_id: generateEventId(),
    effect_event_id: generateEventId(),
    suggested_weight: Math.random() * 0.5 + 0.5,
    confidence: Math.random() * 0.3 + 0.7,
    reasoning: 'AI-generated reasoning',
    ...overrides
  }
}
```

### 5.2 Create Mock API Helpers

**File: `frontend/src/test/mocks/causalApiMocks.ts`**

```typescript
import { vi } from 'vitest'
import { generateCausalPath, generateSuggestion } from '../generators/causalDataGenerators'

export function mockCausalApi() {
  return {
    findChain: vi.fn().mockResolvedValue([generateCausalPath()]),
    getSuggestions: vi.fn().mockResolvedValue([
      generateSuggestion(),
      generateSuggestion(),
      generateSuggestion()
    ]),
    createLink: vi.fn().mockImplementation(async (causeId, effectId, data) => ({
      id: `rel-${causeId}-${effectId}`,
      cause_event_id: causeId,
      effect_event_id: effectId,
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })),
    updateLink: vi.fn().mockResolvedValue({}),
    deleteLink: vi.fn().mockResolvedValue(undefined),
    getRelationships: vi.fn().mockResolvedValue([])
  }
}

export function setupCausalApiMock() {
  const mock = mockCausalApi()
  
  vi.mock('@/services/api', () => ({
    apiClient: {
      causal: mock
    }
  }))
  
  return mock
}
```

---

## Files to Create/Modify

### New Files
1. `frontend/src/utils/causalPathCalculations.ts`
2. `frontend/src/utils/causalPathCalculations.test.ts`
3. `frontend/src/utils/layoutManagerUtils.ts`
4. `frontend/src/utils/layoutManagerUtils.test.ts`
5. `frontend/src/utils/suggestionManagerUtils.ts`
6. `frontend/src/utils/suggestionManagerUtils.test.ts`
7. `frontend/src/test/generators/causalDataGenerators.ts`
8. `frontend/src/test/mocks/causalApiMocks.ts`
9. `frontend/src/test/integration/causalGraph.integration.test.tsx`

### Modified Files
1. `frontend/src/components/causal-graph/CausalGraphLayoutManager.tsx` - Extract logic
2. `frontend/src/components/causal-graph/CausalGraphLayoutManager.test.tsx` - Simplified
3. `frontend/src/components/causal-graph/CausalPathExplorer.tsx` - Extract logic
4. `frontend/src/components/causal-graph/CausalPathExplorer.test.tsx` - Simplified
5. `frontend/src/components/causal-graph/CausalSuggestionManager.tsx` - Extract logic
6. `frontend/src/components/causal-graph/CausalSuggestionManager.test.tsx` - Simplified
7. `frontend/src/components/causal-graph/CausalRelationshipInteractions.test.tsx` - Updated

---

## Success Criteria

1. **All 17 causal graph tests pass** - No algorithmic calculation errors
2. **Business logic is unit tested** - 100% coverage on utility functions
3. **Component tests are maintainable** - Focus on rendering and callbacks
4. **Test data is realistic** - Generated data matches expected API responses
5. **Integration tests cover critical paths** - End-to-end workflow validation

---

## Testing Guidelines

### Algorithm Testing
- Test mathematical functions with precise expected values
- Use `toBeCloseTo()` for floating-point comparisons
- Test edge cases (empty arrays, single elements, boundaries)

### Component Testing
- Focus on what renders, not how
- Test callback invocations
- Verify accessibility attributes
- Skip testing complex animation states

### Integration Testing
- Test complete user workflows
- Use realistic mock data
- Verify state changes across components

---

## Dependencies

- Vitest
- React Testing Library
- @testing-library/user-event
- TypeScript 5.x
