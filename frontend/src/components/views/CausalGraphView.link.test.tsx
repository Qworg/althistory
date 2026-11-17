import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CausalGraphView } from '@/components/views/CausalGraphView'
import { useEvents, useCausalRelationships, useDeleteCausalLink, useUpdateCausalLink } from '@/hooks/useAPI'
import { apiClient } from '@/services/api'
import type { Event, CausalRelationship } from '@/types'
import type { CausalGraphComponentProps } from '@/components/causal-graph'

const updateMutate = vi.fn().mockResolvedValue({})
const deleteMutate = vi.fn().mockResolvedValue(undefined)
vi.mock('@/hooks/useAPI', () => ({
  useEvents: vi.fn(),
  useCausalRelationships: vi.fn(),
  useDeleteCausalLink: vi.fn(),
  useUpdateCausalLink: vi.fn(),
  useDeleteEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateEvent: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))
vi.mock('@/services/api')
vi.mock('@/components/causal-graph', () => ({
  CausalGraphComponent: ({ causalRelationships, onRelationshipContextMenu }: CausalGraphComponentProps) => (
    <div>
      {causalRelationships?.map((r) => (
        <button key={r.id} data-testid={`ctx-${r.id}`} onClick={() => onRelationshipContextMenu?.(r, { x: 1, y: 1 })}>menu</button>
      ))}
    </div>
  ),
}))

const events: Event[] = [
  { id: 'e1', description: 'One', actor: 'A', target: 'B', timestamp: '2023-01-01T00:00:00.000Z', created_at: '', updated_at: '' },
  { id: 'e2', description: 'Two', actor: 'A', target: 'B', timestamp: '2023-01-02T00:00:00.000Z', created_at: '', updated_at: '' },
] as Event[]
// Two links on one pair: the oldest (link_old) and the one the user picks (link_new).
const rels: CausalRelationship[] = [
  { id: 'link_old', cause_event_id: 'e1', effect_event_id: 'e2', weight: 0.5, confidence: 0.5, relationship_type: 'direct', evidence: 'OLD', created_at: '', updated_at: '' },
  { id: 'link_new', cause_event_id: 'e1', effect_event_id: 'e2', weight: 0.9, confidence: 0.9, relationship_type: 'direct', evidence: 'NEW', created_at: '', updated_at: '' },
] as CausalRelationship[]

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><CausalGraphView /></QueryClientProvider>)
}

describe('Causal graph view acts on the link the user picked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useEvents).mockReturnValue({ data: events, isLoading: false, error: null } as never)
    vi.mocked(useCausalRelationships).mockReturnValue({ data: rels, isLoading: false, error: null } as never)
    vi.mocked(useUpdateCausalLink).mockReturnValue({ mutateAsync: updateMutate, isPending: false } as never)
    vi.mocked(useDeleteCausalLink).mockReturnValue({ mutateAsync: deleteMutate, isPending: false } as never)
    vi.mocked(apiClient.causal.updateLink).mockResolvedValue({ ...rels[1]!, evidence: 'NEW, revised' })
    vi.mocked(apiClient.causal.deleteLink).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('edits the picked link with one request, by its id, and sends no second one by the pair', async () => {
    renderView()
    fireEvent.click(screen.getByTestId('ctx-link_new'))
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(await screen.findByText('Save Changes'))
    await waitFor(() => expect(apiClient.causal.updateLink).toHaveBeenCalledTimes(1))
    expect(apiClient.causal.updateLink).toHaveBeenCalledWith('e1', 'e2', expect.objectContaining({ evidence: 'NEW' }), 'link_new')
    // The view only refreshes: its own mutation would PUT by the pair and hit the oldest link.
    await waitFor(() => expect(screen.queryByText('Save Changes')).not.toBeInTheDocument())
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('deletes the picked link with one request, by its id, and sends no second one by the pair', async () => {
    renderView()
    fireEvent.click(screen.getByTestId('ctx-link_new'))
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(await screen.findByText('Delete Relationship'))
    await waitFor(() => expect(apiClient.causal.deleteLink).toHaveBeenCalledTimes(1))
    expect(apiClient.causal.deleteLink).toHaveBeenCalledWith('e1', 'e2', 'link_new')
    await waitFor(() => expect(screen.queryByText('Delete Relationship')).not.toBeInTheDocument())
    expect(deleteMutate).not.toHaveBeenCalled()
  })

  it('deletes from the context menu by the link id', async () => {
    renderView()
    fireEvent.click(screen.getByTestId('ctx-link_new'))
    fireEvent.click(screen.getByText('Delete'))
    const buttons = await screen.findAllByRole('button', { name: 'Delete' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledTimes(1))
    expect(deleteMutate).toHaveBeenCalledWith({ causeEventId: 'e1', effectEventId: 'e2', linkId: 'link_new' })
    expect(apiClient.causal.deleteLink).not.toHaveBeenCalled()
  })
})
