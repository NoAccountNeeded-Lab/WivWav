/**
 * Shared NHTSA date parsing utilities. Ported unchanged from
 * `apps/scraper/src/jobs/nhtsa-date-utils.ts` (#963).
 *
 * NHTSA APIs return dates in different formats depending on the endpoint:
 *   - YYYYMMDD integer (complaints, investigations, TSBs)
 *   - "DD/MM/YYYY" string (recallsByVehicle's ReportReceivedDate — confirmed
 *     against the live API: e.g. "14/03/2024" is March 14, 2024, not
 *     Jan-something. Easy to get backwards given the US-agency source, but
 *     the field is day-first.)
 *   - ISO-8601 string (some newer endpoints)
 *
 * Each helper guards against the known bad input patterns from the live API.
 */

/** Parse a YYYYMMDD integer (e.g. 20240115) or an ISO-8601 string into a Date.
 * Returns new Date(0) (epoch) for null, undefined, or unrecognised input. */
export function parseNhtsaYMD(val: number | string | null | undefined): Date {
  if (val === null || val === undefined) return new Date(0)
  const s = String(val).trim()
  if (/^\d{8}$/.test(s)) {
    return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? new Date(0) : d
}

/** Parse a "DD/MM/YYYY" date string, as returned by recallsByVehicle's
 * ReportReceivedDate (NOT the legacy Microsoft "/Date(ms)/" format its field
 * name suggests — the live API returns a plain slash-delimited, day-first
 * date string).
 * Returns new Date(0) for null, undefined, or unrecognised input. */
export function parseNhtsaDMY(val: string | null | undefined): Date {
  if (!val) return new Date(0)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(val.trim())
  if (!m) return new Date(0)
  const [, day, month, year] = m
  return new Date(Number(year), Number(month) - 1, Number(day))
}
