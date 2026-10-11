import { screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BranchComparisonModal } from './BranchComparisonModal'
import { renderWithProviders } from '@/test/utils'
import { Event, Arc, CausalRelationship } from '@/types'

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
  })

  it('does not render when isOpen is false', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText(/Counterfactual Divergence Explorer/)).not.toBeInTheDocument()
  })

  it('renders header, KPI metrics, and Point of Divergence when open', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    expect(screen.getByText(/Counterfactual Divergence Explorer/)).toBeInTheDocument()
    expect(screen.getByText(/Shared History/)).toBeInTheDocument()
    expect(screen.getByText(/Counterfactual Drift/)).toBeInTheDocument()
    expect(screen.getAllByText(/Point of Divergence/).length).toBeGreaterThan(0)
    expect(screen.getByText('Pre-divergence continuity')).toBeInTheDocument()
  })

  it('switches between views using tabs', async () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    // Tab 1: Timeline canvas is default
    expect(screen.getByText(/Dual-Lane Timeline Visualizer/)).toBeInTheDocument()

    // Switch to Event & Causal Diff tab
    const diffTab = screen.getByText(/Event & Causal Diff/)
    fireEvent.click(diffTab)

    expect(screen.getByText(/Filter Events:/)).toBeInTheDocument()
    expect(screen.getByText('Halifax Appointed Prime Minister')).toBeInTheDocument()
    expect(screen.getByText('Chamberlain Resigns')).toBeInTheDocument()

    // Switch to Summary tab
    const summaryTab = screen.getByText(/Summary Overview/)
    fireEvent.click(summaryTab)

    expect(screen.getByText(/Historical Divergence Analysis/)).toBeInTheDocument()
    expect(screen.getAllByText(/Total Events:/)).toHaveLength(2)
  })

  it('filters events in the Diff tab', () => {
    renderWithProviders(<BranchComparisonModal {...defaultProps} />)

    // Go to Diff tab
    fireEvent.click(screen.getByText(/Event & Causal Diff/))

    // Filter to divergent additions only
    const divergentFilter = screen.getByText(/Divergent Additions/)
    fireEvent.click(divergentFilter)

    expect(screen.getByText('Halifax Appointed Prime Minister')).toBeInTheDocument()
    // Chamberlain resigns is shared, should not appear under divergent filter
    expect(screen.queryByText('Chamberlain Resigns')).not.toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn()
    renderWithProviders(<BranchComparisonModal {...defaultProps} onClose={handleClose} />)

    const closeBtn = screen.getByRole('button', { name: 'Close' })
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
