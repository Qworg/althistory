import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionHistoryPanel } from './VersionHistoryPanel'
import {
  useGraphVersions,
  useRollbackGraph,
  useActiveGraphId,
  useActiveGraph,
  useGraphHeadVersion,
  useSetVersionLabel,
} from '@/hooks/useGraphs'
import { useEvents, useArcs, useCausalRelationships } from '@/hooks/useAPI'
import { GraphVersion, Graph, Event, CausalRelationship } from '@/types'
import type { GraphVersionWithEntities } from '@/services/api'

// Mock dependencies
vi.mock('@/hooks/useGraphs')
vi.mock('@/hooks/useAPI')

type MockQuerySpec<TData> =
  | { data: TData }
  | { data?: undefined; loading: boolean }
  | { error: Error }

/** Builds a useQuery result shaped like the one the graph hooks return. */
const createMockQueryResult = <TData,>(spec: MockQuerySpec<TData>): UseQueryResult<TData, Error> => {
  const base = {
    dataUpdatedAt: 0,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    isEnabled: true,
    isInitialLoading: false,
    isPaused: false,
    isRefetching: false,
    isStale: false,
    refetch: vi.fn(),
  }

  if ('error' in spec) {
    return {
      ...base,
      data: undefined,
      error: spec.error,
      fetchStatus: 'idle',
      isError: true,
      isFetched: true,
      isFetchedAfterMount: true,
      isFetching: false,
      isLoading: false,
      isLoadingError: true,
      isPending: false,
      isPlaceholderData: false,
      isRefetchError: false,
      isSuccess: false,
      status: 'error',
      promise: new Promise<TData>(() => undefined),
    }
  }

  if ('loading' in spec) {
    return {
      ...base,
      data: undefined,
      error: null,
      fetchStatus: spec.loading ? 'fetching' : 'idle',
      isError: false,
      isFetched: false,
      isFetchedAfterMount: false,
      isFetching: spec.loading,
      isLoading: spec.loading,
      isLoadingError: false,
      isPending: true,
      isPlaceholderData: false,
      isRefetchError: false,
      isSuccess: false,
      status: 'pending',
      promise: new Promise<TData>(() => undefined),
    }
  }

  return {
    ...base,
    data: spec.data,
    error: null,
    fetchStatus: 'idle',
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isLoadingError: false,
    isPending: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isSuccess: true,
    status: 'success',
    promise: Promise.resolve(spec.data),
  }
}

/** The version at `index`, which the fixed fixture above guarantees exists. */
const versionAt = (index: number): GraphVersion => {
  const version = mockVersions[index]
  if (!version) {
    throw new Error(`Expected a version at index ${index}`)
  }
  return version
}

const mockActiveGraph: Graph = {
  id: 'graph1',
  name: 'Main Timeline',
  description: 'Primary historical timeline',
  status: 'active',
  // The internal change counter, which runs ahead of Version history. The
  // panel must never show it.
  version: 7,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
  metadata: {
    eventCount: 150,
    arcCount: 12,
    relationshipCount: 75,
    pressureCount: 8
  }
}

const mockVersions: GraphVersion[] = [
  {
    version: 3,
    commitHash: 'abc123',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
    message: 'Added new events for February',
    author: 'user1',
    changes: {
      eventsAdded: 5,
      eventsModified: 2,
      eventsDeleted: 0,
      arcsAdded: 1,
      arcsModified: 0,
      arcsDeleted: 0,
      relationshipsAdded: 3,
      relationshipsModified: 1,
      relationshipsDeleted: 0
    }
  },
  {
    version: 2,
    commitHash: 'def456',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    message: 'Updated arc descriptions',
    author: 'user2',
    changes: {
      eventsAdded: 0,
      eventsModified: 10,
      eventsDeleted: 2,
      arcsAdded: 0,
      arcsModified: 3,
      arcsDeleted: 0,
      relationshipsAdded: 0,
      relationshipsModified: 5,
      relationshipsDeleted: 1
    }
  },
  {
    version: 1,
    commitHash: 'ghi789',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days ago
    message: 'Initial import',
    author: 'user1',
    changes: {
      eventsAdded: 100,
      eventsModified: 0,
      eventsDeleted: 0,
      arcsAdded: 10,
      arcsModified: 0,
      arcsDeleted: 0,
      relationshipsAdded: 50,
      relationshipsModified: 0,
      relationshipsDeleted: 0
    }
  }
]

