#!/usr/bin/env node
/**
 * Remote WivWav Docker log forwarder (#1226).
 *
 * Connects over SSH to `WIVWAV_REMOTE_SSH_TARGET` (required; never hard-coded),
 * discovers running app containers carrying the wivwav project
 * label, follows each container's logs via `docker logs --follow --timestamps`,
 * and pushes the lines to Loki (`LOKI_PUSH_URL`, default the local push
 * endpoint) labelled with the compose service and an optional
 * `WIVWAV_LOG_HOST_LABEL` host label.
 *
 * Design properties:
 * - Source timestamps from `docker logs --timestamps` are preserved verbatim.
 * - Connections to a container resume after a restart from a timestamp cursor
 *   (`--since`), and the exact replayed boundary line is skipped once.
 * - Buffers and retries are bounded (drop-oldest after cap; capped exponential
 *   backoff), so a slow or down Loki exhausts retries without growing memory.
 * - Malformed log lines never crash the forwarder; they are forwarded with a
 *   fallback timestamp and the source data intact.
 * - SIGINT/SIGTERM stop followers and flush best-effort before exiting.
 * - No secrets or machine identifiers are embedded; the SSH target value is
 *   never echoed into diagnostics.
 *
 * Unit tests (no SSH, Docker, or Loki contact): scripts/remote-log-forwarder.test.mjs
 */
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface as readlineCreateInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

/** Compose labels used for discovery. */
export const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project'
export const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service'
/** Compose project name the forwarder is scoped to. */
export const PROJECT = 'wivwav'
/** App services relevant to the website, Ops page, and scheduled/worker jobs. */
export const APP_SERVICES = new Set(['api', 'web', 'ops', 'job-runner'])
/** Local Loki push endpoint used when LOKI_PUSH_URL is not set. */
export const DEFAULT_PUSH_URL = 'http://127.0.0.1:3100/loki/api/v1/push'

const MAX_TAIL_LINES = 1000
const MIN_DISCOVER_POLL_MS = 250
const MIN_FLUSH_INTERVAL_MS = 100

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

/**
 * Parse required/optional configuration from an environment-like object.
 * Throws when the required SSH target is missing.
 */
export function parseConfig(env) {
  const target = env.WIVWAV_REMOTE_SSH_TARGET?.trim()
  if (!target) {
    throw new Error('Missing required environment variable: WIVWAV_REMOTE_SSH_TARGET')
  }
  return {
    sshTarget: target,
    lokiPushUrl: env.LOKI_PUSH_URL?.trim() || DEFAULT_PUSH_URL,
    hostLabel: env.WIVWAV_LOG_HOST_LABEL?.trim() || null,
    rediscoveryPollIntervalMs: clampInt(env.REDISCOVERY_POLL_INTERVAL_MS, 30_000, MIN_DISCOVER_POLL_MS, 10 * 60_000),
    flushIntervalMs: clampInt(env.FLUSH_INTERVAL_MS, 2_000, MIN_FLUSH_INTERVAL_MS, 60_000),
    bufferMaxEntries: clampInt(env.BUFFER_MAX_ENTRIES, 2_000, 1, 100_000),
    lokiRetryMaxAttempts: clampInt(env.LOKI_RETRY_MAX_ATTEMPTS, 3, 1, 10),
    backoffBaseMs: clampInt(env.BACKOFF_BASE_MS, 1_000, 1, 60_000),
    backoffMaxMs: clampInt(env.BACKOFF_MAX_MS, 30_000, 1, 10 * 60_000),
    maxFlushBatchEntries: clampInt(env.MAX_FLUSH_BATCH_ENTRIES, 500, 1, 10_000),
    tailLines: clampInt(env.LOGS_TAIL_LINES, 100, 0, MAX_TAIL_LINES),
  }
}

/**
 * Escape a value for safe single-quoted use inside a remote shell command.
 */
export function shQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/** Redact anything resembling the SSH target from diagnostic text. */
export function maskSensitive(text, sshTarget) {
  if (!sshTarget) return text
  const escaped = sshTarget.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  return text.replaceAll(new RegExp(escaped, 'g'), '<redacted>')
}

