import { describe, expect, test } from 'vitest'

import { type DomeState, domeAt } from '../src/dome'
import { interpolate } from '../src/driver'
import { APPLE_MUSIC, paramsFor, type Shot } from '../src/scene'

/** the largest first and second differences of f, sampled every dt over [a, b] */
function differences(
  f: (t: number) => number,
  a: number,
  b: number,
  dt: number
) {
  let first = 0
  let second = 0
  let y0 = f(a)
  let y1 = f(a + dt)
  first = Math.abs(y1 - y0)
  for (let t = a + 2 * dt; t <= b; t += dt) {
    const y2 = f(t)
    first = Math.max(first, Math.abs(y2 - y1))
    second = Math.max(second, Math.abs(y2 - 2 * y1 + y0))
    y0 = y1
    y1 = y2
  }
  return { first, second }
}

/**
 * What's wrong with a curve, if anything. Halving the step halves a smooth curve's largest step
 * and quarters its largest second difference; a jump keeps the first, a kink halves the second
 * only.
 */
function roughness(f: (t: number) => number, a: number, b: number) {
  const dt = 1 / 2048
  const coarse = differences(f, a, b, dt)
  const fine = differences(f, a, b, dt / 2)
  const problems: string[] = []
  if (coarse.first > 1e-9 && fine.first / coarse.first > 0.6)
    problems.push('a jump')
  if (coarse.second > 1e-9 && fine.second / coarse.second > 0.35)
    problems.push('a kink')
  return problems
}

/** the curves (name: f of shot time) that aren't smooth, with what's wrong */
function rough(curves: Record<string, (t: number) => number>, length: number) {
  return Object.entries(curves).flatMap(([name, f]) =>
    roughness(f, 0, length).map((problem) => `${name}: ${problem}`)
  )
}

/** the key lists that animate a shot: the whole of its motion */
function animated(shot: Shot) {
  return [
    shot.dome.radius,
    shot.dome.height,
    shot.dome.morph,
    shot.dome.settle,
    shot.fade,
    shot.zoom,
    shot.recede,
    shot.colour,
    shot.gloss,
    shot.ring,
    shot.ringReach,
    shot.ball?.lift
  ].filter((keys) => keys && keys.length > 1)
}

describe('the animation is smooth (continuous in value and slope)', () => {
  for (const shot of APPLE_MUSIC.shots) {
    const p = paramsFor(shot)
    const length = shot.end - shot.start

    test(`${shot.name}: every value of the dome`, () => {
      const keys = Object.keys(domeAt(shot, p, 0)) as (keyof DomeState)[]
      const curves = Object.fromEntries(
        keys.map((key) => [key, (t: number) => domeAt(shot, p, t)[key]])
      )
      expect(rough(curves, length)).toEqual([])
    })

    test(`${shot.name}: fade, zoom, colour, gloss, the rig's tip`, () => {
      const curves = {
        fade: (t: number) => interpolate(shot.fade, t),
        zoom: (t: number) => interpolate(shot.zoom, t),
        recede: (t: number) => (shot.recede ? interpolate(shot.recede, t) : 1),
        colour: (t: number) => (shot.colour ? interpolate(shot.colour, t) : 1),
        gloss: (t: number) => (shot.gloss ? interpolate(shot.gloss, t) : 1),
        lift: (t: number) => (shot.ball ? interpolate(shot.ball.lift, t) : 0)
      }
      expect(rough(curves, length)).toEqual([])
    })

    test(`${shot.name}: a few curves with a few keys move everything`, () => {
      const curves = animated(shot)
      expect(curves.length).toBeLessThanOrEqual(10)
      for (const keys of curves) expect(keys!.length).toBeLessThanOrEqual(9)
    })
  }

  test('the check catches a jump and a kink', () => {
    expect(
      rough(
        {
          jump: (t) => (t < 0.5 ? 0 : 1),
          kink: (t) => Math.abs(t - 0.5),
          smooth: (t) => Math.sin(3 * t)
        },
        1
      )
    ).toEqual(['jump: a jump', 'jump: a kink', 'kink: a kink'])
  })
})
