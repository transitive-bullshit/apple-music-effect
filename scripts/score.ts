// Scores the simulation against Apple's film: renders each time, crops both frames to the same
// region, shrinks them (so a pixel of misalignment doesn't dominate) and measures the RMS colour
// difference. Several --query sets in one run share a page load per set; the lowest mean wins.
//
//   pnpm score --times 0.6,0.8,1 --crop 560,140,800,800 --query "p0.lensCrown=0.6" --query ""

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'

import { openRenderPage } from './page'

const run = promisify(execFile)

const { values: args } = parseArgs({
  options: {
    times: { type: 'string', default: '0.6,0.8,1' },
    crop: { type: 'string', default: '560,140,800,800' },
    size: { type: 'string', default: '160' },
    query: { type: 'string', multiple: true, default: [''] },
    offset: { type: 'string', default: '69.334' },
    reference: {
      type: 'string',
      default: 'reference/youtube/apple-music-identity.mkv'
    }
  }
})

const times = args.times.split(',').map(Number)
const [x, y, w, h] = args.crop.split(',').map(Number) as [
  number,
  number,
  number,
  number
]
const work = 'renders/score'

async function referenceFrame(t: number) {
  await mkdir('frames/ref', { recursive: true })
  const file = path.join('frames/ref', `ref-${t.toFixed(3)}.png`)
  if (!existsSync(file)) {
    const at = t + Number(args.offset)
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

async function rmse(a: string, b: string) {
  const shrink = (f: string) => [
    '(',
    f,
    '-crop',
    `${w}x${h}+${x}+${y}`,
    '+repage',
    '-resize',
    `${args.size}x${args.size}!`,
    ')'
  ]
  // compare writes its metric to stderr and exits 1 when the images differ
  const out = await run('magick', [
    'compare',
    '-metric',
    'RMSE',
    ...shrink(a),
    ...shrink(b),
    'null:'
  ]).catch((err: { stderr: string }) => ({ stderr: err.stderr }))
  const m = /\(([\d.]+)\)/.exec(out.stderr)
  return m ? Number(m[1]) : NaN
}

async function main() {
  await mkdir(work, { recursive: true })
  const refs = await Promise.all(times.map(referenceFrame))
  const results: { query: string; mean: number; per: number[] }[] = []
  for (const query of args.query) {
    const { image, close } = await openRenderPage({
      width: 1920,
      height: 1080,
      query
    })
    const per: number[] = []
    try {
      for (const [i, t] of times.entries()) {
        const sim = path.join(work, `sim-${i}.png`)
        await writeFile(sim, await image(t))
        per.push(await rmse(refs[i]!, sim))
      }
    } finally {
      await close()
    }
    const mean = per.reduce((s, v) => s + v, 0) / per.length
    results.push({ query, mean, per })
    console.log(
      `${mean.toFixed(4)}  [${per.map((v) => v.toFixed(3)).join(' ')}]  ${query || '(defaults)'}`
    )
  }
  const best = results.reduce((a, b) => (b.mean < a.mean ? b : a))
  console.log(`best ${best.mean.toFixed(4)}: ${best.query || '(defaults)'}`)
}

await main()
