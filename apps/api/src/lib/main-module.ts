import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * True when the module at `metaUrl` (pass `import.meta.url`) is the script node was started with.
 * Compares real paths, so percent-encoded characters (spaces) and symlinks do not break it (#1170).
 */
export function isMainModule(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false
  try {
    const self = realpathSync(fileURLToPath(metaUrl))
    // `tsx path/to/job` leaves argv[1] without its extension.
    return ['', '.ts', '.js', '.mjs'].some((ext) => realpathOrNull(argv1 + ext) === self)
  } catch {
    return false
  }
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}
