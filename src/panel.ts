// The controls panel (DialKit), closed by default: logos, the look, quality and export. The
// defaults are the match to Apple's film; Reset returns to them. The oil and light dials scale
// each shot's own values (the shots are tuned separately), so 1 is the film.

import 'dialkit/vanilla/styles.css'

import { createDialKit, createDialRoot } from 'dialkit/vanilla'

import type { Engine } from './engine'
import { DEFAULT_PARAMS, type Params } from './scene'

export interface PanelHooks {
  upload(shot: 'icon' | 'wordmark'): void
  resetLogos(): void
  exportVideo(height: number): void
}

export function createPanel(engine: Engine, hooks: PanelHooks) {
  // each shot's own defaults, so the dials scale them rather than overwrite them
  const base = engine.film.shots.map((_, i) => ({ ...engine.getParams(i) }))
  const d = DEFAULT_PARAMS

  createDialRoot({ position: 'top-right', theme: 'dark', defaultOpen: false })
  const kit = createDialKit(
    'Made by Sound',
    {
      Logos: {
        Icon: { type: 'action', label: 'Upload icon…' },
        Wordmark: { type: 'action', label: 'Upload wordmark…' },
        Apple: { type: 'action', label: 'Back to the originals' }
      },
      Oil: {
        Dome: [1, 0, 2, 0.01],
        Depth: [1, 0.3, 2, 0.01],
        Dispersion: [1, 0, 2.5, 0.01],
        _collapsed: true
      },
      Light: {
        Highlights: [1, 0, 2.5, 0.01],
        Rims: [1, 0, 3, 0.01],
        Exposure: [1, 0.3, 2, 0.01],
        Bloom: [1, 0, 5, 0.01],
        Grain: [d.grain, 0, 0.06, 0.001],
        Vignette: [d.vignette, 0, 1, 0.01],
        _collapsed: true
      },
      Quality: {
        Wavelengths: [d.wavelengths, 3, 32, 1],
        'Motion blur': [d.subframes, 1, 16, 1],
        _collapsed: true
      },
      Export: {
        HD: { type: 'action', label: 'Download MP4 (1080p)' },
        UHD: { type: 'action', label: 'Download MP4 (4K)' }
      },
      Reset: { type: 'action', label: 'Reset to the film' }
    },
    {
      onAction: (action) => {
        // nested actions arrive as their path, e.g. "Logos.Icon"
        const key = action.split('.').pop()
        if (key === 'Icon') hooks.upload('icon')
        else if (key === 'Wordmark') hooks.upload('wordmark')
        else if (key === 'Apple') hooks.resetLogos()
        else if (key === 'HD') hooks.exportVideo(1080)
        else if (key === 'UHD') hooks.exportVideo(2160)
        else if (key === 'Reset') kit.resetValues()
      }
    }
  )

  kit.subscribe((v) => {
    for (const [i, b] of base.entries()) {
      const next: Partial<Params> = {
        dome: b.dome * v.Oil.Dome,
        depth: b.depth * v.Oil.Depth,
        dispersion: b.dispersion * v.Oil.Dispersion,
        softbox: b.softbox * v.Light.Highlights,
        horizon: b.horizon * v.Light.Rims,
        exposure: b.exposure * v.Light.Exposure,
        bloom: b.bloom * v.Light.Bloom,
        grain: v.Light.Grain,
        vignette: v.Light.Vignette,
        wavelengths: v.Quality.Wavelengths,
        subframes: v.Quality['Motion blur']
      }
      engine.setParams(i, next)
    }
  })
  return kit
}
