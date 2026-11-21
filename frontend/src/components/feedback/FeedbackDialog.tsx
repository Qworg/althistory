import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
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
  | { kind: 'opened'; clipboard: 'pending' | 'image' | 'text' | 'failed' | 'none'; bodyOnClipboard: boolean }

/** The server's own refusals: GitHub said no, or the server was never going to ask it. Nothing was filed. */
const REFUSAL_CODES = new Set(['FEEDBACK_NOT_CONFIGURED', 'FEEDBACK_REFUSED', 'FEEDBACK_GITHUB_LIMITED', 'FEEDBACK_RATE_LIMITED'])

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
  'mt-1 min-h-11 w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-selected'
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
  const [serverProblem, setServerProblem] = useState<React.ReactNode>(null)
  // Counts problems, so focus moves to each new one (the Send button that had it was disabled).
  const [problemSeen, setProblemSeen] = useState(0)
  const problemRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (problemSeen > 0) problemRef.current?.focus()
  }, [problemSeen])
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
  const sending = outcome.kind === 'sending'
  const doneRef = useRef<HTMLButtonElement>(null)

  // The dialog is keyed per opening (FeedbackHost), so its local state starts
  // fresh each time. Once the report has gone (filed, or handed to GitHub's
  // form) any way of closing clears the draft, so it cannot be sent twice.
  const close = () => {
    if (sending) return
    if (outcome.kind === 'filed' || outcome.kind === 'opened') clearDraft()
    closeFeedback()
  }

  // Focus follows the dialog to its new content: otherwise it falls to <body>.
  useEffect(() => {
    if (outcome.kind === 'filed' || outcome.kind === 'opened') doneRef.current?.focus()
  }, [outcome.kind])

  const issuesUrl = `https://github.com/${repo}/issues?q=${encodeURIComponent('is:issue label:feedback sort:created-desc')}`

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
      setOutcome({ kind: 'form' })
      setProblemSeen((seen) => seen + 1)
      // Refused (a 4xx, or one of the server's own codes): nothing was filed,
      // so the form is the way on.
      if ((status >= 400 && status < 500) || (code && REFUSAL_CODES.has(code))) {
        setServerDeclined(true)
        setServerProblem(
          code === 'FEEDBACK_NOT_CONFIGURED'
            ? 'This server does not file reports, so the report goes through GitHub’s form instead.'
            : status === 429 || code === 'FEEDBACK_GITHUB_LIMITED'
              ? `${error instanceof Error ? error.message : 'Too many reports.'} You can still send it through GitHub’s form.`
              : status === 400 && error instanceof Error
                ? `The server could not take the report (${error.message}). You can send it through GitHub’s form instead; nothing you wrote is lost.`
                : 'The server could not file the report. You can send it through GitHub’s form instead; nothing you wrote is lost.'
        )
        return
      }
      // Anything else (no answer, a gateway's 5xx, or the server's
      // FEEDBACK_MAYBE_FILED) may follow a filing. Sending again, either way,
      // could file it twice, so the reporter looks first, then chooses.
      setServerProblem(
        <>
          The server did not say whether the report was filed.{' '}
          <a href={issuesUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-baseline underline">
            Check the latest feedback issues
          </a>
          . If it is not there, send it again, or{' '}
          <button
            type="button"
            onClick={() => {
              setServerDeclined(true)
              setServerProblem(null)
            }}
            className="font-medium text-baseline underline"
          >
            use GitHub’s form instead
          </button>
          .
        </>
      )
    }
  }

  const retryCopy = () => {
    void copyForForm(null, prefilled.fullBody).then((clipboard) =>
      setOutcome({ kind: 'opened', clipboard, bodyOnClipboard: true })
    )
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
    const bodyOnClipboard = prefilled.bodyOnClipboard
    // The report has gone to GitHub from this click on: closing now clears the draft.
    setOutcome({ kind: 'opened', clipboard: 'pending', bodyOnClipboard })
    void copyForForm(bodyOnClipboard ? null : png, bodyOnClipboard ? prefilled.fullBody : null).then((clipboard) =>
      setOutcome((current) => (current.kind === 'opened' ? { kind: 'opened', clipboard, bodyOnClipboard } : current))
    )
  }

  // Keys pressed in the dialog stay in it (as in the help dialog), so the
  // view's shortcuts do not act underneath; Escape closes it, keeping the draft.
  const containKeys = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') return
    event.stopPropagation()
    // While sending, the dialog stays: the answer says whether the issue exists.
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  if (!isOpen) return null

  const kindPlaceholder = KINDS.find((k) => k.id === draft.kind)?.placeholder

  let body: React.ReactNode
  let footer: React.ReactNode

  const announcement =
    outcome.kind === 'filed'
      ? `Report sent. It is issue ${outcome.number}.`
      : outcome.kind === 'opened'
        ? 'GitHub’s form is open in a new tab.'
        : sending
          ? 'Sending the report.'
          : ''

  if (outcome.kind === 'filed') {
    body = (
      <div className="space-y-3 text-sm text-ink-secondary">
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
      <button ref={doneRef} type="button" className={primaryClass} onClick={close}>
        Done
      </button>
    )
  } else if (outcome.kind === 'opened') {
    body = (
      <div className="space-y-3 text-sm text-ink-secondary">
        <p className="text-base text-ink">GitHub’s form is open in a new tab, filled in.</p>
        {outcome.clipboard === 'image' && <p>The screenshot is on your clipboard: paste it into the form (Ctrl+V or ⌘V).</p>}
        {outcome.clipboard === 'text' && (
          <p>The report was too long for a link, so it is on your clipboard: paste it into the form’s description.</p>
        )}
        {outcome.clipboard === 'failed' && !outcome.bodyOnClipboard && (
          <p>The screenshot could not be put on your clipboard. Download it and drag the file into the form.</p>
        )}
        {outcome.clipboard === 'failed' && outcome.bodyOnClipboard && (
          <div className="space-y-2">
            <p>The report could not be put on your clipboard. Copy it from here and paste it into the form’s description:</p>
            <textarea
              readOnly
              value={prefilled.fullBody}
              aria-label="The report, to copy into GitHub’s form"
              rows={6}
              onFocus={(event) => event.currentTarget.select()}
              className={`${inputClass} font-mono-code text-xs`}
            />
            <button type="button" className={secondaryClass} onClick={retryCopy}>
              Try copying again
            </button>
          </div>
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
        <button ref={doneRef} type="button" className={primaryClass} onClick={close}>
          Done
        </button>
      </>
    )
  } else {
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
          <p
            ref={problemRef}
            tabIndex={-1}
            role="alert"
            className="rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-selected"
          >
            {serverProblem}
          </p>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-ink-secondary">What is it?</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {KINDS.map((kind) => (
              <label
                key={kind.id}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
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
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink lg:min-h-0">
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

          <label className="flex min-h-11 items-center gap-2 text-sm text-ink lg:min-h-0">
            <input
              type="checkbox"
              checked={draft.includeState}
              onChange={(event) => updateDraft({ includeState: event.target.checked })}
            />
            Include the page, app state, browser and recent errors
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer py-3 text-ink-secondary hover:text-ink lg:py-0">See what is sent</summary>
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
        {waitingForConfig ? (
          <button type="button" className={primaryClass} disabled>
            Checking how to send…
          </button>
        ) : serverFiling ? (
          <button type="submit" form={`${ids}-form`} className={primaryClass} disabled={sending}>
            {sending ? 'Sending…' : 'Send report'}
          </button>
        ) : (
          <a
            href={prefilled.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openForm}
            className={primaryClass}
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
      <ModalBase
        isOpen
        onClose={close}
        title="Send feedback"
        size="xl"
        footer={footer}
        closeLabel="Close feedback"
        closeOnEscape={!sending}
        closeOnBackdrop={!sending}
        showCloseButton={!sending}
      >
        {/* One live region for the whole dialog, so each change of content is announced. */}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
        {body}
      </ModalBase>
    </div>
  )
}

export default FeedbackDialog
