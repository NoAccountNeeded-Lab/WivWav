import type { FastifyPluginAsync } from 'fastify'
import type { JobRecord, JobStats, QueueAdapter, QueueFactory } from '@wivwav/queue'
import { CRITICAL_JOB_OPTIONS, LISTING_SYNC_REBUILD_JOB_ID, QUEUES } from '@wivwav/queue'
import { QUALITY_RULE_SEVERITY, SCRAPER_SOURCE_REGISTRY } from '@wivwav/types'
import {
  appendScheduleIntent,
  appendSourceControlAuditEntry,
  readCurrentScheduleIntents,
  type PrismaClient,
} from '@wivwav/db'
import type {
  ListingPublicationCountRow,
  ListingRepository,
  QuarantinedListingRow,
  ScraperRunRepository,
  SourceRepository,
  SourceRow,
} from '../repositories/index.js'

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

interface AdminPluginOptions {
  db: PrismaClient
  listings: ListingRepository
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  queueFactory: QueueFactory
}

interface QueueJobBody {
  data?: Record<string, unknown>
}

const SOURCE_SCOPED_QUEUES = new Set<string>([
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
])

// Stall threshold: a stage with pending work but no completion within this
// window is flagged as stalled rather than just "busy". Kept generous
// relative to the slowest legitimate cadence (detail-crawl runs hourly;
// geocode/dedupe run nightly) so normal scheduling gaps do not false-positive.
const STALL_THRESHOLD_MS = 6 * 60 * 60 * 1000

// Pipeline stages shown on the per-source view, in pipeline order. Each
// DB-derivable stage (detail-crawl, detail-extract, geocode, vin-enrich) maps
// to both a BullMQ queue (for failed-job counts) and a ListingRepository
// stage key (for pending/last-completed counts). source-scrape is
// represented separately since its state lives on the Source row itself.
const PIPELINE_STAGE_QUEUES: Record<'detail-crawl' | 'detail-extract' | 'geocode' | 'vin-enrich', string> = {
  'detail-crawl': QUEUES.DETAIL_CRAWL,
  'detail-extract': QUEUES.DETAIL_EXTRACT,
  'geocode': QUEUES.GEOCODE,
  'vin-enrich': QUEUES.VIN_ENRICH,
}

interface SourcePipelineStage {
  stage: string
  queue: string
  pendingCount: number
  lastCompletedAt: Date | null
  failedCount: number
  /** Whether the failed-job count above is scoped to this source (true) or reflects the whole queue (false, for stages whose job payload has no sourceId). */
  failedScopedToSource: boolean
  stalled: boolean
  /** Id of the most recently failed job for this stage's queue, if any — used by the "Explain this error" action (#555). Only set when failedScopedToSource is true, since an unscoped job may belong to a different source. */
  latestFailedJobId: string | null
}

const LISTING_REFRESH_QUEUES = [
  QUEUES.SOURCE_SCRAPE,
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
  QUEUES.GEOCODE,
] as const

type RefreshQueueName = (typeof LISTING_REFRESH_QUEUES)[number]

interface ListingRefreshQueueState {
  name: RefreshQueueName
  paused: boolean
  stats: JobStats
  lastJobAt: Date | null
  lastFinishedAt: Date | null
  lastStatus: JobRecord['status'] | null
  recentFailureCount: number
  recentFailureReason: string | null
}

const queueJobBodySchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        data: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    { type: 'null' },
  ],
} as const

