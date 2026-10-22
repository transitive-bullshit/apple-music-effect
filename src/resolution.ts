// How many pixels to draw for a canvas: its size on screen at the display's pixel density, so the
// picture is sharp on any screen, within a budget (4K by default).

export const MAX_PIXELS = 3840 * 2160

export interface SizeOptions {
  /** a share of the full density, to draw fewer pixels */
  scale?: number
  maxPixels?: number
  /** keep this width / height (the canvas's CSS may crop it, as with object-fit: cover) */
  aspect?: number
}

/** the drawing size for `canvas` as laid out now */
export function drawingSize(
  canvas: HTMLCanvasElement,
  { scale = 1, maxPixels = MAX_PIXELS, aspect }: SizeOptions = {}
): [number, number] {
  const box = canvas.getBoundingClientRect()
  const dpr = globalThis.devicePixelRatio || 1
  let w = Math.max(1, box.width * dpr * scale)
  let h = aspect ? w / aspect : Math.max(1, box.height * dpr * scale)
  const over = Math.sqrt((w * h) / maxPixels)
  if (over > 1) {
    w /= over
    h /= over
  }
  return [Math.round(w), Math.round(h)]
}
