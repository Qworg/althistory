import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

const toCanvas = vi.hoisted(() => vi.fn())
vi.mock('html-to-image', () => ({ toCanvas }))

import { captureContext, currentRoute, summarizeFilters } from './captureContext'
import { captureScreenshot, SCREENSHOT_BUDGET_BYTES } from './screenshot'
import { useFeedbackStore } from './feedbackStore'
import { useFeedbackShortcut } from './useFeedbackShortcut'
import { clearDiagnostics, recordApiFailure } from './diagnostics'
import { useGlobalStore } from '@/stores/globalStore'

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
    const shot = await captureScreenshot()
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 500, 1280, 800, 0, 0, 1280, 800)
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
  beforeEach(() => useFeedbackStore.setState({ phase: 'closed', screenshot: null, context: null, screenshotError: null }))

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
    useFeedbackStore.setState({ phase: 'closed' })
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
