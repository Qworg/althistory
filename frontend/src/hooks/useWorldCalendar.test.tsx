import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { memo, useRef, type ReactNode } from 'react'
import { useWorldCalendarSync } from './useWorldCalendar'
import { graphKeys } from './useGraphs'
import { apiClient } from '@/services/api'
import { useWorldCalendarStore } from '@/stores/worldCalendarStore'
import { WorldCalendarBoundary } from '@/components/layout/WorldCalendarBoundary'
import { formatHistoricalDate } from '@/utils/historicalTime'
import type { Graph, GraphCalendar } from '@/types'
import { legacyCalendarSet } from '@althistory/calendar'

vi.mock('@/services/api', () => ({
  apiClient: { graphs: { getById: vi.fn() } },
}))

const getById = vi.mocked(apiClient.graphs.getById)

const AR: GraphCalendar = legacyCalendarSet({ epochYear: 1000, eraLabel: 'AR' })

const graph = (id: string, calendar?: GraphCalendar) =>
  ({ id, name: id, metadata: { eventCount: 0 }, ...(calendar ? { calendar } : {}) }) as unknown as Graph

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const activeCalendar = () => useWorldCalendarStore.getState().calendar

function switchTo(id: string | null) {
  if (id) localStorage.setItem('active_graph_id', id)
  else localStorage.removeItem('active_graph_id')
  window.dispatchEvent(new CustomEvent('graph-switched', { detail: { graphId: id } }))
}

describe('useWorldCalendarSync', () => {
  beforeEach(() => {
    localStorage.clear()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    getById.mockReset()
    getById.mockImplementation(async (id: string) => {
      if (id === 'vael') return graph('vael', AR)
      if (id === 'earth') return graph('earth')
      throw new Error('not found')
    })
    useWorldCalendarStore.getState().setCalendar(null)
  })

  afterEach(() => {
    useWorldCalendarStore.getState().setCalendar(null)
  })

  it("takes the selected graph's calendar", async () => {
    localStorage.setItem('active_graph_id', 'vael')
    renderHook(() => useWorldCalendarSync(), { wrapper })
    await waitFor(() => expect(activeCalendar()).toEqual(AR))
  })

  it('follows a switch to a graph without one, and back', async () => {
    localStorage.setItem('active_graph_id', 'vael')
    renderHook(() => useWorldCalendarSync(), { wrapper })
    await waitFor(() => expect(activeCalendar()).toEqual(AR))

    act(() => switchTo('earth'))
    await waitFor(() => expect(activeCalendar()).toBeNull())

    act(() => switchTo('vael'))
    await waitFor(() => expect(activeCalendar()).toEqual(AR))

    act(() => switchTo(null))
    await waitFor(() => expect(activeCalendar()).toBeNull())
  })

  it('follows an edit to the open graph (the update writes the detail query)', async () => {
    localStorage.setItem('active_graph_id', 'earth')
    renderHook(() => useWorldCalendarSync(), { wrapper })
    await waitFor(() => expect(getById).toHaveBeenCalledWith('earth'))
    expect(activeCalendar()).toBeNull()

    act(() => client.setQueryData(graphKeys.detail('earth'), graph('earth', legacyCalendarSet({ epochYear: 1200, eraLabel: 'NE' }))))
    await waitFor(() => expect(activeCalendar()).toEqual(legacyCalendarSet({ epochYear: 1200, eraLabel: 'NE' })))

    // Removing it (PUT with calendar: null) returns the graph without one.
    act(() => client.setQueryData(graphKeys.detail('earth'), graph('earth')))
    await waitFor(() => expect(activeCalendar()).toBeNull())
  })

  it('keeps the calendar, and the views mounted, when a background refetch fails', async () => {
    localStorage.setItem('active_graph_id', 'vael')
    const mounts = vi.fn()
    function View() {
      const counted = useRef(false)
      if (!counted.current) {
        counted.current = true
        mounts()
      }
      return null
    }
    function App() {
      useWorldCalendarSync()
      return (
        <WorldCalendarBoundary>
          <View />
        </WorldCalendarBoundary>
      )
    }
    render(<App />, { wrapper })
    await waitFor(() => expect(activeCalendar()).toEqual(AR))
    const mountsBefore = mounts.mock.calls.length

    getById.mockRejectedValue(Object.assign(new Error('Service unavailable'), { status: 503 }))
    await act(async () => {
      await client.refetchQueries({ queryKey: graphKeys.detail('vael') })
    })
    expect(client.getQueryState(graphKeys.detail('vael'))?.status).toBe('error')
    expect(activeCalendar()).toEqual(AR)
    expect(mounts.mock.calls.length).toBe(mountsBefore)
  })

  it('drops the calendar when a refetch finds the graph gone (404)', async () => {
    localStorage.setItem('active_graph_id', 'vael')
    renderHook(() => useWorldCalendarSync(), { wrapper })
    await waitFor(() => expect(activeCalendar()).toEqual(AR))

    getById.mockRejectedValue(Object.assign(new Error('Graph not found'), { status: 404 }))
    await act(async () => {
      await client.refetchQueries({ queryKey: graphKeys.detail('vael') })
    })
    await waitFor(() => expect(activeCalendar()).toBeNull())
  })

  it('has no calendar for a graph that cannot be loaded', async () => {
    useWorldCalendarStore.getState().setCalendar(AR)
    localStorage.setItem('active_graph_id', 'missing')
    renderHook(() => useWorldCalendarSync(), { wrapper })
    await waitFor(() => expect(activeCalendar()).toBeNull())
  })
})

describe('WorldCalendarBoundary', () => {
  afterEach(() => {
    useWorldCalendarStore.getState().setCalendar(null)
  })

  it('re-renders memoised dates under it when the calendar changes', () => {
    const mounts = vi.fn()
    // Memoised and prop-less: only a remount can make it format again.
    const Dated = memo(function Dated() {
      const counted = useRef(false)
      if (!counted.current) {
        counted.current = true
        mounts()
      }
      return <p>{formatHistoricalDate('1311-03-04T00:00:00Z', 'en-US')}</p>
    })

    render(
      <WorldCalendarBoundary>
        <Dated />
      </WorldCalendarBoundary>
    )
    expect(screen.getByText('Mar 4, 1311')).toBeInTheDocument()

    act(() => useWorldCalendarStore.getState().setCalendar(AR))
    expect(screen.getByText('Mar 4, 312 AR')).toBeInTheDocument()
    expect(mounts).toHaveBeenCalledTimes(2)

    // The same calendar again (a refetch) does not remount.
    act(() => useWorldCalendarStore.getState().setCalendar({ ...AR }))
    expect(mounts).toHaveBeenCalledTimes(2)

    act(() => useWorldCalendarStore.getState().setCalendar(null))
    expect(screen.getByText('Mar 4, 1311')).toBeInTheDocument()
  })
})
