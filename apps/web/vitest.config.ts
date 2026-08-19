import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Keep pure utility tests in Vitest's default Node environment. Add a per-file
// `@vitest-environment jsdom` directive and Testing Library only for rendered
// component behavior that needs browser APIs, effects, or focus assertions.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
})
