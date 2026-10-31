/**
 * The contract between the capture (which writes it) and the video (which
 * reads it). Rectangles and points are in CSS pixels of the captured viewport;
 * multiply by `deviceScaleFactor` for image pixels.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Shot {
  id: string
  /** File name inside the shots directory. */
  file: string
  /** Size of the picture in CSS pixels: the viewport, or the page for a full-page shot. */
  size: { width: number; height: number }
  /** Named regions of the screen the video can zoom to or outline. */
  focus: Record<string, Rect>
  /** Where the pointer was (hover or click) when the shot was taken. */
  pointer?: Point
}

export interface Manifest {
  generatedAt: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  graphName: string
  shots: Record<string, Shot>
}
