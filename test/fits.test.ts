import { describe, expect, test } from 'vitest'

import { fitKeys, FITS } from '../src/fits'
import { APPLE_MUSIC, type LensKey } from '../src/scene'

const LENS_KEYS: LensKey[] = [
  'radius',
  'height',
  'exponent',
  'crown',
  'shoulder',
  'flat',
  'edge',
  'shiftX',
  'shiftY',
  'tiltX',
  'tiltY',
  'astig',
  'skew',
  'ring',
  'ringWidth',
  'ringWave',
  'ripple'
]

describe('fitted domes', () => {
  test('each committed fit belongs to a shot and stays within it', () => {
    expect(FITS.length).toBeGreaterThan(0)
    for (const fit of FITS) {
      const shot = APPLE_MUSIC.shots.find((s) => s.name === fit.shot)
      expect(shot?.lens).toBeTruthy()
      expect(fit.start).toBeCloseTo(shot!.start)
      for (const frame of fit.frames) {
        expect(frame.t).toBeGreaterThanOrEqual(shot!.start)
        expect(frame.t).toBeLessThanOrEqual(shot!.end)
      }
    }
  })

  test('fits set only the dome’s keys, with times increasing', () => {
    for (const fit of FITS)
      for (const [key, keys] of Object.entries(fitKeys(fit))) {
        expect(LENS_KEYS).toContain(key)
        for (let i = 1; i < keys.length; i++)
          expect(keys[i]![0]).toBeGreaterThan(keys[i - 1]![0])
        for (const [, v] of keys) expect(Number.isFinite(v)).toBe(true)
      }
  })
})
