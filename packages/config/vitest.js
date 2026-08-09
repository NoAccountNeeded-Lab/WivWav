import path from 'node:path'

/**
 * Shared vitest alias builder: maps `@wivwav/<name>` specifiers to each
 * package's TypeScript source (`packages/<name>/src/index.ts`) so tests run
 * without built dist output. Packages must be listed explicitly because
 * Vite's module resolver finds the `exports` entry in package.json (which
 * points at ./dist/) before source.
 *
 * `extra` entries are prepended so they win over the package aliases —
 * used for deep-subpath regex aliases (see apps/scraper/vitest.config.ts).
 */
export function wivwavSourceAliases(workspaceRoot, names, extra = []) {
  return [
    ...extra,
    ...names.map((name) => ({
      find: `@wivwav/${name}`,
      replacement: path.resolve(workspaceRoot, 'packages', name, 'src', 'index.ts'),
    })),
  ]
}
