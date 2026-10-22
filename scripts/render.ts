// Deterministic offline renderer: drives the page in render mode in headless Chrome, takes each
// frame off the canvas and pipes it to ffmpeg (x264), with the matching slice of the sting. Frames
// are pure functions of time (the oil restarts from rest at each shot), so a render matches the
// preview exactly.
//
//   pnpm render --stills 0.3,1.9 --out renders/stills
//   pnpm render --from 0 --to 4 --out renders/sting.mp4
//   pnpm render --w 3840 --h 2160 --out renders/sting-4k.mp4

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { APPLE_MUSIC } from '../src/scene'
import { frameTimes, loadTimeline } from '../src/timeline'
import { openRenderPage } from './page'

const { values: args } = parseArgs({
  options: {
    stills: { type: 'string' },
    from: { type: 'string', default: '0' },
    to: { type: 'string' },
    fps: { type: 'string', default: String(APPLE_MUSIC.fps) },
    w: { type: 'string', default: '1920' },
    h: { type: 'string', default: '1080' },
    out: { type: 'string', default: 'renders' },
    /** extra page parameters, e.g. "p.wavelengths=24" */
    query: { type: 'string', default: '' },
    /** frame transfer from the page: jpeg (q 0.97, fast) or png (lossless, slower) */
    transfer: { type: 'string', default: 'png' }
  }
})

/** the standard delivery tags: limited-range BT.709 */
const BT709 =
  'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709'

async function main() {
  const timeline = loadTimeline()
  const { image, close } = await openRenderPage({
    width: Number(args.w),
    height: Number(args.h),
    query: args.query
  })
  try {
    if (args.stills) {
      await mkdir(args.out, { recursive: true })
      for (const t of args.stills.split(',').map(Number)) {
        const file = path.join(args.out, `still-${t.toFixed(3)}.png`)
        await writeFile(file, await image(t, 'image/png'))
        console.log('wrote', file)
      }
      return
    }

    const from = Number(args.from)
    const to = Number(args.to ?? timeline.duration)
    const fps = Number(args.fps)
    const times = frameTimes(from, to, fps)
    const out = args.out.endsWith('.mp4')
      ? args.out
      : path.join(args.out, `render-${from}-${to}.mp4`)
    await mkdir(path.dirname(out), { recursive: true })
    // a timeline without a song (or a missing file) renders silent
    const song =
      timeline.audio && existsSync(timeline.audio) ? timeline.audio : null
    if (timeline.audio && !song)
      console.warn(`${timeline.audio} is missing; rendering silent`)
    const audioIn = song
      ? ['-ss', String(from), '-t', String(to - from), '-i', song]
      : []
    const audioOut = song ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : []

    const mime = args.transfer === 'png' ? 'image/png' : 'image/jpeg'
    const enc = spawn(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(fps),
        '-i',
        '-',
        ...audioIn,
        // frames arrive as full-range RGB; convert to the delivery standard and tag it
        '-vf',
        `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,${BT709}`,
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '14',
        ...audioOut,
        '-movflags',
        '+faststart',
        out
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    )
    const closed = once(enc, 'close')
    const started = Date.now()
    for (const [i, t] of times.entries()) {
      if (!enc.stdin.write(await image(t, mime))) await once(enc.stdin, 'drain')
      if ((i + 1) % Math.round(fps) === 0 || i + 1 === times.length)
        console.log(`progress frame ${i + 1}/${times.length}`)
    }
    enc.stdin.end()
    const [code] = await closed
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`)
    console.log(
      `wrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`
    )
  } finally {
    await close()
  }
}

await main()
