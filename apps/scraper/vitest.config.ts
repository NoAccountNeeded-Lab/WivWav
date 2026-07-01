import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Resolve workspace packages to their source so tests run without a built dist.
// Packages must be listed here explicitly because Vite's module resolver looks for
// the `exports` entry in package.json (which points to ./dist/) before source.
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')

function pkgSrc(name: string): string {
  return path.resolve(WORKSPACE_ROOT, 'packages', name, 'src', 'index.ts')
}

export default defineConfig({
  resolve: {
    alias: {
      '@wivwav/db': pkgSrc('db'),
      '@wivwav/types': pkgSrc('types'),
      '@wivwav/queue': pkgSrc('queue'),
      '@wivwav/logger': pkgSrc('logger'),
      '@wivwav/observability': pkgSrc('observability'),
      '@wivwav/search': pkgSrc('search'),
      '@wivwav/agents': pkgSrc('agents'),
    },
  },
})
