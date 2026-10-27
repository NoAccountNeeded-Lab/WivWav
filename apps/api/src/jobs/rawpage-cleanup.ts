import { OPERATOR_SETTINGS } from '@wivwav/types/operator-settings'
import type { ConfigService } from '../services/config-service.js'
import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'

export async function runRawPageCleanupJob(context?: JobContext, operatorConfig?: ConfigService): Promise<void> {
  const db = getDb()

  const processedDays = await operatorConfig?.getOperatorSetting('retention.raw_page.processed_days') ?? OPERATOR_SETTINGS['retention.raw_page.processed_days'].defaultValue
  const unprocessedDays = await operatorConfig?.getOperatorSetting('retention.raw_page.unprocessed_days') ?? OPERATOR_SETTINGS['retention.raw_page.unprocessed_days'].defaultValue
  const now = new Date()
  const processedCutoff = new Date(now.getTime() - processedDays * 24 * 60 * 60 * 1000)
  const unprocessedCutoff = new Date(now.getTime() - unprocessedDays * 24 * 60 * 60 * 1000)

  // #969: no per-job $disconnect() here — see jobs/geocode.ts's comment.
  const { count: processedDeleted } = await db.rawPage.deleteMany({
    where: {
      processedAt: { not: null },
      scrapedAt: { lt: processedCutoff },
    },
  })

  const { count: staleDeleted } = await db.rawPage.deleteMany({
    where: {
      processedAt: null,
      scrapedAt: { lt: unprocessedCutoff },
    },
  })

  const total = processedDeleted + staleDeleted
  await report(
    context,
    `[rawpage-cleanup] Deleted ${processedDeleted} processed (>${processedDays}d) + ${staleDeleted} stale unprocessed (>${unprocessedDays}d) = ${total} rows`,
    { stage: 'complete', current: total, total },
  )
}
