// The explainer's live figures: each canvas runs its own engine on the demo brand, paused at a
// moment of the film (data-t) or looping (data-loop), with an optional crop (data-crop zooms in)
// and checkboxes that switch one ingredient off (data-toggle="param" data-off="value").

import './explainer.css'

import { fitLogo } from './brand'
import { Engine } from './engine'
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
        height: Number(canvas.dataset.h ?? 360),
        simRows: 360
      })
      return { canvas, engine }
    })
  )

  for (const { canvas, engine } of engines) {
    const t = Number(canvas.dataset.t ?? 0)
    if (canvas.dataset.loop) continue
    engine.render(t)
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
      engine.render(t)
    })
  }

  // the hero loops the film, paused while scrolled out of view
  const hero = engines.find(({ canvas }) => canvas.dataset.loop)
  if (!hero) return
  let visible = true
  new IntersectionObserver(
    ([entry]) => (visible = entry!.isIntersecting)
  ).observe(hero.canvas)
  const start = performance.now()
  const tick = (now: number) => {
    requestAnimationFrame(tick)
    if (!visible) return
    hero.engine.render(((now - start) / 1000) % film.duration)
  }
  requestAnimationFrame(tick)
}

main().catch((err: unknown) => console.error(err))
