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

  it('says it is on, and what that gives', () => {
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

  it('turns off from the badge when it is on', () => {
    const onDisconnect = vi.fn()
    render(<StreamingStatusBadge status="connected" onDisconnect={onDisconnect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps every text at 12px or above and uses token hovers for its actions', () => {
    const { container } = render(
      <StreamingStatusBadge
        status="connected"
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

  it('says the open graph is not watched when the key lost it, as a warning, and offers Retry', () => {
    const onConnect = vi.fn()
    render(<StreamingStatusBadge status="revoked" onConnect={onConnect} />)
    const badge = screen.getByRole('status', { name: 'Live sync: not watching this graph' })
    expect(badge.className).toMatch(/warning/)
    expect(badge.className).not.toMatch(/danger/)
    expect(badge).toHaveAttribute('title', expect.stringMatching(/may no longer read this graph.*graph list is still watched/))
    expect(badge).not.toHaveAttribute('title', expect.stringMatching(/Details/))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onConnect).toHaveBeenCalledWith()
  })

  it('says a graph that no longer exists is gone, rather than that the key lost it', () => {
    render(<StreamingStatusBadge status="revoked" revokedReason="missing" onConnect={() => {}} />)
    const badge = screen.getByRole('status', { name: 'Live sync: not watching this graph' })
    expect(badge).toHaveAttribute('title', expect.stringMatching(/^This graph no longer exists.*graph list is still watched/))
    expect(badge).not.toHaveAttribute('title', expect.stringMatching(/may no longer read/))
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
