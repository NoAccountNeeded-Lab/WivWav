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
    // Raised async/test timeouts: see vitest.setup.ts (#1186).
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Generated output (.next, dist) must never be rediscovered as tests (#811).
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**', '**/.next/**'],
  },
})
