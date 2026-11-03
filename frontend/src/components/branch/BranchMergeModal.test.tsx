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
      getVersions: vi.fn(),
      rollback: vi.fn(),
    },
  },
}))

const mergeDetailedMock = vi.mocked(apiClient.graphs.mergeDetailed)
const getVersionsMock = vi.mocked(apiClient.graphs.getVersions)
const rollbackMock = vi.mocked(apiClient.graphs.rollback)

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
    getVersionsMock.mockResolvedValue([])
  })

  it('does not render when closed', () => {
    renderWithProviders(<BranchMergeModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Merge branch')).not.toBeInTheDocument()
  })

  it('previews conflicts in a dry run and requires a resolution for each', async () => {
    mergeDetailedMock.mockResolvedValueOnce({
      success: false,
      conflicts: [conflict, secondConflict],
      dryRun: true,
    })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))

    await screen.findByTestId('merge-conflict-event:e1')
    expect(screen.getByTestId('merge-conflict-arc:a1')).toBeInTheDocument()
    expect(screen.getByText(/2 differences to resolve/)).toBeInTheDocument()
    expect(screen.getByText(/Differs on: description/)).toBeInTheDocument()

    // Unresolved conflicts cannot be committed.
    expect(screen.getByRole('button', { name: 'Merge branch' })).toBeDisabled()

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
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByRole('button', { name: 'Keep baseline for all' }))
    const commitButton = screen.getByRole('button', { name: 'Merge branch' })
    await waitFor(() => expect(commitButton).toBeEnabled())
    fireEvent.click(commitButton)

    await screen.findByRole('heading', { name: 'Merged' })
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
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByLabelText('Use branch'))
    fireEvent.click(screen.getByRole('button', { name: 'Merge branch' }))

    await screen.findByRole('heading', { name: 'Merged' })
    expect(mergeDetailedMock).toHaveBeenLastCalledWith('graph-1', {
      sourceGraphId: 'graph-2',
      conflictResolution: 'manual',
      manualResolutions: { 'event:e1': 'keep-source' },
    })
  })

  it('merges straight away when the preview finds no differences', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: true, dryRun: true, graph: makeGraph() })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 2 })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))

    await screen.findByTestId('merge-summary')
    fireEvent.click(screen.getByRole('button', { name: 'Merge branch' }))

    await screen.findByRole('heading', { name: 'Merged' })
    expect(mergeDetailedMock).toHaveBeenLastCalledWith('graph-1', {
      sourceGraphId: 'graph-2',
      conflictResolution: 'manual',
      manualResolutions: {},
    })
  })

  it('states the consequences in plain terms, with real counts and versions', async () => {
    getVersionsMock.mockResolvedValueOnce([
      {
        version: 47,
        commitHash: 'abc',
        timestamp: '2026-01-01T00:00:00Z',
        message: 'edit',
        changes: {
          eventsAdded: 0, eventsModified: 0, eventsDeleted: 0,
          arcsAdded: 0, arcsModified: 0, arcsDeleted: 0,
          relationshipsAdded: 0, relationshipsModified: 0, relationshipsDeleted: 0,
        },
      },
    ])
    mergeDetailedMock.mockResolvedValueOnce({ success: true, dryRun: true, graph: makeGraph() })

    renderWithProviders(
      <BranchMergeModal
        {...defaultProps}
        targetGraphName="The Engine Age"
        sourceGraphName="Clerks Prevail"
        targetData={{
          events: [{ id: 'e1' }],
          arcs: [{ id: 'a1' }],
          relationships: [{ id: 'r1' }],
        }}
        sourceData={{
          events: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
          arcs: [{ id: 'a1' }, { id: 'a2' }],
          relationships: [{ id: 'r1' }],
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))

    const summary = await screen.findByTestId('merge-summary')
    expect(summary).toHaveTextContent(
      'Merging adds 2 events and 1 arc from “Clerks Prevail” into “The Engine Age”.'
    )
    expect(summary).toHaveTextContent('Nothing in “The Engine Age” is deleted.')
    expect(summary).toHaveTextContent(
      'This creates version 48; version 47 stays in Version history and can be restored.'
    )
    expect(getVersionsMock).toHaveBeenCalledWith('graph-1', 1)

    // Nothing to pick, so no conflict instructions or controls.
    expect(screen.queryByText(/to resolve/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Keep baseline')).not.toBeInTheDocument()
    expect(screen.queryByText(/Fast-forward/i)).not.toBeInTheDocument()
  })

  it('says how many records differ when there are conflicts', async () => {
    mergeDetailedMock.mockResolvedValueOnce({ success: false, conflicts: [conflict, secondConflict], dryRun: true })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))

    const summary = await screen.findByTestId('merge-summary')
    expect(summary).toHaveTextContent('2 records exist in both and differ; choose below which version to keep.')
    // Without a readable head version the copy does not invent numbers.
    expect(summary).toHaveTextContent('This creates a new version; the current one stays in Version history')
  })

  it('restores the version the merge replaced, after confirming', async () => {
    const onRestored = vi.fn()
    mergeDetailedMock
      .mockResolvedValueOnce({ success: true, dryRun: true, graph: makeGraph() })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 48 })
    // A rollback commits a new version (49) with version 47's content
    rollbackMock.mockResolvedValueOnce({ ...makeGraph(), restoredAsVersion: 49 })

    renderWithProviders(<BranchMergeModal {...defaultProps} onRestored={onRestored} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))
    await screen.findByTestId('merge-summary')
    fireEvent.click(screen.getByRole('button', { name: 'Merge branch' }))

    expect(await screen.findByTestId('merge-outcome')).toHaveTextContent(
      '“Prime Timeline” is now at version 48.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Restore version 47' }))
    // Asking is not restoring.
    expect(rollbackMock).not.toHaveBeenCalled()
    expect(screen.getByText(/Restore “Prime Timeline” to version 47\? This undoes the merge/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, restore version 47' }))

    await screen.findByRole('heading', { name: 'Merge undone' })
    expect(screen.getByRole('status')).toHaveTextContent(
      '“Prime Timeline” has the content of version 47 again, saved as version 49. The merged version 48 is still in Version history'
    )
    expect(rollbackMock).toHaveBeenCalledWith('graph-1', 47)
    expect(onRestored).toHaveBeenCalledWith(47)
  })

  it('keeps the merge when the restore is cancelled', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: true, dryRun: true, graph: makeGraph() })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 48 })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))
    await screen.findByTestId('merge-summary')
    fireEvent.click(screen.getByRole('button', { name: 'Merge branch' }))
    await screen.findByTestId('merge-outcome')

    fireEvent.click(screen.getByRole('button', { name: 'Restore version 47' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep the merge' }))

    expect(rollbackMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Restore version 47' })).toBeInTheDocument()
  })

  it('reports a failed restore and lets the user try again', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: true, dryRun: true, graph: makeGraph() })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 48 })
    rollbackMock.mockRejectedValueOnce(new Error('version not found'))

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))
    await screen.findByTestId('merge-summary')
    fireEvent.click(screen.getByRole('button', { name: 'Merge branch' }))
    await screen.findByTestId('merge-outcome')
    fireEvent.click(screen.getByRole('button', { name: 'Restore version 47' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, restore version 47' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not restore version 47: version not found')
    expect(screen.getByRole('button', { name: 'Yes, restore version 47' })).toBeEnabled()
  })

  it('is a labelled modal dialog that closes on Escape', () => {
    const onClose = vi.fn()
    renderWithProviders(<BranchMergeModal {...defaultProps} onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: 'Merge branch' })).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('surfaces an analysis failure instead of staying in the spinner', async () => {
    mergeDetailedMock.mockRejectedValueOnce(new Error('graph not found'))
    renderWithProviders(<BranchMergeModal {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('graph not found')
    expect(screen.getByRole('button', { name: 'Preview merge' })).toBeInTheDocument()
  })

  it('supports harmonized compromise with field-level overrides', async () => {
    mergeDetailedMock
      .mockResolvedValueOnce({ success: false, conflicts: [conflict], dryRun: true })
      .mockResolvedValueOnce({ success: true, graph: makeGraph(), newVersion: 2 })

    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByLabelText('Combine fields'))

    // Field-level picker appears
    expect(screen.getByRole('heading', { name: 'Choose each field' })).toBeInTheDocument()
    const baselineBtn = screen.getByRole('button', { name: /Baseline: Target version of the landing/ })
    fireEvent.click(baselineBtn)

    fireEvent.click(screen.getByRole('button', { name: 'Merge branch' }))
    await screen.findByRole('heading', { name: 'Merged' })

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
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByLabelText('Combine fields'))
    fireEvent.change(screen.getByLabelText('Custom value for description'), {
      target: { value: 'Neither side exactly' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Merge branch' }))
    await screen.findByRole('heading', { name: 'Merged' })

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
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))
    await screen.findByTestId('merge-conflict-event:e1')

    fireEvent.click(screen.getByLabelText('Combine fields'))
    fireEvent.click(screen.getByRole('button', { name: 'Merge branch' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))

    await screen.findByTestId('merge-conflict-event:e1')
    expect(screen.getByText(/This merge would leave the history inconsistent \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Causal cycle detected: e1 -> e2 -> e1/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Keep baseline'))

    // Changing an answer invalidates the analysis that produced the
    // anomalies, so they are cleared and the commit can be attempted again.
    // The backend re-checks the candidate graph on every commit, so a merge
    // that still has anomalies is refused there with the reason.
    expect(screen.queryByText(/This merge would leave the history inconsistent/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge branch' })).not.toBeDisabled()
  })

  it('reflows for a phone-width sheet: conflicts as one list, footer stacked with the primary last', async () => {
    mergeDetailedMock.mockResolvedValueOnce({ success: false, conflicts: [conflict, secondConflict], dryRun: true })
    renderWithProviders(<BranchMergeModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview merge' }))

    // Each difference is an item of one rule-separated list, not a card.
    const first = await screen.findByTestId('merge-conflict-event:e1')
    expect(first.tagName).toBe('LI')
    expect(first.parentElement).toBe(screen.getByTestId('merge-conflict-arc:a1').parentElement)
    expect(first.className).not.toContain('border')

    const merge = screen.getByRole('button', { name: 'Merge branch' })
    expect(merge.parentElement?.className).toContain('flex-col')
    expect(merge.parentElement?.lastElementChild).toBe(merge)

    // A field's custom value fills the sheet's width below sm.
    fireEvent.click(screen.getAllByLabelText('Combine fields')[0]!)
    expect(screen.getByLabelText('Custom value for description').className).toContain('w-full')
  })
})
