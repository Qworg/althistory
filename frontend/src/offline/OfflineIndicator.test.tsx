import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useGlobalStore } from '@/stores/globalStore'
import { OfflineIndicator } from './OfflineIndicator'

describe('OfflineIndicator', () => {
  beforeEach(() => {
    useGlobalStore.setState({ isOnline: true, pendingMutationCount: 0 })
  })

  it('renders nothing while online with no queued work', () => {
    render(<OfflineIndicator />)
    expect(screen.queryByTestId('offline-indicator')).not.toBeInTheDocument()
  })

  it('reflects connectivity and queue changes', () => {
    render(<OfflineIndicator />)

    act(() => {
      useGlobalStore.getState().setOnline(false)
    })
    expect(screen.getByTestId('offline-indicator')).toHaveTextContent('Offline')

    act(() => {
      useGlobalStore.getState().setPendingMutationCount(2)
    })
    expect(screen.getByTestId('offline-indicator')).toHaveTextContent('2 changes queued')

    act(() => {
      useGlobalStore.getState().setOnline(true)
    })
    expect(screen.getByTestId('offline-indicator')).toHaveTextContent('Syncing 2 queued changes')

    act(() => {
      useGlobalStore.getState().setPendingMutationCount(0)
    })
    expect(screen.queryByTestId('offline-indicator')).not.toBeInTheDocument()
  })
})
