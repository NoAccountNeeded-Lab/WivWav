import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * True when the module at `metaUrl` (pass `import.meta.url`) is the script node was started with.
 * Compares real paths, so percent-encoded characters (spaces) and symlinks do not break it (#1170).
 */
export function isMainModule(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1)
  } catch {
    return false
  }
}
