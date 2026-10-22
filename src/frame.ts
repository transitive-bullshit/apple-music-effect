// One frame of the video as a pure function of song time: the same t always draws the same
// picture, so the player, stills and renders all agree. This is a placeholder look (soft color
// fields drifting on slow orbits, swelling on each beat) for the real effect to replace.

import { sinceBeat, type Timeline } from './timeline'

/** hue, orbit radius as a fraction of the frame, angular speed in rad/s, starting angle */
const FIELDS = [
  { hue: 340, orbit: 0.26, speed: 0.31, phase: 0 },
  { hue: 18, orbit: 0.22, speed: -0.23, phase: 2.1 },
  { hue: 265, orbit: 0.3, speed: 0.17, phase: 4.2 }
] as const

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  t: number,
  timeline: Timeline
) {
  const { width: w, height: h } = ctx.canvas
  // each beat swells the fields, decaying over about half a beat
  const pulse = Math.exp(-sinceBeat(timeline.beats, t) / (30 / timeline.tempo))
  const radius = Math.hypot(w, h) * (0.32 + 0.04 * pulse)

  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#0b0710'
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'lighter'
  for (const f of FIELDS) {
    const a = f.phase + f.speed * t
    const x = w / 2 + Math.cos(a) * f.orbit * w
    const y = h / 2 + Math.sin(1.3 * a) * f.orbit * h
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
    g.addColorStop(0, `hsl(${f.hue} 80% 55% / ${0.5 + 0.25 * pulse})`)
    g.addColorStop(1, `hsl(${f.hue} 80% 55% / 0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  ctx.globalCompositeOperation = 'source-over'
}
