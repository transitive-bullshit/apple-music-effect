// What moves the oil, as pure functions of shot time: the rig's height (keyframes), the note's
// wobble on top of it (a damped oscillation at the note's frequency, slowed to picture time), and
// the camera's zoom.

/** [time in s, value] */
export type Key = readonly [number, number]

/**
 * Monotone cubic interpolation (Fritsch-Carlson) through the keys: smooth, with no overshoot
 * between keys, and held flat before the first and after the last.
 */
export function interpolate(keys: readonly Key[], t: number) {
  const n = keys.length
  if (n === 0) return 0
  if (t <= keys[0]![0] || n === 1) return keys[0]![1]
  if (t >= keys[n - 1]![0]) return keys[n - 1]![1]
  let i = 0
  while (t > keys[i + 1]![0]) i++
  const slopes = tangents(keys)
  const [t0, y0] = keys[i]!
  const [t1, y1] = keys[i + 1]!
  const h = t1 - t0
  const s = (t - t0) / h
  const s2 = s * s
  const s3 = s2 * s
  return (
    (2 * s3 - 3 * s2 + 1) * y0 +
    (s3 - 2 * s2 + s) * h * slopes[i]! +
    (-2 * s3 + 3 * s2) * y1 +
    (s3 - s2) * h * slopes[i + 1]!
  )
}

function tangents(keys: readonly Key[]) {
  const n = keys.length
  const d = Array.from({ length: n - 1 }, (_, i) => {
    const [t0, y0] = keys[i]!
    const [t1, y1] = keys[i + 1]!
    return (y1 - y0) / (t1 - t0)
  })
  const m = keys.map((_, i) =>
    i === 0 ? d[0]! : i === n - 1 ? d[n - 2]! : (d[i - 1]! + d[i]!) / 2
  )
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i]! / d[i]!
    const b = m[i + 1]! / d[i]!
    // flat where the data changes direction, and limited so the curve stays monotone
    if (a < 0) m[i] = 0
    if (b < 0) m[i + 1] = 0
    const r = Math.hypot(a, b)
    if (r > 3) {
      m[i] = (3 * a * d[i]!) / r
      m[i + 1] = (3 * b * d[i]!) / r
    }
  }
  return m
}

export interface Wobble {
  /** shot time the note starts */
  start: number
  /** oscillation frequency in picture time, Hz */
  freq: number
  /** peak displacement, in world units */
  amp: number
  /** seconds for the oscillation to fall to 1/e */
  decay: number
  /** seconds to fade in */
  attack: number
}

/** the note's damped oscillation of the rig, zero before it starts */
export function wobble(w: Wobble | null, t: number) {
  if (!w || w.amp === 0) return 0
  const u = t - w.start
  if (u <= 0) return 0
  const fadeIn = w.attack > 0 ? Math.min(1, u / w.attack) : 1
  return (
    w.amp * fadeIn * Math.exp(-u / w.decay) * Math.sin(2 * Math.PI * w.freq * u)
  )
}

/** the rig's height at shot time t: keyframes plus the note's wobble */
export function rigHeight(keys: readonly Key[], w: Wobble | null, t: number) {
  return interpolate(keys, t) + wobble(w, t)
}

/** the rig's vertical velocity, by central difference */
export function rigVelocity(
  keys: readonly Key[],
  w: Wobble | null,
  t: number,
  h = 1e-4
) {
  return (rigHeight(keys, w, t + h) - rigHeight(keys, w, t - h)) / (2 * h)
}
