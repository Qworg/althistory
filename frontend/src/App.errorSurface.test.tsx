import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { renderWithProviders, screen } from '@/test/utils'
import { useGlobalStore } from '@/stores/globalStore'
import App from './App'

describe('App error surface wiring', () => {
  beforeEach(() => {
    useGlobalStore.setState({ errors: [], loadingOperations: new Set<string>() })
  })

  afterEach(() => {
    useGlobalStore.setState({ errors: [], loadingOperations: new Set<string>() })
  })

  it('mounts the notification surface and shows a store error raised by a failing operation', () => {
    renderWithProviders(<App />, { withRouter: false })

    expect(screen.getByLabelText('Notifications')).toBeInTheDocument()

    act(() => {
      // Mirrors what an API failure handler does via `addError`.
      useGlobalStore.getState().addError({
        message: 'Request to /api/events failed',
        type: 'network',
      })
    })

    expect(screen.getByText('Request to /api/events failed')).toBeInTheDocument()
  })
})
