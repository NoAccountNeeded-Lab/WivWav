import { createLogger, createNoopLogger, type WivWavLogger } from '@wivwav/logger'
import type { FieldResolutionLogEvent } from './claims-repository.js'

let fallbackLogger: WivWavLogger | undefined

function getFallbackLogger(): WivWavLogger {
  if (fallbackLogger) return fallbackLogger
  const env = process.env['NODE_ENV'] ?? 'development'
  fallbackLogger = env === 'test' ? createNoopLogger() : createLogger({ service: process.env['WIVWAV_SERVICE'] ?? 'scraper', env })
  return fallbackLogger
}

/**
 * Structured, private-data-safe log line for a #499 field-resolution
 * transition into or out of `conflicting`. Only listing id, field name,
 * resolution states, and the competing *normalized values* (e.g.
 * "rear_entry"/"side_entry") are logged — never claim source text or
 * descriptions, which may contain private-seller copy.
 */
export function logFieldResolutionEvent(event: FieldResolutionLogEvent, logger: WivWavLogger = getFallbackLogger()): void {
  logger.info(
    {
      event: event.event,
      listingId: event.listingId,
      field: event.field,
      previousState: event.previousState,
      state: event.state,
      ...(event.competingValues ? { competingValues: event.competingValues } : {}),
    },
    event.event === 'field-resolution.conflict-detected'
      ? `[field-resolution] New conflict: listing ${event.listingId} ${event.field}`
      : `[field-resolution] Conflict resolved: listing ${event.listingId} ${event.field}`,
  )
}
