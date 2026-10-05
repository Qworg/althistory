import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/utils'
import { Header } from './Header'
import type { Graph } from '@/types'

// The header now hosts the graph switcher and the graph manager. Both talk to
// the graph hooks; the hook module is mocked so this test asserts the *mount
// wiring* (selector -> manager) without depending on the API layer.
vi.mock('@/hooks/useGraphs', () => {
  const activeGraph: Graph = {
    id: 'graph-1',
    name: 'Main Timeline',
    description: 'Primary historical timeline',
    status: 'active',
    version: 3,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
    metadata: {
      eventCount: 150,
      arcCount: 12,
      relationshipCount: 75,
      pressureCount: 8,
    },
  }
  const switchGraph = vi.fn()

  return {
    useActiveGraphId: () => 'graph-1',
    useGraphs: () => ({ data: { graphs: [activeGraph], total: 1 }, isLoading: false }),
    useSwitchGraph: () => ({ mutate: switchGraph, isPending: false }),
    useDeleteGraph: () => ({ mutate: vi.fn(), isPending: false }),
    useGraphManagement: () => ({
      activeGraphId: 'graph-1',
      activeGraph,
      graphs: [activeGraph],
      totalGraphs: 1,
      isLoading: false,
      isLoadingGraphs: false,
      isLoadingActive: false,
      error: null,
      createGraph: vi.fn(),
      updateGraph: vi.fn(),
      deleteGraph: vi.fn(),
      branchGraph: vi.fn(),
      mergeGraph: vi.fn(),
      rollbackGraph: vi.fn(),
      switchGraph,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      isBranching: false,
      isMerging: false,
      isRollingBack: false,
      isSwitching: false,
    }),
    useGraphVersions: () => ({ data: [], isLoading: false }),
    useGraphBranches: () => ({ data: [], isLoading: false }),
  }
})

describe('Header graph management mount points', () => {
  it('renders the graph selector inside the header (Req 17.1)', () => {
    renderWithProviders(<Header isMobile={false} layoutMode="sidebar" />)

    const banner = screen.getByRole('banner')
    expect(
      within(banner).getByRole('button', { name: /main timeline/i })
    ).toBeInTheDocument()
  })

  it('opens the graph manager when the selector Manage action is used (Req 17.2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Header isMobile={false} layoutMode="sidebar" />)

    await user.click(screen.getByRole('button', { name: /main timeline/i }))

    const manageButton = await screen.findByRole('button', { name: /manage/i })
    await user.click(manageButton)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText('Graph Manager')).toBeInTheDocument()
  })
})
