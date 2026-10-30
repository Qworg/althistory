import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StreamingStatusBadge } from './StreamingStatusBadge'

describe('StreamingStatusBadge', () => {
  it('renders offline state correctly', () => {
    const onConnect = vi.fn()
    render(<StreamingStatusBadge status="disconnected" onConnect={onConnect} />)

    expect(screen.getByText('Streaming Offline')).toBeInTheDocument()
    const connectButton = screen.getByText('Connect')
    expect(connectButton).toBeInTheDocument()

    fireEvent.click(connectButton)
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('renders connecting state correctly', () => {
    render(<StreamingStatusBadge status="connecting" />)
    expect(screen.getByText('Streaming Connecting...')).toBeInTheDocument()
  })

  it('renders connected state with stats and disconnect action', () => {
    const onDisconnect = vi.fn()
    render(
      <StreamingStatusBadge
        status="connected"
        stats={{ sent: 10, acked: 8, failed: 2 }}
        onDisconnect={onDisconnect}
      />
    )

    expect(screen.getByText('Streaming Connected')).toBeInTheDocument()
    expect(screen.getByText('8/10')).toBeInTheDocument()

    const disconnectBtn = screen.getByText('Disconnect')
    fireEvent.click(disconnectBtn)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('renders error state correctly', () => {
    render(<StreamingStatusBadge status="error" error="Network refused" />)
    expect(screen.getByText('Streaming Error')).toBeInTheDocument()
    expect(screen.getByText('Network refused')).toBeInTheDocument()
  })
})
