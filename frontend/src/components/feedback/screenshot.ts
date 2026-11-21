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

/**
 * Show each scrolled element's content without its scroll (see above), and
 * return what puts everything back.
 */
export function flattenScrolling(root: HTMLElement): () => void {
  const restores: Array<() => void> = []

  // The window first. `body` can be only as tall as the window while the page
  // scrolls past it, so cropping body's picture by scrollY would cut it short.
  // Shift body's content up instead, and draw the top of the page.
  const { scrollX, scrollY } = window
  if (scrollX > 0 || scrollY > 0) {
    const children = Array.from(document.body.children).filter(inFlow)
    const saved = children.map((child) => ({ child, top: child.style.marginTop, left: child.style.marginLeft }))
    const first = children[0]
    if (first && scrollY > 0) first.style.marginTop = `${px(getComputedStyle(first).marginTop) - scrollY}px`
    if (scrollX > 0) {
      for (const child of children) child.style.marginLeft = `${px(getComputedStyle(child).marginLeft) - scrollX}px`
    }
    window.scrollTo(0, 0)
    restores.push(() => {
      for (const { child, top, left } of saved) {
        child.style.marginTop = top
        child.style.marginLeft = left
      }
      window.scrollTo(scrollX, scrollY)
    })
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
    if (!(node instanceof HTMLElement) || node === document.body || node === document.documentElement) continue
    const { scrollTop: top, scrollLeft: left } = node
    if (top <= 0 && left <= 0) continue

    const style = getComputedStyle(node)
    const row = (style.display.includes('flex') && !style.flexDirection.startsWith('column')) || style.display.includes('grid')
    const children = Array.from(node.children).filter(inFlow)
    if (children.length === 0) continue
    // Down the page, shifting the first child moves the rest after it; across a
    // row, each item sits on its own, so each is shifted. Sideways, the reverse.
    const shiftTop = row ? children : children.slice(0, 1)
    const shiftLeft = row ? children.slice(0, 1) : children

    const saved = children.map((child) => ({ child, top: child.style.marginTop, left: child.style.marginLeft }))
    if (top > 0) {
      for (const child of shiftTop) child.style.marginTop = `${px(getComputedStyle(child).marginTop) - top}px`
    }
    if (left > 0) {
      for (const child of shiftLeft) child.style.marginLeft = `${px(getComputedStyle(child).marginLeft) - left}px`
    }
    node.scrollTop = 0
    node.scrollLeft = 0
    const element = node
    restores.push(() => {
      for (const { child, top: savedTop, left: savedLeft } of saved) {
        child.style.marginTop = savedTop
        child.style.marginLeft = savedLeft
      }
      element.scrollTop = top
      element.scrollLeft = left
    })
  }
  return () => {
    for (const restore of restores.reverse()) restore()
  }
}

export async function captureScreenshot(root: HTMLElement = document.body): Promise<Screenshot> {
  const scale = 1
  const background = getComputedStyle(document.body).backgroundColor || '#ffffff'
  const restore = flattenScrolling(root)
  let full: HTMLCanvasElement
  try {
    full = await toCanvas(root, {
      pixelRatio: scale,
      backgroundColor: background,
      filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-feedback-ignore')),
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
