/**
 * Shared NHTSA date parsing utilities.
 *
 * NHTSA APIs return dates in two formats depending on the endpoint:
 *   - YYYYMMDD integer (complaints, investigations, TSBs)
 *   - "/Date(ms)/" Microsoft JSON serialisation (recalls)
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

/** Parse a Microsoft "/Date(ms)/" serialised date string (used in the recalls API).
 * Returns new Date(0) for null, undefined, or unrecognised input. */
export function parseMicrosoftDate(val: string | null | undefined): Date {
  if (!val) return new Date(0)
  const m = /\/Date\((\d+)\)\//.exec(val)
  return m && m[1] ? new Date(Number(m[1])) : new Date(0)
}
