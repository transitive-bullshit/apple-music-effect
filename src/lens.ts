// The rig's dome at any shot time, as a pure function of the shot and its parameters: keyframes for
// any of its values (hand-set, or fitted to the film and merged in by src/fits.ts), else values
// derived from the footprint's morph. Every value is a smooth (C1) curve in time.

import { interpolate, type Key } from './driver'
import type { LensKey, LensState, Params, Shot } from './scene'

/**
 * The dome at shot time t, its height times the shot's lensHeight (the panel's Dome dial) unless
 * `scaled` is false (keyframes and fits are in unscaled units).
 */
export function lensState(
  shot: Shot,
  p: Params,
  t: number,
  scaled = true
): LensState {
  const lens = shot.lens
  if (!lens)
    return {
      radius: 0,
      height: 0,
      exponent: 2,
      crown: 0,
      shoulder: 0,
      flat: 2,
      edge: 1,
      shiftX: 0,
      shiftY: 0,
      tiltX: 0,
      tiltY: 0,
      astig: 0,
      skew: 0,
      ring: 0,
      ringWidth: p.ringWidth,
      ringWave: p.ringWavelength,
      ripple: 0
    }
  const morph = Math.min(1, Math.max(0, interpolate(lens.morph, t)))
  const state: LensState = {
    radius: interpolate(lens.radius, t),
    height: interpolate(lens.height, t),
    exponent: 2 + (lens.exponent - 2) * morph,
    // the round crown and the interior's flatness grow with the morph
    crown: p.lensCrown * morph,
    shoulder: 0,
    flat: 2 + (p.lensFlat - 2) * morph,
    edge: p.lensEdge,
    shiftX: 0,
    shiftY: 0,
    tiltX: 0,
    tiltY: 0,
    astig: 0,
    skew: 0,
    ring: lens.ring ? interpolate(lens.ring, t) : 0,
    ringWidth: p.ringWidth,
    ringWave: p.ringWavelength,
    ripple: lens.ripple ? interpolate(lens.ripple, t) : 0
  }
  for (const [key, keys] of Object.entries(lens.keys ?? {}) as [
    LensKey,
    readonly Key[]
  ][])
    state[key] = interpolate(keys, t)
  state.height = Math.max(0, state.height) * (scaled ? p.lensHeight : 1)
  return state
}
