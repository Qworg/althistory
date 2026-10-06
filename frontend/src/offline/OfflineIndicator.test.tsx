import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useGlobalStore } from '@/stores/globalStore'
import { OfflineIndicator } from './OfflineIndicator'

describe('OfflineIndicator', () => {
  beforeEach(() => {
    useGlobalStore.setState({ isOnline: true, pendingMutationCount: 0, syncInProgress: false })
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
    // The count is of writes actually in the queue, and the text does not claim
    // more than that.
    expect(screen.getByTestId('offline-indicator')).toHaveTextContent(
      '2 changes saved on this device, not yet sent',
    )

    act(() => {
      useGlobalStore.getState().setOnline(true)
    })
    // Online but no pass running: the indicator must not claim to be syncing.
    expect(screen.getByTestId('offline-indicator')).toHaveTextContent(
      '2 queued changes — waiting to sync',
    )

    act(() => {
      useGlobalStore.getState().setSyncInProgress(true)
    })
    expect(screen.getByTestId('offline-indicator')).toHaveTextContent('Syncing 2 queued changes')

    act(() => {
      useGlobalStore.getState().setPendingMutationCount(0)
    })
    expect(screen.queryByTestId('offline-indicator')).not.toBeInTheDocument()
  })

  it('claims nothing about saved changes when the queue is empty', () => {
    useGlobalStore.setState({ isOnline: false, pendingMutationCount: 0 })
    render(<OfflineIndicator />)

    const indicator = screen.getByTestId('offline-indicator')
    expect(indicator).toHaveTextContent('Offline')
    expect(indicator).not.toHaveTextContent('saved on this device')
  })
})
