import { screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BranchComparisonModal } from './BranchComparisonModal'
import { renderWithProviders } from '@/test/utils'
import { Event, Arc, CausalRelationship } from '@/types'
import { ModalBase } from '@/components/modals/ModalBase'

// The embedded causal graph is Cytoscape; record what the dialog asks of it.
const causalGraph = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('@/components/causal-graph/CausalGraphComponent', () => ({
  CausalGraphComponent: (props: Record<string, unknown>) => {
    causalGraph.props = props
    return <div data-testid="embedded-causal-graph" />
  },
}))

// Mock apiClient
vi.mock('@/services/api', () => ({
  apiClient: {
    events: {
      getAll: vi.fn().mockResolvedValue([]),
    },
    arcs: {
      getAll: vi.fn().mockResolvedValue([]),
    },
    causal: {
      getRelationships: vi.fn().mockResolvedValue([]),
    },
    graphs: {
      getAll: vi.fn().mockResolvedValue([
        { id: 'graph-1', name: 'Prime Timeline', version: 1, metadata: { eventCount: 2 } },
        { id: 'graph-2', name: 'Halifax Branch', branchName: 'halifax-1940', version: 1, metadata: { eventCount: 2 } },
      ]),
      switch: vi.fn().mockResolvedValue({ success: true }),
      getVersions: vi.fn().mockResolvedValue([]),
      mergeDetailed: vi.fn().mockResolvedValue({
        success: true,
        dryRun: true,
        conflicts: [],
      }),
    },
    inference: {
      simulate: vi.fn().mockResolvedValue({
        graphId: 'graph-2',
        anchorEventId: 'cf_pod',
        domain: 'political',
        steps: 1,
        stepDurationMs: 1000,
        aggressiveness: 0.5,
        dryRun: false,
        events: [],
        relationships: [],
        pressures: [],
      }),
    },
  },
}))

