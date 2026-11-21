/**
 * A picture of what the reporter is looking at (issue #49).
 *
 * The page is drawn by html-to-image, which clones the DOM into an SVG
 * foreignObject: the D3 timeline is SVG already, and Cytoscape's canvases are
 * copied as images. Then it is cropped to the window and kept small enough to send: at most
 * 1600 px wide, as a PNG while that stays under the budget, else as a JPEG.
 *
 * html-to-image clones the page without its scroll positions, and this app
 * scrolls both the window (a phone scrolls the page itself, #37) and elements
 * inside it. So, for the moment of the capture, the window and every scrolled
 * element are scrolled back to the top
 * and its content is shifted up by the same amount with negative margins: the
 * page looks the same, and the clone draws what was in view. Margins, not
 * transforms, because a transform would move `position: fixed` descendants.
 *
 * Anything marked `data-feedback-ignore` is left out, such as the little
 * "Capturing…" notice shown while this runs.
 */

import { toCanvas } from 'html-to-image'

export interface Screenshot {
  /** A PNG, for the clipboard (the only image type browsers put there). */
  png: Blob
  /** What is sent and previewed: the PNG, or a JPEG when the PNG is too big. */
  dataUrl: string
  width: number
  height: number
}

const MAX_WIDTH = 1600
/** The server takes 2 MB decoded; this leaves room. */
export const SCREENSHOT_BUDGET_BYTES = 1_500_000

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The screenshot could not be encoded'))), type, quality)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The screenshot could not be read'))
    reader.readAsDataURL(blob)
  })
}

/** Copy the visible part of `source` into a canvas no wider than `maxWidth`. */
function cropToView(source: HTMLCanvasElement, view: { x: number; y: number; width: number; height: number }, scale: number, maxWidth: number) {
  const fit = Math.min(1, maxWidth / view.width)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(view.width * fit))
  out.height = Math.max(1, Math.round(view.height * fit))
  const context = out.getContext('2d')
  if (!context) throw new Error('The screenshot could not be drawn')
  context.drawImage(
    source,
    view.x * scale,
    view.y * scale,
    view.width * scale,
    view.height * scale,
    0,
    0,
    out.width,
    out.height
  )
  return out
}

/** A computed length in px; 0 when there is none (a detached or unstyled element). */
function px(value: string): number {
  return parseFloat(value) || 0
}

function inFlow(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  const position = getComputedStyle(element).position
  return position !== 'absolute' && position !== 'fixed'
}

/** Jump, never animate: `scroll-behavior: smooth` would glide the page back under the dialog. */
function jump(target: Window | HTMLElement, left: number, top: number): void {
  if (typeof target.scrollTo === 'function') {
    try {
      target.scrollTo({ left, top, behavior: 'instant' })
      return
    } catch {
      // An old engine without the options form: fall through.
    }
  }
  if (target instanceof HTMLElement) {
    target.scrollLeft = left
    target.scrollTop = top
  }
}

/** Run once, however often called. */
function once(fn: () => void): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    fn()
  }
}

/**
 * Shift `children` by (-left, -top) for the capture, and return what puts
 * them back. Block flow and a column of flex items are shifted with negative
 * margins: the first child carries the rest down the page, and each child
 * moves sideways on its own. A grid or a row of flex items lays its items in
 * tracks or lines, which negative margins would collapse, so each item is
 * moved with `translate`, which leaves layout alone.
 */
function shift(container: HTMLElement, left: number, top: number): () => void {
  const children = Array.from(container.children).filter(inFlow)
  if (children.length === 0) return () => undefined
  const style = getComputedStyle(container)
  const tracks = style.display.includes('grid') || (style.display.includes('flex') && !style.flexDirection.startsWith('column'))
  const saved = children.map((child) => ({
    child,
    marginTop: child.style.marginTop,
    marginLeft: child.style.marginLeft,
    translate: child.style.translate,
  }))

  if (tracks) {
    for (const child of children) {
      const [x = 0, y = 0] = (getComputedStyle(child).translate || 'none')
        .split(/\s+/)
        .map((part) => (part === 'none' ? 0 : px(part)))
      child.style.translate = `${x - left}px ${y - top}px`
    }
  } else {
    const first = children[0]
    if (first && top > 0) first.style.marginTop = `${px(getComputedStyle(first).marginTop) - top}px`
    if (left > 0) for (const child of children) child.style.marginLeft = `${px(getComputedStyle(child).marginLeft) - left}px`
  }

  return () => {
    for (const { child, marginTop, marginLeft, translate } of saved) {
      child.style.marginTop = marginTop
      child.style.marginLeft = marginLeft
      child.style.translate = translate
    }
  }
}

