// The song's timeline, written by the Python analysis (analysis/timeline.py) into
// data/timeline.json. Times are seconds from the start of the audio.

import { z } from 'zod'

import data from '../data/timeline.json'

export const TimelineSchema = z
  .strictObject({
    /** the song, relative to the repo root (it lives in media/, not in git); null plays silent */
    audio: z.string().nullable(),
    duration: z.number().positive(),
    tempo: z.number().positive(),
    beats: z.array(z.number().nonnegative())
  })
  .refine((t) => t.beats.every((b) => b < t.duration), {
    message: 'beats must fall within [0, duration)'
  })
  .refine((t) => t.beats.every((b, i) => i === 0 || b > t.beats[i - 1]!), {
    message: 'beats must be strictly increasing'
  })

export type Timeline = z.infer<typeof TimelineSchema>

export function loadTimeline(json: unknown = data): Timeline {
  return TimelineSchema.parse(json)
}

/** seconds since the latest beat at or before t; Infinity before the first beat */
export function sinceBeat(beats: readonly number[], t: number) {
  let lo = 0
  let hi = beats.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid]! <= t) lo = mid + 1
    else hi = mid
  }
  return lo === 0 ? Infinity : t - beats[lo - 1]!
}

/** the times of the frames from `from` up to, not including, `to` on the fps grid */
export function frameTimes(from: number, to: number, fps: number) {
  const n = Math.max(0, Math.round((to - from) * fps))
  return Array.from({ length: n }, (_, i) => from + i / fps)
}
