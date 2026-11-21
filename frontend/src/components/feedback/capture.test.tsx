import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, waitFor } from '@testing-library/react'

const toCanvas = vi.hoisted(() => vi.fn())
vi.mock('html-to-image', () => ({ toCanvas }))

import { captureContext, currentRoute, summarizeFilters } from './captureContext'
import { captureScreenshot, SCREENSHOT_BUDGET_BYTES } from './screenshot'
import { useFeedbackStore } from './feedbackStore'
import { useFeedbackShortcut } from './useFeedbackShortcut'
import { clearDiagnostics, recordApiFailure } from './diagnostics'
import { useGlobalStore } from '@/stores/globalStore'

// A capture left running by one test would hold up the next (captures run one
// at a time): closing cancels it, as Escape does in the app.
afterEach(() => {
  useFeedbackStore.getState().closeFeedback()
})

describe('captureContext', () => {
  beforeEach(() => clearDiagnostics())

  it('keeps ids and counts, never the text of a filter or a search', () => {
    expect(
      summarizeFilters({
        dateRange: null,
        actors: ['Lady Ada', 'Babbage'],
        targets: [],
        eventTypes: ['secret-type'],
        arcLevels: [1, 2],
        causalWeightRange: [0, 1],
        confidenceThreshold: 0,
        searchQuery: '  my private search ',
      })
    ).toEqual({ actors: 2, eventTypes: 1, arcLevels: [1, 2], searchLength: 17 })
  })

  it('keeps the route’s path and its event id, not the rest of its query', () => {
    const location = { pathname: '/timeline', search: '?event=evt_9&q=private', hash: '' } as Location
    expect(currentRoute(location)).toBe('/timeline?event=evt_9')
    expect(currentRoute({ pathname: '/causal-graph', search: '?q=x', hash: '' } as Location)).toBe('/causal-graph')
  })

  it('caps the selection and says how much there was', () => {
    useGlobalStore.setState({ selectedEvents: Array.from({ length: 30 }, (_, i) => `evt_${i}`), selectedArcs: [] })
    const context = captureContext({ graphName: 'The Engine Age' })
    expect(context.state.selectedEvents).toHaveLength(20)
    expect(context.state.selectedTotal).toEqual({ events: 30, arcs: 0 })
    expect(context.graph.name).toBe('The Engine Age')
    useGlobalStore.setState({ selectedEvents: [] })
  })

  it('carries the recent failures and never a stored key', () => {
    localStorage.setItem('api_key', 'ak_THISISASECRETKEYVALUE1234')
    recordApiFailure({ method: 'get', url: '/events', status: 500 })
    const context = captureContext()
    expect(context.errors).toHaveLength(1)
    expect(JSON.stringify(context)).not.toContain('ak_THISISASECRETKEYVALUE1234')
    localStorage.removeItem('api_key')
  })
})

