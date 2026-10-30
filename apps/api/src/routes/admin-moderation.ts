import type { FastifyPluginAsync } from 'fastify'
import { QUALITY_RULE_SEVERITY } from '@wivwav/types'
import type { ListingRepository, QuarantinedListingRow } from '../repositories/index.js'

const MAX_QUARANTINE_PAGE_SIZE = 200
const DEFAULT_QUARANTINE_PAGE_SIZE = 50

interface QuarantineListQuery {
  sourceId?: string
  rule?: string
  severity?: 'error' | 'warn'
  olderThanDays?: string
  skip?: string
  take?: string
}

interface FieldConflictListQuery {
  sourceId?: string
  field?: string
  skip?: string
  take?: string
}

interface ListingReportListQuery {
  minReports?: string
  skip?: string
  take?: string
}

const MAX_FIELD_CONFLICT_PAGE_SIZE = 200
const DEFAULT_FIELD_CONFLICT_PAGE_SIZE = 50
const MAX_LISTING_REPORT_PAGE_SIZE = 200
const DEFAULT_LISTING_REPORT_PAGE_SIZE = 50

function quarantineRowToResponse(row: QuarantinedListingRow) {
  return {
    ...row,
    rules: row.qualityIssueCodes.map((code) => ({
      code,
      severity: QUALITY_RULE_SEVERITY[code] ?? 'warn',
    })),
  }
}

// Listing moderation and audit: quarantine, field conflicts, listing reports, image analyses.
export const adminModerationRoutes: FastifyPluginAsync<{ listings: ListingRepository }> = async (app, { listings }) => {
  // ── Quarantine ──────────────────────────────────────────────────────────────
  // Operator-facing list/filter/reprocess surface for listings the publication
  // validator quarantined (see engine/listing-validator.ts).

  // GET /internal/ops/quarantine — list quarantined listings, filterable by source,
  // rule, severity, and age (olderThanDays).
  app.get<{ Querystring: QuarantineListQuery }>('/quarantine', async (req, reply) => {
    const { sourceId, rule, severity, olderThanDays, skip, take } = req.query

    if (severity && rule && (QUALITY_RULE_SEVERITY[rule] ?? 'warn') !== severity) {
      // Contradictory filter combination — no row can satisfy both, so short-circuit
      // rather than running a query that always returns empty with a misleading 200.
      return reply.send({ data: [], meta: { total: 0, skip: 0, take: 0 } })
    }

    const parsedTake = Math.min(
      take ? Number.parseInt(take, 10) || DEFAULT_QUARANTINE_PAGE_SIZE : DEFAULT_QUARANTINE_PAGE_SIZE,
      MAX_QUARANTINE_PAGE_SIZE,
    )
    const parsedSkip = skip ? Math.max(Number.parseInt(skip, 10) || 0, 0) : 0
    const olderThanMs = olderThanDays
      ? Number.parseInt(olderThanDays, 10) * 24 * 60 * 60 * 1000
      : undefined

    // A specific rule already pins severity (validated above); otherwise resolve
    // the severity filter to its set of rule codes so pagination/total stay
    // accurate at the DB layer instead of being approximated after the fact.
    const ruleFilter = rule
      ?? (severity
        ? Object.entries(QUALITY_RULE_SEVERITY)
            .filter(([, s]) => s === severity)
            .map(([code]) => code)
        : undefined)

    const filter = {
      ...(sourceId ? { sourceId } : {}),
      ...(ruleFilter ? { rule: ruleFilter } : {}),
      ...(olderThanMs != null && !Number.isNaN(olderThanMs) ? { olderThanMs } : {}),
    }

    const [rows, total] = await Promise.all([
      listings.findQuarantined({ ...filter, skip: parsedSkip, take: parsedTake }),
      listings.countQuarantined(filter),
    ])

    return reply.send({
      data: rows.map(quarantineRowToResponse),
      meta: { total, skip: parsedSkip, take: parsedTake },
    })
  })

  // POST /internal/ops/quarantine/:id/reprocess — reset a quarantined listing to
  // 'pending' so the next validator pass re-evaluates it (e.g. after an
  // operator corrects upstream data or a source fix ships).
  app.post<{ Params: { id: string } }>('/quarantine/:id/reprocess', async (req, reply) => {
    const reprocessed = await listings.reprocessQuarantined(req.params.id)
    if (!reprocessed) {
      return reply.notFound(`Quarantined listing "${req.params.id}" not found`)
    }
    return reply.send({ data: { reprocessed: true } })
  })

  // ── #499 field conflicts ─────────────────────────────────────────────────────
  // Operator triage surface for listings whose conversionType/rampType
  // resolution is `conflicting` (resolution/). Reuses #147's
  // triage list/filter/paginate shape (see the quarantine routes above) —
  // this issue does not build a separate user-report form, only the
  // operator-facing conflict list the issue's acceptance criteria require.

  // GET /internal/ops/field-conflicts — list unresolved field conflicts, one row per
  // (listingId, field), with the competing claims that caused each one.
  app.get<{ Querystring: FieldConflictListQuery }>('/field-conflicts', async (req, reply) => {
    const { sourceId, field, skip, take } = req.query

    const parsedTake = Math.min(
      take ? Number.parseInt(take, 10) || DEFAULT_FIELD_CONFLICT_PAGE_SIZE : DEFAULT_FIELD_CONFLICT_PAGE_SIZE,
      MAX_FIELD_CONFLICT_PAGE_SIZE,
    )
    const parsedSkip = skip ? Math.max(Number.parseInt(skip, 10) || 0, 0) : 0

    const filter = {
      ...(sourceId ? { sourceId } : {}),
      ...(field ? { field } : {}),
    }

    const [rows, total] = await Promise.all([
      listings.findFieldConflicts({ ...filter, skip: parsedSkip, take: parsedTake }),
      listings.countFieldConflicts(filter),
    ])

    return reply.send({ data: rows, meta: { total, skip: parsedSkip, take: parsedTake } })
  })

  // GET /internal/ops/listing-reports — operator triage for listings with unresolved
  // user reports, sorted by highest unresolved count then latest report.
  app.get<{ Querystring: ListingReportListQuery }>('/listing-reports', async (req, reply) => {
    const { minReports, skip, take } = req.query

    const parsedTake = Math.min(
      take ? Number.parseInt(take, 10) || DEFAULT_LISTING_REPORT_PAGE_SIZE : DEFAULT_LISTING_REPORT_PAGE_SIZE,
      MAX_LISTING_REPORT_PAGE_SIZE,
    )
    const parsedSkip = skip ? Math.max(Number.parseInt(skip, 10) || 0, 0) : 0
    const parsedMinReports = Math.max(minReports ? Number.parseInt(minReports, 10) || 1 : 1, 1)

    const filter = { minReports: parsedMinReports }
    const [rows, total] = await Promise.all([
      listings.findListingReportTriage({ ...filter, skip: parsedSkip, take: parsedTake }),
      listings.countListingReportTriage(filter),
    ])

    return reply.send({ data: rows, meta: { total, skip: parsedSkip, take: parsedTake } })
  })

  // GET /internal/ops/images/:imageId/semantic-analyses — full operator-only audit
  // history for one image. Unlike the public listing read model, this exposes
  // low-confidence and failed attempts for calibration/review.
  app.get<{ Params: { imageId: string } }>('/images/:imageId/semantic-analyses', async (req, reply) => {
    const rows = await listings.findSemanticAnalysesForImage(req.params.imageId)
    return reply.send({ data: rows })
  })
}
