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

/** A page html-to-image cannot finish drawing should not keep the dialog from opening. */
const CAPTURE_TIMEOUT_MS = 8000

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Drawing the screen took too long')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
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

  openFeedback: async () => {
    if (get().phase !== 'closed') return
    set({ phase: 'capturing', screenshot: null, screenshotError: null, context: null })
    await afterPaint()
    // The state first: it is what the reporter saw, before anything else changes.
    const context = captureContext(get().extras)
    let screenshot: Screenshot | null = null
    let screenshotError: string | null = null
    try {
      screenshot = await withTimeout(captureScreenshot(), CAPTURE_TIMEOUT_MS)
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : 'The screen could not be captured'
    }
    // Closed while capturing (Escape on the notice): stay closed.
    if (get().phase !== 'capturing') return
    set({ phase: 'open', context, screenshot, screenshotError })
  },

  closeFeedback: () => set({ phase: 'closed', screenshot: null, context: null, screenshotError: null }),
  updateDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  clearDraft: () => set({ draft: EMPTY_DRAFT }),
  setExtras: (extras) => set({ extras }),
}))
