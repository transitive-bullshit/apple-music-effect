import { describe, expect, test } from 'vitest'

import { interpolate } from '../src/driver'
import { APPLE_MUSIC } from '../src/scene'

describe('driver', () => {
  test('interpolate passes through its keys and holds flat outside them', () => {
    const keys = [
      [0, 1],
      [1, 3],
      [2, 2]
    ] as const
    expect(interpolate(keys, -1)).toBe(1)
    expect(interpolate(keys, 0)).toBe(1)
    expect(interpolate(keys, 1)).toBeCloseTo(3)
    expect(interpolate(keys, 2)).toBe(2)
    expect(interpolate(keys, 5)).toBe(2)
  })

  test('interpolate never overshoots between keys', () => {
    const keys = [
      [0, 0],
      [0.1, 1],
      [1, 1],
      [1.1, 0]
    ] as const
    for (let t = 0; t <= 1.1; t += 0.01) {
      const v = interpolate(keys, t)
      expect(v).toBeGreaterThanOrEqual(-1e-9)
      expect(v).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  test("the film's shots are contiguous and their keys run forward in time", () => {
    const shots = APPLE_MUSIC.shots
    expect(shots[0]!.start).toBe(0)
    for (let i = 1; i < shots.length; i++)
      expect(shots[i]!.start).toBe(shots[i - 1]!.end)
    for (const shot of shots)
      for (const keys of [
        shot.zoom,
        shot.recede ?? [],
        shot.fade,
        shot.colour ?? [],
        shot.gloss ?? [],
        shot.ring ?? [],
        shot.ringReach ?? [],
        shot.ball?.lift ?? [],
        shot.dome.radius,
        shot.dome.height,
        shot.dome.morph,
        shot.dome.settle
      ])
        for (let i = 1; i < keys.length; i++)
          expect(keys[i]![0]).toBeGreaterThan(keys[i - 1]![0])
  })
})
