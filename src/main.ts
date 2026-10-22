// Entry point for index.html. Two modes:
// - preview (default): the player draws the video live, in sync with the song (?t= starts there)
// - render (?mode=render&w=&h=): a bare canvas of exactly w x h that exposes window.renderFrame(t)
//   for scripts/render.ts to capture in headless Chrome

import './player.css'

import { drawFrame } from './frame'
import { createPlayer } from './player'
import { loadTimeline } from './timeline'

declare global {
  interface Window {
    renderFrame?: (t: number) => void
    renderReady?: boolean
    renderError?: string
  }
}

function main() {
  const params = new URLSearchParams(location.search)
  const timeline = loadTimeline()
  if (params.get('mode') !== 'render') {
    createPlayer(timeline, Number(params.get('t') ?? 0))
    return
  }
  const canvas = document.createElement('canvas')
  canvas.width = Number(params.get('w') ?? 1920)
  canvas.height = Number(params.get('h') ?? 1080)
  document.body.className = 'render'
  document.body.replaceChildren(canvas)
  const ctx = canvas.getContext('2d')!
  window.renderFrame = (t) => drawFrame(ctx, t, timeline)
  window.renderReady = true
}

try {
  main()
} catch (err) {
  console.error(err)
  window.renderError = String(
    err instanceof Error ? (err.stack ?? err.message) : err
  )
}
