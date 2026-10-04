import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'
import { wivwavSourceAliases } from '@wivwav/config/vitest'

// Deliberately no @wivwav/db entry: this package must never import it
// (#948 invariant — workers hold no database access).
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  // Explicit so compiled output is never rediscovered as tests (#811).
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
  resolve: {
    // The subpath alias must precede the bare '@wivwav/queue' one (Vite
    // substitutes by prefix) — see the escalation signal subpath (#1043).
    alias: wivwavSourceAliases(
      WORKSPACE_ROOT,
      ['types', 'queue', 'logger'],
      [
        {
          find: '@wivwav/queue/escalate-capability-signal',
          replacement: path.resolve(
            WORKSPACE_ROOT,
            'packages',
            'queue',
            'src',
            'escalate-capability-signal.ts',
          ),
        },
      ],
    ),
  },
})
