import { screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BranchMergeModal } from './BranchMergeModal'
import { renderWithProviders } from '@/test/utils'
import { apiClient } from '@/services/api'
import type { Graph, MergeConflict } from '@/types'

vi.mock('@/services/api', () => ({
  apiClient: {
    graphs: {
      mergeDetailed: vi.fn(),
    },
  },
}))

const mergeDetailedMock = vi.mocked(apiClient.graphs.mergeDetailed)

const conflict: MergeConflict = {
  entityType: 'event',
  entityId: 'e1',
  targetVersion: {
    id: 'e1',
    description: 'Target version of the landing',
    actor: 'Allied Command',
    target: 'Normandy',
  },
  sourceVersion: {
    id: 'e1',
    description: 'Source version of the landing',
    actor: 'Allied Command',
    target: 'Normandy',
  },
  suggestedResolution: 'keep-target',
}

const secondConflict: MergeConflict = {
  entityType: 'arc',
  entityId: 'a1',
  targetVersion: { id: 'a1', name: 'Baseline arc' },
  sourceVersion: { id: 'a1', name: 'Branch arc' },
  suggestedResolution: 'keep-target',
}

function makeGraph(): Graph {
  return {
    id: 'graph-1',
    name: 'Prime Timeline',
    status: 'active',
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    metadata: { eventCount: 2, arcCount: 1, relationshipCount: 0, pressureCount: 0 },
  }
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  targetGraphId: 'graph-1',
  targetGraphName: 'Prime Timeline',
  sourceGraphId: 'graph-2',
  sourceGraphName: 'Halifax Branch',
}

describe('BranchMergeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when closed', () => {
    renderWithProviders(<BranchMergeModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Merge Branch')).not.toBeInTheDocument()
  })

  it('previews conflicts in a dry run and requires a resolution for each', async () => {
    mergeDetailedMock.mockResolvedValueOnce({
      success: false,
      conflicts: [conflict, secondConflict],
      dryRun: true,
    })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))

    await screen.findByTestId('merge-conflict-event:e1')
    expect(screen.getByTestId('merge-conflict-arc:a1')).toBeInTheDocument()
    expect(screen.getByText(/2 conflicts to resolve/)).toBeInTheDocument()
    expect(screen.getByText(/Differs on: description/)).toBeInTheDocument()

    // Unresolved conflicts cannot be committed.
    expect(screen.getByRole('button', { name: 'Commit Resolutions' })).toBeDisabled()

    expect(mergeDetailedMock).toHaveBeenCalledWith('graph-1', {
      sourceGraphId: 'graph-2',
      conflictResolution: 'manual',
      dryRun: true,
    })
  })

  it('commits the selected resolutions keyed as the API expects', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: false, conflicts: [conflict, secondConflict], dryRun: true })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 2 })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByRole('button', { name: 'Keep all baseline' }))
    const commitButton = screen.getByRole('button', { name: 'Commit Resolutions' })
    await waitFor(() => expect(commitButton).toBeEnabled())
    fireEvent.click(commitButton)

    await screen.findByText('Merge complete')
    expect(mergeDetailedMock).toHaveBeenLastCalledWith('graph-1', {
      sourceGraphId: 'graph-2',
      conflictResolution: 'manual',
      manualResolutions: {
        'event:e1': 'keep-target',
        'arc:a1': 'keep-target',
      },
    })
  })

  it('records the per-conflict side the user picked', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: false, conflicts: [conflict], dryRun: true })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 2 })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByLabelText('Accept counterfactual'))
    fireEvent.click(screen.getByRole('button', { name: 'Commit Resolutions' }))

    await screen.findByText('Merge complete')
    expect(mergeDetailedMock).toHaveBeenLastCalledWith('graph-1', {
      sourceGraphId: 'graph-2',
      conflictResolution: 'manual',
      manualResolutions: { 'event:e1': 'keep-source' },
    })
  })

  it('offers a fast-forward commit when the dry run finds no conflicts', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: true, dryRun: true, graph: makeGraph() })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 2 })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))

    await screen.findByText('Fast-forward merge')
    fireEvent.click(screen.getByRole('button', { name: 'Merge Branch' }))

    await screen.findByText('Merge complete')
    expect(mergeDetailedMock).toHaveBeenLastCalledWith('graph-1', {
      sourceGraphId: 'graph-2',
      conflictResolution: 'manual',
      manualResolutions: {},
    })
  })

  it('surfaces an analysis failure instead of staying in the spinner', async () => {
    mergeDetailedMock.mockRejectedValueOnce(new Error('graph not found'))
    renderWithProviders(<BranchMergeModal {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('graph not found')
    expect(screen.getByRole('button', { name: 'Analyze Merge' })).toBeInTheDocument()
  })
})
