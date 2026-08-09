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

/**
 * True when apps/api's worker gateway (#948/#951) owns the three browser-job
 * queues (SOURCE_SCRAPE, DETAIL_CRAWL, DETAIL_EXTRACT) instead of this
 * daemon. Reads the *same* `WORKER_GATEWAY_ENABLED` env var apps/api's
 * config.ts defines — the two processes are separate deployables with
 * separate env files, so this is what actually enforces the "never run two
 * consumer groups against the same queue" contract documented in both
 * apps/api/src/app.ts and apps/api/src/config.ts, rather than leaving it as
 * an operational convention an operator has to remember to honor by hand.
 */
export function isWorkerGatewayEnabled(value = process.env['WORKER_GATEWAY_ENABLED']): boolean {
  return value === 'true'
}
