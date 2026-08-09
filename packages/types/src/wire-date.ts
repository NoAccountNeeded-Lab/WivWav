import { z } from 'zod'

/**
 * Date field on a wire contract: accepts an ISO-8601 datetime string (what
 * JSON serialization produces) or an in-process `Date`, and always outputs a
 * `Date`. Deliberately NOT `z.coerce.date()`, which would also accept raw
 * numbers and silently turn a misplaced count or year into an epoch-relative
 * timestamp instead of failing validation at the boundary.
 */
export const isoDateTimeSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
])
