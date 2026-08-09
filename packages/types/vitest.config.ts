import { defineConfig } from 'vitest/config'

// Scoped to src/ (not dist/) so the built CommonJS .js copies of the specs —
// which cannot import vitest via require() — are never collected.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
})
