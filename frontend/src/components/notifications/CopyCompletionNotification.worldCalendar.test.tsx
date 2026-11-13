import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { CopyCompletionNotification } from './CopyCompletionNotification'
import { ImportValidationStep } from '@/components/import/ImportValidationStep'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import type { CopyOperation, ImportValidationResult } from '@/types'
import { legacyCalendarSet } from '@althistory/calendar'

const AR = legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' })

const copy = (sourceCalendar?: CopyOperation['sourceCalendar']): CopyOperation => ({
  id: 'copy-1',
  name: 'Vael (copy)',
  type: 'time_range',
  status: 'completed',
  progress: 100,
  created_at: '2026-11-11T10:00:00Z',
  completed_at: '2026-11-11T10:00:01Z',
  parameters: {
    timeRange: { start: new Date('1311-03-04T00:00:00Z'), end: new Date('1320-01-01T00:00:00Z') },
  },
  ...(sourceCalendar !== undefined ? { sourceCalendar } : {}),
})

afterEach(() => useWorldCalendarStore.getState().setCalendar(null))

describe('copy notice in world calendars', () => {
  it("shows the range in the copied graph's calendar, whichever graph is open", () => {
    render(<CopyCompletionNotification operation={copy(AR)} onDismiss={vi.fn()} autoHideDelay={0} />)
    expect(screen.getByText(/Range: Mar 4, 312 AR - Jan 1, 321 AR/)).toBeInTheDocument()
  })

  it('shows a copy of a Gregorian graph in stored years with a world open', () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    render(<CopyCompletionNotification operation={copy(null)} onDismiss={vi.fn()} autoHideDelay={0} />)
    expect(screen.getByText(/Range: Mar 4, 1311 - Jan 1, 1320/)).toBeInTheDocument()
  })

  it("falls back to the open graph's calendar for a copy recorded without one, and follows it", () => {
    render(<CopyCompletionNotification operation={copy()} onDismiss={vi.fn()} autoHideDelay={0} />)
    expect(screen.getByText(/Range: Mar 4, 1311/)).toBeInTheDocument()
    act(() => useWorldCalendarStore.getState().setCalendar(AR))
    expect(screen.getByText(/Range: Mar 4, 312 AR/)).toBeInTheDocument()
  })
})

describe('import preview in world calendars', () => {
  const validation: ImportValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    summary: {
      eventCount: 1,
      arcCount: 0,
      relationshipCount: 0,
      pressureCount: 0,
      crossRefCount: 0,
      actors: [],
      temporalRange: { start: '1311-03-04T00:00:00Z', end: '1320-01-01T00:00:00Z' },
    },
  }

  it("shows the incoming file's range in its own calendar", () => {
    render(<ImportValidationStep validation={validation} onContinue={vi.fn()} onBack={vi.fn()} calendar={AR} />)
    expect(screen.getByText(/Mar 4, 312 AR -/)).toBeInTheDocument()
  })

  it('shows a file without a calendar in stored years, even with a world open', () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    render(<ImportValidationStep validation={validation} onContinue={vi.fn()} onBack={vi.fn()} calendar={null} />)
    expect(screen.getByText(/Mar 4, 1311 -/)).toBeInTheDocument()
    expect(screen.queryByText(/AR/)).not.toBeInTheDocument()
  })
})
