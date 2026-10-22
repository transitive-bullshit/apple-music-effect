// The comparison harness: renders the film at reference timestamps and sets each frame
// under the matching frame of Apple's film, for tuning by eye. Times are film (reel) times; the
// YouTube cut runs 69.334 s later (measured by cross-correlating the two clips' brightness).
//
//   pnpm compare --times 0.2,0.3,0.45 --crop 640,220,640,640 --out renders/compare/icon.png
//   pnpm compare --shot wordmark --step 0.125 --crop 400,330,1120,420

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { parseArgs } from 'node:util'

import { APPLE_MUSIC } from '../src/scene'
import { openRenderPage } from './page'

const run = promisify(execFile)

const { values: args } = parseArgs({
  options: {
    times: { type: 'string' },
    shot: { type: 'string' },
    step: { type: 'string', default: '0.125' },
    /** x,y,w,h in 1920x1080 px */
    crop: { type: 'string', default: '0,0,1920,1080' },
    /** width of each tile in the sheet */
    tile: { type: 'string', default: '480' },
    cols: { type: 'string', default: '6' },
    out: { type: 'string', default: 'renders/compare/sheet.png' },
    query: { type: 'string', default: '' },
    reference: {
      type: 'string',
      default: 'reference/youtube/apple-music-identity.mkv'
    },
    offset: { type: 'string', default: '69.334' }
  }
})

function timesFromArgs() {
  if (args.times) return args.times.split(',').map(Number)
  const shot = APPLE_MUSIC.shots.find((s) => s.name === (args.shot ?? 'icon'))
  if (!shot) throw new Error(`no shot ${args.shot}`)
  const step = Number(args.step)
  const out: number[] = []
  for (let t = shot.start + step / 2; t < shot.end; t += step)
    out.push(Number(t.toFixed(3)))
  return out
}

/** the reference frame nearest film time t, cached as PNG */
async function referenceFrame(t: number) {
  const dir = 'frames/ref'
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `ref-${t.toFixed(3)}.png`)
  if (!existsSync(file)) {
    const at = t + Number(args.offset)
    // fast seek to a second before, then an exact one
    await run('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(Math.max(0, at - 1)),
      '-i',
      args.reference,
      '-ss',
      String(Math.min(1, at)),
      '-frames:v',
      '1',
      file
    ])
  }
  return file
}

async function main() {
  const times = timesFromArgs()
  const [x, y, w, h] = args.crop.split(',').map(Number) as [
    number,
    number,
    number,
    number
  ]
  const tile = Number(args.tile)
  const work = path.join(path.dirname(args.out), '.work')
  await mkdir(work, { recursive: true })
  const { image, close } = await openRenderPage({
    width: 1920,
    height: 1080,
    query: args.query
  })
  const pairs: string[] = []
  try {
    for (const t of times) {
      const ref = await referenceFrame(t)
      const sim = path.join(work, `sim-${t.toFixed(3)}.png`)
      await writeFile(sim, await image(t))
      const pair = path.join(work, `pair-${t.toFixed(3)}.png`)
      await run('magick', [
        '(',
        ref,
        '-crop',
        `${w}x${h}+${x}+${y}`,
        '+repage',
        '-resize',
        `${tile}x`,
        ')',
        '(',
        sim,
        '-crop',
        `${w}x${h}+${x}+${y}`,
        '+repage',
        '-resize',
        `${tile}x`,
        ')',
        '-append',
        '-font',
        '/System/Library/Fonts/Menlo.ttc',
        '-gravity',
        'NorthWest',
        '-fill',
        '#ffd400',
        '-pointsize',
        '18',
        '-annotate',
        '+6+4',
        `${t.toFixed(3)}s ref`,
        '-gravity',
        'West',
        '-annotate',
        `+6+${Math.round((tile * h) / w / 2)}`,
        'sim',
        pair
      ])
      pairs.push(pair)
      console.log('compared', t)
    }
  } finally {
    await close()
  }
  const cols = Math.min(Number(args.cols), pairs.length)
  const rows: string[] = []
  for (let i = 0; i < pairs.length; i += cols) {
    const row = path.join(work, `row-${i}.png`)
    await run('magick', [
      ...pairs.slice(i, i + cols),
      '-background',
      '#222',
      '-splice',
      '4x0',
      '+append',
      row
    ])
    rows.push(row)
  }
  await mkdir(path.dirname(args.out), { recursive: true })
  await run('magick', [
    ...rows,
    '-background',
    '#222',
    '-splice',
    '0x4',
    '-append',
    args.out
  ])
  console.log('wrote', args.out)
}

await main()
