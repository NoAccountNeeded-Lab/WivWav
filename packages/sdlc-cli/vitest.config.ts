import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Sprint worktrees are full repo checkouts nested under .claude/; without
    // this exclude vitest scans their *.test.ts copies and fails on unresolved
    // workspace deps. Exclude compiled tests explicitly; stale dist tests can
    // bypass source mocks and mutate the real checkout.
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/dist/**'],
  },
})
