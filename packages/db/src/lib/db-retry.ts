const TRANSIENT_PRISMA_CODES = new Set([
  'P2002',
  'P2028',
  'P2034',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
])
const TRANSIENT_DB_MESSAGES = [
  'connection closed',
  'connection reset',
  'transaction already closed',
  // Thrown by Prisma's interactive-transaction manager when a transaction that
  // blocked past its timeout (e.g. waiting on recordClaim's pg_advisory_xact_lock
  // under concurrent writers) gets force-closed before a queued query inside it
  // runs — the query then fails with this message instead of a Prisma error code.
  'transaction not found',
]

/**
 * Returns true for Prisma errors that represent transient connection or transaction
 * failures that are safe to retry: concurrent create/write conflicts P2002/P2034,
 * P2028 (transaction already closed), connection errors P1001/P1002/P1008/P1017,
 * and the "transaction not found" interactive-transaction-timeout error.
 */
export function isTransientPrismaError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const code = (err as Record<string, unknown>)['code']
  if (typeof code === 'string' && TRANSIENT_PRISMA_CODES.has(code)) return true
  const message = (err as Record<string, unknown>)['message']
  if (typeof message === 'string') {
    const lower = message.toLowerCase()
    return TRANSIENT_DB_MESSAGES.some((fragment) => lower.includes(fragment))
  }
  return false
}

/**
 * Runs `fn` up to `maxAttempts` times, retrying only on transient Prisma errors.
 * Uses exponential backoff starting at `baseDelayMs`.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 100,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err: unknown) {
      attempt++
      if (!isTransientPrismaError(err) || attempt >= maxAttempts) throw err
      await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)))
    }
  }
}
