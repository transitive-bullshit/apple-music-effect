// Entry point for index.html. Modes:
// - preview (default): the player renders the film live, in sync with the sting (?t= starts there)
// - render (?mode=render&w=&h=): a bare canvas of exactly w x h that exposes window.renderFrame(t)
//   for scripts/render.ts to capture in headless Chrome
// Both take ?icon= and ?wordmark= to swap in other logos, and ?p.name=value (?p1.name= for the
// second shot only) to override any parameter.

import './player.css'

import { resolveLogos } from './brand'
import { Engine } from './engine'
import { applyFits, FITS, parseFit } from './fits'
import { createPlayer } from './player'
import { APPLE_MUSIC } from './scene'
import { loadTimeline } from './timeline'

declare global {
  interface Window {
    renderFrame?: (t: number) => void
    renderReady?: boolean
    renderError?: string
    engine?: Engine
  }
}

/** ?p.depth=0.5 sets a parameter on every shot; ?p1.depth=0.5 on the second shot only */
function applyQueryParams(engine: Engine, params: URLSearchParams) {
  for (const [key, value] of params) {
    const m = /^p(\d*)\.(\w+)$/.exec(key)
    if (!m) continue
    const shots = m[1] ? [Number(m[1])] : engine.film.shots.map((_, i) => i)
    const v = value.includes(',') ? value.split(',').map(Number) : Number(value)
    for (const i of shots) engine.setParams(i, { [m[2]!]: v })
  }
}

async function main() {
  const params = new URLSearchParams(location.search)
  const timeline = loadTimeline()
  // ?icon=...&wordmark=... replace the logos (URLs relative to the page, e.g. assets/mine.svg)
  const overrides: Record<string, string> = {}
  for (const name of ['icon', 'wordmark']) {
    const src = params.get(name)
    if (src) overrides[name] = src
  }
  // the dome fitted to the film (data/fit); ?fit=renders/fit-test/icon.json,... tries others, and
  // ?fit=none the keyframes alone
  const fitUrls = params.get('fit')?.split(',').filter(Boolean) ?? []
  const fits =
    fitUrls[0] === 'none'
      ? []
      : fitUrls.length
        ? await Promise.all(
            fitUrls.map(async (url) =>
              parseFit(await (await fetch(url)).json())
            )
          )
        : FITS
  const film = applyFits(await resolveLogos(APPLE_MUSIC, overrides), fits)

  if (params.get('mode') === 'render') {
    const canvas = document.createElement('canvas')
    document.body.className = 'render'
    document.body.replaceChildren(canvas)
    const engine = await Engine.create(canvas, film, {
      width: Number(params.get('w') ?? 1920),
      height: Number(params.get('h') ?? 1080),
      simRows: Number(params.get('rows') ?? 576),
      preserveDrawingBuffer: true
    })
    window.engine = engine
    applyQueryParams(engine, params)
    engine.debug = Number(params.get('debug') ?? 0)
    engine.debugScale = Number(params.get('debugScale') ?? 0.05)
    window.renderFrame = (t) => {
      engine.render(t)
      engine.gl.finish()
    }
    window.renderReady = true
    return
  }

  const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas')!
  const engine = await Engine.create(canvas, film, {
    width: Number(params.get('w') ?? 1280),
    height: Number(params.get('h') ?? 720),
    simRows: Number(params.get('rows') ?? 432)
  })
  window.engine = engine
  applyQueryParams(engine, params)
  createPlayer(engine, timeline, film, Number(params.get('t') ?? 0))
}

main().catch((err: unknown) => {
  console.error(err)
  window.renderError = String(
    err instanceof Error ? (err.stack ?? err.message) : err
  )
})
