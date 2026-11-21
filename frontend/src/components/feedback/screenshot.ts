/**
 * A picture of what the reporter is looking at (issue #49).
 *
 * The page is drawn by html-to-image, which clones the DOM into an SVG
 * foreignObject: the D3 timeline is SVG already, and Cytoscape's canvases are
 * copied as images. Then it is cropped to the part of the page in view (a
 * phone scrolls the page itself, #37) and kept small enough to send: at most
 * 1600 px wide, as a PNG while that stays under the budget, else as a JPEG.
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

export async function captureScreenshot(root: HTMLElement = document.body): Promise<Screenshot> {
  const scale = 1
  const background = getComputedStyle(document.body).backgroundColor || '#ffffff'
  const full = await toCanvas(root, {
    pixelRatio: scale,
    backgroundColor: background,
    filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-feedback-ignore')),
  })

  const view = {
    x: window.scrollX,
    y: window.scrollY,
    width: Math.min(window.innerWidth, full.width / scale),
    height: Math.min(window.innerHeight, full.height / scale - window.scrollY),
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
