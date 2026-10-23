// Logos for each shot: Apple's (our traces in public/apple), or one the viewer brings. Any logo is
// fitted to its shot by its visible bounds, so padding in an SVG's viewBox doesn't shrink it.

import { imageAspect, loadImage } from './assets'
import type { Film, LogoSpec } from './scene'

/** where each shot puts its logo: the box its visible bounds fit inside, world units */
const SLOTS: Record<
  string,
  { center: [number, number]; box: [number, number] }
> = {
  // Apple's note at rest: 0.62 units tall in a 1.24-unit glass tile
  icon: { center: [-0.0143, -0.0038], box: [0.56, 0.624] },
  // Apple's wordmark: 1.09 units wide
  wordmark: { center: [0, 0.01], box: [1.09, 0.34] }
}

/** the visible bounds of an image as fractions of its size: x, y, w, h (y down) */
export function visibleBounds(img: HTMLImageElement, mode: LogoSpec['mode']) {
  const size = 512
  const aspect = imageAspect(img)
  const canvas = document.createElement('canvas')
  canvas.width = aspect >= 1 ? size : Math.round(size * aspect)
  canvas.height = aspect >= 1 ? Math.round(size / aspect) : size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let x0 = canvas.width
  let y0 = canvas.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      const lum = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!
      const v =
        mode === 'alpha' ? d[i + 3]! : mode === 'luminance' ? lum : 255 - lum
      if (v < 128) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  if (x1 < 0) return [0, 0, 1, 1] as const
  return [
    x0 / canvas.width,
    y0 / canvas.height,
    (x1 + 1 - x0) / canvas.width,
    (y1 + 1 - y0) / canvas.height
  ] as const
}

/** alpha for transparent logos; for opaque ones, whichever of light-on-dark or dark-on-light fits */
export function detectMode(img: HTMLImageElement): LogoSpec['mode'] {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = Math.max(1, Math.round(64 / imageAspect(img)))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let transparent = 0
  let lum = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 250) transparent++
    lum += (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255
  }
  const n = d.length / 4
  if (transparent > n * 0.02) return 'alpha'
  return lum / n > 0.5 ? 'inverse' : 'luminance'
}

/** a logo spec that fits `src` to the shot's slot */
export async function fitLogo(
  shotName: string,
  src: string,
  mode?: LogoSpec['mode']
): Promise<LogoSpec> {
  const img = await loadImage(src)
  const m = mode ?? detectMode(img)
  const slot = SLOTS[shotName] ?? SLOTS.wordmark!
  const aspect = imageAspect(img)
  const [bx, by, bw, bh] = visibleBounds(img, m)
  // scale so the visible bounds fill the slot's box, then centre them on the slot
  const visibleAspect = (bw * aspect) / bh
  const visW = Math.min(slot.box[0], slot.box[1] * visibleAspect)
  const width = visW / bw
  const height = width / aspect
  const cx = slot.center[0] - (bx + bw / 2 - 0.5) * width
  const cy = slot.center[1] + (by + bh / 2 - 0.5) * height
  return { src, mode: m, center: [cx, cy], width }
}

/** the film with its logos resolved: Apple's, or the viewer's overrides */
export async function resolveLogos(
  film: Film,
  overrides: Record<string, string> = {}
): Promise<Film> {
  const shots = await Promise.all(
    film.shots.map(async (shot) => {
      const custom = overrides[shot.name]
      if (custom) return { ...shot, logo: await fitLogo(shot.name, custom) }
      return shot
    })
  )
  return { ...film, shots }
}