const DOCKER_TS_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

const isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

const daysInMonth = (year, month) => {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

/**
 * Convert a `docker logs --timestamps` timestamp (RFC3339Nano) into
 * nanoseconds since epoch, as a string (Loki's value format).
 * Returns null for malformed input rather than throwing. Components are
 * range-validated explicitly (months, days per month with leap years, hours,
 * minutes, seconds) instead of relying on engine-specific date parsing,
 * which can silently roll impossible dates forward.
 */
export function dockerTsToLokiNs(raw) {
  if (typeof raw !== 'string') return null
  const match = DOCKER_TS_RE.exec(raw)
  if (!match) return null
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match
  const y = Number(year)
  const mo = Number(month)
  const d = Number(day)
  const h = Number(hour)
  const mi = Number(minute)
  const s = Number(second)
  if (
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > daysInMonth(y, mo) ||
    h > 23 ||
    mi > 59 ||
    s > 59 // docker container logs do not carry leap seconds
  ) {
    return null
  }
  let instantMs = Date.UTC(y, mo - 1, d, h, mi, s)
  if (zone !== 'Z') {
    const zoneHours = Number(zone.slice(1, 3))
    const zoneMinutes = Number(zone.slice(4, 6))
    if (zoneHours > 23 || zoneMinutes > 59) return null
    const offsetMs = (zoneHours * 60 + zoneMinutes) * 60_000 * (zone[0] === '-' ? -1 : 1)
    instantMs -= offsetMs
  }
  const epochSeconds = BigInt(Math.floor(instantMs / 1000))
  return `${epochSeconds}${fraction.padEnd(9, '0')}`
}

/**
 * Parse one `docker logs --timestamps` line into { tsNs, message }.
 * Malformed timestamps never throw: the raw line is preserved in `message`
 * with `tsNs: null` so the caller chooses the fallback timestamp.
 */
export function parseLogLine(line) {
  if (typeof line !== 'string') {
    return { tsNs: null, message: '' }
  }
  const spaceIndex = line.indexOf(' ')
  if (spaceIndex === -1) {
    return { tsNs: null, message: line }
  }
  const token = line.slice(0, spaceIndex)
  const tsNs = dockerTsToLokiNs(token)
  if (tsNs === null) {
    return { tsNs: null, message: line }
  }
  return { tsNs, message: line.slice(spaceIndex + 1) }
}

/**
 * Build Loki stream labels. Every stream carries the compose project name and
 * the compose service; the optional environment-provided host label is added
 * as `host`. Throws if the service label is missing — never emit unlabelled
 * streams.
 */
export function buildStreamLabels({ service, hostLabel = null }) {
  const cleanService = typeof service === 'string' ? service.trim() : ''
  if (!cleanService) {
    throw new Error('stream labels require a non-empty compose service label')
  }
  const labels = { project: PROJECT, service: cleanService }
  const cleanHost = typeof hostLabel === 'string' ? hostLabel.trim() : ''
  if (cleanHost) labels.host = cleanHost
  return labels
}

/**
 * Serialize forwarded entries into a Loki push payload. Entries are grouped
 * by identical label sets and sorted oldest-first inside each stream.
 * Entry shape: { labels, line, tsNs }.
 */
export function buildLokiPayload(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = JSON.stringify(entry.labels)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  const streams = [...groups.values()].map((group) => ({
    stream: group[0].labels,
    values: group
      .slice()
      .sort((a, b) => (a.tsNs < b.tsNs ? -1 : a.tsNs > b.tsNs ? 1 : 0))
      .map((entry) => [entry.tsNs, entry.line]),
  }))
  return JSON.stringify({ streams })
}

/**
 * Exponential reconnect/flush backoff, bounded at `maxMs`.
 */
export function nextBackoffDelayMs(attempt, baseMs = 1_000, maxMs = 30_000) {
  const safeAttempt = Number.isFinite(attempt) && attempt > 1 ? attempt : 1
  return Math.min(baseMs * 2 ** (safeAttempt - 1), maxMs)
}

/**
 * Arguments for the remote `docker logs` invocation following one container.
 * - First observation: bounded `--tail` catch-up, no `--since`.
 * - After a restart, `--since <cursor>` resumes at the last forwarded
 *   timestamp; the tail only bounds an extremely long outage.
 */
export function computeFollowArgs({ containerId, cursor, tail = 100 }) {
  const boundedTail = clampInt(tail, 100, 0, MAX_TAIL_LINES)
  const args = ['docker', 'logs', '--follow', '--timestamps', '--tail', String(boundedTail)]
  if (cursor) args.push('--since', cursor)
  args.push(containerId)
  return args
}

/**
 * Dropping-oldest bounded entry buffer: a slow or down Loki must not make the
 * forwarder's memory grow without limit.
 */
export function createEntryBuffer(maxEntries) {
  const entries = []
  return {
    droppedCount: 0,
    push(items) {
      entries.push(...items)
      while (entries.length > maxEntries) {
        entries.shift()
        this.droppedCount += 1
      }
    },
    requeue(items) {
      entries.unshift(...items)
      while (entries.length > maxEntries) {
        entries.shift()
        this.droppedCount += 1
      }
    },
    drain() {
      return entries.splice(0, entries.length)
    },
  }
}

/**
 * Restart-safe replay guard. When a follow session resumes from a cursor, the
 * boundary line (identical timestamp + line) is replayed once by
 * `docker logs --since`; it is skipped exactly that one time, then the guard
 * disarms so subsequent identical lines flow normally.
 */
export function createReplayGuard() {
  let armedLine = null
  return {
    arm({ tsNs, line }) {
      armedLine = { tsNs, line }
    },
    shouldSkip(tsNs, line) {
      if (!armedLine) return false
      const matched = armedLine.tsNs === tsNs && armedLine.line === line
      armedLine = null
      return matched
    },
  }
}

/**
 * Flush one batch (array of { labels, entries }) with a bounded number of
 * attempts and exponential backoff; the whole batch is retried as one unit.
 * Throws after the cap; the caller decides recovery.
 */
export async function flushBatchesWithRetry(
  pushFn,
  groupsOfEntries,
  { maxAttempts, sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const entries = groupsOfEntries.flatMap((group) => group.entries)
      return await pushFn(buildLokiPayload(entries))
    } catch (error) {
      if (attempt === maxAttempts) throw error
      await sleepFn(nextBackoffDelayMs(attempt))
    }
  }
  throw new Error('unreachable: flush retries exhausted')
}