describe('captureScreenshot', () => {
  let drawImage: ReturnType<typeof vi.fn>
  let blobSizes: number[]

  beforeEach(() => {
    drawImage = vi.fn()
    blobSizes = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback, type) {
      const size = blobSizes.shift() ?? 1000
      callback(new Blob([new Uint8Array(size)], { type: type ?? 'image/png' }))
    })
    const page = document.createElement('canvas')
    page.width = 1280
    page.height = 3000
    toCanvas.mockResolvedValue(page)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('draws only the part of the page in view, and leaves out what asks to be left out', async () => {
    // The window is scrolled 500 px: it is drawn from the top with its content
    // shifted up, then scrolled back.
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const content = document.createElement('div')
    document.body.prepend(content)
    let shiftedDuringDraw = ''
    toCanvas.mockImplementationOnce(async () => {
      shiftedDuringDraw = content.style.marginTop
      const page = document.createElement('canvas')
      page.width = 1280
      page.height = 800
      return page
    })
    const shot = await captureScreenshot()
    expect(shiftedDuringDraw).toBe('-500px')
    expect(content.style.marginTop).toBe('')
    expect(scrollTo.mock.calls).toEqual([[{ left: 0, top: 0, behavior: 'instant' }], [{ left: 0, top: 500, behavior: 'instant' }]])
    content.remove()
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 800, 0, 0, 1280, 800)
    expect(shot).toMatchObject({ width: 1280, height: 800 })
    expect(shot.dataUrl).toMatch(/^data:image\/png;base64,/)

    const filter = toCanvas.mock.calls[0]![1].filter as (node: Node) => boolean
    const ignored = document.createElement('div')
    ignored.setAttribute('data-feedback-ignore', '')
    expect(filter(ignored)).toBe(false)
    expect(filter(document.createElement('div'))).toBe(true)
  })

  it('sends a JPEG when the PNG is over budget, but keeps a PNG for the clipboard', async () => {
    blobSizes = [SCREENSHOT_BUDGET_BYTES + 1, 400_000]
    const shot = await captureScreenshot()
    expect(shot.png.type).toBe('image/png')
    expect(shot.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('draws smaller when even the JPEG is over budget', async () => {
    blobSizes = [SCREENSHOT_BUDGET_BYTES + 1, SCREENSHOT_BUDGET_BYTES + 1, 900_000, 300_000]
    const shot = await captureScreenshot()
    expect(shot.width).toBe(1000)
    expect(shot.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
  })
})

describe('openFeedback', () => {
  beforeEach(() => useFeedbackStore.setState({ phase: 'closed', screenshot: null, context: null, screenshotError: null, available: true }))

  it('captures before the dialog opens', async () => {
    const page = document.createElement('canvas')
    page.width = 100
    page.height = 100
    toCanvas.mockResolvedValue(page)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['x'], { type: 'image/png' })))

    const opening = useFeedbackStore.getState().openFeedback()
    expect(useFeedbackStore.getState().phase).toBe('capturing')
    await opening
    expect(useFeedbackStore.getState().phase).toBe('open')
    expect(useFeedbackStore.getState().screenshot).not.toBeNull()
    expect(useFeedbackStore.getState().context).not.toBeNull()
    vi.restoreAllMocks()
  })

  it('stays closed when closed while capturing', async () => {
    let finish: (canvas: HTMLCanvasElement) => void = () => undefined
    toCanvas.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const opening = useFeedbackStore.getState().openFeedback()
    await new Promise((resolve) => setTimeout(resolve, 50))
    useFeedbackStore.getState().closeFeedback()
    finish(document.createElement('canvas'))
    await opening
    expect(useFeedbackStore.getState().phase).toBe('closed')
  })

  it('is ignored while already open', async () => {
    useFeedbackStore.setState({ phase: 'open' })
    toCanvas.mockClear()
    await useFeedbackStore.getState().openFeedback()
    expect(toCanvas).not.toHaveBeenCalled()
    expect(useFeedbackStore.getState().phase).toBe('open')
  })
})

describe('Shift+I', () => {
  function Harness() {
    useFeedbackShortcut()
    return <input aria-label="field" />
  }

  beforeEach(() => {
    useFeedbackStore.setState({ phase: 'closed', available: true })
    toCanvas.mockReturnValue(new Promise(() => undefined))
  })

  it('opens feedback', async () => {
    render(<Harness />)
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'I', shiftKey: true })
    })
    expect(useFeedbackStore.getState().phase).toBe('capturing')
  })

  it.each([
    ['a bare I', { key: 'i' }],
    ['Ctrl+Shift+I (the browser’s developer tools)', { key: 'I', shiftKey: true, ctrlKey: true }],
    ['Cmd+Shift+I', { key: 'I', shiftKey: true, metaKey: true }],
  ])('ignores %s', (_name, init) => {
    render(<Harness />)
    fireEvent.keyDown(document.body, init)
    expect(useFeedbackStore.getState().phase).toBe('closed')
  })

  it('stands aside while typing and while a dialog is open', () => {
    const { getByLabelText } = render(<Harness />)
    fireEvent.keyDown(getByLabelText('field'), { key: 'I', shiftKey: true })
    expect(useFeedbackStore.getState().phase).toBe('closed')

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    fireEvent.keyDown(document.body, { key: 'I', shiftKey: true })
    expect(useFeedbackStore.getState().phase).toBe('closed')
    dialog.remove()
  })
})

