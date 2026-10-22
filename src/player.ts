// The preview player: draws the video live in a 16:9 frame, in sync with the song. Space plays
// and pauses, the arrow keys step a frame (with shift, a beat), and the bar scrubs.

import { PlaybackClock } from './clock'
import { drawFrame } from './frame'
import type { Timeline } from './timeline'

/** frame rate of the rendered video, for frame stepping */
const FPS = 60
const ASPECT = 16 / 9

export function createPlayer(timeline: Timeline, start = 0) {
  const stage = document.querySelector<HTMLElement>('.stage')!
  const canvas = stage.querySelector('canvas')!
  const ctx = canvas.getContext('2d')!
  const play = document.querySelector<HTMLButtonElement>('[data-play]')!
  const scrub = document.querySelector<HTMLInputElement>('[data-scrub]')!
  const readout = document.querySelector<HTMLElement>('[data-time]')!

  // a relative URL, so the song resolves next to the page in dev and in a built site
  const clock = new PlaybackClock(timeline.duration, timeline.audio)
  clock.seek(start)
  scrub.max = String(timeline.duration)

  const fit = () => {
    // a page loaded hidden (a background tab) has no size yet; the observer catches up
    const w = Math.max(1, stage.clientWidth)
    const h = Math.max(1, Math.min(stage.clientHeight, w / ASPECT))
    const dpr = Math.min(2, devicePixelRatio || 1)
    canvas.style.width = `${Math.round(h * ASPECT)}px`
    canvas.style.height = `${Math.round(h)}px`
    canvas.width = Math.round(h * ASPECT * dpr)
    canvas.height = Math.round(h * dpr)
  }
  new ResizeObserver(fit).observe(stage)
  fit()

  play.addEventListener('click', () => clock.toggle())
  scrub.addEventListener('input', () => clock.seek(Number(scrub.value)))
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      clock.toggle()
    } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      e.preventDefault()
      const dir = e.code === 'ArrowRight' ? 1 : -1
      const beat = Math.round((FPS * 60) / timeline.tempo)
      clock.step(dir * (e.shiftKey ? beat : 1), FPS)
    }
  })

  const tick = () => {
    requestAnimationFrame(tick)
    const t = clock.time()
    drawFrame(ctx, t, timeline)
    play.textContent = clock.playing ? 'Pause' : 'Play'
    if (document.activeElement !== scrub) scrub.value = String(t)
    readout.textContent = `${t.toFixed(2)} / ${timeline.duration.toFixed(2)} s`
  }
  tick()
}
