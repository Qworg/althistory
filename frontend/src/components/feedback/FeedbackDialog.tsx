import React, { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ModalBase } from '@/components/modals/ModalBase'
import { apiClient, APIError } from '@/services/api'
import { DEMO_MODE } from '@/demo/flag'
import { useFeedbackStore } from './feedbackStore'
import {
  DEFAULT_FEEDBACK_REPO,
  buildIssueBody,
  buildPrefilledIssue,
  type BodyParts,
  type FeedbackKind,
} from './issueBody'

const KINDS: ReadonlyArray<{ id: FeedbackKind; label: string; placeholder: string }> = [
  { id: 'bug', label: 'Something is wrong', placeholder: 'What did you do, what happened, and what did you expect?' },
  { id: 'idea', label: 'An idea', placeholder: 'What would you like to be able to do, and why?' },
  { id: 'other', label: 'Something else', placeholder: 'What would you like to tell us?' },
]

const CONFIGURED_REPO = (import.meta.env.VITE_FEEDBACK_REPO as string | undefined)?.trim() || DEFAULT_FEEDBACK_REPO

/** Whether the server files reports. The demo has no server; an error means "no". */
function useFeedbackConfig(enabled: boolean) {
  return useQuery({
    queryKey: ['feedback-config'],
    queryFn: () => apiClient.feedback.getConfig(),
    enabled: enabled && !DEMO_MODE,
    staleTime: Infinity,
    retry: false,
  })
}

type Outcome =
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'filed'; number: number; url: string; screenshotStored: boolean }
  | { kind: 'opened'; clipboard: 'image' | 'text' | 'failed' | 'none'; bodyOnClipboard: boolean }