/** Keep a failed Loki batch queued for a later flush while capacity remains. */
export async function flushBatchWithRetention(
  pushFn,
  buffer,
  groups,
  { maxAttempts, sleepFn, onFailure = () => {} },
) {
  try {
    await flushBatchesWithRetry(pushFn, groups, { maxAttempts, sleepFn })
    return true
  } catch (error) {
    const droppedBefore = buffer.droppedCount
    buffer.requeue(groups.flatMap((group) => group.entries))
    onFailure(error, buffer.droppedCount - droppedBefore)
    return false
  }
}

/** Remote docker ps discovery command for wivwav compose services. */
export function discoverCommand() {
  return [
    'docker',
    'ps',
    '--filter',
    shQuote(`label=${COMPOSE_PROJECT_LABEL}=${PROJECT}`),
    '--format',
    shQuote(`{{.ID}}\t{{.Names}}\t{{.Label "${COMPOSE_SERVICE_LABEL}"}}`),
  ].join(' ')
}

/** Parse tab-separated docker ps rows and retain only relevant app services. */
export function parseContainerListing(output) {
  return String(output)
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [id, name, service] = row.split('\t')
      return { containerId: id, name, service }
    })
    .filter((record) => record.containerId && APP_SERVICES.has(record.service))
}

/*
 * ------------------------------------------------------------------
 * Runtime orchestration. SSH/Docker/Loki are touched only through
 * injectable dependencies, so tests substitute fakes and never
 * contact real hosts.
 * ------------------------------------------------------------------
 */

