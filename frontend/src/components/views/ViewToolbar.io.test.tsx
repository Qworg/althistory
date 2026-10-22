import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/utils'
import { ViewToolbar } from './ViewToolbar'

// Entry points added in this phase: the toolbar is where graph data operations
// (copy, import, export) live, so import/export/version-history hang off it too.
// The graph, import, export and copy hooks are mocked so this file asserts the
// mount wiring and the resolved copy TODOs; the wizard/panel internals have
// their own suites.
const graphSpies = vi.hoisted(() => ({
  switchGraph: vi.fn(),
  deleteGraph: vi.fn(),
}))

vi.mock('@/hooks/useGraphs', () => {
  const graph = {
    id: 'graph-1',
    name: 'Alpha Graph',
    description: '',
    status: 'active',
    version: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    metadata: { eventCount: 0, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
  }
  const copiedGraph = {
    ...graph,
    id: 'graph-copy-1',
    name: 'Alpha Graph Copy',
    createdAt: '2024-01-03T00:00:00Z',
  }
  return {
    useActiveGraphId: () => 'graph-1',
    useActiveGraph: () => ({ data: graph }),
    useGraphs: () => ({ data: { graphs: [graph, copiedGraph], total: 2 }, isLoading: false }),
    useGraphVersions: () => ({ data: [], isLoading: false, error: null }),
    useRollbackGraph: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSwitchGraph: () => ({ mutate: graphSpies.switchGraph, isPending: false }),
    useDeleteGraph: () => ({ mutate: graphSpies.deleteGraph, isPending: false }),
  }
})

const completedCopy = vi.hoisted(() => ({
  id: 'graph-copy-1',
  name: 'Alpha Graph Copy',
  type: 'full',
  status: 'completed',
  progress: 100,
  created_at: '2024-01-03T00:00:00Z',
  completed_at: '2024-01-03T00:00:05Z',
  parameters: {},
}))

vi.mock('@/hooks/useGraphCopy', () => ({
  useGraphCopy: () => ({
    copyState: {
      activeOperations: [],
      completedOperations: [completedCopy],
      selectedTimeRange: null,
      selectedFilter: null,
      copyName: '',
      isCreatingCopy: false,
    },
    setCopyName: vi.fn(),
    setSelectedTimeRange: vi.fn(),
    setSelectedFilter: vi.fn(),
    createFullCopy: vi.fn(),
    createTimeRangeCopy: vi.fn(),
    createFilteredCopy: vi.fn(),
    cancelCopy: vi.fn(),
    refreshCopyStatus: vi.fn(),
    clearCompletedOperations: vi.fn(),
    isCreatingCopy: false,
    isRefreshingStatus: false,
  }),
}))

vi.mock('@/hooks/useImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useImport')>()
  return {
    ...actual,
    useValidateImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
    usePreviewImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useExecuteImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

vi.mock('@/hooks/useExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useExport')>()
  return {
    ...actual,
    useExportManagement: () => ({
      activeJob: undefined,
      stats: undefined,
      isCreating: false,
      isDownloading: false,
      isSyncExporting: false,
      isValidating: false,
      createExport: vi.fn(),
      syncExport: vi.fn(),
      downloadExport: vi.fn(),
      cancelExport: vi.fn(),
      validateExport: vi.fn(),
      hasActiveJobs: false,
      completedJobs: [],
    }),
  }
})

describe('ViewToolbar graph data operation entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the import wizard from the Import action (Req 18.1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ViewToolbar viewMode="timeline" />)

    await user.click(screen.getByRole('button', { name: 'Import' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Import Data')).toBeInTheDocument()
  })

  it('opens the export panel and its primary export action (Req 5)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ViewToolbar viewMode="timeline" />)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Export Graph')).toBeInTheDocument()

    // The panel starts collapsed; expanding it reveals the export affordances.
    await user.click(within(dialog).getByRole('button', { name: /export/i }))
    expect(
      await within(dialog).findByRole('button', { name: /quick export/i })
    ).toBeInTheDocument()
  })

  it('opens the version history panel from the Versions action (Req 17.5)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ViewToolbar viewMode="timeline" />)

    await user.click(screen.getByRole('button', { name: 'Versions' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Version History' })).toBeInTheDocument()
    expect(within(dialog).getByText('No version history available')).toBeInTheDocument()
  })

  it('resolves a copy-history "Open" to the copied graph id and switches to it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ViewToolbar viewMode="timeline" />)

    await user.click(screen.getByRole('button', { name: 'Copy History' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))

    expect(graphSpies.switchGraph).toHaveBeenCalledWith('graph-copy-1')
  })

  it('deletes a copy by its graph id from the copy-history panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ViewToolbar viewMode="timeline" />)

    await user.click(screen.getByRole('button', { name: 'Copy History' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // Deleting a copy deletes a graph, so it asks first.
    expect(graphSpies.deleteGraph).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete copy' }))

    expect(graphSpies.deleteGraph).toHaveBeenCalledWith('graph-copy-1')
  })
})