function downloadScreenshot(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `althistory-screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Put the screenshot (or, when the report did not fit the link, its text) on the clipboard. */
async function copyForForm(png: Blob | null, text: string | null): Promise<'image' | 'text' | 'failed' | 'none'> {
  try {
    if (text !== null) {
      await navigator.clipboard.writeText(text)
      return 'text'
    }
    if (!png) return 'none'
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return 'failed'
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    return 'image'
  } catch {
    return 'failed'
  }
}

const inputClass =
  'mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-selected'
const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-selected disabled:cursor-not-allowed disabled:opacity-60'
const primaryClass = `${buttonClass} bg-baseline text-on-accent hover:bg-baseline/90`
const secondaryClass = `${buttonClass} border border-line bg-card text-ink hover:bg-subtle`

/**
 * The feedback dialog (issue #49). It opens on what the reporter was looking
 * at: the screenshot and the state were captured before it appeared. It sends
 * the report to the server when the server files reports, and otherwise
 * opens GitHub's new-issue form with everything filled in and the screenshot
 * on the clipboard.
 */
export function FeedbackDialog() {
  const phase = useFeedbackStore((state) => state.phase)
  const screenshot = useFeedbackStore((state) => state.screenshot)
  const screenshotError = useFeedbackStore((state) => state.screenshotError)
  const context = useFeedbackStore((state) => state.context)
  const draft = useFeedbackStore((state) => state.draft)
  const updateDraft = useFeedbackStore((state) => state.updateDraft)
  const clearDraft = useFeedbackStore((state) => state.clearDraft)
  const closeFeedback = useFeedbackStore((state) => state.closeFeedback)

  const isOpen = phase === 'open'
  const config = useFeedbackConfig(isOpen)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'form' })
  const [serverProblem, setServerProblem] = useState<string | null>(null)
  const [titleTouched, setTitleTouched] = useState(false)
  const ids = useId()

  // The server may refuse (no token after all, a limit, GitHub down): then the form route.
  const [serverDeclined, setServerDeclined] = useState(false)
  const serverFiling = !DEMO_MODE && config.data?.serverFiling === true && !serverDeclined
  const repo = config.data?.repo ?? CONFIGURED_REPO
  const waitingForConfig = !DEMO_MODE && config.isPending

  const parts = (screenshotMode: BodyParts['screenshot']): BodyParts => ({
    kind: draft.kind,
    description: draft.description,
    context: draft.includeState ? context : null,
    screenshot: draft.includeScreenshot && screenshot ? screenshotMode : 'none',
  })

  const preview = useMemo(
    () => buildIssueBody(parts(serverFiling ? 'none' : 'paste')),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `parts` reads exactly these
    [draft, context, screenshot, serverFiling]
  )
  const prefilled = useMemo(
    () => buildPrefilledIssue(repo, draft.title || 'Feedback', parts('paste')),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `parts` reads exactly these
    [repo, draft, context, screenshot]
  )

  const titleMissing = draft.title.trim().length === 0

  const close = () => {
    setOutcome({ kind: 'form' })
    setServerProblem(null)
    setServerDeclined(false)
    setTitleTouched(false)
    closeFeedback()
  }

  const finish = () => {
    clearDraft()
    close()
  }

  const send = async () => {
    setTitleTouched(true)
    if (titleMissing) return
    setOutcome({ kind: 'sending' })
    try {
      const issue = await apiClient.feedback.submit({
        kind: draft.kind,
        title: draft.title,
        body: buildIssueBody(parts('none')),
        ...(draft.includeScreenshot && screenshot ? { screenshot: screenshot.dataUrl } : {}),
      })
      setOutcome({ kind: 'filed', ...issue })
    } catch (error) {
      const status = error instanceof APIError ? error.status : 0
      const code = error instanceof APIError ? error.code : undefined
      setServerDeclined(true)
      setOutcome({ kind: 'form' })
      setServerProblem(
        code === 'FEEDBACK_NOT_CONFIGURED'
          ? 'This server does not file reports, so the report goes through GitHub’s form instead.'
          : status === 429
            ? `${error instanceof Error ? error.message : 'Too many reports.'} You can still send it through GitHub’s form.`
            : 'The server could not file the report. You can send it through GitHub’s form instead; nothing you wrote is lost.'
      )
    }
  }

  const openForm = (event: React.MouseEvent<HTMLAnchorElement>) => {
    setTitleTouched(true)
    if (titleMissing) {
      event.preventDefault()
      return
    }
    // The link opens GitHub itself (a link is never popup-blocked); the clipboard
    // write starts in the same click, while the browser still allows it.
    const png = draft.includeScreenshot && screenshot ? screenshot.png : null
    void copyForForm(prefilled.bodyOnClipboard ? null : png, prefilled.bodyOnClipboard ? prefilled.fullBody : null).then(
      (clipboard) => setOutcome({ kind: 'opened', clipboard, bodyOnClipboard: prefilled.bodyOnClipboard })
    )
  }

  // Keys pressed in the dialog stay in it (as in the help dialog), so the
  // view's shortcuts do not act underneath; Escape closes it, keeping the draft.
  const containKeys = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') return
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  if (!isOpen) return null

  const kindPlaceholder = KINDS.find((k) => k.id === draft.kind)?.placeholder

  let body: React.ReactNode
  let footer: React.ReactNode

  if (outcome.kind === 'filed') {
    body = (
      <div role="status" className="space-y-3 text-sm text-ink-secondary">
        <p className="text-base text-ink">Thank you. Your report is issue #{outcome.number}.</p>
        <p>
          <a href={outcome.url} target="_blank" rel="noopener noreferrer" className="font-medium text-baseline underline">
            See it on GitHub
          </a>
          {' '}to follow it or add more.
        </p>
        {!outcome.screenshotStored && <p>The screenshot could not be stored, so the issue has none.</p>}
      </div>
    )
    footer = (
      <button type="button" className={primaryClass} onClick={finish} data-autofocus>
        Done
      </button>
    )
  } else if (outcome.kind === 'opened') {
    body = (
      <div role="status" className="space-y-3 text-sm text-ink-secondary">
        <p className="text-base text-ink">GitHub’s form is open in a new tab, filled in.</p>
        {outcome.clipboard === 'image' && <p>The screenshot is on your clipboard: paste it into the form (Ctrl+V or ⌘V).</p>}
        {outcome.clipboard === 'text' && (
          <p>The report was too long for a link, so it is on your clipboard: paste it into the form’s description.</p>
        )}
        {outcome.clipboard === 'failed' && (
          <p>
            {outcome.bodyOnClipboard
              ? 'The report could not be put on your clipboard. Copy it from “See what is sent” and paste it into the form.'
              : 'The screenshot could not be put on your clipboard. Download it and drag the file into the form.'}
          </p>
        )}
        <p>
          If no tab opened,{' '}
          <a href={prefilled.url} target="_blank" rel="noopener noreferrer" className="font-medium text-baseline underline">
            open the form
          </a>
          .
        </p>
      </div>
    )
    footer = (
      <>
        {screenshot && draft.includeScreenshot && (
          <button type="button" className={secondaryClass} onClick={() => downloadScreenshot(screenshot.png)}>
            Download the screenshot
          </button>
        )}
        <button type="button" className={primaryClass} onClick={finish} data-autofocus>
          Done
        </button>
      </>
    )
  } else {
    const sending = outcome.kind === 'sending'
    body = (
      <form
        id={`${ids}-form`}
        // The title's own message says what is missing, in both routes.
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (serverFiling) void send()
        }}
      >
        <p className="text-sm text-ink-secondary">
          Tell us what went wrong or what you would like. The report becomes an issue on{' '}
          <span className="font-mono-code text-ink">{repo}</span>, with a picture of the page and the app’s state as
          they were when you opened this.
        </p>

        {serverProblem && (
          <p role="alert" className="rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink">
            {serverProblem}
          </p>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-ink-secondary">What is it?</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {KINDS.map((kind) => (
              <label
                key={kind.id}
                className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                  draft.kind === kind.id ? 'border-selected bg-subtle text-ink' : 'border-line text-ink-secondary hover:bg-subtle'
                }`}
              >
                <input
                  type="radio"
                  name={`${ids}-kind`}
                  value={kind.id}
                  checked={draft.kind === kind.id}
                  onChange={() => updateDraft({ kind: kind.id })}
                  className="accent-baseline"
                />
                {kind.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${ids}-title`} className="block text-sm font-medium text-ink-secondary">
            Title
          </label>
          <input
            id={`${ids}-title`}
            type="text"
            value={draft.title}
            maxLength={200}
            required
            aria-invalid={titleTouched && titleMissing}
            aria-describedby={titleTouched && titleMissing ? `${ids}-title-error` : undefined}
            onChange={(event) => updateDraft({ title: event.target.value })}
            placeholder="A line that sums it up"
            autoComplete="off"
            data-autofocus
            className={inputClass}
          />
          {titleTouched && titleMissing && (
            <p id={`${ids}-title-error`} className="mt-1 text-xs text-divergence">
              Give the report a title.
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${ids}-description`} className="block text-sm font-medium text-ink-secondary">
            Details
          </label>
          <textarea
            id={`${ids}-description`}
            value={draft.description}
            rows={5}
            maxLength={20000}
            onChange={(event) => updateDraft({ description: event.target.value })}
            placeholder={kindPlaceholder}
            className={`${inputClass} resize-y`}
          />
        </div>

        <div className="space-y-2 rounded-md border border-line p-3">
          {screenshot ? (
            <>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={draft.includeScreenshot}
                  onChange={(event) => updateDraft({ includeScreenshot: event.target.checked })}
                />
                Include the screenshot
              </label>
              <img
                src={screenshot.dataUrl}
                alt="The page as it was when you opened this"
                className={`max-h-40 w-auto rounded-sm border border-line ${draft.includeScreenshot ? '' : 'opacity-40'}`}
              />
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              No screenshot{screenshotError ? `: ${screenshotError}` : ''}. You can attach one on GitHub.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.includeState}
              onChange={(event) => updateDraft({ includeState: event.target.checked })}
            />
            Include the page, app state, browser and recent errors
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-secondary hover:text-ink">See what is sent</summary>
            <pre className="font-mono-code mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-subtle p-2 text-xs text-ink">
              {preview}
            </pre>
          </details>
          <p className="text-xs text-ink-muted">
            Issues on a public repository can be read by anyone, screenshot included, and the screenshot shows whatever
            is on screen. The state holds ids, not the text of your events. No API key is ever sent.
          </p>
        </div>
      </form>
    )

    footer = (
      <>
        <button type="button" className={secondaryClass} onClick={close} disabled={sending}>
          Cancel
        </button>
        {serverFiling ? (
          <button type="submit" form={`${ids}-form`} className={primaryClass} disabled={sending || waitingForConfig}>
            {sending ? 'Sending…' : 'Send report'}
          </button>
        ) : (
          <a
            href={prefilled.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openForm}
            aria-disabled={waitingForConfig || undefined}
            className={`${primaryClass} ${waitingForConfig ? 'pointer-events-none opacity-60' : ''}`}
          >
            Continue on GitHub
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6v6m0-6L10 14M19 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h6" />
            </svg>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </>
    )
  }

  return (
    // Not an interactive element: it only stops key events bubbling out of the dialog.
    <div onKeyDown={containKeys}>
      <ModalBase isOpen onClose={close} title="Send feedback" size="xl" footer={footer} closeLabel="Close feedback">
        {body}
      </ModalBase>
    </div>
  )
}

export default FeedbackDialog
