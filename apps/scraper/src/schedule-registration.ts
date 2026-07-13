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

  const validSourceIds = collectSourceIds(definitions)

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

    const matchedKeys = new Set<string>()

    for (const definition of queueDefinitions) {
      const signatureDefinitions = definitionsBySignature.get(signatureFor(definition)) ?? []
      const match = findScheduledMatch(
        definition,
        existing,
        signatureDefinitions.length > 1,
      )

      if (match) {
        if (payloadsMatch(match.data, definition.data)) {
          matchedKeys.add(match.key)
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
        const correctedKey = definition.jobId ?? definition.name

        // The legacy name+pattern fallback can match a scheduler keyed
        // differently from this definition's canonical key (e.g. after a
        // registry-key rename). addRepeatable above upserts under
        // `correctedKey`, so the old-keyed entry is now a distinct,
        // superseded scheduler — remove it explicitly instead of leaving it
        // in `matchedKeys`, which would exempt it from the orphan-cleanup
        // pass below and let two active schedulers run the same job forever.
        if (match.key !== correctedKey) {
          const removed = await queue.removeRepeatableByKey(match.key)
          if (removed) {
            logger.warn(
              { queue: queue.name, key: match.key, replacedBy: correctedKey },
              'Superseded schedule removed after registering under its canonical key',
            )
          }
        }

        matchedKeys.add(correctedKey)
        existing = existing.filter((job) => job.key !== match.key)
        existing.push({
          key: correctedKey,
          name: definition.name,
          id: correctedKey,
          tz: definition.tz,
          pattern: definition.pattern,
          next: null,
          legacy: false,
          data: definition.data,
        })
        logger.info(
          {
            queue: definition.name,
            jobId: definition.jobId,
            key: match.key,
          },
          'Schedule payload corrected to match current definition',
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
      const newKey = definition.jobId ?? definition.name
      matchedKeys.add(newKey)
      existing.push({
        key: newKey,
        name: definition.name,
        id: newKey,
        tz: definition.tz,
        pattern: definition.pattern,
        next: null,
        legacy: false,
        data: definition.data,
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

    for (const job of existing) {
      if (matchedKeys.has(job.key)) continue

      const sourceId = extractSourceId(job.data)
      if (sourceId === undefined || validSourceIds.has(sourceId)) continue

      const removed = await queue.removeRepeatableByKey(job.key)
      if (removed) {
        logger.warn(
          { queue: queue.name, key: job.key, sourceId },
          'Stale schedule removed: referenced source id no longer exists',
        )
      }
    }
  }
}

/** Collects every sourceId referenced by the current schedule definitions, across all queues. */
function collectSourceIds(definitions: readonly ScheduleDefinition[]): Set<string> {
  const ids = new Set<string>()
  for (const definition of definitions) {
    const sourceId = extractSourceId(definition.data)
    if (sourceId !== undefined) ids.add(sourceId)
  }
  return ids
}

function extractSourceId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const sourceId = (data as Record<string, unknown>)['sourceId']
  return typeof sourceId === 'string' ? sourceId : undefined
}

/** Deep-equal comparison of schedule payloads, tolerant of key ordering. */
function payloadsMatch(existingData: unknown, definitionData: Record<string, unknown>): boolean {
  return stableStringify(existingData) === stableStringify(definitionData)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`
  }
  return JSON.stringify(value)
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

/**
 * Finds the existing scheduler that a definition already occupies, if any.
 * Matching (jobId, then signature fallback) mirrors the previous
 * `isAlreadyScheduled` boolean check, but returns the matched job so callers
 * can compare payloads instead of assuming a match means "nothing to do".
 */
function findScheduledMatch(
  definition: ScheduleDefinition,
  existing: readonly RepeatableJob[],
  signatureIsAmbiguous: boolean,
): RepeatableJob | undefined {
  if (!definition.jobId) {
    return existing.find((job) => job.name === definition.name)
  }

  const byId = existing.find((job) => job.id === definition.jobId)
  if (byId) return byId
  if (signatureIsAmbiguous) return undefined

  // Preserve a single legacy schedule where name+pattern still identifies one
  // canonical definition. Ambiguous per-source signatures are migrated above.
  return existing.find((job) => hasSameSignature(job, definition))
}
