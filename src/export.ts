// Video export in the browser: a second engine renders every frame offscreen at full quality,
// WebCodecs encodes it (H.264 where the browser has it), and Mediabunny writes the MP4, with the
// sting's audio when it's available. The same frames scripts/render.ts makes, without a terminal.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type VideoCodec
} from 'mediabunny'

import { Engine } from './engine'
import type { Film, Params } from './scene'

export interface ExportOptions {
  film: Film
  params: Params[]
  height: number
  duration: number
  audio: string | null
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

async function pickCodec(width: number, height: number): Promise<VideoCodec> {
  for (const codec of ['avc', 'hevc', 'av1', 'vp9'] as const)
    if (await canEncodeVideo(codec, { width, height })) return codec
  throw new Error(`this browser can't encode ${width}x${height} video`)
}

async function decodeAudio(url: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const ctx = new OfflineAudioContext(2, 1, 48000)
    return await ctx.decodeAudioData(await res.arrayBuffer())
  } catch {
    return null
  }
}

export async function exportMp4({
  film,
  params,
  height,
  duration,
  audio,
  onProgress,
  signal
}: ExportOptions) {
  const width = Math.round((height * film.aspect) / 2) * 2
  const canvas = document.createElement('canvas')
  const engine = await Engine.create(canvas, film, {
    width,
    height,
    preserveDrawingBuffer: true
  })
  for (const [i, p] of params.entries())
    engine.setParams(i, { ...p, subframes: Math.max(p.subframes, 8) })

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget()
  })
  const video = new CanvasSource(canvas, {
    codec: await pickCodec(width, height),
    quality: QUALITY_HIGH,
    keyFrameInterval: 1
  })
  output.addVideoTrack(video, { frameRate: film.fps })
  const sound = audio ? await decodeAudio(audio) : null
  const track = sound
    ? new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH })
    : null
  if (track) output.addAudioTrack(track)
  await output.start()

  const frames = Math.round(duration * film.fps)
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) {
      await output.cancel()
      throw new DOMException('export cancelled', 'AbortError')
    }
    const t = i / film.fps
    engine.render(t)
    await video.add(t, 1 / film.fps)
    onProgress?.(i + 1, frames)
    // let the page breathe so the progress shows
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0))
  }
  if (track && sound) await track.add(sound)
  await output.finalize()
  engine.dispose()
  return new Blob([output.target.buffer!], { type: 'video/mp4' })
}
