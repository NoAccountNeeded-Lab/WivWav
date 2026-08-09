import { defineConfig } from 'vitest/config'

// Scoped to src/: the build (tsconfig.build.json) excludes specs from dist/,
// but a stale dist from an older build could still contain CommonJS .js
// copies that cannot import vitest via require() — never collect them.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
})
