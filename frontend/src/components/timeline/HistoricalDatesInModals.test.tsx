/**
 * Historical dates in the arc and event dialogs are UTC, like everywhere else
 * (see utils/historicalTime.ts).
 *
 * They were formatted with toLocaleString(), and the time fields read and
 * wrote the browser's zone. West of Greenwich a date stored as its UTC midnight
 * showed as the evening before -- and before standard time, browsers apply
 * local mean time, so 1843-11-20T00:00Z read "11/19/1843, 4:07:02 PM" in Los
 * Angeles and lost its odd seconds on a round trip through the field.
 *
 * The suite pins a western zone for the formatting it checks, whatever the
 * machine's own.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ArcCreationModal from './ArcCreationModal'
import EventArcAssignment from './EventArcAssignment'
import ArcDetailPanel from '@/components/modals/ArcDetailPanel'
import { EventDetailModal } from '@/components/modals/EventDetailModal'
import type { Arc, Event } from '@/types'

const mutateAsync = vi.fn()
vi.mock('@/hooks/useAPI', () => ({
  useCreateArc: () => ({ mutateAsync, isPending: false }),
}))

const engine: Event = {
  id: 'e1',
  description: 'Babbage completes the Engine',
  actor: 'Babbage',
  target: 'Treasury',
  timestamp: '1843-11-20T00:00:00.000Z',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
}

const era: Arc = {
  id: 'a1',
  name: 'Building the Engine',
  description: '',
  start_time: '1840-01-01T00:00:00.000Z',
  end_time: '1850-01-01T00:00:00.000Z',
  level: 0,
  parent_arc_id: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
}

beforeAll(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

function expectUtcDate(container: HTMLElement) {
  expect(container).toHaveTextContent('Nov 20, 1843')
  expect(container).not.toHaveTextContent('Nov 19, 1843')
  expect(container).not.toHaveTextContent('11/19/1843')
}

describe('historical dates in the arc and event dialogs', () => {
  it('EventArcAssignment shows the event date in UTC', () => {
    const { container } = render(
      <EventArcAssignment event={engine} availableArcs={[era]} onAssign={vi.fn()} onCancel={vi.fn()} />
    )
    expectUtcDate(container)
  })

  it('ArcDetailPanel lists contained events with UTC dates and edits its range in UTC', () => {
    render(
      <ArcDetailPanel arc={era} isOpen onClose={vi.fn()} onSave={vi.fn()} containedEvents={[engine]} />
    )
    expectUtcDate(screen.getByText('Babbage completes the Engine').parentElement!)
    expect(screen.getByLabelText(/start time/i)).toHaveValue('1840-01-01T00:00')
    expect(screen.getByLabelText(/end time/i)).toHaveValue('1850-01-01T00:00')
    expect(screen.getByText('Time Range').parentElement).toHaveTextContent('(UTC)')
  })

  it('ArcDetailPanel judges contained events against the UTC range it shows', async () => {
    // An event exactly on the arc's start is inside it. Read in the
    // browser's zone, the field put the start eight hours later and the
    // panel refused its own unchanged range.
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onTheStart = { ...engine, timestamp: era.start_time }
    render(
      <ArcDetailPanel
        arc={{ ...era, description: 'The Engine is built' }}
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        containedEvents={[onTheStart]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ start_time: era.start_time, end_time: era.end_time })
      )
    )
    expect(screen.queryByText(/would be outside the new time range/)).not.toBeInTheDocument()
  })

  it('ArcCreationModal shows the selected range and contained events in UTC', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ArcCreationModal
          isOpen
          onClose={vi.fn()}
          timeRange={{ start: new Date('1843-11-20T00:00:00.000Z'), end: new Date('1844-01-01T00:00:00.000Z') }}
          containedEvents={[engine]}
          parentArcs={[]}
        />
      </QueryClientProvider>
    )
    const range = screen.getByText('Selected Time Range').parentElement!
    expect(range).toHaveTextContent('Start: Nov 20, 1843')
    expect(range).toHaveTextContent('End: Jan 1, 1844')
    expect(screen.getByLabelText(/start time/i)).toHaveValue('1843-11-20T00:00')
    expectUtcDate(screen.getByText('Babbage completes the Engine').parentElement!)
  })

  it('ArcCreationModal saves the range it showed, to the second', async () => {
    mutateAsync.mockResolvedValue(era)
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ArcCreationModal
          isOpen
          onClose={vi.fn()}
          timeRange={{ start: new Date('1843-11-20T00:00:00.000Z'), end: new Date('1844-01-01T00:00:00.000Z') }}
          containedEvents={[]}
          parentArcs={[]}
        />
      </QueryClientProvider>
    )
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'The Engine' } })
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Its construction' } })
    fireEvent.submit(screen.getByLabelText(/^name/i).closest('form')!)

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          start_time: '1843-11-20T00:00:00.000Z',
          end_time: '1844-01-01T00:00:00.000Z',
        })
      )
    )
  })

  it('EventDetailModal edits the timestamp as UTC and saves it unshifted', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EventDetailModal event={engine} isOpen onClose={vi.fn()} onSave={onSave} />)

    const field = screen.getByLabelText(/^date/i)
    expect(field).toHaveValue('1843-11-20')
    expect(field.closest('div')?.parentElement).toHaveTextContent('(UTC)')

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ timestamp: '1843-11-20T00:00:00.000Z' }))
    )
  })
})
