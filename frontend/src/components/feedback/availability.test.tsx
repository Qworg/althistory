import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, act } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { APIError } from '@/services/api'

const api = vi.hoisted(() => ({ getConfig: vi.fn(), submit: vi.fn() }))
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, apiClient: { ...actual.apiClient, feedback: api } }
})
vi.mock('./screenshot', () => ({ captureScreenshot: vi.fn(async () => { throw new Error('not in this test') }) }))

import { FeedbackHost } from './FeedbackHost'
import { FeedbackButton } from './FeedbackButton'
import { useFeedbackStore } from './feedbackStore'
import { HelpDialog } from '@/components/help/HelpDialog'
import { useHelpStore } from '@/components/help/helpStore'

function App() {
  return (
    <>
      <FeedbackHost />
      <FeedbackButton />
      <HelpDialog />
    </>
  )
}

beforeEach(() => {
  useFeedbackStore.setState({ phase: 'closed', available: false })
  api.getConfig.mockReset()
})

afterEach(() => {
  act(() => useHelpStore.getState().closeHelp())
  vi.unstubAllEnvs()
})

describe('turning feedback off', () => {
  it('with FEEDBACK_ENABLED=false on the server: no button, no Help link, and Shift+I does nothing', async () => {
    api.getConfig.mockResolvedValue({ enabled: false, serverFiling: false, repo: null })
    renderWithProviders(<App />)
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled())
    await act(async () => undefined)

    expect(screen.queryByRole('button', { name: /Send feedback/ })).not.toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'I', shiftKey: true })
    await act(async () => undefined)
    expect(useFeedbackStore.getState().phase).toBe('closed')

    act(() => useHelpStore.getState().openHelp())
    expect(await screen.findByRole('dialog', { name: 'Help & reference' })).toBeInTheDocument()
    expect(screen.queryByText(/Found a problem, or have an idea/)).not.toBeInTheDocument()
  })

  it('shows nothing until the server has said, so a private install that turned it off never flashes it', async () => {
    api.getConfig.mockReturnValue(new Promise(() => undefined))
    renderWithProviders(<App />)
    await act(async () => undefined)
    expect(screen.queryByRole('button', { name: /Send feedback/ })).not.toBeInTheDocument()
    expect(useFeedbackStore.getState().available).toBe(false)
  })

  it('offers it when the server says it is on', async () => {
    api.getConfig.mockResolvedValue({ enabled: true, serverFiling: false, repo: 'o/r' })
    renderWithProviders(<App />)
    expect(await screen.findByRole('button', { name: /Send feedback/ })).toBeInTheDocument()
  })

  it('offers it when the server is older than feedback (404): GitHub’s form needs no server', async () => {
    api.getConfig.mockRejectedValue(new APIError('Not found', 404, 'NOT_FOUND'))
    renderWithProviders(<App />)
    expect(await screen.findByRole('button', { name: /Send feedback/ })).toBeInTheDocument()
  })

  it.each([
    ['a 502 while the API restarts', new APIError('Bad Gateway', 502)],
    ['a proxy’s 403', new APIError('Forbidden', 403)],
    ['no connection', new APIError('Network error - please check your connection', 0, 'NETWORK_ERROR')],
  ])('fails closed on %s: the operator may have turned it off', async (_name, error) => {
    api.getConfig.mockRejectedValue(error)
    renderWithProviders(<App />)
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(screen.queryByRole('button', { name: /Send feedback/ })).not.toBeInTheDocument()
    expect(useFeedbackStore.getState().available).toBe(false)
  })

  it('stops offering it, and closes, when a report finds the server has turned it off since', async () => {
    api.getConfig.mockResolvedValue({ enabled: true, serverFiling: true, repo: 'o/r' })
    api.submit.mockRejectedValue(new APIError('Feedback is turned off on this server.', 404, 'FEEDBACK_DISABLED'))
    renderWithProviders(<App />)
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(true))
    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'x' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(useFeedbackStore.getState().phase).toBe('closed'))
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(false))
    expect(screen.queryByRole('button', { name: /Send feedback/ })).not.toBeInTheDocument()
  })

  it('leaves Shift+I alone, and does not list it in Help, where feedback is off', async () => {
    api.getConfig.mockResolvedValue({ enabled: false, serverFiling: false, repo: null })
    renderWithProviders(<App />)
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled())
    const key = new KeyboardEvent('keydown', { key: 'I', shiftKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(false)
    act(() => useHelpStore.getState().openHelp('shortcuts'))
    await screen.findByRole('dialog', { name: 'Help & reference' })
    expect(screen.queryByText('Send feedback: report a problem or suggest an idea')).not.toBeInTheDocument()
  })

  it('with VITE_FEEDBACK_ENABLED=false at build time: never offered, and no error is recorded', async () => {
    vi.stubEnv('VITE_FEEDBACK_ENABLED', 'false')
    vi.resetModules()
    const availability = await import('./availability')
    expect(availability.FEEDBACK_BUILT_IN).toBe(false)
    expect(availability.feedbackAvailable({ data: { enabled: true, serverFiling: true, repo: 'o/r' }, error: null } as never)).toBe(false)
    const diagnostics = await import('./diagnostics')
    diagnostics.recordApiFailure({ method: 'get', url: '/events', status: 500 })
    diagnostics.recordBoundaryError(new Error('boom'))
    expect(diagnostics.recentDiagnostics()).toEqual([])
  })

  it.each([
    [undefined, true],
    ['', true],
    ['true', true],
    ['YES', true],
    ['1', true],
    ['on', true],
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['no', false],
    ['off', false],
    ['disabled', false],
  ])('reads VITE_FEEDBACK_ENABLED=%s as the server reads FEEDBACK_ENABLED', async (value, on) => {
    const { readSwitch } = await import('./buildFlag')
    expect(readSwitch(value)).toBe(on)
  })
})
