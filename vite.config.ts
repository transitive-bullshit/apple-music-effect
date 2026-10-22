import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'

// the sting, at the path data/timeline.json names, so the built site plays it as the dev server does
const { audio } = JSON.parse(readFileSync('data/timeline.json', 'utf8')) as {
  audio: string | null
}

export default defineConfig({
  // relative URLs, so the site works from any folder of a web server
  base: './',
  // `pnpm dev` runs through portless (https://apple-music-effect.localhost), which picks the port;
  // this fixed one is for PORTLESS=0 pnpm dev
  server: { host: '127.0.0.1', port: 5215, strictPort: true },
  preview: { host: '127.0.0.1', port: 5215 },
  // two pages: the player and the explainer
  build: {
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        explainer: resolve('explainer.html')
      }
    }
  },
  plugins: [
    {
      name: 'sting',
      apply: 'build',
      generateBundle() {
        if (audio)
          this.emitFile({
            type: 'asset',
            fileName: audio,
            source: readFileSync(audio)
          })
      }
    }
  ]
})
