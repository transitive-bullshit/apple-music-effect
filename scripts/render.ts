// Deterministic offline renderer: drives the player page in render mode in headless Chrome, takes
// each frame off the canvas and pipes it to ffmpeg (x264), with the matching slice of the song.
// Frames are pure functions of time (src/frame.ts), so a render matches the preview exactly.
//
//   pnpm render --stills 1.5,4 --out renders/stills
//   pnpm render --from 0 --to 8 --fps 60 --out renders/test.mp4

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { chromium } from 'playwright-core'
import { createServer } from 'vite'

import { frameTimes, loadTimeline } from '../src/timeline'

const { values: args } = parseArgs({
  options: {
    stills: { type: 'string' },
    from: { type: 'string', default: '0' },
    to: { type: 'string' },
    fps: { type: 'string', default: '60' },
    w: { type: 'string', default: '1920' },
    h: { type: 'string', default: '1080' },
    out: { type: 'string', default: 'renders' },
    /** frame transfer from the page: jpeg (q 0.97, fast) or png (lossless, slower) */
    transfer: { type: 'string', default: 'jpeg' }
  }
})

const W = Number(args.w)
const H = Number(args.h)
/** the standard delivery tags: limited-range BT.709 */
const BT709 =
  'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709'

async function main() {
  const timeline = loadTimeline()
  // any free port, so several renders can run side by side; no file watching, so editing
  // sources mid-render can't hot-reload the page out from under the capture
  const server = await createServer({
    configFile: 'vite.config.ts',
    logLevel: 'error',
    server: { port: 0, strictPort: false, hmr: false, watch: null }
  })
  await server.listen()
  const address = server.httpServer?.address()
  const port =
    typeof address === 'object' && address
      ? address.port
      : server.config.server.port
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-background-timer-throttling']
  })
  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning')
        console.log(`[page ${msg.type()}]`, msg.text())
    })
    await page.goto(`http://127.0.0.1:${port}/?mode=render&w=${W}&h=${H}`)
    await page.waitForFunction(
      () => window.renderReady || window.renderError,
      null,
      { timeout: 60_000 }
    )
    const error = await page.evaluate(() => window.renderError)
    if (error) throw new Error(error)

    /** the frame at t, encoded as an image */
    const image = async (t: number, mime: string) => {
      const dataUrl = await page.evaluate(
        ([time, type]) => {
          window.renderFrame!(time)
          return document.querySelector('canvas')!.toDataURL(type, 0.97)
        },
        [t, mime] as const
      )
      return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    }

    if (args.stills) {
      await mkdir(args.out, { recursive: true })
      for (const t of args.stills.split(',').map(Number)) {
        const file = path.join(args.out, `still-${t.toFixed(2)}.png`)
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
    // the song isn't in git: without it in media/, the clip renders silent
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
        '16',
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
      if ((i + 1) % fps === 0 || i + 1 === times.length)
        console.log(`progress frame ${i + 1}/${times.length}`)
    }
    enc.stdin.end()
    const [code] = await closed
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`)
    console.log(
      `wrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`
    )
  } finally {
    await browser.close()
    await server.close()
  }
}

await main()
