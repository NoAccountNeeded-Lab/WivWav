import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Resolve workspace packages to their source so tests run without a built dist.
// Same pattern as apps/scraper/vitest.config.ts. Deliberately no @wivwav/db
// entry: this package must never import it (#948 invariant).
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')

function pkgSrc(name: string): string {
  return path.resolve(WORKSPACE_ROOT, 'packages', name, 'src', 'index.ts')
}

export default defineConfig({
  resolve: {
    alias: {
      '@wivwav/types': pkgSrc('types'),
      '@wivwav/queue': pkgSrc('queue'),
      '@wivwav/logger': pkgSrc('logger'),
      '@wivwav/search': pkgSrc('search'),
    },
  },
})
