import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Resolve workspace packages to their source so tests run without a built dist.
// Packages must be listed here explicitly because Vite's module resolver looks for
// the `exports` entry in package.json (which points to ./dist/) before source.
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')

function pkgSrc(name: string): string {
  return path.resolve(WORKSPACE_ROOT, 'packages', name, 'src', 'index.ts')
}

function pkgFile(name: string, file: string): string {
  return path.resolve(WORKSPACE_ROOT, 'packages', name, 'src', file)
}

export default defineConfig({
  resolve: {
    // Subpath entries must precede the bare package aliases: Vite substitutes
    // by prefix, so a bare entry would otherwise mangle subpath imports.
    alias: [
      {
        find: /^@wivwav\/scraper-sources\/(.*)\.js$/,
        replacement: path.resolve(WORKSPACE_ROOT, 'packages', 'scraper-sources', 'src') + '/$1.ts',
      },
      { find: '@wivwav/types/scraper-gateway', replacement: pkgFile('types', 'scraper-gateway.ts') },
      { find: '@wivwav/types/worker-protocol', replacement: pkgFile('types', 'worker-protocol.ts') },
      { find: '@wivwav/scraper-sources', replacement: pkgSrc('scraper-sources') },
      { find: '@wivwav/db', replacement: pkgSrc('db') },
      { find: '@wivwav/types', replacement: pkgSrc('types') },
      { find: '@wivwav/queue', replacement: pkgSrc('queue') },
      { find: '@wivwav/logger', replacement: pkgSrc('logger') },
      { find: '@wivwav/observability', replacement: pkgSrc('observability') },
      { find: '@wivwav/search', replacement: pkgSrc('search') },
      { find: '@wivwav/agents', replacement: pkgSrc('agents') },
    ],
  },
})
