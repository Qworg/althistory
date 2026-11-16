import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { EditHistoryEntry } from './useEditHistory'
import type { CausalRelationship, Event } from '@/types'

const deleteEvent = vi.fn()
const createEvent = vi.fn()
const createLink = vi.fn()

vi.mock('@/hooks/useAPI', () => ({
  useDeleteEvent: () => ({ mutateAsync: deleteEvent }),
  useCreateEvent: () => ({ mutateAsync: createEvent }),
  useCreateCausalLink: () => ({ mutateAsync: createLink }),
}))

import { useUndoableEventDelete } from './useUndoableEventDelete'
import { useGlobalStore } from '@/stores/globalStore'

/** The notices on screen, from the real store. */
const messages = () => useGlobalStore.getState().errors.map((e) => e.message)

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
    useGlobalStore.setState({ errors: [], events: [] })
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
    expect(messages().some((m) => /1 of its causal links/.test(m))).toBe(true)
  })

  const busy = () =>
    Object.assign(new Error('Saving the link was refused because too many requests were sent. Try again shortly.'), {
      status: 429,
      refusal: 'Saving the link was refused because too many requests were sent.',
    })

  it('stops at the first refusal, keeps the entry for another undo, and names what is missing', async () => {
    useGlobalStore.setState({
      events: [
        { ...event, id: 'e2', description: 'Lovelace publishes the Notes' },
        { ...event, id: 'e3', description: 'Bank of England opens' },
      ],
    })
    createLink.mockRejectedValue(busy())
    const record = vi.fn<(entry: EditHistoryEntry) => void>()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    await act(() => result.current(event, [link('l1', 'e1', 'e2'), link('l2', 'e1', 'e3'), link('l3', 'e0', 'e1')]))
    // Unfinished: false keeps the entry on the undo stack.
    await expect(record.mock.calls[0]![0].undo()).resolves.toBe(false)
    expect(createLink).toHaveBeenCalledTimes(1)
    const notices = messages()
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('is back, but 3 of its causal links weren\'t restored yet because the server is busy')
    expect(notices[0]).toContain('"Lovelace publishes the Notes"')
    expect(notices[0]).toContain('"Bank of England opens"')
    expect(notices[0]).toContain('and 1 more')
    expect(notices[0]).toContain('Press Undo again')
    expect(notices[0]).not.toContain('no longer exists')
    expect(notices[0]).not.toContain('was refused because too many requests')
  })

  it('the next undo restores only the links still missing, then completes and clears the notice', async () => {
    createLink.mockResolvedValueOnce({}).mockRejectedValueOnce(busy())
    const record = vi.fn<(entry: EditHistoryEntry) => void>()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    await act(() => result.current(event, [link('l1', 'e1', 'e2'), link('l2', 'e1', 'e3'), link('l3', 'e0', 'e1')]))
    const entry = record.mock.calls[0]![0]
    await expect(entry.undo()).resolves.toBe(false)
    expect(createEvent).toHaveBeenCalledTimes(1)
    expect(createLink).toHaveBeenCalledTimes(2)
    expect(messages()).toHaveLength(1)

    createLink.mockReset().mockResolvedValue({})
    await expect(entry.undo()).resolves.toBe(true)
    // The event is not created twice, and only the two missing links are sent,
    // against the restored event's id.
    expect(createEvent).toHaveBeenCalledTimes(1)
    expect(createLink).toHaveBeenCalledTimes(2)
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ causeId: 'e1-restored', effectId: 'e3' }))
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ causeId: 'e0', effectId: 'e1-restored' }))
    expect(messages()).toHaveLength(0)
    // Redo removes the restored copy; undoing again starts from the snapshot.
    await expect(entry.redo()).resolves.toBe(true)
    expect(deleteEvent).toHaveBeenLastCalledWith('e1-restored')
    createEvent.mockClear()
    await expect(entry.undo()).resolves.toBe(true)
    expect(createEvent).toHaveBeenCalledTimes(1)
  })

  it('does not stack an identical lasting notice when undo is pressed again during one wait', async () => {
    createLink.mockRejectedValue(busy())
    const record = vi.fn<(entry: EditHistoryEntry) => void>()
    const { result } = renderHook(() => useUndoableEventDelete(record))
    await act(() => result.current(event, [link('l1', 'e1', 'e2')]))
    const entry = record.mock.calls[0]![0]
    await entry.undo()
    await entry.undo()
    await entry.undo()
    expect(messages()).toHaveLength(1)
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
    const all = messages()
    expect(all).toHaveLength(2)
    expect(all[0]).toContain('"Babbage completes the Engine" could not be restored: the server is busy')
    expect(all[1]).toContain('"Second event" could not be restored')
    for (const m of all) {
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
    const message = messages()[0]!
    expect(message).toContain('could not be restored: disk full. It is still')
    expect(message).not.toContain('..')
  })
})
