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

  it('falls back to GitHub’s form when GitHub refused, keeping what was written', async () => {
    api.submit.mockRejectedValue(new APIError('GitHub refused', 502, 'FEEDBACK_REFUSED'))
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

describe('FeedbackDialog, after the first review', () => {
  it('cannot be closed while sending, and the answer is shown when it comes', async () => {
    api.getConfig.mockResolvedValue({ serverFiling: true, repo: 'owner/repo' })
    let answer: (value: unknown) => void = () => undefined
    api.submit.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const dialog = await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'x')
    await user.click(await screen.findByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close feedback' })).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(useFeedbackStore.getState().phase).toBe('open')
    await act(async () => answer({ number: 9, url: 'https://github.com/owner/repo/issues/9', screenshotStored: true }))
    expect(await screen.findByText(/Your report is issue #9/)).toBeInTheDocument()
  })

  it('clears the draft however a sent report is dismissed, and moves focus to Done', async () => {
    api.getConfig.mockResolvedValue({ serverFiling: true, repo: 'owner/repo' })
    api.submit.mockResolvedValue({ number: 3, url: 'https://github.com/owner/repo/issues/3', screenshotStored: true })
    const dialog = await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'Sent once')
    await user.click(await screen.findByRole('button', { name: 'Send report' }))
    await screen.findByText(/Your report is issue #3/)
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Report sent. It is issue 3.')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(useFeedbackStore.getState().draft.title).toBe('')
  })

  it('asks the reporter to check before sending again when the issue may exist', async () => {
    api.getConfig.mockResolvedValue({ serverFiling: true, repo: 'owner/repo' })
    api.submit
      .mockRejectedValueOnce(new APIError('lost', 502, 'FEEDBACK_MAYBE_FILED'))
      .mockRejectedValueOnce(new APIError('Network error - please check your connection', 0, 'NETWORK_ERROR'))
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'x')
    for (let attempt = 0; attempt < 2; attempt++) {
      await user.click(await screen.findByRole('button', { name: 'Send report' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/did not say whether the report was filed/)
      expect(screen.getByRole('alert')).toHaveFocus()
      expect(screen.getByRole('link', { name: 'Check the latest feedback issues' })).toHaveAttribute(
        'href',
        expect.stringContaining('https://github.com/owner/repo/issues?q=')
      )
      // Still the server's route: the reporter has not been sent to the form.
      expect(screen.getByRole('button', { name: 'Send report' })).toBeInTheDocument()
    }
  })

  it('cannot go to GitHub before it knows where reports go', async () => {
    api.getConfig.mockReturnValue(new Promise(() => undefined))
    await openDialog()
    expect(screen.getByRole('button', { name: 'Checking how to send…' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /Continue on GitHub/ })).not.toBeInTheDocument()
  })

  it('shows a long report to copy when the clipboard refuses it', async () => {
    api.getConfig.mockResolvedValue({ serverFiling: false, repo: 'owner/repo' })
    clipboardWriteText.mockRejectedValueOnce(new Error('denied'))
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'Long')
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'é'.repeat(3000) } })
    stubClipboard()
    fireEvent.click(await screen.findByRole('link', { name: /Continue on GitHub/ }))
    const copy = await screen.findByLabelText('The report, to copy into GitHub’s form')
    expect((copy as HTMLTextAreaElement).value).toContain('é'.repeat(3000))
    await user.click(screen.getByRole('button', { name: 'Try copying again' }))
    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledTimes(2))
  })
})

describe('FeedbackHost, after the first review', () => {
  it('starts each opening fresh, even if the last one ended mid-answer', async () => {
    const { FeedbackHost } = await import('./FeedbackHost')
    api.getConfig.mockResolvedValue({ serverFiling: true, repo: 'owner/repo' })
    api.submit.mockRejectedValue(new APIError('GitHub refused', 502, 'UPSTREAM'))
    renderWithProviders(<FeedbackHost />)
    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Title'), 'x')
    await user.click(await screen.findByRole('button', { name: 'Send report' }))
    await screen.findByRole('alert')
    act(() => useFeedbackStore.getState().closeFeedback())
    await act(async () => {
      await useFeedbackStore.getState().openFeedback()
    })
    // A new opening asks the server again and shows no old alert.
    expect(await screen.findByRole('button', { name: 'Send report' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FeedbackDialog, after the second review', () => {
  beforeEach(() => api.getConfig.mockResolvedValue({ serverFiling: true, repo: 'owner/repo' }))

  it('treats a gateway’s 502 with no code of ours as “may have been filed”, and lets the reporter choose the form', async () => {
    api.submit.mockRejectedValue(new APIError('Bad Gateway', 502, undefined))
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'x')
    await user.click(await screen.findByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not say whether/)
    expect(screen.queryByRole('link', { name: /Continue on GitHub/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'use GitHub’s form instead' }))
    expect(screen.getByRole('link', { name: /Continue on GitHub/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('moves focus to a refusal, since the Send button that had it was disabled', async () => {
    api.submit.mockRejectedValue(new APIError('GitHub refused', 502, 'FEEDBACK_REFUSED'))
    await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'x')
    await user.click(await screen.findByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveFocus()
  })

  it('counts the report as gone from the click on GitHub, before the clipboard answers', async () => {
    api.getConfig.mockResolvedValue({ serverFiling: false, repo: 'owner/repo' })
    const dialog = await openDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'Gone')
    stubClipboard()
    clipboardWrite.mockReturnValueOnce(new Promise(() => undefined))
    fireEvent.click(await screen.findByRole('link', { name: /Continue on GitHub/ }))
    expect(await screen.findByText('GitHub’s form is open in a new tab, filled in.')).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(useFeedbackStore.getState().draft.title).toBe('')
  })
})

