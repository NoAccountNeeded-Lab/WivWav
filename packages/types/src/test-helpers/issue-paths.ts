import type { z } from 'zod'

/**
 * Dotted issue paths from a safeParse result — empty when parsing succeeded.
 * Lets a rejection test make a single assertion: a `toContain('field.path')`
 * on this both proves the parse failed and pins the field-level error.
 */
export function issuePaths(result: { success: boolean; error?: z.ZodError<unknown> }): string[] {
  return result.error?.issues.map((issue) => issue.path.join('.')) ?? []
}
