import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

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
    // Explicit so generated output is never rediscovered as tests (#811).
    exclude: [...configDefaults.exclude, '**/dist/**', '**/.next/**'],
    // Needed so computed-style assertions (e.g. font-family legibility checks)
    // see real cascaded CSS rather than an empty stylesheet.
    css: true,
    // Raised timeouts: jsdom + real CSS renders exceed the 5s default under full-suite load (#1186).
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
