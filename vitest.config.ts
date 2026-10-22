import { defineConfig } from 'vitest/config'

export default defineConfig({
  // only the TypeScript tests; the Python tests live in tests/
  test: { include: ['test/**/*.test.ts'] }
})
