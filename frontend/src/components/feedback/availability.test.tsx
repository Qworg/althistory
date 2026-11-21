import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, act } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'

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

  it('offers it when the server says it is on, or cannot say (GitHub’s form needs no server)', async () => {
    api.getConfig.mockResolvedValue({ enabled: true, serverFiling: false, repo: 'o/r' })
    const { unmount } = renderWithProviders(<App />)
    expect(await screen.findByRole('button', { name: /Send feedback/ })).toBeInTheDocument()
    unmount()

    api.getConfig.mockRejectedValue(new Error('Network error'))
    renderWithProviders(<App />)
    expect(await screen.findByRole('button', { name: /Send feedback/ })).toBeInTheDocument()
  })

  it('with VITE_FEEDBACK_ENABLED=false at build time: never offered, whatever the server says', async () => {
    vi.stubEnv('VITE_FEEDBACK_ENABLED', 'false')
    vi.resetModules()
    const availability = await import('./availability')
    expect(availability.FEEDBACK_BUILT_IN).toBe(false)
    expect(
      availability.feedbackAvailable({ isError: false, data: { enabled: true, serverFiling: true, repo: 'o/r' } } as never)
    ).toBe(false)
  })
})
