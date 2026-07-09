import type { WivWavLogger } from '@wivwav/logger'
import type { JobOptions, QueueAdapter, RepeatableJob } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'

export interface ScheduleDefinition {
  queue: QueueAdapter
  name: string
  data: Record<string, unknown>
  pattern: string
  tz: string
  jobId?: string
  options?: JobOptions
}

export interface DetailScheduleSource {
  id: string
  timezone: string
  schedulerPrefix: string
  sourceName?: string
}

interface DetailScheduleQueues {
  crawl: QueueAdapter
  extract: QueueAdapter
}

export function buildDetailScheduleDefinitions(
  sources: readonly DetailScheduleSource[],
  queues: DetailScheduleQueues,
  options: JobOptions,
): ScheduleDefinition[] {
  return sources.flatMap((source) => [
    {
      queue: queues.crawl,
      name: QUEUES.DETAIL_CRAWL,
      data: { sourceId: source.id },
      pattern: '0 * * * *',
      tz: source.timezone,
      jobId: `${source.schedulerPrefix}-crawl`,
      options,
    },
    {
      queue: queues.extract,
      name: QUEUES.DETAIL_EXTRACT,
      data: { sourceId: source.id },
      pattern: '*/5 * * * *',
      tz: source.timezone,
      jobId: `${source.schedulerPrefix}-extract`,
      options,
    },
  ])
}

export async function reconcileSchedules(
  definitions: readonly ScheduleDefinition[],
  logger: Pick<WivWavLogger, 'debug' | 'info' | 'warn'>,
): Promise<void> {
  const definitionsByQueue = new Map<QueueAdapter, ScheduleDefinition[]>()
  for (const definition of definitions) {
    const queueDefinitions = definitionsByQueue.get(definition.queue) ?? []
    queueDefinitions.push(definition)
    definitionsByQueue.set(definition.queue, queueDefinitions)
  }

  for (const [queue, queueDefinitions] of definitionsByQueue) {
    let existing = await queue.getRepeatableJobs()
    const definitionsBySignature = groupBySignature(queueDefinitions)

    for (const signatureDefinitions of definitionsBySignature.values()) {
      if (signatureDefinitions.length < 2) continue

      const firstDefinition = signatureDefinitions[0]
      if (!firstDefinition) continue

      const legacyCollisions = existing.filter((job) =>
        hasSameSignature(job, firstDefinition) &&
        (job.id === null || job.legacy === true),
      )
      for (const collision of legacyCollisions) {
        const removed = await queue.removeRepeatableByKey(collision.key)
        if (removed) {
          logger.warn(
            { queue: queue.name, key: collision.key, pattern: collision.pattern },
            'Legacy collided schedule removed before source-specific registration',
          )
        }
      }
      const removedKeys = new Set(legacyCollisions.map((job) => job.key))
      existing = existing.filter((job) => !removedKeys.has(job.key))
    }

    for (const definition of queueDefinitions) {
      const signatureDefinitions = definitionsBySignature.get(signatureFor(definition)) ?? []
      const alreadyScheduled = isAlreadyScheduled(
        definition,
        existing,
        signatureDefinitions.length > 1,
      )

      if (alreadyScheduled) {
        logger.debug(
          { queue: definition.name, jobId: definition.jobId },
          'Schedule already registered',
        )
        continue
      }

      await queue.addRepeatable(
        definition.name,
        definition.data,
        definition.pattern,
        definition.tz,
        definition.jobId,
        definition.options,
      )
      existing.push({
        key: definition.jobId ?? definition.name,
        name: definition.name,
        id: definition.jobId ?? definition.name,
        tz: definition.tz,
        pattern: definition.pattern,
        next: null,
        legacy: false,
      })
      logger.info(
        {
          queue: definition.name,
          jobId: definition.jobId,
          pattern: definition.pattern,
          tz: definition.tz,
        },
        'Schedule registered',
      )
    }
  }
}

function groupBySignature(
  definitions: readonly ScheduleDefinition[],
): Map<string, ScheduleDefinition[]> {
  const grouped = new Map<string, ScheduleDefinition[]>()
  for (const definition of definitions) {
    const signature = signatureFor(definition)
    const entries = grouped.get(signature) ?? []
    entries.push(definition)
    grouped.set(signature, entries)
  }
  return grouped
}

function signatureFor(definition: ScheduleDefinition): string {
  return `${definition.name}\u0000${definition.pattern}`
}

function hasSameSignature(
  job: RepeatableJob,
  definition: ScheduleDefinition,
): boolean {
  return job.name === definition.name && job.pattern === definition.pattern
}

function isAlreadyScheduled(
  definition: ScheduleDefinition,
  existing: readonly RepeatableJob[],
  signatureIsAmbiguous: boolean,
): boolean {
  if (!definition.jobId) {
    return existing.some((job) => job.name === definition.name)
  }

  if (existing.some((job) => job.id === definition.jobId)) return true
  if (signatureIsAmbiguous) return false

  // Preserve a single legacy schedule where name+pattern still identifies one
  // canonical definition. Ambiguous per-source signatures are migrated above.
  return existing.some((job) => hasSameSignature(job, definition))
}
