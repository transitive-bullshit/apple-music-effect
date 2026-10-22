// The rig's dome of oil over shot time. Four smooth curves animate it: its radius, its height, its
// morph from a circle to the footprint's shape (a squircle for the icon, a long rounded oval for the
// wordmark), and its settle from one profile to another (crown, shoulder, rim falloff). analysis/capture.py fits them to the film into
// data/dome/<shot>.json; everything about the dome at any moment follows from them.

import { z } from 'zod'

import { interpolate, type Key } from './driver'
import type { Params, Shot } from './scene'

/** the dome's cross-section: H (1 - crown r² - shoulder r⁴) (1 - rho^flat)^edge (lensZ in src/shaders.ts) */
export interface Profile {
  /** the round crown, which magnifies radially */
  crown: number
  /** a round quartic term after it: the dome steepens toward its rim */
  shoulder: number
  /** how flat the interior stays before the rim falls (2: not at all) */
  flat: number
  /** the rim's falloff: below 1 is steep at the edge */
  edge: number
}

/** the dome over shot time */
export interface DomeSpec {
  /** world units */
  center: readonly [number, number]
  /** the footprint's superellipse exponent at full morph (2 stays a circle) */
  exponent: number
  /** the footprint's width over its height at full morph (1 stays round; the radius is its half-height) */
  aspect: number
  /** the profile at settle 0 and 1 */
  from: Profile
  to: Profile
  /** footprint radius (half-size), units */
  radius: readonly Key[]
  /** height, units */
  height: readonly Key[]
  /** 0: a circle, 1: the full exponent */
  morph: readonly Key[]
  /** 0: the `from` profile, 1: the `to` profile */
  settle: readonly Key[]
}

/** every number that shapes the dome at a moment */
export interface DomeState extends Profile {
  radius: number
  height: number
  exponent: number
  aspect: number
  /** 0: the `from` profile, 1: the `to` profile */
  settle: number
  /** height of the wave train on its edge, units */
  ring: number
  /** how far outside the rim it runs, units */
  ringReach: number
  /** height of the rod's ripples on it, units */
  ripple: number
}

const KeysSchema = z
  .array(z.tuple([z.number(), z.number()]))
  .min(1)
  .refine((keys) => keys.every((k, i) => i === 0 || k[0] > keys[i - 1]![0]), {
    message: 'key times must increase'
  })

const ProfileSchema = z.strictObject({
  crown: z.number(),
  shoulder: z.number(),
  flat: z.number().positive(),
  edge: z.number().positive()
})

const DomeSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  exponent: z.number().min(2),
  aspect: z.number().positive(),
  from: ProfileSchema,
  to: ProfileSchema,
  radius: KeysSchema,
  height: KeysSchema,
  morph: KeysSchema,
  settle: KeysSchema
})

/** a dome as analysis/capture.py writes it */
export function parseDome(data: unknown): DomeSpec {
  return DomeSchema.parse(data)
}

/** the dome at shot time t; its height times the panel's Dome dial (params.dome) */
export function domeAt(shot: Shot, p: Params, t: number): DomeState {
  const d = shot.dome
  const settle = interpolate(d.settle, t)
  const morph = interpolate(d.morph, t)
  const between = (key: keyof Profile) =>
    d.from[key] + (d.to[key] - d.from[key]) * settle
  return {
    radius: interpolate(d.radius, t),
    height: Math.max(0, interpolate(d.height, t)) * p.dome,
    exponent: 2 + (d.exponent - 2) * morph,
    aspect: 1 + (d.aspect - 1) * morph,
    settle,
    crown: between('crown'),
    shoulder: between('shoulder'),
    flat: between('flat'),
    edge: between('edge'),
    ring: shot.ring ? interpolate(shot.ring, t) : 0,
    ringReach: shot.ringReach ? interpolate(shot.ringReach, t) : p.ringOffset,
    // the rod's ripples decay from the start, and are gone once the dome has settled
    ripple: shot.ripple
      ? shot.ripple.height * Math.exp(-t / shot.ripple.decay) * (1 - settle)
      : 0
  }
}
