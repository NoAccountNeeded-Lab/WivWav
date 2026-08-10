export type ScraperRuntimeMode = 'all' | 'scheduler' | 'worker'

export function resolveScraperRuntimeMode(
  value = process.env['SCRAPER_RUNTIME_MODE'],
): ScraperRuntimeMode {
  switch (value) {
    case undefined:
    case '':
    case 'all':
      return 'all'
    case 'scheduler':
      return 'scheduler'
    case 'worker':
      return 'worker'
    default:
      throw new Error(
        `Invalid SCRAPER_RUNTIME_MODE "${value}". Expected one of: all, scheduler, worker.`,
      )
  }
}

export function shouldRegisterSchedules(mode: ScraperRuntimeMode): boolean {
  return mode !== 'worker'
}

export function shouldStartWorkers(mode: ScraperRuntimeMode): boolean {
  return mode !== 'scheduler'
}