describe('capturing, after the first review', () => {
  it('Escape cancels the capture, other keys are swallowed, and a stale capture never lands', async () => {
    const { FeedbackHost } = await import('./FeedbackHost')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    useFeedbackStore.setState({ phase: 'closed' })
    let finishFirst: (canvas: HTMLCanvasElement) => void = () => undefined
    toCanvas.mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
    // The server has said feedback is on (no request is made: the answer is cached).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['feedback-config'], { enabled: true, serverFiling: false, repo: 'o/r' })
    render(
      <QueryClientProvider client={client}>
        <FeedbackHost />
      </QueryClientProvider>
    )
    await waitFor(() => expect(useFeedbackStore.getState().available).toBe(true))

    const first = useFeedbackStore.getState().openFeedback()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)))
    const other = vi.fn()
    document.addEventListener('keydown', other)
    fireEvent.keyDown(document.body, { key: '?' })
    expect(other).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    document.removeEventListener('keydown', other)
    expect(useFeedbackStore.getState().phase).toBe('closed')

    // Opened again: the first capture finishing must not open the dialog with its picture.
    toCanvas.mockReturnValueOnce(new Promise(() => undefined))
    void useFeedbackStore.getState().openFeedback()
    await act(async () => {
      finishFirst(document.createElement('canvas'))
      await first
    })
    expect(useFeedbackStore.getState().phase).toBe('capturing')
    act(() => useFeedbackStore.getState().closeFeedback())
  })
})

describe('captureScreenshot, after the second review', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('a cancelled capture puts the page back at once, and the next one starts from the real page', async () => {
    // Earlier tests can leave queued answers behind.
    toCanvas.mockReset()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['x'], { type: 'image/png' })))
    const content = document.createElement('div')
    document.body.prepend(content)

    // The first drawing never ends on its own.
    let endFirst: (canvas: HTMLCanvasElement) => void = () => undefined
    toCanvas.mockReturnValueOnce(new Promise((resolve) => (endFirst = resolve)))
    const controller = new AbortController()
    const first = captureScreenshot(document.body, controller.signal).catch((error: Error) => error.message)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(content.style.marginTop).toBe('-500px')

    controller.abort(new Error('cancelled'))
    expect(await first).toBe('cancelled')
    expect(content.style.marginTop).toBe('')
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 500, behavior: 'instant' })

    // A second capture sees the real margin, and the first's late end changes nothing.
    let seen = ''
    toCanvas.mockImplementationOnce(async () => {
      seen = content.style.marginTop
      const page = document.createElement('canvas')
      page.width = 100
      page.height = 100
      return page
    })
    await captureScreenshot()
    endFirst(document.createElement('canvas'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen).toBe('-500px')
    expect(content.style.marginTop).toBe('')
    content.remove()
  })
})

describe('openFeedback, after the third review', () => {
  it('Escape before the first paint cancels the capture: nothing is drawn and nothing shifts', async () => {
    useFeedbackStore.setState({ phase: 'closed', available: true })
    toCanvas.mockReset()
    const opening = useFeedbackStore.getState().openFeedback()
    // Before the two frames openFeedback waits for.
    useFeedbackStore.getState().closeFeedback()
    await opening
    expect(toCanvas).not.toHaveBeenCalled()
    expect(useFeedbackStore.getState().phase).toBe('closed')
  })
})
