import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { wivwavSourceAliases } from '@wivwav/config/vitest'

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')
const TYPES_SRC = path.resolve(WORKSPACE_ROOT, 'packages', 'types', 'src')

export default defineConfig({
  resolve: {
    // Subpath entries must precede the bare package aliases: Vite substitutes
    // by prefix, so a bare entry would otherwise mangle subpath imports.
    alias: wivwavSourceAliases(
      WORKSPACE_ROOT,
      ['scraper-sources', 'db', 'types', 'queue', 'logger', 'observability', 'search', 'agents'],
      [
        // Deep subpath imports ('@wivwav/scraper-sources/<file>.js') map onto
        // the package's TypeScript sources.
        {
          find: /^@wivwav\/scraper-sources\/(.*)\.js$/,
          replacement:
            path.resolve(WORKSPACE_ROOT, 'packages', 'scraper-sources', 'src') + '/$1.ts',
        },
        { find: '@wivwav/types/scraper-gateway', replacement: TYPES_SRC + '/scraper-gateway.ts' },
        { find: '@wivwav/types/worker-protocol', replacement: TYPES_SRC + '/worker-protocol.ts' },
      ],
    ),
  },
})