/** The value useRollbackGraph resolves to. */
type RollbackMutation = ReturnType<typeof useRollbackGraph>

/** An idle rollback mutation, before any overrides are applied. */
const baseRollbackMutation = (): RollbackMutation => ({
  data: undefined,
  error: null,
  failureCount: 0,
  failureReason: null,
  context: undefined,
  isError: false,
  isIdle: true,
  isPaused: false,
  isPending: false,
  isSuccess: false,
  status: 'idle',
  submittedAt: 0,
  variables: undefined,
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ ...mockActiveGraph, restoredAsVersion: 4 }),
  reset: vi.fn()
})

const createMockRollbackMutation = (
  overrides: Partial<RollbackMutation> = {}
): RollbackMutation => Object.assign(baseRollbackMutation(), overrides)


const mockEvents: Event[] = [
  {
    id: 'event_1793660000000_census',
    description: 'Census of 1851',
    actor: 'Registrar General',
    target: 'Britain',
    timestamp: '1851-03-30T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'event_1793660000001_protest',
    description: "Clerks' protest",
    actor: 'Clerks',
    target: 'Calculating Offices',
    timestamp: '1852-06-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
]

const mockRelationships: CausalRelationship[] = [
  {
    id: 'local_1793661234567_abcdef',
    cause_event_id: 'event_1793660000000_census',
    effect_event_id: 'event_1793660000001_protest',
    weight: 0.7,
    evidence: '',
    confidence: 0.8,
    relationship_type: 'direct',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
]

const noChanges: GraphVersion['changes'] = {
  eventsAdded: 0,
  eventsModified: 0,
  eventsDeleted: 0,
  arcsAdded: 0,
  arcsModified: 0,
  arcsDeleted: 0,
  relationshipsAdded: 0,
  relationshipsModified: 0,
  relationshipsDeleted: 0,
}

/** The rows' "Restore version N…" buttons. */
const restoreButtons = () => screen.queryAllByRole('button', { name: /^Restore version \d+…$/ })

describe('VersionHistoryPanel', () => {
  const user = userEvent.setup()
  const mockOnVersionSelect = vi.fn()
  let mockRollbackMutation: ReturnType<typeof createMockRollbackMutation>

  beforeEach(() => {
    mockRollbackMutation = createMockRollbackMutation()

    vi.mocked(useActiveGraphId).mockReturnValue('graph1')
    vi.mocked(useActiveGraph).mockReturnValue(createMockQueryResult({ data: mockActiveGraph }))
    vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({ data: mockVersions }))
    vi.mocked(useGraphHeadVersion).mockReturnValue(3)
    vi.mocked(useRollbackGraph).mockReturnValue(mockRollbackMutation)
    vi.mocked(useEvents).mockReturnValue({ data: mockEvents } as unknown as ReturnType<typeof useEvents>)
    vi.mocked(useArcs).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useArcs>)
    vi.mocked(useCausalRelationships).mockReturnValue(
      { data: mockRelationships } as unknown as ReturnType<typeof useCausalRelationships>
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('No Graph Selected', () => {
    it('should display "No graph selected" when no graph is active', () => {
      vi.mocked(useActiveGraphId).mockReturnValue(null)

      render(<VersionHistoryPanel />)

      expect(screen.getByText('No graph selected')).toBeInTheDocument()
    })
  })

  describe('One version number', () => {
    it('shows the Version-history head, never the graph\'s internal change counter', () => {
      render(<VersionHistoryPanel />)

      // The header badge and the newest row both read v3; v7 (Graph.version)
      // appears nowhere.
      expect(screen.getAllByText('v3')).toHaveLength(2)
      expect(screen.queryByText('v7')).not.toBeInTheDocument()
      expect(useGraphHeadVersion).toHaveBeenCalledWith('graph1', 7)
    })

    it('names the head as the current version in a titled host', () => {
      render(<VersionHistoryPanel hideHeader />)

      const current = screen.getByText(/Current version/)
      expect(current).toHaveTextContent('Current version v3')
      expect(current).not.toHaveTextContent('v7')
    })

    it('marks the head row as current, even when the change counter differs', () => {
      render(<VersionHistoryPanel />)

      const rows = Array.from(document.querySelectorAll('li[data-version]'))
      expect(rows[0]).toHaveAttribute('aria-current', 'true')
      expect(rows[0]).toHaveClass('bg-selected/10')
      expect(rows[1]).not.toHaveAttribute('aria-current')
    })

    it('falls back to the newest listed version while the head is loading', () => {
      vi.mocked(useGraphHeadVersion).mockReturnValue(null)

      render(<VersionHistoryPanel hideHeader />)

      expect(screen.getByText(/Current version/)).toHaveTextContent('Current version v3')
    })
  })

  describe('Panel Header', () => {
    it('should display panel header with version history title', () => {
      render(<VersionHistoryPanel />)

      expect(screen.getByText('Version history')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(<VersionHistoryPanel className="custom-class" />)

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('Collapse/Expand Behavior', () => {
    it('should be expanded by default', () => {
      render(<VersionHistoryPanel />)

      expect(screen.getByText('Added new events for February')).toBeInTheDocument()
    })

    it('should collapse and expand when the header is clicked', async () => {
      render(<VersionHistoryPanel />)

      const header = screen.getByRole('button', { name: /Version history/i })
      await user.click(header)
      expect(screen.queryByText('Added new events for February')).not.toBeInTheDocument()

      await user.click(header)
      expect(screen.getByText('Added new events for February')).toBeInTheDocument()
    })
  })

  describe('Loading, error and empty states', () => {
    it('should display loading spinner when loading', () => {
      vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({ loading: true }))

      render(<VersionHistoryPanel />)

      expect(screen.getByText('Loading history...')).toBeInTheDocument()
      expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('should display error message when loading fails', () => {
      vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({
        error: new Error('Network error'),
      }))

      render(<VersionHistoryPanel />)

      expect(screen.getByText('Failed to load version history')).toBeInTheDocument()
    })

    it('should display empty message when no versions exist', () => {
      vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({ data: [] }))

      render(<VersionHistoryPanel />)

      expect(screen.getByText('No version history available')).toBeInTheDocument()
    })

    it('should display empty message when versions is null', () => {
      vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({ loading: false }))

      render(<VersionHistoryPanel />)

      expect(screen.getByText('No version history available')).toBeInTheDocument()
    })
  })

  describe('Version List Rendering', () => {
    it('should display all versions in the mono face', () => {
      render(<VersionHistoryPanel />)

      expect(screen.getByText('v2')).toHaveClass('font-mono-code')
      expect(screen.getByText('v1')).toBeInTheDocument()
    })

    it('should display version summaries that are already in words', () => {
      render(<VersionHistoryPanel />)

      expect(screen.getByText('Added new events for February')).toBeInTheDocument()
      expect(screen.getByText('Updated arc descriptions')).toBeInTheDocument()
      expect(screen.getByText('Initial import')).toBeInTheDocument()
    })

    it('should display author names and relative timestamps', () => {
      render(<VersionHistoryPanel />)

      expect(screen.getAllByText('user1').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('user2')).toBeInTheDocument()
      expect(screen.getByText('5m ago')).toBeInTheDocument()
      expect(screen.getByText('2h ago')).toBeInTheDocument()
      expect(screen.getByText('3d ago')).toBeInTheDocument()
    })

    it('should show "Current" only on the head', () => {
      render(<VersionHistoryPanel />)

      expect(screen.getAllByText('Current')).toHaveLength(1)
    })

    it('should respect maxVersions prop', () => {
      render(<VersionHistoryPanel maxVersions={2} />)

      expect(useGraphVersions).toHaveBeenCalledWith('graph1', 2)
    })
  })

  describe('Human change summaries', () => {
    const at = (overrides: Partial<GraphVersionWithEntities>): GraphVersionWithEntities => ({
      ...versionAt(1),
      version: 2,
      commitHash: `hash-${overrides.message ?? 'x'}`,
      changes: noChanges,
      ...overrides,
    })

    const renderVersions = (list: GraphVersionWithEntities[]) => {
      vi.mocked(useGraphHeadVersion).mockReturnValue(9)
      vi.mocked(useGraphVersions).mockReturnValue(createMockQueryResult({ data: list }))
      return render(<VersionHistoryPanel />)
    }

    it('rewrites an old id-bearing message into names, and never shows the id', () => {
      const { container } = renderVersions([
        at({
          message: 'create relationship local_1793661234567_abcdef',
          operation: 'create',
          changes: { ...noChanges, relationshipsAdded: 1 },
        }),
        at({ version: 1, message: 'update event event_1793660000000_census', operation: 'update' }),
      ])

      expect(screen.getByText("Added link: “Census of 1851” → “Clerks' protest”")).toBeInTheDocument()
      expect(screen.getByText('Edited event “Census of 1851”')).toBeInTheDocument()
      expect(container.textContent).not.toMatch(/local_|event_/)
    })

    it('describes an entity it cannot name by its kind', () => {
      const { container } = renderVersions([
        at({ message: 'delete event event_1793669999999_gone', operation: 'delete' }),
      ])

      expect(screen.getByText('Deleted an event')).toBeInTheDocument()
      expect(container.textContent).not.toContain('event_1793669999999_gone')
    })

    it('says "Restored version N" and "Merged “X”" for old rollback and merge messages', () => {
      renderVersions([
        at({ message: 'Rollback to version 45', operation: 'rollback' }),
        at({ version: 1, message: 'Merged from Clerks Prevail', operation: 'merge', changes: { ...noChanges, eventsAdded: 2 } }),
      ])

      expect(screen.getByText('Restored version 45')).toBeInTheDocument()
      expect(screen.getByText('Merged “Clerks Prevail”')).toBeInTheDocument()
      expect(screen.getByText('2 events added')).toBeInTheDocument()
    })

    it('shows the server\'s summary when it is already in words', () => {
      renderVersions([at({ message: 'Moved “Battle of Hastings” to Oct 14, 1066', operation: 'update' })])

      expect(screen.getByText('Moved “Battle of Hastings” to Oct 14, 1066')).toBeInTheDocument()
    })

    it('names the one changed entity when a version has no usable text', () => {
      renderVersions([
        at({
          message: '',
          operation: 'create',
          entities: { added: [{ type: 'event', id: 'event_1793660000001_protest' }], modified: [], deleted: [] },
          changes: { ...noChanges, eventsAdded: 1 },
        }),
      ])

      expect(screen.getByText("Added event “Clerks' protest”")).toBeInTheDocument()
      expect(screen.getByText('1 event added')).toBeInTheDocument()
    })

    it('writes the counts in words instead of "R: +1"', () => {
      render(<VersionHistoryPanel />)

      expect(
        screen.getByText('5 events added · 2 events changed · 1 arc added · 3 links added · 1 link changed')
      ).toBeInTheDocument()
      expect(screen.getByText('10 events changed · 2 events deleted · 3 arcs changed · 5 links changed · 1 link deleted'))
        .toBeInTheDocument()
      expect(screen.queryByText(/^[EAR]:/)).not.toBeInTheDocument()
    })
  })

  describe('Restore', () => {
    it('offers a labelled restore on every version but the current one', () => {
      render(<VersionHistoryPanel />)

      expect(restoreButtons().map((b) => b.textContent)).toEqual(['Restore version 2…', 'Restore version 1…'])
    })

    it('states the consequences before restoring', async () => {
      render(<VersionHistoryPanel />)

      await user.click(screen.getByRole('button', { name: 'Restore version 1…' }))

      const dialog = screen.getByRole('dialog', { name: 'Restore version 1?' })
      expect(dialog).toHaveTextContent(
        'Restore “Main Timeline” to version 1? Its content becomes what it was at version 1, saved as a new version 4; versions 2–3 stay in Version history.'
      )
      expect(mockRollbackMutation.mutateAsync).not.toHaveBeenCalled()
    })

    it('uses the singular when one later version stays', async () => {
      render(<VersionHistoryPanel />)

      await user.click(screen.getByRole('button', { name: 'Restore version 2…' }))

      expect(screen.getByRole('dialog', { name: 'Restore version 2?' })).toHaveTextContent(
        'saved as a new version 4; version 3 stays in Version history.'
      )
    })

    it('restores on confirm and reports the number it was really saved as', async () => {
      vi.mocked(useRollbackGraph).mockReturnValue(createMockRollbackMutation({
        mutateAsync: vi.fn().mockResolvedValue({ ...mockActiveGraph, restoredAsVersion: 12 }),
      }))
      render(<VersionHistoryPanel />)

      await user.click(screen.getByRole('button', { name: 'Restore version 2…' }))
      await user.click(screen.getByRole('button', { name: 'Restore version 2' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(vi.mocked(useRollbackGraph).mock.results[0]?.value.mutateAsync).toHaveBeenCalledWith({ id: 'graph1', version: 2 })
      expect(screen.getByRole('status')).toHaveTextContent('Restored version 2. Saved as version 12, now the current version.')
    })

    it('cancels without restoring', async () => {
      render(<VersionHistoryPanel />)

      await user.click(screen.getByRole('button', { name: 'Restore version 2…' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mockRollbackMutation.mutateAsync).not.toHaveBeenCalled()
    })

    it('shows progress and blocks a second restore while one runs', async () => {
      vi.mocked(useRollbackGraph).mockReturnValue(createMockRollbackMutation({ isPending: true }))
      render(<VersionHistoryPanel />)

      await user.click(screen.getByRole('button', { name: 'Restore version 2…' }))

      expect(screen.getByRole('button', { name: 'Restoring…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    })

    it('keeps the dialog open with the reason when the restore fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(useRollbackGraph).mockReturnValue(createMockRollbackMutation({
        mutateAsync: vi.fn().mockRejectedValue(new Error('Version 2 not found')),
      }))
      render(<VersionHistoryPanel />)

      await user.click(screen.getByRole('button', { name: 'Restore version 2…' }))
      await user.click(screen.getByRole('button', { name: 'Restore version 2' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't restore version 2: Version 2 not found. Nothing was changed; try again."
      )
      expect(screen.getByRole('dialog', { name: 'Restore version 2?' })).toBeInTheDocument()
      consoleSpy.mockRestore()
    })
  })

  describe('Version Click Handler', () => {
    it('should call onVersionSelect when version item is clicked', async () => {
      render(<VersionHistoryPanel onVersionSelect={mockOnVersionSelect} />)

      await user.click(screen.getByText('Updated arc descriptions'))

      expect(mockOnVersionSelect).toHaveBeenCalledWith(mockVersions[1])
    })

    it('does not select the version when its restore button is clicked', async () => {
      render(<VersionHistoryPanel onVersionSelect={mockOnVersionSelect} />)

      await user.click(screen.getByRole('button', { name: 'Restore version 2…' }))

      expect(mockOnVersionSelect).not.toHaveBeenCalled()
    })
  })

  describe('hideHeader', () => {
    it('omits its own header when the host already titles the panel', () => {
      render(<VersionHistoryPanel hideHeader />)

      expect(screen.queryByText('Version history')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Version history/i })).not.toBeInTheDocument()
      expect(screen.getByText('Added new events for February')).toBeInTheDocument()
    })

    it('shows the header by default', () => {
      render(<VersionHistoryPanel />)

      expect(screen.getByRole('button', { name: /Version history/i })).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('finding and naming versions', () => {
    it('filters the list by what a version did', async () => {
      const user = userEvent.setup()
      render(<VersionHistoryPanel hideHeader />)
      await user.type(screen.getByRole('searchbox', { name: 'Find a version' }), 'arc descriptions')
      const rows = Array.from(document.querySelectorAll('li[data-version]'))
      expect(rows.map((row) => row.getAttribute('data-version'))).toEqual(['2'])
      await user.clear(screen.getByRole('searchbox', { name: 'Find a version' }))
      await user.type(screen.getByRole('searchbox', { name: 'Find a version' }), 'zzz-nothing')
      expect(screen.getByText(/No version matches/)).toBeInTheDocument()
    })

    it('names a version through the label route', async () => {
      const mutateAsync = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSetVersionLabel).mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<typeof useSetVersionLabel>)
      const user = userEvent.setup()
      render(<VersionHistoryPanel hideHeader />)
      const row = document.querySelector('li[data-version="2"]') as HTMLElement
      await user.click(within(row).getByRole('button', { name: 'Name…' }))
      await user.type(within(row).getByRole('textbox', { name: 'Name version 2' }), 'Before the strike')
      await user.click(within(row).getByRole('button', { name: 'Save name' }))
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ version: 2, label: 'Before the strike' }))
    })

    it('says in the restore confirmation what the restore changes', async () => {
      const user = userEvent.setup()
      render(<VersionHistoryPanel hideHeader />)
      await user.click(screen.getByRole('button', { name: 'Restore version 2…' }))
      const preview = screen.getByRole('list', { name: 'What the restore changes' })
      // Version 3 added 5 events, 1 arc and 3 links: restoring 2 removes them.
      expect(preview).toHaveTextContent(/Removes 5 events, 1 arc, 3 links/)
    })
  })
})
