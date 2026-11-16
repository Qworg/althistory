/**
 * A graph switch the server refuses with 429 must be shown, and must leave the
 * picker where it was (issue #32). This runs the real hooks and the real API
 * client over a fake transport, so the response interceptor, the hook and the
 * picker are all exercised together.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axios from 'axios'
import type { Graph } from '@/types'

function graph(id: string, name: string): Graph {
  return {
    id,
    name,
    status: 'active',
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    metadata: { eventCount: 1, arcCount: 0, relationshipCount: 0, pressureCount: 0 },
  } as Graph
}

const graphs = [graph('g1', 'Main Timeline'), graph('g2', 'Alternative Branch')]

describe('GraphSelector when a switch is refused with 429', () => {
  let activateCalls = 0
  let retryAfterSeconds = 12

  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    localStorage.setItem('active_graph_id', 'g1')
    activateCalls = 0
    retryAfterSeconds = 12

    let onRejected: ((error: unknown) => unknown) | undefined
    const refuse = (url: string, cfg: object = {}) => {
      const error = {
        isAxiosError: true,
        message: 'Request failed with status code 429',
        request: {},
        config: { url, method: 'post', ...cfg },
        response: {
          status: 429,
          data: { error: { message: 'Rate limit exceeded: 60/minute', retryAfter: retryAfterSeconds } },
          headers: { 'retry-after': String(retryAfterSeconds) },
        },
      }
      return onRejected ? onRejected(error) : Promise.reject(error)
    }
    const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } })

    vi.spyOn(axios, 'create').mockReturnValue({
      get: vi.fn((url: string) => {
        if (url === '/graphs/active') return ok(graphs[0])
        if (url === '/graphs/g1') return ok(graphs[0])
        if (url === '/graphs/g2') return ok(graphs[1])
        if (url === '/graphs') return Promise.resolve({ data: { success: true, data: graphs, pagination: { total: 2 } } })
        return ok(null)
      }),
      post: vi.fn((url: string, _data?: unknown, cfg?: object) => {
        if (url.endsWith('/activate')) {
          activateCalls += 1
          return refuse(url, cfg)
        }
        return ok(null)
      }),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn((_ok: unknown, bad: (e: unknown) => unknown) => { onRejected = bad }) },
      },
      defaults: { headers: { common: {} } },
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tells the person, and stays on the old graph', async () => {
    const { GraphSelector } = await import('./GraphSelector')
    const { useGlobalStore } = await import('@/stores/globalStore')
    useGlobalStore.setState({ errors: [] })
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <GraphSelector />
      </QueryClientProvider>
    )

    const button = await screen.findByRole('button', { name: /Main Timeline/ })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await user.click(await screen.findByRole('button', { name: /Alternative Branch/ }))

    // The picker says the switch failed, why, and when to retry.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Couldn.t switch to Alternative Branch/)
    expect(alert).toHaveTextContent(/still on Main Timeline/)
    expect(alert).toHaveTextContent(/Switching graphs was refused/)
    expect(alert).toHaveTextContent(/Try again in 12 seconds/)

    // The alert is the one message: the notification centre never gets a notice
    // for a refused switch (so none flashes up first, or is announced twice).
    const notices = useGlobalStore.getState().errors.filter((e) => /Switching graphs was refused/.test(e.message))
    expect(notices).toHaveLength(0)
    expect(screen.getAllByTestId('retry-countdown')).toHaveLength(1)

    // Nothing half-switched: still on the old graph, locally and in the picker.
    expect(activateCalls).toBe(1)
    expect(localStorage.getItem('active_graph_id')).toBe('g1')
    expect(screen.getByRole('button', { name: /Main Timeline/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switching/ })).not.toBeInTheDocument()
  })

  async function refuseASwitch(sheet = false) {
    const { GraphSelector } = await import('./GraphSelector')
    const { useGlobalStore } = await import('@/stores/globalStore')
    useGlobalStore.setState({ errors: [] })
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <GraphSelector sheet={sheet} />
      </QueryClientProvider>
    )
    const button = await screen.findByRole('button', { name: /Main Timeline/ })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    // On a phone the choices are in a dialog sheet.
    await user.click(await screen.findByRole('button', { name: /Alternative Branch/ }))
    return screen.findByRole('alert')
  }

  it("counts the wait down in the alert (it uses the notice centre's countdown)", async () => {
    await refuseASwitch()
    const text = () => screen.getByTestId('retry-countdown').textContent
    // Under load a second may already have gone by; the shape is what matters.
    const first = text()!
    expect(first).toMatch(/^Try again in (11|12) seconds\.$/)
    const spokenAtFirst = screen.getByTestId('retry-spoken').textContent
    await waitFor(() => expect(text()).not.toBe(first), { timeout: 4000 })
    expect(text()).toMatch(/^Try again in \d+ seconds?\.$/)
    // Hidden from the alert's live region, which still carries the spoken sentence.
    expect(screen.getByTestId('retry-countdown')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('retry-spoken').textContent).toBe(spokenAtFirst)
    expect(spokenAtFirst).toMatch(/^Try again in about (11|12) seconds\.$/)
  })

  it('shows the notice for a refused switch from anywhere else, such as the Graph Manager', async () => {
    const { useGraphManagement } = await import('@/hooks/useGraphs')
    const { NotificationCenter } = await import('@/components/notifications/NotificationCenter')
    const { useGlobalStore } = await import('@/stores/globalStore')
    useGlobalStore.setState({ errors: [] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // What the Graph Manager's "Switch to Graph" runs: the same hook, not quiet.
    function ManagerButton() {
      const { switchGraph } = useGraphManagement()
      return <button onClick={() => switchGraph('g2')}>Switch to Graph</button>
    }
    render(
      <QueryClientProvider client={client}>
        <ManagerButton />
        <NotificationCenter />
      </QueryClientProvider>
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to Graph' }))
    expect(await screen.findByText(/Switching graphs was refused/)).toBeInTheDocument()
    expect(screen.getByTestId('retry-countdown')).toHaveTextContent('Try again in 12 seconds.')
    expect(localStorage.getItem('active_graph_id')).toBe('g1')
  })

  it('shows the notice for a refused switch from a bare useSwitchGraph button', async () => {
    const { useSwitchGraph } = await import('@/hooks/useGraphs')
    const { NotificationCenter } = await import('@/components/notifications/NotificationCenter')
    const { useGlobalStore } = await import('@/stores/globalStore')
    useGlobalStore.setState({ errors: [] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function OpenButton() {
      const { mutate } = useSwitchGraph()
      return <button onClick={() => mutate('g2')}>Open</button>
    }
    render(
      <QueryClientProvider client={client}>
        <OpenButton />
        <NotificationCenter />
      </QueryClientProvider>
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText(/Switching graphs was refused/)).toBeInTheDocument()
    expect(screen.getByTestId('retry-countdown')).toHaveTextContent('Try again in 12 seconds.')
  })

  it('hides the alert once the graph it could not open is the open one', async () => {
    await refuseASwitch()
    // A switch made elsewhere (the Graph Manager, another tab) lands on g2.
    act(() => {
      localStorage.setItem('active_graph_id', 'g2')
      window.dispatchEvent(new CustomEvent('graph-switched', { detail: { graphId: 'g2' } }))
    })
    await waitFor(() => expect(screen.queryByTestId('graph-switch-error')).not.toBeInTheDocument())
  })

  it('does not bring a stale alert back after the person returns to the original graph', async () => {
    await refuseASwitch()
    const go = (id: string) =>
      act(() => {
        localStorage.setItem('active_graph_id', id)
        window.dispatchEvent(new CustomEvent('graph-switched', { detail: { graphId: id } }))
      })
    go('g2')
    await waitFor(() => expect(screen.queryByTestId('graph-switch-error')).not.toBeInTheDocument())
    go('g1')
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByTestId('graph-switch-error')).not.toBeInTheDocument()
  })

  it('takes the alert away once the wait it named has passed', async () => {
    retryAfterSeconds = 1
    await refuseASwitch()
    // 1 s wait plus the 3 s grace the notices use.
    await waitFor(() => expect(screen.queryByTestId('graph-switch-error')).not.toBeInTheDocument(), { timeout: 6000 })
  }, 10000)

  it('on a phone the alert sits below the header', async () => {
    const alert = await refuseASwitch(true)
    // Under the header height Header.tsx publishes, not a guessed number.
    expect(alert.className).toContain('var(--app-header-h')
    const { useGlobalStore } = await import('@/stores/globalStore')
    expect(useGlobalStore.getState().errors.filter((e) => /Switching graphs/.test(e.message))).toHaveLength(0)
  })

  it("pins the alert to the screen with a gutter on a phone, not to the selector's edge", async () => {
    const alert = await refuseASwitch(true)
    expect(alert.className).toContain('fixed')
    expect(alert.className).toContain('inset-x-4')
    expect(alert.className).not.toContain('w-80')
  })
})
