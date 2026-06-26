import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Sprint worktrees are full repo checkouts nested under .claude/; without
    // this exclude vitest scans their *.test.ts copies and fails on unresolved
    // workspace deps. Keep vitest's defaults (node_modules, dist, etc.).
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})
