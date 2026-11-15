import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { LiveChangeNotices } from './LiveChangeNotices'
import { NOTICE_MS, resetLiveChangesStore, useLiveChangesStore } from '@/stores/liveChangesStore'

describe('LiveChangeNotices', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetLiveChangesStore()
  })

  afterEach(() => {
    resetLiveChangesStore()
    vi.useRealTimers()
  })

  it('renders nothing while nothing has changed', () => {
    const { container } = render(<LiveChangeNotices />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says who changed what, politely, for a few seconds', () => {
    render(<LiveChangeNotices />)
    act(() => useLiveChangesStore.getState().addNotices(['An agent (Claude) added 3 events to “The Tide War”']))
    expect(screen.getByRole('status')).toHaveTextContent('An agent (Claude) added 3 events to “The Tide War”')
    expect(screen.getByLabelText('Live changes')).toHaveAttribute('aria-live', 'polite')
    act(() => {
      vi.advanceTimersByTime(NOTICE_MS + 200)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('can be dismissed, and uses the theme tokens rather than raw colours', () => {
    render(<LiveChangeNotices />)
    act(() => useLiveChangesStore.getState().addNotices(['One', 'Two']))
    const className = screen.getAllByTestId('live-change-notice')[0]?.className ?? ''
    expect(className).toMatch(/bg-card/)
    expect(className).not.toMatch(/bg-(gray|slate|white|black)/)
    const [dismiss] = screen.getAllByRole('button', { name: 'Dismiss notice' })
    if (!dismiss) throw new Error('no dismiss button')
    fireEvent.click(dismiss)
    expect(screen.getAllByTestId('live-change-notice')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Two')
  })
})
