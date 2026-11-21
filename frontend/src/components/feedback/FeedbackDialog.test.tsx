import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { APIError } from '@/services/api'

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  submit: vi.fn(),
}))

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, apiClient: { ...actual.apiClient, feedback: api } }
})

vi.mock('./screenshot', () => ({
  captureScreenshot: vi.fn(async () => ({
    png: new Blob(['png'], { type: 'image/png' }),
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 800,
    height: 600,
  })),
}))

import { FeedbackDialog } from './FeedbackDialog'
import { useFeedbackStore } from './feedbackStore'
import { captureScreenshot } from './screenshot'
import { useGlobalStore } from '@/stores/globalStore'

/** After userEvent.setup(), which installs a clipboard of its own. */
function stubClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write: clipboardWrite, writeText: clipboardWriteText },
  })
}

async function openDialog() {
  renderWithProviders(<FeedbackDialog />)
  await act(async () => {
    await useFeedbackStore.getState().openFeedback()
  })
  return screen.findByRole('dialog', { name: 'Send feedback' })
}

const clipboardWrite = vi.fn(async () => undefined)
const clipboardWriteText = vi.fn(async () => undefined)

beforeEach(() => {
  useFeedbackStore.setState({ phase: 'closed', screenshot: null, context: null, screenshotError: null })
  useFeedbackStore.getState().clearDraft()
  api.getConfig.mockReset()
  api.submit.mockReset()
  clipboardWrite.mockClear()
  clipboardWriteText.mockClear()
  ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
    constructor(public items: Record<string, Blob>) {}
  }
  localStorage.setItem('active_graph_id', 'graph_1')
})

afterEach(() => {
  delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem
  localStorage.removeItem('active_graph_id')
})

describe('FeedbackDialog, when the server files reports', () => {
  beforeEach(() => api.getConfig.mockResolvedValue({ serverFiling: true, repo: 'owner/repo' }))

  it('sends the report with its screenshot and links to the new issue', async () => {
    api.submit.mockResolvedValue({ number: 51, url: 'https://github.com/owner/repo/issues/51', screenshotStored: true })
    await openDialog()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Title'), 'Timeline goes blank')
    await user.type(screen.getByLabelText('Details'), 'After zooming out.')
    await user.click(await screen.findByRole('button', { name: 'Send report' }))

    expect(await screen.findByText(/Your report is issue #51/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See it on GitHub' })).toHaveAttribute('href', 'https://github.com/owner/repo/issues/51')
    const sent = api.submit.mock.calls[0]![0]
    expect(sent).toMatchObject({ kind: 'bug', title: 'Timeline goes blank', screenshot: 'data:image/png;base64,iVBORw0KGgo=' })
    expect(sent.body).toContain('After zooming out.')
    expect(sent.body).toContain('`graph_1`')
    // The server adds the screenshot itself; the body does not ask anyone to paste it.
    expect(sent.body).not.toContain('### Screenshot')
  })

  it('leaves the screenshot and the state out when unticked', async () => {
    api.submit.mockResolvedValue({ number: 1, url: 'https://github.com/o/r/issues/1', screenshotStored: true })
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'x')
    await user.click(screen.getByLabelText('Include the screenshot'))
    await user.click(screen.getByLabelText(/Include the page, app state/))
    await user.click(await screen.findByRole('button', { name: 'Send report' }))
    await screen.findByText(/Your report is issue #1/)
    const sent = api.submit.mock.calls[0]![0]
    expect(sent.screenshot).toBeUndefined()
    expect(sent.body).not.toContain('### Where')
    expect(sent.body).not.toContain('graph_1')
  })

  it('needs a title', async () => {
    await openDialog()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Send report' }))
    expect(screen.getByText('Give the report a title.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('falls back to GitHub’s form when the server fails, keeping what was written', async () => {
    api.submit.mockRejectedValue(new APIError('GitHub refused', 502, 'UPSTREAM'))
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'Kept')
    await user.click(await screen.findByRole('button', { name: 'Send report' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not file the report/)
    expect(screen.getByLabelText('Title')).toHaveValue('Kept')
    expect(screen.getByRole('link', { name: /Continue on GitHub/ })).toHaveAttribute(
      'href',
      expect.stringContaining('https://github.com/owner/repo/issues/new?')
    )
  })

  it('says when the server is limiting reports', async () => {
    api.submit.mockRejectedValue(new APIError('Too many reports. Try again in 60 seconds, or use the GitHub form.', 429, 'FEEDBACK_RATE_LIMITED'))
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'x')
    await user.click(await screen.findByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Try again in 60 seconds/)
  })
})

describe('FeedbackDialog, when the server does not file reports', () => {
  beforeEach(() => api.getConfig.mockResolvedValue({ serverFiling: false, repo: null }))

  it('opens GitHub’s prefilled form and puts the screenshot on the clipboard', async () => {
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'An idea')
    await user.click(screen.getByLabelText('An idea'))
    stubClipboard()

    const link = await screen.findByRole('link', { name: /Continue on GitHub/ })
    const url = new URL(link.getAttribute('href')!)
    expect(url.origin + url.pathname).toBe('https://github.com/Qworg/althistory/issues/new')
    expect(url.searchParams.get('title')).toBe('An idea')
    expect(url.searchParams.get('labels')).toBe('enhancement,feedback')
    expect(url.searchParams.get('body')).toContain('### Screenshot')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    fireEvent.click(link)
    expect(await screen.findByText(/screenshot is on your clipboard: paste it into the form/)).toBeInTheDocument()
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('offers the download when the clipboard refuses the image', async () => {
    clipboardWrite.mockRejectedValueOnce(new Error('denied'))
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'x')
    stubClipboard()
    fireEvent.click(await screen.findByRole('link', { name: /Continue on GitHub/ }))
    expect(await screen.findByText(/could not be put on your clipboard/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download the screenshot' })).toBeInTheDocument()
  })

  it('does not open GitHub without a title', async () => {
    await openDialog()
    stubClipboard()
    const link = await screen.findByRole('link', { name: /Continue on GitHub/ })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(await screen.findByText('Give the report a title.')).toBeInTheDocument()
    expect(clipboardWrite).not.toHaveBeenCalled()
  })
})

describe('FeedbackDialog, in general', () => {
  beforeEach(() => api.getConfig.mockResolvedValue({ serverFiling: false, repo: 'owner/repo' }))

  it('keeps the draft when closed with Escape, and opens on it again', async () => {
    const dialog = await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'Half-written')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useFeedbackStore.getState().phase).toBe('closed')

    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    expect(await screen.findByLabelText('Title')).toHaveValue('Half-written')
  })

  it('keeps the view’s shortcuts from acting while it is open', async () => {
    const dialog = await openDialog()
    const onKey = vi.fn()
    document.addEventListener('keydown', onKey)
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'f' })
    expect(onKey).not.toHaveBeenCalled()
    document.removeEventListener('keydown', onKey)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('shows exactly what will be sent, and that the state holds ids', async () => {
    useGlobalStore.setState({ selectedEvents: ['evt_42'] })
    await openDialog()
    const preview = screen.getByText('See what is sent').closest('details')!.querySelector('pre')!
    expect(preview.textContent).toContain('"evt_42"')
    useGlobalStore.setState({ selectedEvents: [] })
  })

  it('opens without a screenshot when capturing fails, and says why', async () => {
    vi.mocked(captureScreenshot).mockRejectedValueOnce(new Error('Drawing the screen took too long'))
    await openDialog()
    expect(screen.getByText(/No screenshot: Drawing the screen took too long/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Include the screenshot')).not.toBeInTheDocument()
  })
})
