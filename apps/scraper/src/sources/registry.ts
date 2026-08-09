import type { PrismaClient, Prisma } from '@wivwav/db'
import {
  SCRAPER_SOURCE_REGISTRY,
  type FieldMapping,
  type ScraperSourceRegistryEntry,
} from '@wivwav/types'
import type { PlaywrightBrowserService } from '../browser/index.js'
import type { ScraperEngine } from '../engine/scraper-engine.js'
import type { DetailScheduleSource } from '../schedule-registration.js'
import { SOURCE_ADAPTER_MODULES } from '@wivwav/scraper-sources'
import { FREEDOM_MOTORS_DETAIL_MAPPINGS } from '@wivwav/scraper-sources/sources/freedom-motors-detail-mappings.js'

interface SourceRow {
  id: string
  name: string
  cronExpression: string
  timezone: string
  fingerprintHash: string | null
  page1Hash: string | null
}

export interface RegisteredSource {
  definition: ScraperSourceRegistryEntry
  row: SourceRow
}

/**
 * Initial `Source.mappings` seeded for a source's row the first time it's
 * created — only meaningful for `pipeline: 'detail-pages'` sources whose
 * detail extraction is declarative (#822) rather than a bespoke per-source
 * parser (BLVD, MobilityWorks have no use for this). This only covers a
 * brand-new install; an already-existing row is backfilled once by the
 * seed_freedom_motors_detail_mappings migration instead, since `update: {}`
 * below intentionally never overwrites a live (possibly AI-remapped) row.
 */
const DEFAULT_MAPPINGS_BY_KEY: Partial<Record<string, FieldMapping[]>> = {
  'freedom-motors': FREEDOM_MOTORS_DETAIL_MAPPINGS,
}

export async function registerSources(
  db: PrismaClient,
  engine: ScraperEngine,
  browserService: PlaywrightBrowserService,
): Promise<RegisteredSource[]> {
  const registered: RegisteredSource[] = []

  for (const definition of SCRAPER_SOURCE_REGISTRY) {
    const defaultMappings = DEFAULT_MAPPINGS_BY_KEY[definition.key]
    const row = await db.source.upsert({
      where: { name: definition.name },
      update: {},
      create: {
        name: definition.name,
        baseUrl: definition.baseUrl,
        cronExpression: definition.cronExpression,
        timezone: definition.timezone,
        ...(defaultMappings
          ? { mappings: defaultMappings as unknown as Prisma.InputJsonValue }
          : {}),
      },
    })

    const module = SOURCE_ADAPTER_MODULES[definition.key]
    if (!module) {
      throw new Error(
        `[registry] No adapter module for registry key '${definition.key}' — add it to SOURCE_ADAPTER_MODULES in @wivwav/scraper-sources`,
      )
    }
    engine.register(
      module.createSourceAdapter(row.fingerprintHash, {
        previousPage1Hash: row.page1Hash,
        browserService,
      }),
      row.id,
    )

    registered.push({ definition, row })
  }

  return registered
}

export function buildSourceScrapeScheduleSources(sources: readonly RegisteredSource[]): Array<{
  id: string
  name: string
  data: { sourceId: string }
  pattern: string
  tz: string
  jobId: string
}> {
  return sources.map(({ definition, row }) => ({
    id: definition.schedulerKey ?? definition.key,
    name: definition.name,
    data: { sourceId: row.id },
    pattern: row.cronExpression,
    tz: row.timezone,
    jobId: definition.schedulerKey ?? definition.key,
  }))
}

export function buildDetailScheduleSources(
  sources: readonly RegisteredSource[],
): DetailScheduleSource[] {
  return sources
    .filter(({ definition }) => definition.pipeline === 'detail-pages')
    .map(({ definition, row }) => ({
      id: row.id,
      timezone: row.timezone,
      schedulerPrefix: definition.schedulerKey ?? definition.key,
      sourceName: definition.name,
    }))
}
