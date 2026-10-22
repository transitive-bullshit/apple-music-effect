// The render page in headless Chrome, shared by the renderer and the comparison harness: a Vite
// server on a free port, the page in render mode, and a function that returns any frame as an
// encoded image.

import { chromium } from 'playwright-core'
import { createServer } from 'vite'

export interface RenderPageOptions {
  width: number
  height: number
  /** extra page parameters, e.g. "p.wavelengths=24" */
  query?: string
}

export async function openRenderPage({
  width,
  height,
  query = ''
}: RenderPageOptions) {
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
    args: [
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling'
    ]
  })
  const close = async () => {
    await browser.close()
    await server.close()
  }
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning')
        console.log(`[page ${msg.type()}]`, msg.text())
    })
    await page.goto(
      `http://127.0.0.1:${port}/?mode=render&w=${width}&h=${height}${query ? `&${query}` : ''}`
    )
    await page.waitForFunction(
      () => window.renderReady || window.renderError,
      null,
      {
        timeout: 120_000
      }
    )
    const error = await page.evaluate(() => window.renderError)
    if (error) throw new Error(error)

    /** the frame at t, encoded as an image */
    const image = async (t: number, mime = 'image/png') => {
      const dataUrl = await page.evaluate(
        ([time, type]) => {
          window.renderFrame!(time)
          return document.querySelector('canvas')!.toDataURL(type, 0.97)
        },
        [t, mime] as const
      )
      return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    }
    return { page, image, close }
  } catch (err) {
    await close()
    throw err
  }
}