export function createForwarder(config, deps = {}) {
  const {
    sshSpawn = spawn,
    sshRun = null,
    nowMs = () => Date.now(),
    logError = (message) => console.error(message),
  } = deps

  const buffer = createEntryBuffer(config.bufferMaxEntries)
  /** containerId -> last forwarded docker timestamp (cursor for --since) */
  const cursorByContainer = new Map()
  /** containerId -> last forwarded (tsNs, line), used to arm the replay guard */
  const lastLineByContainer = new Map()
  /** containerId -> { kill } for running follow sessions */
  const followers = new Map()
  /** containerId -> per-container replay guard */
  const replayGuards = new Map()
  let stopping = false
  let flushChain = Promise.resolve()

  const safeLog = (message) => logError(maskSensitive(message, config.sshTarget))

  const defaultSshRun = (remoteCommand) =>
    new Promise((resolveRun, rejectRun) => {
      const child = sshSpawn('ssh', [config.sshTarget, remoteCommand], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderrTail = ''
      child.stdout?.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr?.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk).slice(-2_000)
      })
      child.on('error', rejectRun)
      child.on('close', (code) => {
        if (code === 0) resolveRun(stdout)
        else rejectRun(new Error(`ssh exited with code ${code}: ${stderrTail}`))
      })
    })

  const fallbackTsNs = () => `${BigInt(nowMs()) * 1_000_000n}`

  const handleLine = (record, rawLine) => {
    const parsed = parseLogLine(rawLine)
    const line = parsed.tsNs === null ? rawLine : parsed.message
    const guard = replayGuards.get(record.containerId)
    if (guard?.shouldSkip(parsed.tsNs ?? '', line)) return
    const tsNs = parsed.tsNs ?? fallbackTsNs()
    if (parsed.tsNs !== null) {
      cursorByContainer.set(record.containerId, rawLine.slice(0, rawLine.indexOf(' ')))
      lastLineByContainer.set(record.containerId, { tsNs, line })
    }
    buffer.push([
      {
        labels: buildStreamLabels({ service: record.service, hostLabel: config.hostLabel }),
        line,
        tsNs,
      },
    ])
  }

  const groupEntries = (entries) => {
    const groups = []
    const byLabels = new Map()
    for (const entry of entries) {
      const key = JSON.stringify(entry.labels)
      if (!byLabels.has(key)) {
        const group = { labels: entry.labels, entries: [] }
        byLabels.set(key, group)
        groups.push(group)
      }
      byLabels.get(key).entries.push(entry)
    }
    return groups
  }

  const flushOnce = async () => {
    const entries = buffer.drain()
    if (entries.length === 0) return
    const groups = groupEntries(entries)
    for (let start = 0; start < groups.length; start += config.maxFlushBatchEntries) {
      const batch = groups.slice(start, start + config.maxFlushBatchEntries)
      await flushBatchWithRetention(async (payload) => {
          const response = await fetch(config.lokiPushUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload,
          })
          if (!response.ok) throw new Error(`loki push failed with HTTP ${response.status}`)
        }, buffer, batch, {
          maxAttempts: config.lokiRetryMaxAttempts,
          onFailure: (error, droppedNow) => safeLog(
            `loki batch retained for retry after ${config.lokiRetryMaxAttempts} attempts: ${error?.message}` +
            (droppedNow > 0 ? `; ${droppedNow} oldest buffered entries dropped at capacity` : ''),
          ),
        })
    }
  }

  const scheduleFlush = () => {
    flushChain = flushChain
      .then(flushOnce)
      .catch((error) => safeLog(`flush error: ${error?.message}`))
  }

  const discoverContainers = async () => {
    try {
      const output = await (sshRun ?? defaultSshRun)(discoverCommand())
      return parseContainerListing(output)
    } catch (error) {
      safeLog(`discovery failed: ${error?.message}`)
      return []
    }
  }

  /**
   * Follow one container over a long-lived ssh child process. Reconnects with
   * capped exponential backoff until stopped, resuming from the recorded
   * cursor; the replayed boundary line is skipped by the per-container guard.
   */
  const follow = async (record) => {
    const follower = { child: null, kill() {} }
    followers.set(record.containerId, follower)
    let attempts = 0
    while (!stopping) {
      const cursor = cursorByContainer.get(record.containerId) ?? null
      if (cursor) {
        const last = lastLineByContainer.get(record.containerId)
        const guard = replayGuards.get(record.containerId) ?? null
        if (last && guard) guard.arm(last)
      }
      const args = computeFollowArgs({ containerId: record.containerId, cursor, tail: config.tailLines })
      // indexes 0-5 are fixed, safe tokens; the cursor and container id are
      // passed last and are shell-quoted for the remote login shell.
      const remoteCommand = args.map((arg, index) => (index >= 6 ? shQuote(arg) : arg)).join(' ')
      const sessionStartedAt = nowMs()
      try {
        await new Promise((resolveSession, rejectSession) => {
          const child = sshSpawn('ssh', [config.sshTarget, remoteCommand], { stdio: ['ignore', 'pipe', 'pipe'] })
          follower.child = child
          follower.kill = () => {
            try {
              child.kill('SIGTERM')
            } catch {
              /* already gone */
            }
          }
          if (!child.stdout) {
            rejectSession(new Error('ssh did not provide a piped stdout'))
            return
          }
          const lines = readlineCreateInterface({ input: child.stdout, crlfDelay: Infinity })
          lines.on('line', (raw) => handleLine(record, raw))
          let stderrTail = ''
          child.stderr?.on('data', (chunk) => {
            stderrTail = (stderrTail + chunk).slice(-2_000)
          })
          child.on('error', rejectSession)
          child.on('close', (code) => {
            lines.close()
            if (code === 0) resolveSession()
            else rejectSession(new Error(`docker logs follow exited with code ${code}: ${stderrTail}`))
          })
        })
        attempts = 0
      } catch (error) {
        safeLog(`follow ended: ${error?.message}`)
      } finally {
        follower.child = null
      }
      if (stopping) break
      // A session that lived at least as long as the max backoff counts as
      // healthy: reset the reconnect attempt counter.
      if (nowMs() - sessionStartedAt >= config.backoffMaxMs) attempts = 0
      attempts += 1
      await new Promise((resolveWait) => setTimeout(resolveWait, nextBackoffDelayMs(attempts, config.backoffBaseMs, config.backoffMaxMs)))
    }
    followers.delete(record.containerId)
  }

  const pollWait = () => new Promise((resolve) => setTimeout(resolve, Math.min(500, config.rediscoveryPollIntervalMs)))

  const mainLoop = async () => {
    while (!stopping) {
      const records = await discoverContainers()
      if (stopping) break
      for (const [containerId, follower] of followers) {
        if (!records.some((record) => record.containerId === containerId)) {
          follower.kill()
        }
      }
      for (const record of records) {
        if (!followers.has(record.containerId)) {
          replayGuards.set(record.containerId, createReplayGuard())
          follow(record)
        }
      }
      for (let waited = 0; waited < config.rediscoveryPollIntervalMs && !stopping; waited += 500) {
        await pollWait()
      }
    }
  }

  let loopPromise = null
  let flushTimer = null

  const stop = async () => {
    stopping = true
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
    for (const follower of followers.values()) follower.kill()
    while (followers.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    scheduleFlush() // best-effort final drain with the bounded retry policy
    await flushChain
    await loopPromise
  }

  return {
    async start() {
      flushTimer = setInterval(scheduleFlush, config.flushIntervalMs)
      flushTimer.unref?.()
      loopPromise = mainLoop()
      return { stop }
    },
    stop,
    /** Test/inspection hooks: internal state without touching real hosts. */
    _internal: { buffer, cursorByContainer, followers, replayGuards },
  }
}

// Entry point: run only when executed directly (never on import by tests).
const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const config = parseConfig(process.env)
  const handle = createForwarder(config).start()
  const shutdown = (signal) => {
    console.error(`remote-log-forwarder: received ${signal}, flushing and exiting`)
    handle
      .then((session) => session.stop())
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(`remote-log-forwarder: shutdown error: ${error?.message}`)
        process.exit(1)
      })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
