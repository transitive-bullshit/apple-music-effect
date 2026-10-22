// Rasterize an SVG with headless Chrome, so references and assets render exactly as the page
// renders them. The SVG is fit (contain) into a width x height frame over a solid background.
//
//   pnpm tsx scripts/svg-to-png.ts logo.svg out.png --w 2048 --h 2048 --bg '#000'

import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { chromium } from 'playwright-core'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    w: { type: 'string', default: '1024' },
    h: { type: 'string', default: '1024' },
    bg: { type: 'string', default: '#000' }
  }
})

const [svg, out] = positionals
if (!svg || !out) throw new Error('usage: svg-to-png.ts <in.svg> <out.png>')
const w = Number(args.w)
const h = Number(args.h)
const src = Buffer.from(await readFile(svg)).toString('base64')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.setContent(
    `<body style="margin:0;background:${args.bg}"><img style="display:block;width:${w}px;height:${h}px;object-fit:contain" src="data:image/svg+xml;base64,${src}"></body>`
  )
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode())
  await page.screenshot({ path: out, omitBackground: args.bg === 'none' })
  console.log('wrote', out)
} finally {
  await browser.close()
}