export const adminRoutes: FastifyPluginAsync<AdminPluginOptions> = async (
  app,
  { db, listings, sources, scraperRuns, queueFactory },
) => {
  const queues = new Map<string, QueueAdapter>()
  for (const name of Object.values(QUEUES)) {
    queues.set(name, queueFactory.createQueue(name))
  }

  // GET /admin/queues — all queues with stats
  app.get('/queues', async (_req, reply) => {
    try {
      const data = await Promise.all(
        [...queues.entries()].map(async ([name, q]) => ({
          name,
          paused: await q.isPaused(),
          stats: await q.getStats(),
          policy: q.getPolicy(),
        })),
      )
      return reply.send({ data })
    } catch (err) {
      app.log.error(err, 'Queue service unavailable')
      return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Queue service is unavailable' } })
    }
  })

  // GET /admin/queues/:name — single queue stats + recent jobs
  app.get<{ Params: { name: string } }>('/queues/:name', async (req, reply) => {
    const q = queues.get(req.params.name)
    if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
    const [stats, paused, jobs] = await Promise.all([
      q.getStats(),
      q.isPaused(),
      q.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed']),
    ])
    return reply.send({ data: { name: req.params.name, paused, stats, jobs, policy: q.getPolicy() } })
  })

  // POST /admin/queues/:name/jobs — enqueue a job
  app.post<{ Params: { name: string }; Body: QueueJobBody | null }>(
    '/queues/:name/jobs',
    { schema: { body: queueJobBodySchema } },
    async (req, reply) => {
      const q = queues.get(req.params.name)
      if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
      const data = req.body?.data ?? {}
      if (
        SOURCE_SCOPED_QUEUES.has(req.params.name)
        && (typeof data['sourceId'] !== 'string' || data['sourceId'].trim().length === 0)
      ) {
        return reply.code(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: `Queue "${req.params.name}" requires a non-empty data.sourceId`,
          },
        })
      }
      const id = await q.add({ ...data, traceId: req.id })
      return reply.code(201).send({ data: { id } })
    },
  )

  // POST /admin/queues/:name/pause
  app.post<{ Params: { name: string } }>('/queues/:name/pause', async (req, reply) => {
    const q = queues.get(req.params.name)
    if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
    await q.pause()
    return reply.send({ data: { paused: true } })
  })

  // POST /admin/queues/:name/resume
  app.post<{ Params: { name: string } }>('/queues/:name/resume', async (req, reply) => {
    const q = queues.get(req.params.name)
    if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
    await q.resume()
    return reply.send({ data: { paused: false } })
  })

  // DELETE /admin/queues/:name/failed — clean all failed jobs from a queue
  app.delete<{ Params: { name: string } }>('/queues/:name/failed', async (req, reply) => {
    const q = queues.get(req.params.name)
    if (!q) return reply.notFound(`Queue "${req.params.name}" not found`)
    const removed = await q.cleanFailed()
    return reply.send({ data: { removed } })
  })

  // GET /admin/runs — last 100 scraper runs ordered by startedAt desc, with source name
  app.get('/runs', async (_req, reply) => {
    const runs = await scraperRuns.findRecent(100)
    const sourceIds = [...new Set(runs.map(r => r.sourceId))]
    const sourceRows = await sources.findManyByIds(sourceIds)
    const nameById = new Map(sourceRows.map(s => [s.id, s.name]))
    return reply.send({ data: runs.map(r => ({ ...r, sourceName: nameById.get(r.sourceId) ?? null })) })
  })

  // GET /admin/sources — sources with status, lastScrapedAt, listingCount
  app.get('/sources', async (_req, reply) => {
    const [sourceList, publicationCounts] = await Promise.all([
      sources.findAll(),
      listings.getPublicationCountsBySource(),
    ])
    return reply.send({ data: withPublicationCounts(sourceList, publicationCounts) })
  })

  // POST /admin/sources/:id/run — immediately enqueue a source-scrape job
  app.post<{ Params: { id: string } }>('/sources/:id/run', async (req, reply) => {
    const source = await sources.findById(req.params.id)
    if (!source) return reply.notFound(`Source "${req.params.id}" not found`)
    if (source.status === 'disabled' || source.status === 'paused') {
      return reply.code(409).send({
        error: {
          code: 'SOURCE_DISABLED',
          message: `Source "${source.name}" is ${source.status} and cannot be run`,
        },
      })
    }
    const q = queues.get(QUEUES.SOURCE_SCRAPE)!
    const id = await q.add({ sourceId: source.id, traceId: req.id })
    return reply.code(201).send({ data: { id } })
  })

  app.post<{ Params: { id: string }; Body: { reason?: string; createdBy?: string } }>(
    '/sources/:id/disable',
    async (req, reply) => {
      const source = await sources.findById(req.params.id)
      if (!source) return reply.notFound(`Source "${req.params.id}" not found`)
      const reason = req.body?.reason?.trim() || 'Disabled by authenticated operator action'
      const createdBy = req.body?.createdBy?.trim() || null
      const updated = await sources.disable(source.id, reason)
      if (!updated) return reply.notFound(`Source "${req.params.id}" not found`)
      await appendSourceControlAuditEntry(db, source.id, {
        action: 'disable',
        status: 'disabled',
        reason,
        updatedBy: createdBy,
      })
      await queues.get(QUEUES.LISTING_SYNC)?.add({}, { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID })
      return reply.send({ data: { id: source.id, status: 'disabled', reason } })
    },
  )

  app.post<{ Params: { id: string }; Body: { createdBy?: string } }>(
    '/sources/:id/enable',
    async (req, reply) => {
      const source = await sources.findById(req.params.id)
      if (!source) return reply.notFound(`Source "${req.params.id}" not found`)
      const createdBy = req.body?.createdBy?.trim() || null
      const updated = await sources.enable(source.id)
      if (!updated) return reply.notFound(`Source "${req.params.id}" not found`)
      await appendSourceControlAuditEntry(db, source.id, {
        action: 'enable',
        status: 'active',
        updatedBy: createdBy,
      })
      await queues.get(QUEUES.LISTING_SYNC)?.add({}, { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID })
      return reply.send({ data: { id: source.id, status: 'active' } })
    },
  )

  // GET /admin/sources/:id/pipeline — per-stage pending/failed/stall state for one source
  app.get<{ Params: { id: string } }>('/sources/:id/pipeline', async (req, reply) => {
    const source = await sources.findById(req.params.id)
    if (!source) return reply.notFound(`Source "${req.params.id}" not found`)

    try {
      const [dbStages, sourceScrapeFailedJobs] = await Promise.all([
        listings.getSourcePipelineStages(source.id),
        (async () => {
          const q = getQueueOrThrow(queues, QUEUES.SOURCE_SCRAPE)
          const jobs = await q.getJobs(['failed'])
          return jobs.filter((job) => isJobForSource(job, source.id))
        })(),
      ])

      const dbStageQueueResults = await Promise.all(
        (Object.entries(PIPELINE_STAGE_QUEUES) as Array<[keyof typeof PIPELINE_STAGE_QUEUES, string]>).map(
          async ([stageKey, queueName]) => {
            const q = getQueueOrThrow(queues, queueName)
            const failedJobs = await q.getJobs(['failed'])
            const sourceScoped = SOURCE_SCOPED_QUEUES.has(queueName)
            const scopedFailures = sourceScoped
              ? failedJobs.filter((job) => isJobForSource(job, source.id))
              : failedJobs
            return {
              stageKey,
              queueName,
              failedCount: scopedFailures.length,
              failedScopedToSource: sourceScoped,
              // Only surface a job id to explain when the failure is known to
              // belong to this source — an unscoped queue's latest failure
              // may be for a different source entirely.
              latestFailedJobId: sourceScoped ? (latestByCreatedAt(scopedFailures)?.id ?? null) : null,
            }
          },
        ),
      )
      const failuresByStage = new Map(dbStageQueueResults.map((r) => [r.stageKey, r]))

      const stages: SourcePipelineStage[] = [
        {
          // source-scrape has no per-item "pending" count of its own (a scrape
          // either has or hasn't run) — its stage tile reports the last run
          // and any recent failures instead of a queue depth.
          stage: 'source-scrape',
          queue: QUEUES.SOURCE_SCRAPE,
          pendingCount: 0,
          lastCompletedAt: source.lastScrapedAt,
          failedCount: sourceScrapeFailedJobs.length,
          failedScopedToSource: true,
          stalled: source.status === 'needs_remapping' || source.status === 'error',
          latestFailedJobId: latestByCreatedAt(sourceScrapeFailedJobs)?.id ?? null,
        },
        ...dbStages.map((dbStage) => {
          const failures = failuresByStage.get(dbStage.stage)
          const stalled = dbStage.pendingCount > 0
            && (dbStage.lastCompletedAt === null || Date.now() - dbStage.lastCompletedAt.getTime() > STALL_THRESHOLD_MS)
          return {
            stage: dbStage.stage,
            queue: failures?.queueName ?? dbStage.stage,
            pendingCount: dbStage.pendingCount,
            lastCompletedAt: dbStage.lastCompletedAt,
            failedCount: failures?.failedCount ?? 0,
            failedScopedToSource: failures?.failedScopedToSource ?? false,
            stalled,
            latestFailedJobId: failures?.latestFailedJobId ?? null,
          }
        }),
      ]

      return reply.send({
        data: {
          source: { id: source.id, name: source.name },
          generatedAt: new Date(),
          stages,
        },
      })
    } catch (err) {
      app.log.error(err, 'Source pipeline status unavailable')
      return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Source pipeline status is unavailable' } })
    }
  })

  // POST /admin/sync — enqueue a full versioned re-index of the listings
  // search projection. The scraper's single-owner indexer job (#669) performs
  // the actual rebuild (versioned index + atomic swap); this route only
  // enqueues it, using the same fixed jobId as the nightly schedule and the
  // gone-listing-sync failure path so a burst of manual triggers collapses
  // into one pending rebuild rather than queuing several serial ones.
  app.post('/sync', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const queue = queues.get(QUEUES.LISTING_SYNC)
    if (!queue) return reply.internalServerError('listing-sync queue is not registered')
    const jobId = await queue.add({}, { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID })
    return reply.code(202).send({ data: { enqueued: true, jobId } })
  })

  // ── Quarantine ──────────────────────────────────────────────────────────────
  // Operator-facing list/filter/reprocess surface for listings the publication
  // validator quarantined (see apps/scraper/src/engine/listing-validator.ts).

  // GET /admin/quarantine — list quarantined listings, filterable by source,
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

  // POST /admin/quarantine/:id/reprocess — reset a quarantined listing to
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
  // resolution is `conflicting` (apps/scraper/src/resolution). Reuses #147's
  // triage list/filter/paginate shape (see the quarantine routes above) —
  // this issue does not build a separate user-report form, only the
  // operator-facing conflict list the issue's acceptance criteria require.

  // GET /admin/field-conflicts — list unresolved field conflicts, one row per
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

  // GET /admin/listing-reports — operator triage for listings with unresolved
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

  // GET /admin/listing-refresh/status — aggregate status for the guided refresh workflow
  app.get('/listing-refresh/status', async (_req, reply) => {
    try {
      const [
        sourceList,
        recentRuns,
        observedActiveListings,
        eligibleListings,
        mapReadyListings,
        missingLocationListings,
        publicationCounts,
        queueStates,
      ] = await Promise.all([
        sources.findAll(),
        scraperRuns.findRecent(20),
        listings.countObservedActive(),
        listings.countActive(),
        listings.countActiveWithCoordinates(),
        listings.countActiveMissingCoordinates(),
        listings.getPublicationCountsBySource(),
        Promise.all(
          LISTING_REFRESH_QUEUES.map(async (name): Promise<ListingRefreshQueueState> => {
            const q = getQueueOrThrow(queues, name)
            const [stats, paused, jobs] = await Promise.all([
              q.getStats(),
              q.isPaused(),
              q.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed']),
            ])
            const latestJob = latestByCreatedAt(jobs)
            const failedJobs = jobs.filter(job => job.status === 'failed')
            const latestFailure = latestByCreatedAt(failedJobs)
            return {
              name,
              paused,
              stats,
              lastJobAt: latestJob?.createdAt ?? null,
              lastFinishedAt: latestJob?.finishedAt ?? null,
              lastStatus: latestJob?.status ?? null,
              recentFailureCount: failedJobs.length,
              recentFailureReason: latestFailure?.failedReason ?? null,
            }
          }),
        ),
      ])
      const sourceIds = [...new Set(recentRuns.map(run => run.sourceId))]
      const sourceRows = await sources.findManyByIds(sourceIds)
      const nameById = new Map(sourceRows.map(source => [source.id, source.name]))
      const latestScrapeRun = recentRuns[0] ?? null
      const countedSources = withPublicationCounts(sourceList, publicationCounts)

      return reply.send({
        data: {
          generatedAt: new Date(),
          sources: {
            total: sourceList.length,
            active: sourceList.filter(source => source.status === 'active').length,
            needsAttention: sourceList.filter(source => source.status === 'error' || source.status === 'needs_remapping').length,
            totalListings: sourceList.reduce((sum, source) => sum + source.listingCount, 0),
            observedActiveListings: countedSources.reduce((sum, source) => sum + source.observedActiveCount, 0),
            eligibleListings: countedSources.reduce((sum, source) => sum + source.eligibleActiveCount, 0),
            lastScrapedAt: latestDate(sourceList.map(source => source.lastScrapedAt)),
          },
          listings: {
            active: observedActiveListings,
            observedActive: observedActiveListings,
            eligible: eligibleListings,
            mapReady: mapReadyListings,
            missingLocations: missingLocationListings,
          },
          latestScrapeRun: latestScrapeRun
            ? {
                ...latestScrapeRun,
                sourceName: nameById.get(latestScrapeRun.sourceId) ?? null,
              }
            : null,
          queues: queueStates,
        },
      })
    } catch (err) {
      app.log.error(err, 'Listing refresh status unavailable')
      return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Listing refresh status is unavailable' } })
    }
  })

  // ── Repeatables ────────────────────────────────────────────────────────────
  // Canonical schedule definitions, merged with live BullMQ state.
  // "Canonical" = what the scraper sets up on first boot. Stored here so the
  // UI can re-enable a schedule even after it's been removed from BullMQ.

  type CanonicalDef = {
    id: string
    queue: string
    jobId?: string
    label: string
    name: string
    data: Record<string, unknown>
    defaultPattern: string
    tz: string
    /** True when multiple defs share the same name+queue (e.g. per-source scrape schedules) and must be disambiguated by data.sourceId. */
    sourceScoped?: boolean
  }

  function applyScheduleIntentToDefinition(
    def: CanonicalDef,
    intent: { enabled: boolean; pattern?: string | null; tz?: string | null } | undefined,
  ): CanonicalDef & { hasIntent: boolean; enabled: boolean; intendedPattern: string; intendedTz: string } {
    return {
      ...def,
      hasIntent: intent !== undefined,
      enabled: intent?.enabled ?? true,
      intendedPattern: intent?.pattern ?? def.defaultPattern,
      intendedTz: intent?.tz ?? def.tz,
    }
  }

  function isMatchingJob(job: JobRecord, def: CanonicalDef): boolean {
    if (job.name !== def.name && job.name !== def.queue) return false
    if (!def.sourceScoped) return true
    const sourceId = def.data['sourceId']
    return typeof sourceId === 'string' && isJobForSource(job, sourceId)
  }

  async function getCanonicalDefs(): Promise<CanonicalDef[]> {
    const scheduledSources = await sources.findScheduledSources(
      SCRAPER_SOURCE_REGISTRY.map((entry) => entry.name),
    )
    const tz = scheduledSources[0]?.timezone ?? 'America/New_York'
    const scheduledByName = new Map(scheduledSources.map((source) => [source.name, source]))
    const scrapeDefs: CanonicalDef[] = []
    const crawlDefs: CanonicalDef[] = []
    const extractDefs: CanonicalDef[] = []

    for (const definition of SCRAPER_SOURCE_REGISTRY) {
      const source = scheduledByName.get(definition.name)
      if (!source) continue
      const schedulerKey = definition.schedulerKey ?? definition.key

      scrapeDefs.push({
        id: schedulerKey,
        queue: QUEUES.SOURCE_SCRAPE,
        jobId: schedulerKey,
        label: `${definition.name} scrape`,
        name: QUEUES.SOURCE_SCRAPE,
        data: { sourceId: source.id },
        defaultPattern: source.cronExpression,
        tz: source.timezone,
        sourceScoped: true,
      })

      if (definition.pipeline === 'detail-pages') {
        crawlDefs.push({
          id: `${schedulerKey}-crawl`,
          queue: QUEUES.DETAIL_CRAWL,
          jobId: `${schedulerKey}-crawl`,
          label: `${definition.name} detail crawl (Playwright)`,
          name: QUEUES.DETAIL_CRAWL,
          data: { sourceId: source.id },
          defaultPattern: '0 * * * *',
          tz: source.timezone,
          sourceScoped: true,
        })
        extractDefs.push({
          id: `${schedulerKey}-extract`,
          queue: QUEUES.DETAIL_EXTRACT,
          jobId: `${schedulerKey}-extract`,
          label: `${definition.name} detail extract (HTML)`,
          name: QUEUES.DETAIL_EXTRACT,
          data: { sourceId: source.id },
          defaultPattern: '*/5 * * * *',
          tz: source.timezone,
          sourceScoped: true,
        })
      }
    }

    const sourceDefs = [...scrapeDefs, ...crawlDefs, ...extractDefs]

    return [
      ...sourceDefs,
      { id: 'geocode',         queue: 'geocode',         label: 'Geocode (city → GPS)',      name: 'geocode',         data: {},                          defaultPattern: '0 2 * * *',   tz },
      { id: 'deduplicate',     queue: 'deduplicate',     label: 'Deduplicate (VIN)',         name: 'deduplicate',     data: {},                          defaultPattern: '0 3 * * *',   tz },
      { id: 'rawpage-cleanup', queue: 'rawpage-cleanup', label: 'RawPage cleanup (TTL)',      name: 'rawpage-cleanup', data: {},                          defaultPattern: '0 1 * * *',   tz },
      { id: 'vin-enrich',      queue: QUEUES.VIN_ENRICH,           label: 'VIN enrichment (NHTSA vPIC)',     name: QUEUES.VIN_ENRICH,           data: {}, defaultPattern: '0 4/6 * * *', tz },
      { id: 'listing-sync',    queue: QUEUES.LISTING_SYNC,         label: 'Listing search full sync',         name: QUEUES.LISTING_SYNC,         data: {}, defaultPattern: '30 1 * * *',  tz },
      { id: 'nhtsa-recalls',   queue: QUEUES.NHTSA_RECALLS,        label: 'NHTSA recalls refresh',           name: QUEUES.NHTSA_RECALLS,        data: {}, defaultPattern: '30 4 * * *',  tz },
      { id: 'nhtsa-complaints', queue: QUEUES.NHTSA_COMPLAINTS,    label: 'NHTSA complaints refresh',        name: QUEUES.NHTSA_COMPLAINTS,     data: {}, defaultPattern: '0 5 * * 0',   tz },
      { id: 'nhtsa-safety-ratings', queue: QUEUES.NHTSA_SAFETY_RATINGS, label: 'NHTSA safety ratings refresh', name: QUEUES.NHTSA_SAFETY_RATINGS, data: {}, defaultPattern: '0 6 * * 0',   tz },
    ]
  }

  // GET /admin/repeatables — merged canonical + live BullMQ state
  app.get('/repeatables', async (_req, reply) => {
    const [defs, scheduleIntents] = await Promise.all([
      getCanonicalDefs(),
      readCurrentScheduleIntents(db),
    ])
    const effectiveDefs = defs.map((def) => applyScheduleIntentToDefinition(def, scheduleIntents.get(def.id)))

    // Collect current repeatables from all relevant queues
    const liveByQueue = new Map<string, Awaited<ReturnType<QueueAdapter['getRepeatableJobs']>>>()
    const jobsByQueue = new Map<string, Awaited<ReturnType<QueueAdapter['getJobs']>>>()
    for (const q of queues.values()) {
      const [repeatableJobs, jobs] = await Promise.all([
        q.getRepeatableJobs(),
        q.getJobs(['active', 'completed', 'failed']),
      ])
      liveByQueue.set(q.name, repeatableJobs)
      jobsByQueue.set(q.name, jobs)
    }

    const data = effectiveDefs.map((def) => {
      const live = liveByQueue.get(def.queue) ?? []
      const exactMatch = def.jobId
        ? live.find((repeatable) => repeatable.id === def.jobId)
        : undefined
      const signatureIsAmbiguous = effectiveDefs.some((candidate) =>
        candidate.id !== def.id &&
        candidate.queue === def.queue &&
        candidate.name === def.name &&
        candidate.intendedPattern === def.intendedPattern,
      )
      const match = exactMatch ?? (
        signatureIsAmbiguous
          ? undefined
          : live.find((repeatable) =>
              repeatable.name === def.name &&
              (!def.jobId || repeatable.pattern === def.intendedPattern),
            )
      )
      const jobs = (jobsByQueue.get(def.queue) ?? []).filter((job) => isMatchingJob(job, def))
      const latestJob = [...jobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
      const failedJobs = jobs.filter((job) => job.status === 'failed')
      const latestFailedJob = [...failedJobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

      return {
        id: def.id,
        queue: def.queue,
        jobId: def.jobId ?? null,
        label: def.label,
        name: def.name,
        data: def.data,
        defaultPattern: def.defaultPattern,
        tz: def.intendedTz,
        enabled: def.hasIntent ? def.enabled : !!match,
        key: match?.key ?? null,
        pattern: match?.pattern ?? def.intendedPattern,
        next: match?.next ?? null,
        lastRunAt: latestJob?.createdAt ?? null,
        lastStatus: latestJob?.status ?? null,
        recentFailureCount: failedJobs.length,
        recentFailureReason: latestFailedJob?.failedReason ?? null,
      }
    })

    return reply.send({ data })
  })

  // DELETE /admin/repeatables/:queue — disable (remove from BullMQ) by key
  app.delete<{ Params: { queue: string }; Body: { key: string } }>(
    '/repeatables/:queue',
    async (req, reply) => {
      const q = queues.get(req.params.queue)
      if (!q) return reply.notFound(`Queue "${req.params.queue}" not found`)
      const defs = await getCanonicalDefs()
      const def = defs.find((candidate) => candidate.queue === req.params.queue && candidate.jobId === req.body.key)
      if (def) {
        await appendScheduleIntent(db, def.id, { enabled: false })
      }
      await q.removeRepeatableByKey(req.body.key)
      return reply.send({ data: { removed: true } })
    },
  )

  // POST /admin/repeatables/:queue — enable (add) a repeatable
  app.post<{
    Params: { queue: string }
    Body: { name: string; data: Record<string, unknown>; pattern: string; tz?: string; jobId?: string }
  }>('/repeatables/:queue', async (req, reply) => {
    const q = queues.get(req.params.queue)
    if (!q) return reply.notFound(`Queue "${req.params.queue}" not found`)
    const { name, data, pattern, tz, jobId } = req.body
    const defs = await getCanonicalDefs()
    const def = defs.find((candidate) => candidate.queue === req.params.queue && candidate.jobId === jobId)
    if (def) {
      await appendScheduleIntent(db, def.id, { enabled: true, pattern, tz: tz ?? def.tz })
      if (req.params.queue === QUEUES.SOURCE_SCRAPE && typeof data['sourceId'] === 'string') {
        await sources.updateCronExpression(data['sourceId'], pattern)
      }
    }
    await q.addRepeatable(name, data, pattern, tz, jobId)
    return reply.code(201).send({ data: { added: true } })
  })

  // PUT /admin/repeatables/:queue — update pattern (remove old key, add with new pattern)
  app.put<{
    Params: { queue: string }
    Body: { key: string; name: string; data: Record<string, unknown>; pattern: string; tz?: string; jobId?: string }
  }>('/repeatables/:queue', async (req, reply) => {
    const q = queues.get(req.params.queue)
    if (!q) return reply.notFound(`Queue "${req.params.queue}" not found`)
    const { key, name, data, pattern, tz, jobId } = req.body
    const defs = await getCanonicalDefs()
    const def = defs.find((candidate) => candidate.queue === req.params.queue && candidate.jobId === jobId)
    if (def) {
      await appendScheduleIntent(db, def.id, { enabled: true, pattern, tz: tz ?? def.tz })
      if (req.params.queue === QUEUES.SOURCE_SCRAPE && typeof data['sourceId'] === 'string') {
        await sources.updateCronExpression(data['sourceId'], pattern)
      }
    }
    await q.removeRepeatableByKey(key)
    await q.addRepeatable(name, data, pattern, tz, jobId)
    return reply.send({ data: { updated: true } })
  })
}

function withPublicationCounts(
  sources: SourceRow[],
  counts: ListingPublicationCountRow[],
): Array<SourceRow & { observedActiveCount: number; eligibleActiveCount: number; possiblyGoneCount: number }> {
  const countBySource = new Map(counts.map(count => [count.sourceId, count]))
  return sources.map(source => ({
    ...source,
    observedActiveCount: countBySource.get(source.id)?.observedActive ?? 0,
    eligibleActiveCount: countBySource.get(source.id)?.eligibleActive ?? 0,
    possiblyGoneCount: countBySource.get(source.id)?.possiblyGoneCount ?? 0,
  }))
}

function latestByCreatedAt(jobs: JobRecord[]): JobRecord | undefined {
  return [...jobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

function isJobForSource(job: JobRecord, sourceId: string): boolean {
  const data = job.data
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>)['sourceId'] === sourceId
}

function getQueueOrThrow(queues: Map<string, QueueAdapter>, name: string): QueueAdapter {
  const queue = queues.get(name)
  if (!queue) throw new Error(`Queue "${name}" is not registered`)
  return queue
}

function latestDate(values: Array<Date | null>): Date | null {
  const dates = values.filter((value): value is Date => value !== null)
  return dates.length > 0
    ? new Date(Math.max(...dates.map(date => date.getTime())))
    : null
}
