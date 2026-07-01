import type { PrismaClient } from '@wivwav/db'

const SCRAPER_OLLAMA_MODEL_KEYS = ['ai.scraper.remap.model', 'ai.scraper.structure.model'] as const

type ScraperOllamaModelKey = (typeof SCRAPER_OLLAMA_MODEL_KEYS)[number]

export async function resolveOllamaModel(db: PrismaClient): Promise<string | null> {
  for (const key of SCRAPER_OLLAMA_MODEL_KEYS) {
    const row = await db.configEntry.findFirst({
      where: { key },
      orderBy: { createdAt: 'desc' },
    })

    if (row && typeof row.value === 'string' && row.value.trim().length > 0) {
      return row.value
    }
  }

  return null
}
