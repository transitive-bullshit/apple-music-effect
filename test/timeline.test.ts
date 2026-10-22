import { describe, expect, test } from 'vitest'

import { frameTimes, loadTimeline, sinceBeat } from '../src/timeline'

describe('timeline', () => {
  test('the committed data/timeline.json is valid', () => {
    const timeline = loadTimeline()
    expect(timeline.beats.length).toBeGreaterThan(0)
  })

  test('rejects beats out of order or past the end', () => {
    const base = { audio: null, duration: 2, tempo: 120 }
    expect(() => loadTimeline({ ...base, beats: [1, 0.5] })).toThrow()
    expect(() => loadTimeline({ ...base, beats: [0.5, 2] })).toThrow()
    expect(() => loadTimeline({ ...base, beats: [], extra: 1 })).toThrow()
  })

  test('sinceBeat measures from the latest beat at or before t', () => {
    const beats = [0.5, 1, 1.5]
    expect(sinceBeat(beats, 0.25)).toBe(Infinity)
    expect(sinceBeat(beats, 0.5)).toBe(0)
    expect(sinceBeat(beats, 1.2)).toBeCloseTo(0.2)
    expect(sinceBeat(beats, 9)).toBe(7.5)
  })

  test('frameTimes lands on the fps grid, end exclusive', () => {
    expect(frameTimes(1, 1.1, 30)).toEqual([1, 1 + 1 / 30, 1 + 2 / 30])
    expect(frameTimes(2, 2, 60)).toEqual([])
  })
})
