import type { FastifyPluginAsync } from 'fastify'
import type { JobRecord, JobStats, QueueAdapter, QueueFactory } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import type { ListingSearchService } from '../services/listing-search.js'
import type { ListingRepository, SourceRepository, ScraperRunRepository } from '../repositories/index.js'

interface AdminPluginOptions {
  listings: ListingRepository
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  queueFactory: QueueFactory
  search: ListingSearchService
}

interface QueueJobBody {
  data?: Record<string, unknown>
}

const SOURCE_SCOPED_QUEUES = new Set<string>([
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
])

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
  { listings, sources, scraperRuns, queueFactory, search },
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
    return reply.send({ data: { name: req.params.name, paused, stats, jobs } })
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
    const sourceList = await sources.findAll()
    return reply.send({ data: sourceList })
  })

  // POST /admin/sources/:id/run — immediately enqueue a source-scrape job
  app.post<{ Params: { id: string } }>('/sources/:id/run', async (req, reply) => {
    const source = await sources.findById(req.params.id)
    if (!source) return reply.notFound(`Source "${req.params.id}" not found`)
    const q = queues.get(QUEUES.SOURCE_SCRAPE)!
    const id = await q.add({ sourceId: source.id, traceId: req.id })
    return reply.code(201).send({ data: { id } })
  })

  // POST /admin/sync — re-index all listings into Meilisearch
  app.post('/sync', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    const count = await search.syncAll(listings)
    return reply.send({ data: { synced: count } })
  })

  // GET /admin/listing-refresh/status — aggregate status for the guided refresh workflow
  app.get('/listing-refresh/status', async (_req, reply) => {
    try {
      const [
        sourceList,
        recentRuns,
        activeListings,
        mapReadyListings,
        missingLocationListings,
        queueStates,
      ] = await Promise.all([
        sources.findAll(),
        scraperRuns.findRecent(20),
        listings.countActive(),
        listings.countActiveWithCoordinates(),
        listings.countActiveMissingCoordinates(),
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

      return reply.send({
        data: {
          generatedAt: new Date(),
          sources: {
            total: sourceList.length,
            active: sourceList.filter(source => source.status === 'active').length,
            needsAttention: sourceList.filter(source => source.status === 'error' || source.status === 'needs_remapping').length,
            totalListings: sourceList.reduce((sum, source) => sum + source.listingCount, 0),
            lastScrapedAt: latestDate(sourceList.map(source => source.lastScrapedAt)),
          },
          listings: {
            active: activeListings,
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
  }

  function isMatchingJob(job: { name: string }, def: CanonicalDef): boolean {
    return job.name === def.name || job.name === def.queue
  }

  async function getCanonicalDefs(): Promise<CanonicalDef[]> {
    const scheduledSources = await sources.findScheduledSources(['BLVD.com', 'MobilityWorks'])
    const blvd = scheduledSources.find((s) => s.name === 'BLVD.com')
    const mw = scheduledSources.find((s) => s.name === 'MobilityWorks')
    const tz = blvd?.timezone ?? 'America/New_York'
    return [
      ...(blvd ? [{ id: 'blvd', queue: 'source-scrape', jobId: 'blvd', label: 'BLVD.com scrape', name: 'source-scrape', data: { sourceId: blvd.id }, defaultPattern: blvd.cronExpression, tz: blvd.timezone }] : []),
      ...(mw   ? [{ id: 'mw',   queue: 'source-scrape', jobId: 'mw',   label: 'MobilityWorks scrape', name: 'source-scrape', data: { sourceId: mw.id }, defaultPattern: mw.cronExpression, tz: mw.timezone }] : []),
      { id: 'detail-crawl',    queue: 'detail-crawl',    label: 'Detail crawl (Playwright)', name: 'detail-crawl',    data: { sourceId: blvd?.id ?? '' }, defaultPattern: '0 * * * *',   tz },
      { id: 'detail-extract',  queue: 'detail-extract',  label: 'Detail extract (HTML)',     name: 'detail-extract',  data: { sourceId: blvd?.id ?? '' }, defaultPattern: '*/5 * * * *', tz },
      { id: 'geocode',         queue: 'geocode',         label: 'Geocode (city → GPS)',      name: 'geocode',         data: {},                          defaultPattern: '0 2 * * *',   tz },
      { id: 'deduplicate',     queue: 'deduplicate',     label: 'Deduplicate (VIN)',         name: 'deduplicate',     data: {},                          defaultPattern: '0 3 * * *',   tz },
      { id: 'rawpage-cleanup', queue: 'rawpage-cleanup', label: 'RawPage cleanup (TTL)',      name: 'rawpage-cleanup', data: {},                          defaultPattern: '0 1 * * *',   tz },
      { id: 'vin-enrich',      queue: QUEUES.VIN_ENRICH,           label: 'VIN enrichment (NHTSA vPIC)',     name: QUEUES.VIN_ENRICH,           data: {}, defaultPattern: '0 4/6 * * *', tz },
      { id: 'nhtsa-recalls',   queue: QUEUES.NHTSA_RECALLS,        label: 'NHTSA recalls refresh',           name: QUEUES.NHTSA_RECALLS,        data: {}, defaultPattern: '30 4 * * *',  tz },
      { id: 'nhtsa-complaints', queue: QUEUES.NHTSA_COMPLAINTS,    label: 'NHTSA complaints refresh',        name: QUEUES.NHTSA_COMPLAINTS,     data: {}, defaultPattern: '0 5 * * 0',   tz },
      { id: 'nhtsa-safety-ratings', queue: QUEUES.NHTSA_SAFETY_RATINGS, label: 'NHTSA safety ratings refresh', name: QUEUES.NHTSA_SAFETY_RATINGS, data: {}, defaultPattern: '0 6 * * 0',   tz },
    ]
  }

  // GET /admin/repeatables — merged canonical + live BullMQ state
  app.get('/repeatables', async (_req, reply) => {
    const defs = await getCanonicalDefs()

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

    const data = defs.map((def) => {
      const live = liveByQueue.get(def.queue) ?? []
      // BullMQ 5 stores repeatables in a Redis hash that omits `id`, so r.id is
      // always null for new-format entries. Fall back to name+pattern matching.
      const match = def.jobId
        ? (live.find((r) => r.id === def.jobId) ??
           live.find((r) => r.name === def.name && r.pattern === def.defaultPattern))
        : live.find((r) => r.name === def.name)
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
        tz: def.tz,
        enabled: !!match,
        key: match?.key ?? null,
        pattern: match?.pattern ?? def.defaultPattern,
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
    await q.removeRepeatableByKey(key)
    await q.addRepeatable(name, data, pattern, tz, jobId)
    return reply.send({ data: { updated: true } })
  })
}

function latestByCreatedAt(jobs: JobRecord[]): JobRecord | undefined {
  return [...jobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

function getQueueOrThrow(queues: Map<string, QueueAdapter>, name: RefreshQueueName): QueueAdapter {
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
