import { isSentryEnabled, Sentry } from '../sentry.js'

interface Deps {
  sentryEnabled: boolean
  capture: (err: unknown) => void
  flush: (ms: number) => Promise<unknown>
  exit: (code: number) => void
  write: (text: string) => void
}

const defaultDeps: Deps = {
  sentryEnabled: isSentryEnabled,
  capture: (err) => Sentry.captureException(err),
  flush: (ms) => Sentry.flush(ms),
  exit: (code) => process.exit(code),
  write: (text) => process.stderr.write(text),
}

/**
 * Print the error to stderr before exiting, so a startup failure (for example
 * an invalid environment) is visible in `docker logs` (#1149).
 */
export function handleUncaughtException(err: unknown, deps: Deps = defaultDeps): void {
  deps.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  if (!deps.sentryEnabled) {
    deps.exit(1)
    return
  }
  deps.capture(err)
  void deps.flush(2000).finally(() => deps.exit(1))
}
