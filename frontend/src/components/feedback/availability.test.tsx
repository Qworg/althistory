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
      <main id="main-view" tabIndex={-1} />
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

  it('says a report was not sent, with the text to keep, when the server has turned feedback off since', async () => {
    api.getConfig.mockResolvedValue({ enabled: true, serverFiling: true, repo: 'o/r' })
    api.submit.mockRejectedValue(new APIError('Feedback is turned off on this server.', 404, 'FEEDBACK_DISABLED'))
    renderWithProviders(<App />)
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(true))
    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Kept title' } })
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Kept words' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Send report' }))

    expect(await screen.findByText('Your report was not sent.')).toBeInTheDocument()
    expect((screen.getByLabelText('What you wrote') as HTMLTextAreaElement).value).toBe('Kept title\n\nKept words')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    // Not offered any more in this tab.
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(useFeedbackStore.getState().phase).toBe('closed')
    expect(screen.queryByRole('button', { name: /Send feedback/ })).not.toBeInTheDocument()
  })

  it('a tab open since before feedback was turned off learns it when feedback is next opened', async () => {
    api.getConfig.mockResolvedValueOnce({ enabled: true, serverFiling: false, repo: 'o/r' })
    renderWithProviders(<App />)
    expect(await screen.findByRole('button', { name: /Send feedback/ })).toBeInTheDocument()

    // The operator turns it off; this tab still has the old answer.
    api.getConfig.mockResolvedValue({ enabled: false, serverFiling: false, repo: null })
    fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Send feedback/ })).not.toBeInTheDocument())
    await waitFor(() => expect(useFeedbackStore.getState().phase).toBe('closed'))
    expect(screen.queryByRole('dialog', { name: 'Send feedback' })).not.toBeInTheDocument()
  })

  it('keeps the earlier answer when the server cannot be asked again as feedback opens', async () => {
    api.getConfig.mockResolvedValueOnce({ enabled: true, serverFiling: false, repo: 'o/r' })
    renderWithProviders(<App />)
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(true))
    api.getConfig.mockRejectedValue(new APIError('Bad Gateway', 502))
    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    expect(await screen.findByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument()
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

describe('the recheck, after the sixth review', () => {
  beforeEach(() => {
    useFeedbackStore.setState({ phase: 'closed', available: false, notice: null })
    api.getConfig.mockReset()
  })

  it('captures the page as it was asked for, not after a slow answer', async () => {
    api.getConfig.mockResolvedValueOnce({ enabled: true, serverFiling: false, repo: 'o/r' })
    renderWithProviders(<App />)
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(true))
    // The recheck never answers.
    api.getConfig.mockReturnValue(new Promise(() => undefined))
    window.history.pushState({}, '', '/timeline')
    const opening = useFeedbackStore.getState().openFeedback()
    await waitFor(() => expect(useFeedbackStore.getState().phase).toBe('capturing'))
    // The reporter moves on while the server is slow.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)))
    window.history.pushState({}, '', '/causal-graph')
    await act(async () => {
      await opening
    })
    expect(useFeedbackStore.getState().phase).toBe('open')
    expect(useFeedbackStore.getState().context?.page.route).toBe('/timeline')
    window.history.pushState({}, '', '/')
  })

  it('a failed recheck does not undo a 404 that offered feedback', async () => {
    api.getConfig.mockRejectedValueOnce(new APIError('Not found', 404, 'NOT_FOUND'))
    renderWithProviders(<App />)
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(true))
    api.getConfig.mockRejectedValue(new APIError('Bad Gateway', 502))
    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    expect(useFeedbackStore.getState().phase).toBe('open')
    expect(useFeedbackStore.getState().available).toBe(true)
  })

  it('says so when the recheck finds feedback turned off', async () => {
    api.getConfig.mockResolvedValueOnce({ enabled: true, serverFiling: false, repo: 'o/r' })
    renderWithProviders(<App />)
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(true))
    api.getConfig.mockResolvedValue({ enabled: false, serverFiling: false, repo: null })
    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    expect(useFeedbackStore.getState().phase).toBe('closed')
    expect(await screen.findByText('Feedback has been turned off on this server.')).toBeInTheDocument()
  })
})

describe('after the seventh review', () => {
  beforeEach(() => {
    useFeedbackStore.setState({ phase: 'closed', available: false, notice: null })
    api.getConfig.mockReset()
  })

  it('a refetch that fails after a 404 keeps feedback offered (the server stays older)', async () => {
    const { focusManager } = await import('@tanstack/react-query')
    api.getConfig.mockRejectedValueOnce(new APIError('Not found', 404, 'NOT_FOUND'))
    renderWithProviders(<App />)
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(true))
    api.getConfig.mockRejectedValue(new APIError('Bad Gateway', 502))
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(api.getConfig).toHaveBeenCalledTimes(2))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(useFeedbackStore.getState().available).toBe(true)
    act(() => focusManager.setFocused(undefined))
  })

  it('moves focus to the view when the button it was on goes because feedback was turned off', async () => {
    api.getConfig.mockResolvedValueOnce({ enabled: true, serverFiling: false, repo: 'o/r' })
    renderWithProviders(<App />)
    const button = await screen.findByRole('button', { name: /Send feedback/ })
    button.focus()
    api.getConfig.mockResolvedValue({ enabled: false, serverFiling: false, repo: null })
    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    await screen.findByText('Feedback has been turned off on this server.')
    await waitFor(() => expect(document.activeElement?.id).toBe('main-view'))
  })

  it('does not move focus on load', async () => {
    api.getConfig.mockResolvedValue({ enabled: true, serverFiling: false, repo: 'o/r' })
    renderWithProviders(<App />)
    await screen.findByRole('button', { name: /Send feedback/ })
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))))
    expect(document.activeElement).toBe(document.body)
  })
})
