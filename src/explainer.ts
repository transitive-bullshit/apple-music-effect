// The explainer's live figures: each canvas runs its own engine on the demo brand, paused at a
// moment of the film (data-t) or looping (data-loop), with an optional crop (data-crop zooms in)
// and checkboxes that switch one ingredient off (data-toggle="param" data-off="value").

import './explainer.css'

import { startAnalytics } from './analytics'
import { fitLogo } from './brand'
import { Engine } from './engine'
import { drawingSize } from './resolution'
import { APPLE_MUSIC, type Film } from './scene'

const DEMO: Record<string, string> = {
  icon: 'demo/icon.svg',
  wordmark: 'demo/wordmark.svg'
}

async function demoFilm(): Promise<Film> {
  const shots = await Promise.all(
    APPLE_MUSIC.shots.map(async (shot) => ({
      ...shot,
      logo: await fitLogo(shot.name, DEMO[shot.name]!, 'alpha')
    }))
  )
  return { ...APPLE_MUSIC, shots }
}

async function main() {
  startAnalytics()
  const film = await demoFilm()
  const figures = [
    ...document.querySelectorAll<HTMLCanvasElement>('canvas[data-figure]')
  ]
  const engines = await Promise.all(
    figures.map(async (canvas) => {
      const crop = Number(canvas.dataset.crop ?? 1)
      // a crop zooms every shot in by the same factor
      const zoomed: Film =
        crop === 1
          ? film
          : {
              ...film,
              shots: film.shots.map((s) => ({
                ...s,
                zoom: s.zoom.map(([t, z]) => [t, z * crop] as const)
              }))
            }
      const engine = await Engine.create(canvas, zoomed, {
        width: Number(canvas.dataset.w ?? 640),
        height: Number(canvas.dataset.h ?? 360)
      })
      return { canvas, engine }
    })
  )

  // each still figure draws at its size on screen, sharp at any pixel density, and again on resize
  const aspect = film.aspect
  for (const { canvas, engine } of engines) {
    const t = Number(canvas.dataset.t ?? 0)
    if (canvas.dataset.loop) continue
    const draw = () => {
      engine.resize(...drawingSize(canvas, { aspect, maxPixels: 2560 * 1440 }))
      engine.render(t)
    }
    let pending = 0
    new ResizeObserver(() => {
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(draw)
    }).observe(canvas)
    draw()
    const toggle = canvas
      .closest('figure')
      ?.querySelector<HTMLInputElement>('input[data-toggle]')
    if (!toggle) continue
    const name = toggle.dataset.toggle!
    const original = engine.film.shots.map(
      (_, i) =>
        (engine.getParams(i) as unknown as Record<string, unknown>)[name]
    )
    toggle.addEventListener('change', () => {
      for (const [i, value] of original.entries())
        engine.setParams(i, {
          [name]: toggle.checked ? Number(toggle.dataset.off) : value
        })
      draw()
    })
  }

  // the hero loops the film, paused while scrolled out of view
  const hero = engines.find(({ canvas }) => canvas.dataset.loop)
  if (!hero) return
  let visible = true
  new IntersectionObserver(
    ([entry]) => (visible = entry!.isIntersecting)
  ).observe(hero.canvas)
  // the loop runs behind the reading, so it draws lighter: at most 1.5 pixels per CSS pixel, and
  // half the subframes
  const heroScale = () => Math.min(1, 1.5 / (globalThis.devicePixelRatio || 1))
  const start = performance.now()
  const tick = (now: number) => {
    requestAnimationFrame(tick)
    if (!visible) return
    hero.engine.resize(
      ...drawingSize(hero.canvas, {
        scale: heroScale(),
        aspect,
        maxPixels: 2560 * 1440
      })
    )
    hero.engine.render(((now - start) / 1000) % film.duration, {
      subframes: 4
    })
  }
  requestAnimationFrame(tick)
}

main().catch((err: unknown) => console.error(err))
