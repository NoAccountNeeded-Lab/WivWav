/**
 * Lazy loader for `sharp`. The native binary needs x86-64-v2 on Linux x64, so a
 * top-level import crashes the whole API on older CPUs. Loading on first use
 * limits the failure to image hashing/analysis.
 */
import type sharp from 'sharp'

type Sharp = typeof sharp

let cached: Sharp | undefined

export async function loadSharp(): Promise<Sharp> {
  if (cached) return cached
  try {
    cached = (await import('sharp')).default
    return cached
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`sharp is unavailable on this host (native binary failed to load): ${reason}`, { cause: err })
  }
}
