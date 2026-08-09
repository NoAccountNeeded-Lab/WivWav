import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { wivwavSourceAliases } from '@wivwav/config/vitest'

// Deliberately no @wivwav/db entry: this package must never import it
// (#948 invariant — workers hold no database access).
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  resolve: {
    alias: wivwavSourceAliases(WORKSPACE_ROOT, ['types', 'queue', 'logger']),
  },
})
