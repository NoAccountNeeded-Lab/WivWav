import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'
import { wivwavSourceAliases } from '@wivwav/config/vitest'

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  // Explicit so compiled output is never rediscovered as tests (#811).
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
  resolve: {
    alias: wivwavSourceAliases(WORKSPACE_ROOT, ['types', 'logger']),
  },
})