/**
 * Show the window's and each scrolled element's content without its scroll
 * (see above), and return what puts everything back. The returned function
 * runs once, however often it is called, so a cancelled capture can put the
 * page back at once and its late `finally` changes nothing.
 */
export function flattenScrolling(root: HTMLElement): () => void {
  const restores: Array<() => void> = []

  // The window first. `body` can be only as tall as the window while the page
  // scrolls past it, so cropping body's picture by scrollY would cut it short.
  // Shift body's content up instead, and draw the top of the page.
  const { scrollX, scrollY } = window
  if (scrollX > 0 || scrollY > 0) {
    const unshift = shift(document.body, scrollX, scrollY)
    jump(window, 0, 0)
    restores.push(() => {
      unshift()
      jump(window, scrollX, scrollY)
    })
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
    if (!(node instanceof HTMLElement) || node === document.body || node === document.documentElement) continue
    const { scrollTop: top, scrollLeft: left } = node
    if (top <= 0 && left <= 0) continue
    const unshift = shift(node, left, top)
    jump(node, 0, 0)
    const element = node
    restores.push(() => {
      unshift()
      jump(element, left, top)
    })
  }
  return once(() => {
    for (const restore of restores.reverse()) restore()
  })
}

/** Captures run one at a time: a new one waits until the last has put the page back. */
let lastCapture: Promise<unknown> = Promise.resolve()

/**
 * Draw the page. `signal` cancels it (Escape, or the store's time limit): the
 * page is put back at once, and the drawing, which cannot be stopped, is
 * thrown away when it ends.
 */
export function captureScreenshot(root: HTMLElement = document.body, signal?: AbortSignal): Promise<Screenshot> {
  const run = lastCapture.catch(() => undefined).then(() => drawScreenshot(root, signal))
  lastCapture = run
  return run
}

async function drawScreenshot(root: HTMLElement, signal?: AbortSignal): Promise<Screenshot> {
  const cancelled = () => (signal?.reason instanceof Error ? signal.reason : new Error('The capture was cancelled'))
  if (signal?.aborted) throw cancelled()
  const scale = 1
  const background = getComputedStyle(document.body).backgroundColor || '#ffffff'
  const restore = flattenScrolling(root)
  let full: HTMLCanvasElement
  try {
    full = await new Promise<HTMLCanvasElement>((resolve, reject) => {
      const abort = () => {
        restore()
        reject(cancelled())
      }
      signal?.addEventListener('abort', abort, { once: true })
      toCanvas(root, {
        pixelRatio: scale,
        backgroundColor: background,
        filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-feedback-ignore')),
      }).then(
        (canvas) => {
          signal?.removeEventListener('abort', abort)
          resolve(canvas)
        },
        (error: unknown) => {
          signal?.removeEventListener('abort', abort)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
    })
  } finally {
    restore()
  }

  // Scrolling was flattened above, so what was in view is the top-left corner.
  const view = {
    x: 0,
    y: 0,
    width: Math.min(window.innerWidth, full.width / scale),
    height: Math.min(window.innerHeight, full.height / scale),
  }

  let canvas = cropToView(full, view, scale, MAX_WIDTH)
  let png = await toBlob(canvas, 'image/png')
  let sent: Blob = png
  if (png.size > SCREENSHOT_BUDGET_BYTES) {
    sent = await toBlob(canvas, 'image/jpeg', 0.85)
    if (sent.size > SCREENSHOT_BUDGET_BYTES) {
      canvas = cropToView(full, view, scale, 1000)
      png = await toBlob(canvas, 'image/png')
      sent = await toBlob(canvas, 'image/jpeg', 0.75)
    }
  }

  return { png, dataUrl: await blobToDataUrl(sent), width: canvas.width, height: canvas.height }
}
