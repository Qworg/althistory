import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { CopyCompletionNotifier } from './CopyCompletionNotifier'
import { useCopyStore } from '@/stores/copyStore'
import { CopyOperation } from '@/types'

const mockSwitchGraph = vi.fn()

vi.mock('@/hooks/useGraphs', () => ({
  useGraphs: () => ({ data: { graphs: [] } }),
  useSwitchGraph: () => ({ mutate: mockSwitchGraph }),
}))

vi.mock('@/stores/globalStore', () => ({
  useGlobalStore: (selector: (state: { addError: unknown }) => unknown) =>
    selector({ addError: vi.fn() }),
}))

const completedCopy = (id: string, name: string): CopyOperation => ({
  id,
  name,
  type: 'full',
  status: 'completed',
  progress: 100,
  created_at: '2024-01-01T00:00:00Z',
  completed_at: '2024-01-01T00:01:00Z',
  parameters: {},
})

describe('CopyCompletionNotifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSwitchGraph.mockClear()
    useCopyStore.getState().stopAllPolling()
    useCopyStore.setState({
      activeOperations: [],
      completedOperations: [],
      pollingIntervals: new Map(),
    })
  })

  afterEach(() => {
    useCopyStore.getState().stopAllPolling()
  })

  it('shows nothing when no copy has finished', () => {
    const { container } = render(<CopyCompletionNotifier />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows a copy that finished while it was mounted', async () => {
    render(<CopyCompletionNotifier />)

    // The notifier announces copies that finish while it is mounted: a copy
    // that had already finished when the application loaded is not worth a
    // notification storm.
    act(() => {
      useCopyStore.setState({ completedOperations: [completedCopy('copy-1', 'Copy One')] })
    })

    await waitFor(() => {
      expect(screen.getByText('Copy Completed Successfully')).toBeInTheDocument()
    })
    expect(screen.getByText(/Copy One/)).toBeInTheDocument()
  })

  it('does not announce a copy that had already finished', () => {
    useCopyStore.setState({ completedOperations: [completedCopy('copy-1', 'Copy One')] })

    const { container } = render(<CopyCompletionNotifier />)

    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the copy in the history when the notice is dismissed', async () => {
    render(<CopyCompletionNotifier />)

    act(() => {
      useCopyStore.setState({ completedOperations: [completedCopy('copy-1', 'Copy One')] })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    })

    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).click()
    })

    // The notification hides itself and calls `onDismiss` 300 ms later. The
    // assertion has to come after that, or it passes before the code under
    // test has run at all.
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
      },
      { timeout: 2000 }
    )
    await new Promise((resolve) => setTimeout(resolve, 400))

    // The history panel shows the same operations. A notice that timed out must
    // not take the copy out of the history: the user never looked at it.
    expect(useCopyStore.getState().completedOperations).toHaveLength(1)
  })

  it('keeps a copy that finished just after a dismissal on screen', async () => {
    render(<CopyCompletionNotifier />)

    act(() => {
      useCopyStore.setState({ completedOperations: [completedCopy('copy-1', 'Copy One')] })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    })

    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).click()
    })

    // The old notice's dismissal lands 300 ms later. A copy that finished in
    // between must not be taken down with it.
    act(() => {
      useCopyStore.setState({
        completedOperations: [
          completedCopy('copy-1', 'Copy One'),
          completedCopy('copy-2', 'Copy Two'),
        ],
      })
    })

    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(screen.getByText(/Copy Two/)).toBeInTheDocument()
  })

  it('announces a copy that finishes after the history was cleared', async () => {
    render(<CopyCompletionNotifier />)

    act(() => {
      useCopyStore.setState({ completedOperations: [completedCopy('copy-1', 'Copy One')] })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    })

    // "Clear History" empties the list, so its length goes DOWN. Counting the
    // copies instead of remembering their ids would stop announcing new ones.
    act(() => {
      useCopyStore.getState().clearCompletedOperations()
    })

    act(() => {
      useCopyStore.setState({ completedOperations: [completedCopy('copy-2', 'Copy Two')] })
    })

    await waitFor(() => {
      expect(screen.getByText(/Copy Two/)).toBeInTheDocument()
    })
  })

  it('announces a second copy after the first notice was dismissed', async () => {
    render(<CopyCompletionNotifier />)

    act(() => {
      useCopyStore.setState({ completedOperations: [completedCopy('copy-1', 'Copy One')] })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    })

    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).click()
    })

    act(() => {
      useCopyStore.setState({
        completedOperations: [
          completedCopy('copy-1', 'Copy One'),
          completedCopy('copy-2', 'Copy Two'),
        ],
      })
    })

    // The second copy has to be announced too: counting the copies instead of
    // remembering their ids would stop after the first one.
    await waitFor(() => {
      expect(screen.getByText(/Copy Two/)).toBeInTheDocument()
    })
  })

  it('switches to the copy\'s graph by id', async () => {
    render(<CopyCompletionNotifier />)

    act(() => {
      useCopyStore.setState({ completedOperations: [completedCopy('copy-1', 'Copy One')] })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Switch to Graph' })).toBeInTheDocument()
    })

    act(() => {
      screen.getByRole('button', { name: 'Switch to Graph' }).click()
    })

    // A copy's id is the id of the graph it created, so the notice switches
    // straight to it -- the graph list may not have been refreshed yet, and
    // the copy is not in it.
    expect(mockSwitchGraph).toHaveBeenCalledWith('copy-1')
  })

  it('does not announce a copy the user cancelled', async () => {
    render(<CopyCompletionNotifier />)

    act(() => {
      useCopyStore.setState({
        completedOperations: [
          { ...completedCopy('copy-1', 'Copy One'), error_message: 'Cancelled by user' },
        ],
      })
    })

    // A cancellation the user made is not a failure to report.
    await waitFor(() => {
      expect(screen.queryByText('Copy Completed Successfully')).not.toBeInTheDocument()
    })
  })
})
