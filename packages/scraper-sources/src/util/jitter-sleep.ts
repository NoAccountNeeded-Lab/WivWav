/**
 * jitteredSleep — sleep for `ms` milliseconds with ±`factor` random jitter.
 *
 * A constant inter-request delay is a bot fingerprint; adding jitter makes
 * timing non-deterministic and harder for rate-limit middleware to detect.
 *
 * Default factor of 0.2 produces delays in the range [ms*0.8, ms*1.2].
 *
 * The computed delay is written to stderr so it is observable in scraper logs
 * when SCRAPER_LOG_JITTER=1 is set, or when NODE_ENV is not 'test'.
 *
 * @param ms     - Base delay in milliseconds.
 * @param factor - Jitter factor (0–1). Defaults to 0.2 (±20%).
 */
export function jitteredSleep(ms: number, factor = 0.2): Promise<void> {
  const jitter = ms * factor * (2 * Math.random() - 1) // range: [-ms*factor, +ms*factor]
  const delay = Math.max(0, ms + jitter)
  if (process.env['NODE_ENV'] !== 'test') {
    process.stderr.write(
      `[scraper] jitter delay: ${delay.toFixed(0)}ms (base=${ms}ms, jitter=${jitter > 0 ? '+' : ''}${jitter.toFixed(0)}ms)\n`,
    )
  }
  return new Promise((resolve) => setTimeout(resolve, delay))
}
