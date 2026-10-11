import type { JobRecord, QueueAdapter } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import { SCRAPER_SOURCE_REGISTRY } from '@wivwav/types'
import { readCurrentScheduleIntents, type PrismaClient } from '@wivwav/db'
import type { SourceRepository } from '../repositories/index.js'
import { isJobForSource } from './admin-queue-helpers.js'

// Canonical schedule definitions, merged with live BullMQ state.
// "Canonical" = what the scraper sets up on first boot. Stored here so the
// UI can re-enable a schedule even after it's been removed from BullMQ.

export type CanonicalDef = {
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

export async function getCanonicalDefs(sources: SourceRepository): Promise<CanonicalDef[]> {
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
      // requiresBrowser travels with the job data rather than being
      // re-derived from sourceId at dispatch time — see the comment on
      // buildSourceScrapeScheduleSources in apps/api/src/sources/registry.ts (#1041).
      data: { sourceId: source.id, requiresBrowser: definition.requiresBrowser },
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
    { id: 'listing-observation-cleanup', queue: 'listing-observation-cleanup', label: 'Listing observation cleanup (TTL)', name: 'listing-observation-cleanup', data: {}, defaultPattern: '0 1 * * *', tz },
    { id: 'vin-enrich',      queue: QUEUES.VIN_ENRICH,           label: 'VIN enrichment (NHTSA vPIC)',     name: QUEUES.VIN_ENRICH,           data: {}, defaultPattern: '0 4/6 * * *', tz },
    { id: 'listing-sync',    queue: QUEUES.LISTING_SYNC,         label: 'Listing search full sync',         name: QUEUES.LISTING_SYNC,         data: {}, defaultPattern: '30 1 * * *',  tz },
    { id: 'nhtsa-recalls',   queue: QUEUES.NHTSA_RECALLS,        label: 'NHTSA recalls refresh',           name: QUEUES.NHTSA_RECALLS,        data: {}, defaultPattern: '30 4 * * *',  tz },
    { id: 'nhtsa-complaints', queue: QUEUES.NHTSA_COMPLAINTS,    label: 'NHTSA complaints refresh',        name: QUEUES.NHTSA_COMPLAINTS,     data: {}, defaultPattern: '0 5 * * 0',   tz },
    { id: 'nhtsa-safety-ratings', queue: QUEUES.NHTSA_SAFETY_RATINGS, label: 'NHTSA safety ratings refresh', name: QUEUES.NHTSA_SAFETY_RATINGS, data: {}, defaultPattern: '0 6 * * 0',   tz },
  ]
}

/** Canonical repeatable schedules merged with live BullMQ state and persisted operator intent. */
export async function buildRepeatableStatuses(
  db: PrismaClient,
  sources: SourceRepository,
  queues: Map<string, QueueAdapter>,
) {
  const [defs, scheduleIntents] = await Promise.all([
    getCanonicalDefs(sources),
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

  return data
}
