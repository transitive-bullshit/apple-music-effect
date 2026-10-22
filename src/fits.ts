// Fitted performances (analysis/capture.py): the dome's shape per reel frame, fitted to the
// refraction measured in Apple's film, turned into keyframes for a shot's lens.

import { z } from 'zod'

import type { Key } from './driver'
import type { Film, LensKey } from './scene'

const FitFileSchema = z.object({
  shot: z.string(),
  /** the shot's start in film time; frame times are film times */
  start: z.number(),
  frames: z.array(
    z.object({
      t: z.number(),
      lens: z.record(z.string(), z.number()),
      score: z.number()
    })
  )
})

export type FitFile = z.infer<typeof FitFileSchema>

export function parseFit(data: unknown): FitFile {
  return FitFileSchema.parse(data)
}

const committed = import.meta.glob<unknown>('../data/fit/*.json', {
  eager: true,
  import: 'default'
})

/** the fits in data/fit */
export const FITS: FitFile[] = Object.values(committed).map(parseFit)

/** keyframes in shot time for every key the fit measured */
export function fitKeys(fit: FitFile) {
  const keys: Partial<Record<LensKey, Key[]>> = {}
  for (const frame of [...fit.frames].sort((a, b) => a.t - b.t))
    for (const [key, value] of Object.entries(frame.lens))
      (keys[key as LensKey] ??= []).push([frame.t - fit.start, value])
  return keys
}

/** one curve: the hand keys before and after the fitted ones, which replace them in between */
function merge(hand: readonly Key[] | undefined, fitted: readonly Key[]) {
  const from = fitted[0]![0]
  const to = fitted.at(-1)![0]
  const outside = (hand ?? []).filter(([t]) => t < from - 1e-6 || t > to + 1e-6)
  return [...outside, ...fitted].sort((a, b) => a[0] - b[0])
}

/** the film with each fit merged into its shot's lens */
export function applyFits(film: Film, fits: FitFile[]): Film {
  return {
    ...film,
    shots: film.shots.map((shot) => {
      const fit = fits.find((f) => f.shot === shot.name)
      if (!fit || !shot.lens) return shot
      const lens = { ...shot.lens, keys: { ...shot.lens.keys } }
      for (const [key, fitted] of Object.entries(fitKeys(fit)) as [
        LensKey,
        Key[]
      ][]) {
        if (key === 'radius' || key === 'height')
          lens[key] = merge(shot.lens[key], fitted)
        else lens.keys[key] = merge(shot.lens.keys?.[key], fitted)
      }
      return { ...shot, lens }
    })
  }
}