describe('BranchComparisonModal', () => {
  const mockBaselineEvents: Event[] = [
    {
      id: 'e1',
      description: 'Chamberlain Resigns',
      actor: 'Parliament',
      target: 'Chamberlain',
      timestamp: '1940-05-09T00:00:00Z',
      created_at: '1940-05-09T00:00:00Z',
      updated_at: '1940-05-09T00:00:00Z',
    },
    {
      id: 'e2',
      description: 'Churchill Appointed Prime Minister',
      actor: 'King George VI',
      target: 'Churchill',
      timestamp: '1940-05-10T18:00:00Z',
      created_at: '1940-05-10T18:00:00Z',
      updated_at: '1940-05-10T18:00:00Z',
    },
  ]

  const mockCounterfactualEvents: Event[] = [
    {
      id: 'e1',
      description: 'Chamberlain Resigns',
      actor: 'Parliament',
      target: 'Chamberlain',
      timestamp: '1940-05-09T00:00:00Z',
      created_at: '1940-05-09T00:00:00Z',
      updated_at: '1940-05-09T00:00:00Z',
    },
    {
      id: 'cf_pod',
      description: 'Halifax Appointed Prime Minister',
      actor: 'King George VI',
      target: 'Halifax',
      timestamp: '1940-05-10T18:00:00Z',
      created_at: '1940-05-10T18:00:00Z',
      updated_at: '1940-05-10T18:00:00Z',
    },
  ]

  const mockArcs: Arc[] = [
    {
      id: 'arc1',
      name: 'May 1940 Crisis',
      description: 'The critical crisis of May 1940',
      start_time: '1940-05-01T00:00:00Z',
      end_time: '1940-05-20T00:00:00Z',
      level: 0,
      parent_arc_id: null,
      created_at: '1940-05-01T00:00:00Z',
      updated_at: '1940-05-01T00:00:00Z',
    },
  ]

  const mockRelationships: CausalRelationship[] = [
    {
      id: 'rel1',
      cause_event_id: 'e1',
      effect_event_id: 'e2',
      weight: 0.9,
      confidence: 0.95,
      relationship_type: 'direct',
      evidence: 'Direct causal pressure from resignation',
      created_at: '1940-05-09T00:00:00Z',
      updated_at: '1940-05-09T00:00:00Z',
    },
  ]

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    originalGraphName: 'Prime Timeline',
    copiedGraphName: 'Halifax Branch',
    originalData: {
      events: mockBaselineEvents,
      arcs: mockArcs,
      relationships: mockRelationships,
    },
    copiedData: {
      events: mockCounterfactualEvents,
      arcs: mockArcs,
      relationships: mockRelationships,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    causalGraph.props = null
  })

  const FOCUSABLE =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

  const mergeableProps = {
    ...defaultProps,
    initialBaselineGraphId: 'graph-1',
    initialCounterfactualGraphId: 'graph-2',
  }

  it('does not render when isOpen is false', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is the "Compare branches" dialog, with the at-a-glance figures', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    const dialog = screen.getByRole('dialog', { name: 'Compare branches' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(/aligned at the point of divergence/)).toBeInTheDocument()
    expect(screen.getByText('Shared history')).toBeInTheDocument()
    expect(screen.getByText('Branch changes')).toBeInTheDocument()
    expect(screen.getAllByText(/Point of divergence/).length).toBeGreaterThan(0)
    expect(screen.getByText('In both, before the split')).toBeInTheDocument()
    expect(screen.queryByText(/Explorer|PoD/)).not.toBeInTheDocument()
  })

  it('names the graph pickers by their labels alone', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)
    // Explicit labels: the selected option is not folded into the name
    expect(screen.getByRole('combobox', { name: 'Baseline' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Branch' })).toBeInTheDocument()
  })

  it('exposes the views as tabs that control one tab panel', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    const tablist = screen.getByRole('tablist', { name: 'Comparison views' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual([
      'Timeline',
      'Causal graph',
      'Differences',
      'Summary',
    ])

    const timelineTab = screen.getByRole('tab', { name: 'Timeline' })
    expect(timelineTab).toHaveAttribute('aria-selected', 'true')
    expect(timelineTab).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('tabindex', '-1')

    const panel = screen.getByRole('tabpanel')
    expect(timelineTab).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', timelineTab.id)
  })

  it('moves between tabs with the arrow, Home and End keys', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    const timelineTab = screen.getByRole('tab', { name: 'Timeline' })
    timelineTab.focus()

    // Left from the first tab wraps to the last.
    fireEvent.keyDown(timelineTab, { key: 'ArrowLeft' })
    const summaryTab = screen.getByRole('tab', { name: 'Summary' })
    expect(summaryTab).toHaveAttribute('aria-selected', 'true')
    expect(summaryTab).toHaveFocus()

    fireEvent.keyDown(summaryTab, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Differences' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Differences' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Summary' }).id)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'Home' })
    expect(timelineTab).toHaveFocus()
    expect(timelineTab).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(timelineTab, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'ArrowRight' })
    expect(timelineTab).toHaveFocus()
  })

  it('switches between views using tabs', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Differences' }))

    expect(screen.getByRole('group', { name: 'Show events' })).toBeInTheDocument()
    // It opens on the changes; the shared history is one click away.
    expect(screen.getByRole('button', { name: /^Changes/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Halifax Appointed Prime Minister')).toBeInTheDocument()
    expect(screen.queryByText('Chamberlain Resigns')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(screen.getByText('Chamberlain Resigns')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))

    // The summary tells the branch's story rather than repeating the header:
    // where it splits, then what it adds.
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent(/follows .*Prime Timeline.* until/)
    expect(screen.getByRole('heading', { name: 'What the branch adds' })).toBeInTheDocument()
  })

  it('filters events in the Differences tab', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Differences' }))

    const addedFilter = screen.getByRole('button', { name: /^Added in branch \(/ })
    expect(addedFilter).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(addedFilter)
    expect(addedFilter).toHaveAttribute('aria-pressed', 'true')

    expect(screen.getByText('Halifax Appointed Prime Minister')).toBeInTheDocument()
    // Chamberlain resigns is shared, should not appear under the added filter
    expect(screen.queryByText('Chamberlain Resigns')).not.toBeInTheDocument()
  })

  it('calls onClose from the footer and the header', () => {
    const handleClose = vi.fn()
    renderWithProviders(<BranchComparisonModal {...defaultProps} onClose={handleClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }))
    expect(handleClose).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape', () => {
    const handleClose = vi.fn()
    renderWithProviders(<BranchComparisonModal {...defaultProps} onClose={handleClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab inside the dialog', () => {
    renderWithProviders(<BranchComparisonModal {...mergeableProps} />)

    const dialog = screen.getByRole('dialog', { name: 'Compare branches' })
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    // Close comes last: the commit actions sit before it, as the next step.
    expect(last).toHaveTextContent('Close')

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(first).toHaveFocus()

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('offers merge and switch as equal secondary actions: comparing is the task here', () => {
    renderWithProviders(<BranchComparisonModal {...mergeableProps} />)

    // A filled merge button in a dialog opened to compare drew the curious
    // click to the riskiest action; the merge step confirms on its own.
    const merge = screen.getByRole('button', { name: 'Merge into baseline…' })
    const switchButton = screen.getByRole('button', { name: 'Open this branch' })
    expect(merge.className).not.toContain('bg-baseline')
    expect(merge.className).toContain('border-line')
    expect(switchButton.className).not.toContain('bg-baseline')
    expect(switchButton.className).toContain('border-line')
  })

  it('opens the merge as a step of the comparison, not a second dialog', () => {
    renderWithProviders(<BranchComparisonModal {...mergeableProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Merge into baseline…' }))

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Merge branch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview merge' })).toBeInTheDocument()
  })

  it('steps back to the comparison on Escape, then returns focus to its opener', () => {
    const handleClose = vi.fn()
    renderWithProviders(<BranchComparisonModal {...mergeableProps} onClose={handleClose} />)

    const opener = screen.getByRole('button', { name: 'Merge into baseline…' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByTestId('merge-step')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByTestId('merge-step')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Compare branches' })).toBeInTheDocument()
    expect(handleClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Merge into baseline…' })).toHaveFocus()

    // The next Escape belongs to the comparison.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('steps back from the merge with its own button', () => {
    renderWithProviders(<BranchComparisonModal {...mergeableProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Merge into baseline…' }))

    fireEvent.click(screen.getByRole('button', { name: 'Back to comparison' }))

    expect(screen.queryByTestId('merge-step')).not.toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('leaves a dialog underneath it open on Escape', () => {
    const outerClose = vi.fn()
    const handleClose = vi.fn()
    renderWithProviders(
      <ModalBase isOpen onClose={outerClose} title="Graphs">
        <BranchComparisonModal {...defaultProps} onClose={handleClose} />
      </ModalBase>
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
    expect(outerClose).not.toHaveBeenCalled()
  })

  it('only compares: no simulation inside, and the commit actions set apart as the next step', () => {
    renderWithProviders(<BranchComparisonModal {...mergeableProps} />)

    expect(screen.queryByRole('tab', { name: /Simulate/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('simulation-launcher')).not.toBeInTheDocument()
    const nextSteps = screen.getByText('Next step', { selector: 'span' }).parentElement!
    expect(within(nextSteps).getByRole('button', { name: /Merge into baseline/ })).toBeInTheDocument()
  })

  it('embeds the causal graph as a read-only preview, without editing tools', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Causal graph' }))

    expect(screen.getByTestId('embedded-causal-graph')).toBeInTheDocument()
    expect(causalGraph.props).toMatchObject({
      readOnly: true,
      enablePathExploration: false,
      enableSuggestions: false,
      showSuggestionManager: false,
      divergenceEventIds: ['cf_pod'],
    })
    // A diff: what only the branch has is passed for the amber marking.
    expect(causalGraph.props?.branchAddedIds).toEqual(expect.arrayContaining(['cf_pod']))
  })

  it('keeps one tab panel height across every view, scrolling inside it', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    const heights = ['Timeline', 'Causal graph', 'Differences', 'Summary'].map(name => {
      fireEvent.click(screen.getByRole('tab', { name }))
      return screen.getByRole('tabpanel').className
    })
    expect(new Set(heights).size).toBe(1)
    expect(heights[0]).toMatch(/lg:h-\[/)
    expect(heights[0]).toContain('lg:overflow-y-auto')
  })

  it('reflows for a phone-width sheet: stacked pickers, scrolling tabs, stacked footer', () => {
    renderWithProviders(<BranchComparisonModal {...mergeableProps} />)

    // The pickers stack below sm and fill the width.
    const baseline = screen.getByRole('combobox', { name: 'Baseline' })
    expect(baseline.className).toContain('w-full')
    expect(baseline.parentElement?.parentElement?.className).toContain('grid-cols-1')

    // The tabs stay one row that scrolls, rather than wrapping.
    const tablist = screen.getByRole('tablist', { name: 'Comparison views' })
    expect(tablist.className).toContain('overflow-x-auto')
    expect(tablist.className).not.toContain('flex-wrap')

    // The figures are a two-column strip on a phone, not bordered tiles.
    const strip = screen.getByText('Shared history').closest('dl')!
    expect(strip.className).toContain('grid-cols-2')
    expect(strip.querySelector('.bg-card')).toBeNull()

    // The footer actions stack, the primary last.
    const merge = screen.getByRole('button', { name: 'Merge into baseline…' })
    const actions = merge.parentElement!
    expect(actions.className).toContain('flex-col')
    expect(actions.lastElementChild).toBe(merge)
  })

  it('explains the timeline marks in the canvas legend, not in a caption under it', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Added in branch')
    expect(screen.queryByText(/Dotted lines join events/)).not.toBeInTheDocument()
  })
})
