import type { PrismaClient } from '@wivwav/db'
import { SCRAPER_SOURCE_REGISTRY, type ScraperSourceRegistryEntry } from '@wivwav/types'
import type { PlaywrightBrowserService } from '../browser/index.js'
import type { ScraperEngine } from '../engine/scraper-engine.js'
import type { DetailScheduleSource } from '../schedule-registration.js'
import type { SourceAdapterModule } from './factory.js'

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

export async function registerSources(
  db: PrismaClient,
  engine: ScraperEngine,
  browserService: PlaywrightBrowserService,
): Promise<RegisteredSource[]> {
  const registered: RegisteredSource[] = []

  for (const definition of SCRAPER_SOURCE_REGISTRY) {
    const row = await db.source.upsert({
      where: { name: definition.name },
      update: {},
      create: {
        name: definition.name,
        baseUrl: definition.baseUrl,
        cronExpression: definition.cronExpression,
        timezone: definition.timezone,
      },
    })

    const module = (await import(`./${definition.key}.js`)) as SourceAdapterModule
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

export function buildSourceScrapeScheduleSources(
  sources: readonly RegisteredSource[],
): Array<{
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
