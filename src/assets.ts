// Brand assets in, textures out: rasterize a logo (SVG or bitmap) for the floor of the tank.

export async function loadImage(src: string) {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await img.decode()
  return img
}

/** the image's aspect (width / height), with SVGs that lack a size falling back to their viewBox */
export function imageAspect(img: HTMLImageElement) {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  return w > 0 && h > 0 ? w / h : 1
}

/** draws `img` to fill a canvas of `width` px, keeping its aspect */
export function rasterize(
  img: CanvasImageSource & { width: number },
  width: number,
  aspect: number
) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.max(1, Math.round(width / aspect))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Converts a logo to the floor's emission: white where the logo is, with its alpha as coverage.
 * `luminance` uses brightness instead, for light logos on an opaque dark background; `inverse`
 * uses darkness, for dark logos on an opaque light one.
 */
export function toMask(
  canvas: HTMLCanvasElement,
  mode: 'alpha' | 'luminance' | 'inverse' = 'alpha'
) {
  const ctx = canvas.getContext('2d')!
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = im.data
  for (let i = 0; i < d.length; i += 4) {
    const lum =
      (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) *
      (d[i + 3]! / 255)
    const a =
      mode === 'alpha'
        ? d[i + 3]!
        : Math.round(mode === 'luminance' ? lum : 255 - lum)
    d[i] = d[i + 1] = d[i + 2] = 255
    d[i + 3] = a
  }
  ctx.putImageData(im, 0, 0)
  return canvas
}
