import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCreateEventWithCause } from './useCreateEventWithCause'
import * as api from './useAPI'

vi.mock('./useAPI')

const data = { description: 'New', actor: 'A', target: 'B', timestamp: '1866-06-01T00:00:00.000Z' }

describe('useCreateEventWithCause', () => {
  const createEvent = vi.fn()
  const createLink = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    createEvent.mockResolvedValue({ delivery: 'sent', value: { id: 'new-event' } })
    createLink.mockResolvedValue({})
    vi.mocked(api.useCreateEvent).mockReturnValue({ mutateAsync: createEvent } as unknown as ReturnType<typeof api.useCreateEvent>)
    vi.mocked(api.useCreateCausalLink).mockReturnValue({ mutateAsync: createLink } as unknown as ReturnType<typeof api.useCreateCausalLink>)
  })

  it('sends the evidence the form gave, trimmed, with the link', async () => {
    const { result } = renderHook(() => useCreateEventWithCause())
    await result.current(data, { cause: { eventId: 'e1', type: 'direct', evidence: '  The treaty cut its supply ' } })
    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        causeId: 'e1',
        effectId: 'new-event',
        relationship: expect.objectContaining({ evidence: 'The treaty cut its supply' }),
      })
    )
  })

  it('does not create the event when its cause has no evidence', async () => {
    const { result } = renderHook(() => useCreateEventWithCause())
    await expect(result.current(data, { cause: { eventId: 'e1', type: 'direct', evidence: '   ' } })).rejects.toThrow(/evidence is required/i)
    expect(createEvent).not.toHaveBeenCalled()
    expect(createLink).not.toHaveBeenCalled()
  })

  it('makes an event with no cause and no link', async () => {
    const { result } = renderHook(() => useCreateEventWithCause())
    await expect(result.current(data)).resolves.toMatchObject({ status: 'created', linked: false })
    expect(createLink).not.toHaveBeenCalled()
  })
})
