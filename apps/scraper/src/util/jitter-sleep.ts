/** Sleep for `ms` milliseconds with random jitter in the range ±`factor`. */
export function jitteredSleep(ms: number, factor = 0.2): Promise<void> {
  const jitter = ms * factor * (2 * Math.random() - 1)
  const delay = Math.max(0, ms + jitter)
  if (process.env['NODE_ENV'] !== 'test') {
    process.stderr.write(
      `[scraper] jitter delay: ${delay.toFixed(0)}ms (base=${ms}ms, jitter=${jitter > 0 ? '+' : ''}${jitter.toFixed(0)}ms)\n`,
    )
  }
  return new Promise((resolve) => setTimeout(resolve, delay))
}
