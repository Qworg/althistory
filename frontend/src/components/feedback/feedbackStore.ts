import { create } from 'zustand'
import { captureContext, type ContextExtras, type FeedbackContext } from './captureContext'
import { captureScreenshot, type Screenshot } from './screenshot'
import type { FeedbackKind } from './issueBody'

export interface FeedbackDraft {
  kind: FeedbackKind
  title: string
  description: string
  includeScreenshot: boolean
  includeState: boolean
}

const EMPTY_DRAFT: FeedbackDraft = {
  kind: 'bug',
  title: '',
  description: '',
  includeScreenshot: true,
  includeState: true,
}

/**
 * A page html-to-image cannot finish drawing should not keep the dialog from
 * opening. The limit is checked between the drawing's steps: a very large page
 * can hold the browser for longer in one step, and opens late.
 */
const CAPTURE_TIMEOUT_MS = 8000

/** The capture in progress, so closing (Escape) can cancel it and put the page back. */
let capturing: AbortController | null = null

interface FeedbackState {
  /** `capturing` while the screen is drawn, before the dialog appears (so it is not in the picture). */
  phase: 'closed' | 'capturing' | 'open'
  screenshot: Screenshot | null
  /** Why there is no screenshot, when capturing it failed. */
  screenshotError: string | null
  context: FeedbackContext | null
  /** Kept when the dialog closes without sending, so nothing typed is lost. */
  draft: FeedbackDraft
  /** What only a mounted component knows (the open graph's name); set by FeedbackHost. */
  extras: ContextExtras
  /** Counts openings: the dialog is keyed on it, so each opening starts with fresh local state. */
  openCount: number
  /** Whether feedback is offered here (built in, and not turned off by the server); set by FeedbackHost. */
  available: boolean
  setAvailable: (available: boolean) => void
  openFeedback: () => Promise<void>
  closeFeedback: () => void
  updateDraft: (patch: Partial<FeedbackDraft>) => void
  /** After a report is sent: the next one starts empty. */
  clearDraft: () => void
  setExtras: (extras: ContextExtras) => void
}

/** Two frames: whatever opened this (a sheet, the help dialog) has closed and painted. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/**
 * The feedback dialog's state (issue #49). Mounted once (FeedbackHost, in
 * MainLayout) and opened from the header button, the phone's More sheet, the
 * help dialog and Shift+I, so the open state lives here.
 */
export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  phase: 'closed',
  screenshot: null,
  screenshotError: null,
  context: null,
  draft: EMPTY_DRAFT,
  extras: {},
  openCount: 0,
  available: false,
  setAvailable: (available) => set({ available }),

  openFeedback: async () => {
    // Turned off on this install (or not known yet): every way in leads here, so it stops here.
    if (!get().available || get().phase !== 'closed') return
    set((state) => ({ phase: 'capturing', screenshot: null, screenshotError: null, context: null, openCount: state.openCount + 1 }))
    const opening = get().openCount
    // Made before waiting for paint, so Escape in those frames cancels it too.
    const controller = new AbortController()
    capturing = controller
    await afterPaint()
    // Cancelled while waiting: draw nothing, so the page is never shifted.
    if (controller.signal.aborted || get().openCount !== opening) {
      if (capturing === controller) capturing = null
      return
    }
    // The state first: it is what the reporter saw, before anything else changes.
    const context = captureContext(get().extras)
    let screenshot: Screenshot | null = null
    let screenshotError: string | null = null
    const timer = setTimeout(() => controller.abort(new Error('Drawing the screen took too long')), CAPTURE_TIMEOUT_MS)
    try {
      screenshot = await captureScreenshot(document.body, controller.signal)
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : 'The screen could not be captured'
    } finally {
      clearTimeout(timer)
      if (capturing === controller) capturing = null
    }
    // Cancelled while capturing (Escape, handled by FeedbackHost): stay closed. And
    // if it was cancelled and opened again, this capture is not the new one's.
    if (get().phase !== 'capturing' || get().openCount !== opening) return
    set({ phase: 'open', context, screenshot, screenshotError })
  },

  closeFeedback: () => {
    // Cancelling puts the page back now, not when the drawing ends.
    capturing?.abort(new Error('The capture was cancelled'))
    capturing = null
    set({ phase: 'closed', screenshot: null, context: null, screenshotError: null })
  },
  updateDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  clearDraft: () => set({ draft: EMPTY_DRAFT }),
  setExtras: (extras) => set({ extras }),
}))
