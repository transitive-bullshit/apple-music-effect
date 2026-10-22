// The player: renders the film live in a 16:9 frame, in sync with the sting. Space plays and
// pauses, the arrow keys step a frame (with shift, a beat), and the bar scrubs. Drop an image on
// the picture to replace the logo of the shot that's showing; the panel uploads logos, tunes the
// look and exports an MP4.

import { fitLogo } from './brand'
import { PlaybackClock } from './clock'
import type { Engine } from './engine'
import { exportMp4 } from './export'
import { createPanel } from './panel'
import type { Film } from './scene'
import type { Timeline } from './timeline'

export function createPlayer(
  engine: Engine,
  timeline: Timeline,
  originals: Film,
  start = 0
) {
  const stage = document.querySelector<HTMLElement>('.stage')!
  const canvas = stage.querySelector('canvas')!
  const play = document.querySelector<HTMLButtonElement>('[data-play]')!
  const scrub = document.querySelector<HTMLInputElement>('[data-scrub]')!
  const readout = document.querySelector<HTMLElement>('[data-time]')!
  const overlay = document.querySelector<HTMLElement>('[data-overlay]')!
  const fileInput = document.querySelector<HTMLInputElement>('[data-file]')!
  const fps = engine.film.fps
  const aspect = engine.film.aspect
  const duration = Math.min(timeline.duration, engine.film.duration)

  // a relative URL, so the song resolves next to the page in dev and in a built site
  const clock = new PlaybackClock(duration, timeline.audio)
  clock.seek(start)
  scrub.max = String(duration)

  const fit = () => {
    // a page loaded hidden (a background tab) has no size yet; the observer catches up
    const w = Math.max(1, stage.clientWidth)
    const h = Math.max(1, Math.min(stage.clientHeight, w / aspect))
    canvas.style.width = `${Math.round(h * aspect)}px`
    canvas.style.height = `${Math.round(h)}px`
  }
  new ResizeObserver(fit).observe(stage)
  fit()

  let shown = -1
  const redraw = () => (shown = -1)

  const replaceLogo = async (shotName: string, file: File) => {
    const index = engine.film.shots.findIndex((s) => s.name === shotName)
    if (index < 0 || !file.type.startsWith('image/')) return
    const spec = await fitLogo(shotName, URL.createObjectURL(file))
    await engine.setLogo(index, spec)
    redraw()
  }

  let uploadFor = 'icon'
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) void replaceLogo(uploadFor, file)
    fileInput.value = ''
  })

  // drop an image on the picture: it replaces the logo of the shot that's showing
  stage.addEventListener('dragover', (e) => {
    e.preventDefault()
    stage.classList.add('dropping')
  })
  stage.addEventListener('dragleave', () => stage.classList.remove('dropping'))
  stage.addEventListener('drop', (e) => {
    e.preventDefault()
    stage.classList.remove('dropping')
    const file = e.dataTransfer?.files[0]
    const shot = engine.film.shots[engine.shotIndexAt(clock.time())]!
    if (file) void replaceLogo(shot.name, file)
  })

  let exporting: AbortController | null = null
  const exportVideo = async (height: number) => {
    if (exporting) return
    exporting = new AbortController()
    clock.pause()
    overlay.hidden = false
    overlay.textContent = 'Rendering…'
    try {
      const blob = await exportMp4({
        film: engine.film,
        params: engine.film.shots.map((_, i) => engine.getParams(i)),
        height,
        duration,
        audio: timeline.audio,
        signal: exporting.signal,
        onProgress: (done, total) => {
          overlay.textContent = `Rendering ${height}p… ${Math.round((100 * done) / total)}% (Esc cancels)`
        }
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `made-by-sound-${height}p.mp4`
      a.click()
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error(err)
        overlay.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`
        await new Promise((r) => setTimeout(r, 4000))
      }
    } finally {
      exporting = null
      overlay.hidden = true
      redraw()
    }
  }

  createPanel(engine, {
    upload: (shot) => {
      uploadFor = shot
      fileInput.click()
    },
    resetLogos: () => {
      void Promise.all(
        originals.shots.map((s, i) => engine.setLogo(i, s.logo))
      ).then(redraw)
    },
    exportVideo: (height) => void exportVideo(height)
  })
  // any change to the dials redraws a paused frame
  addEventListener('pointerup', redraw)
  addEventListener('input', redraw)

  play.addEventListener('click', () => clock.toggle())
  scrub.addEventListener('input', () => clock.seek(Number(scrub.value)))
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') exporting?.abort()
    if (
      exporting ||
      (e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, select'))
    )
      return
    if (e.code === 'Space') {
      e.preventDefault()
      clock.toggle()
    } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      e.preventDefault()
      const dir = e.code === 'ArrowRight' ? 1 : -1
      const beat = Math.round((fps * 60) / timeline.tempo)
      clock.step(dir * (e.shiftKey ? beat : 1), fps)
    }
  })

  const tick = () => {
    requestAnimationFrame(tick)
    if (exporting) return
    const t = clock.time()
    // paused on the same time: nothing to redraw
    if (t !== shown || clock.playing) {
      engine.render(t)
      shown = t
    }
    play.textContent = clock.playing ? 'Pause' : 'Play'
    if (document.activeElement !== scrub) scrub.value = String(t)
    readout.textContent = `${t.toFixed(2)} / ${duration.toFixed(2)} s`
  }
  tick()
}
