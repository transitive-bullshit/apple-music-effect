// Brand assets in, textures out: rasterize a logo (SVG or bitmap) for the floor of the tank, and
// build signed distance fields for the glass cover's footprint.

export type FootprintKind = 'squircle' | 'circle' | 'rect'

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

/** coverage (0..1) of a shape centred in a w x h grid, sized `sw` x `sh` px */
export function footprintCoverage(
  kind: FootprintKind,
  w: number,
  h: number,
  sw: number,
  sh: number
) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.translate(w / 2, h / 2)
  ctx.beginPath()
  if (kind === 'circle') ctx.ellipse(0, 0, sw / 2, sh / 2, 0, 0, Math.PI * 2)
  else if (kind === 'rect') ctx.rect(-sw / 2, -sh / 2, sw, sh)
  else {
    // a superellipse with exponent 5 is close to Apple's continuous-corner icon shape
    const n = 5
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      const x = (Math.sign(c) * Math.abs(c) ** (2 / n) * sw) / 2
      const y = (Math.sign(s) * Math.abs(s) ** (2 / n) * sh) / 2
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
  ctx.fill()
  return coverageOf(canvas)
}

export function coverageOf(canvas: HTMLCanvasElement) {
  const d = canvas
    .getContext('2d')!
    .getImageData(0, 0, canvas.width, canvas.height).data
  const out = new Float32Array(canvas.width * canvas.height)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3]! / 255
  return out
}

/** 1D squared Euclidean distance transform (Felzenszwalb and Huttenlocher) */
function edt1d(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array
) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    d[q] = (q - v[k]!) ** 2 + f[v[k]!]!
  }
}

/** squared distance (px²) from each cell to the nearest cell where `inside` holds */
function edt(inside: (i: number) => boolean, w: number, h: number) {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = inside(i) ? 0 : 1e20
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]!
  }
  return grid
}

/**
 * Signed distance in px from coverage: negative inside, positive outside. The half-pixel
 * offsets put the zero crossing on the shape's edge rather than on the cell centres beside it.
 */
export function signedDistance(coverage: Float32Array, w: number, h: number) {
  const outside = edt((i) => coverage[i]! >= 0.5, w, h)
  const inside = edt((i) => coverage[i]! < 0.5, w, h)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    out[i] =
      coverage[i]! >= 0.5
        ? -(Math.sqrt(inside[i]!) - 0.5)
        : Math.sqrt(outside[i]!) - 0.5
  }
  return out
}
