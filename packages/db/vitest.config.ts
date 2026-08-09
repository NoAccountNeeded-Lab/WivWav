import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { wivwavSourceAliases } from '@wivwav/config/vitest'

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  resolve: {
    alias: wivwavSourceAliases(WORKSPACE_ROOT, ['types', 'logger']),
  },
})
