import type { FastifyPluginAsync } from 'fastify'
import type { QueueAdapter } from '@wivwav/queue'
import { OPERATOR_SETTINGS } from '@wivwav/types/operator-settings'
import type { ConfigService } from '../services/config-service.js'
import { CRITICAL_JOB_OPTIONS, LISTING_SYNC_REBUILD_JOB_ID, QUEUES } from '@wivwav/queue'
import { findScraperSourceByName } from '@wivwav/types'
import { appendSourceControlAuditEntry, type PrismaClient } from '@wivwav/db'
import type {
  JobRunRepository,
  ListingRepository,
  ScraperRunRepository,
  SourceRepository,
} from '../repositories/index.js'
import { withPublicationCounts } from '../services/listing-refresh-status.js'
import { buildSourcePipelineStages } from '../services/source-pipeline-status.js'

interface AdminSourcesOptions {
  db: PrismaClient
  listings: ListingRepository
  operatorConfig?: ConfigService
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  jobRuns: JobRunRepository
  queues: Map<string, QueueAdapter>
}

// Scraper runs and source management: list, run, enable/disable, pipeline and job-run views.
export const adminSourceRoutes: FastifyPluginAsync<AdminSourcesOptions> = async (
  app,
  { db, listings, operatorConfig, sources, scraperRuns, jobRuns, queues },
) => {
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
    const registryEntry = findScraperSourceByName(source.name)
    const id = await q.add({
      sourceId: source.id,
      traceId: req.id,
      // See buildSourceScrapeScheduleSources's comment (apps/api/src/sources/registry.ts, #1041) —
      // carried here rather than re-derived from sourceId at dispatch time.
      ...(registryEntry ? { requiresBrowser: registryEntry.requiresBrowser } : {}),
    })
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
      const stallThresholdHours = await operatorConfig?.getOperatorSetting('ops.stall_threshold_hours') ?? OPERATOR_SETTINGS['ops.stall_threshold_hours'].defaultValue
      const stages = await buildSourcePipelineStages(source, listings, queues, stallThresholdHours * 60 * 60 * 1000)
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

  // GET /admin/sources/:id/job-runs — full pipeline run tree for one source
  // (#933 lineage backbone). Every JobRun directly attributed to the source
  // (scrape, detail-crawl, detail-extract, etc.), plus every run
  // transitively spawned from one of those (e.g. a listing-resolve run
  // triggered by a detail-extract run), nested by parentRunId. 404 if the
  // source does not exist.
  app.get<{ Params: { id: string } }>('/sources/:id/job-runs', async (req, reply) => {
    const source = await sources.findById(req.params.id)
    if (!source) return reply.notFound(`Source "${req.params.id}" not found`)

    try {
      const runs = await jobRuns.findRunTreeForSource(source.id)
      return reply.send({ data: { source: { id: source.id, name: source.name }, generatedAt: new Date(), runs } })
    } catch (err) {
      app.log.error(err, 'Source job-run tree unavailable')
      return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Source job-run tree is unavailable' } })
    }
  })
}
