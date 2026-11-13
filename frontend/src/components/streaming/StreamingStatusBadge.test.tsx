import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StreamingStatusBadge } from './StreamingStatusBadge'

describe('StreamingStatusBadge', () => {
  it('renders offline state correctly', () => {
    const onConnect = vi.fn()
    render(<StreamingStatusBadge status="disconnected" onConnect={onConnect} />)

    // "Off" is a resting state, not a fault: neutral wording, and the
    // explanation of what streaming is lives in the tooltip.
    const badge = screen.getByRole('status', { name: 'Edits save as you go' })
    expect(badge).toHaveTextContent('Edits save as you go')
    expect(badge.className).not.toMatch(/danger|warning|rose|red|amber/)
    expect(badge).toHaveAttribute('title', expect.stringMatching(/Every edit is saved as you make it/))
    // The media tour finds the last toolbar control by this exact name.
    const connectButton = screen.getByRole('button', { name: 'Live sync' })

    fireEvent.click(connectButton)
    expect(onConnect).toHaveBeenCalledTimes(1)
    // The click event must not reach onConnect: connect(targetGraphId?) would
    // take it for a graph id and the server rejects "[object Object]".
    expect(onConnect).toHaveBeenCalledWith()
  })

  it('says it is on, and what that gives, without edit counts it no longer keeps', () => {
    render(<StreamingStatusBadge status="connected" onDisconnect={() => {}} />)
    const badge = screen.getByRole('status', { name: 'Live sync on' })
    expect(badge).toHaveAttribute('title', expect.stringMatching(/Changes made elsewhere, such as by an agent, appear here as they happen/))
    expect(screen.queryByText(/confirmed/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
  })

  it('says it is reconnecting, as a warning rather than an error, and that it will catch up', () => {
    render(<StreamingStatusBadge status="reconnecting" />)
    const badge = screen.getByRole('status', { name: 'Live sync: reconnecting…' })
    expect(badge.className).toMatch(/warning/)
    expect(badge.className).not.toMatch(/danger/)
    expect(badge).toHaveAttribute('title', expect.stringMatching(/caught up/))
  })

  it('says what turning it on gives, when it is off', () => {
    render(<StreamingStatusBadge status="disconnected" onConnect={() => {}} />)
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringMatching(/Turn on live sync to see changes made elsewhere/))
  })

  it('says it is waiting for a graph, in neutral colours rather than as a warning', () => {
    render(<StreamingStatusBadge status="waiting" />)
    const badge = screen.getByRole('status', { name: 'Live sync: waiting for a graph' })
    expect(badge.className).toContain('bg-subtle')
    expect(badge.className).not.toContain('warning')
    expect(badge.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders connecting state correctly', () => {
    render(<StreamingStatusBadge status="connecting" />)
    expect(screen.getByText('Live sync: connecting…')).toBeInTheDocument()
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

    expect(screen.getByText('Live sync on')).toBeInTheDocument()
    expect(screen.getByText('8 of 10 confirmed')).toBeInTheDocument()

    const disconnectBtn = screen.getByText('Turn off')
    fireEvent.click(disconnectBtn)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps every text at 12px or above and uses token hovers for its actions', () => {
    const { container } = render(
      <StreamingStatusBadge
        status="connected"
        stats={{ sent: 3, acked: 2, failed: 1 }}
        error="Socket closed"
        onDisconnect={() => {}}
      />
    )
    expect(container.innerHTML).not.toMatch(/text-\[(?:\d|1[01])px\]/)
    const disconnect = screen.getByRole('button', { name: 'Turn off' })
    expect(disconnect.className).toContain('text-xs')
    expect(disconnect.className).toContain('hover:text-ink')
    expect(disconnect.className).not.toMatch(/hover:text-(?:slate|emerald)-900/)
  })

  it('explains a failure in plain words, keeps server detail out of the badge, and offers Retry', () => {
    const onConnect = vi.fn()
    render(<StreamingStatusBadge status="error" error='Unsafe graph id: "[object Object]"' onConnect={onConnect} />)
    const badge = screen.getByRole('status', { name: "Couldn't start live sync" })
    expect(badge).not.toHaveTextContent('Unsafe graph id')
    expect(badge).toHaveAttribute('title', expect.stringContaining('Unsafe graph id'))
    expect(screen.getByRole('alert')).toHaveTextContent(/edits still save as you go/)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onConnect).toHaveBeenCalledWith()
  })
})
