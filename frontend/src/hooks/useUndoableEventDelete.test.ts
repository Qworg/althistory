import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { EditHistoryEntry } from './useEditHistory'
import type { CausalRelationship, Event } from '@/types'

const deleteEvent = vi.fn()
const createEvent = vi.fn()
const createLink = vi.fn()
const addError = vi.fn()

vi.mock('@/hooks/useAPI', () => ({
  useDeleteEvent: () => ({ mutateAsync: deleteEvent }),
  useCreateEvent: () => ({ mutateAsync: createEvent }),
  useCreateCausalLink: () => ({ mutateAsync: createLink }),
}))
vi.mock('@/stores/globalStore', () => ({
  useGlobalStore: (select: (state: { addError: typeof addError }) => unknown) => select({ addError }),
}))

import { useUndoableEventDelete } from './useUndoableEventDelete'

const event: Event = {
  id: 'e1',
  description: 'Babbage completes the Engine',
  actor: 'Charles Babbage',
  target: 'Royal Society',
  timestamp: '1843-11-20T00:00:00.000Z',
  created_at: '',
  updated_at: '',
  metadata: { arcId: 'arc1', confidence: 0.9 },
}

const link = (id: string, cause: string, effect: string): CausalRelationship => ({
  id,
  cause_event_id: cause,
  effect_event_id: effect,
  weight: 0.8,
  evidence: 'e',
  confidence: 0.7,
  relationship_type: 'direct',
  created_at: '',
  updated_at: '',
})

describe('useUndoableEventDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteEvent.mockResolvedValue({ delivery: 'sent', value: undefined })
    createEvent.mockResolvedValue({ delivery: 'sent', value: { ...event, id: 'e1-restored' } })
    createLink.mockResolvedValue({})
  })

  it('records a delete that undo rebuilds, links and arc included, and redo removes again', async () => {
    const record = vi.fn<(entry: EditHistoryEntry) => void>()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    const links = [link('l1', 'e0', 'e1'), link('l2', 'e1', 'e2'), link('l3', 'e8', 'e9')]

    await act(() => result.current(event, links))
    expect(deleteEvent).toHaveBeenCalledWith('e1')
    const entry = record.mock.calls[0]![0]
    expect(entry.description).toBe('deleted "Babbage completes the Engine" and its 2 causal links')

    await expect(entry.undo()).resolves.toBe(true)
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { arcId: 'arc1', confidence: 0.9 } }))
    expect(createLink).toHaveBeenCalledTimes(2)
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ causeId: 'e0', effectId: 'e1-restored' }))
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ causeId: 'e1-restored', effectId: 'e2' }))

    await expect(entry.redo()).resolves.toBe(true)
    expect(deleteEvent).toHaveBeenLastCalledWith('e1-restored')
  })

  it('records nothing for a delete queued offline', async () => {
    deleteEvent.mockResolvedValue({ delivery: 'queued', mutation: {} })
    const record = vi.fn()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    await act(() => result.current(event, []))
    expect(record).not.toHaveBeenCalled()
  })

  it('says which links could not come back when their other end is gone', async () => {
    createLink.mockRejectedValueOnce(new Error('not found'))
    const record = vi.fn<(entry: EditHistoryEntry) => void>()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    await act(() => result.current(event, [link('l1', 'e0', 'e1')]))
    await expect(record.mock.calls[0]![0].undo()).resolves.toBe(true)
    expect(addError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/1 of its causal links/) }))
  })

  it('reports a link the server refused as a refusal, not as a missing event', async () => {
    const busy = Object.assign(new Error('Saving the link was refused because too many requests were sent. Try again shortly.'), {
      status: 429,
      refusal: 'Saving the link was refused because too many requests were sent.',
    })
    createLink.mockRejectedValue(busy)
    const record = vi.fn<(entry: EditHistoryEntry) => void>()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    await act(() => result.current(event, [link('l1', 'e0', 'e1'), link('l2', 'e1', 'e2'), link('l3', 'e1', 'e3')]))
    await expect(record.mock.calls[0]![0].undo()).resolves.toBe(true)
    // After the first refusal no more links are sent; the rest count as refused.
    expect(createLink).toHaveBeenCalledTimes(1)
    const messages = addError.mock.calls.map((c) => (c[0] as { message: string }).message)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('3 of its causal links were not restored because the server is busy')
    expect(messages[0]).not.toContain('no longer exists')
    // Its own words, not the retry notice's sentence.
    expect(messages[0]).not.toContain('was refused because too many requests')
  })

  it('gives each failed restore its own notice, in its own words, with no doubled stop', async () => {
    createEvent.mockRejectedValue(
      Object.assign(new Error('Saving the event was refused because too many requests were sent. Try again shortly.'), {
        status: 429,
        refusal: 'x',
      }),
    )
    const record = vi.fn<(entry: EditHistoryEntry) => void>()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    await act(() => result.current(event, []))
    await act(() => result.current({ ...event, id: 'e2', description: 'Second event' }, []))
    await record.mock.calls[0]![0].undo()
    await record.mock.calls[1]![0].undo()
    const messages = addError.mock.calls.map((c) => (c[0] as { message: string }).message)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain('"Babbage completes the Engine" could not be restored: the server is busy')
    expect(messages[1]).toContain('"Second event" could not be restored')
    for (const m of messages) {
      expect(m).toContain('It is still in Version history.')
      expect(m).not.toContain('..')
    }
  })

  it('has no doubled stop when the restore fails for another reason', async () => {
    createEvent.mockRejectedValue(new Error('disk full.'))
    const record = vi.fn<(entry: EditHistoryEntry) => void>()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    await act(() => result.current(event, []))
    await record.mock.calls[0]![0].undo()
    const message = (addError.mock.calls[0]![0] as { message: string }).message
    expect(message).toContain('could not be restored: disk full. It is still')
    expect(message).not.toContain('..')
  })
})
