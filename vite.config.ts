import { resolve } from 'node:path'

import { defineConfig } from 'vite'

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
  }
})
