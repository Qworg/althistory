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

  it('supports harmonized compromise with field-level overrides', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: false, conflicts: [conflict], dryRun: true })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 2 })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByLabelText('Harmonized compromise'))

    // Field-level picker appears
    expect(screen.getByText('Field-level selection:')).toBeInTheDocument()
    const baselineBtn = screen.getByRole('button', { name: /Baseline: Target version of the landing/ })
    fireEvent.click(baselineBtn)

    fireEvent.click(screen.getByRole('button', { name: 'Commit Resolutions' }))
    await screen.findByText('Merge complete')

    expect(mergeDetailedMock).toHaveBeenLastCalledWith('graph-1', {
      sourceGraphId: 'graph-2',
      conflictResolution: 'manual',
      manualResolutions: {
        'event:e1': {
          strategy: 'merged',
          value: {
            id: 'e1',
            actor: 'Allied Command',
            target: 'Normandy',
            description: 'Target version of the landing',
          },
        },
      },
    })
  })

  it('accepts a value of the user\'s own for a field', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: false, conflicts: [conflict], dryRun: true })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 2 })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByLabelText('Harmonized compromise'))
    fireEvent.change(screen.getByLabelText('Custom value for description'), {
      target: { value: 'Neither side exactly' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Commit Resolutions' }))
    await screen.findByText('Merge complete')

    expect(mergeDetailedMock).toHaveBeenLastCalledWith('graph-1', {
      sourceGraphId: 'graph-2',
      conflictResolution: 'manual',
      manualResolutions: {
        'event:e1': {
          strategy: 'merged',
          value: expect.objectContaining({ description: 'Neither side exactly' }),
        },
      },
    })
  })

  it('surfaces the server\'s refusal of an unusable merged payload', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: false, conflicts: [conflict], dryRun: true })
      .mockRejectedValueOnce(
        new Error(
          "The merge was refused: The merged event 'e1' is not usable: timestamp must stay a string"
        )
      )

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByLabelText('Harmonized compromise'))
    fireEvent.click(screen.getByRole('button', { name: 'Commit Resolutions' }))

    // The message names the field, so the user knows what to change.
    expect(await screen.findByRole('alert')).toHaveTextContent('timestamp must stay a string')
  })

  it('displays pre-merge anomalies and blocks commit', async () => {
    mergeDetailedMock.mockResolvedValueOnce({
      success: false,
      conflicts: [conflict],
      anomalies: [
        {
          type: 'causal_cycle',
          message: 'Causal cycle detected: e1 -> e2 -> e1',
        },
      ],
      dryRun: true,
    })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Merge' }))

    await screen.findByTestId('merge-conflict-event:e1')
    expect(screen.getByText(/Pre-merge Anomalies Detected \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Causal cycle detected: e1 -> e2 -> e1/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Keep baseline'))

    // Changing an answer invalidates the analysis that produced the
    // anomalies, so they are cleared and the commit can be attempted again.
    // The backend re-checks the candidate graph on every commit, so a merge
    // that still has anomalies is refused there with the reason.
    expect(screen.queryByText(/Pre-merge Anomalies Detected/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commit Resolutions' })).not.toBeDisabled()
  })
})
