'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CopyButton } from '@/components/CopyButton'
import { OpsRunbooks } from '../OpsRunbooks'
import styles from '../ops.module.css'
import { LOG_RUNBOOK_IDS } from '../runbooks'
import logsStyles from './logs.module.css'
import {
  ansiToPlainText,
  parseAnsi,
  type AnsiNamedColor,
  type AnsiSegment,
} from './ansi'

interface LogEntry {
  ts: string
  level: string | null
  service: string | null
  message: string | null
  requestId: string | null
  queue: string | null
  jobId: string | null
  sourceId: string | null
  stack: string | null
  extra: Record<string, unknown>
}

interface LogsClientProps {
  apiBaseUrl: string
  initialSearch?: string
}

type LevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug'

const LEVEL_PRIORITY: Record<string, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
}

function levelVariant(level: string | null): string {
  switch (level) {
    case 'fatal':
    case 'error':
      return 'danger'
    case 'warn':
      return 'warning'
    case 'info':
      return 'neutral'
    case 'debug':
    case 'trace':
      return 'muted'
    default:
      return 'neutral'
  }
}

function fmtTs(ts: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts))
}

function hasDetails(entry: LogEntry): boolean {
  return entry.stack !== null || Object.keys(entry.extra).length > 0
}

function requiredClass(value: string | undefined): string {
  return value ?? ''
}

const ANSI_FOREGROUND_CLASSES: Record<AnsiNamedColor, string> = {
  black: requiredClass(logsStyles.ansiBlack),
  red: requiredClass(logsStyles.ansiRed),
  green: requiredClass(logsStyles.ansiGreen),
  yellow: requiredClass(logsStyles.ansiYellow),
  blue: requiredClass(logsStyles.ansiBlue),
  magenta: requiredClass(logsStyles.ansiMagenta),
  cyan: requiredClass(logsStyles.ansiCyan),
  white: requiredClass(logsStyles.ansiWhite),
  'bright-black': requiredClass(logsStyles.ansiBlack),
  'bright-red': requiredClass(logsStyles.ansiRed),
  'bright-green': requiredClass(logsStyles.ansiGreen),
  'bright-yellow': requiredClass(logsStyles.ansiYellow),
  'bright-blue': requiredClass(logsStyles.ansiBlue),
  'bright-magenta': requiredClass(logsStyles.ansiMagenta),
  'bright-cyan': requiredClass(logsStyles.ansiCyan),
  'bright-white': requiredClass(logsStyles.ansiWhite),
}

const ANSI_BACKGROUND_CLASSES: Record<AnsiNamedColor, string> = {
  black: requiredClass(logsStyles.ansiBgBlack),
  red: requiredClass(logsStyles.ansiBgRed),
  green: requiredClass(logsStyles.ansiBgGreen),
  yellow: requiredClass(logsStyles.ansiBgYellow),
  blue: requiredClass(logsStyles.ansiBgBlue),
  magenta: requiredClass(logsStyles.ansiBgMagenta),
  cyan: requiredClass(logsStyles.ansiBgCyan),
  white: requiredClass(logsStyles.ansiBgWhite),
  'bright-black': requiredClass(logsStyles.ansiBgBlack),
  'bright-red': requiredClass(logsStyles.ansiBgRed),
  'bright-green': requiredClass(logsStyles.ansiBgGreen),
  'bright-yellow': requiredClass(logsStyles.ansiBgYellow),
  'bright-blue': requiredClass(logsStyles.ansiBgBlue),
  'bright-magenta': requiredClass(logsStyles.ansiBgMagenta),
  'bright-cyan': requiredClass(logsStyles.ansiBgCyan),
  'bright-white': requiredClass(logsStyles.ansiBgWhite),
}

function namedAnsiColor(color: string | null): color is AnsiNamedColor {
  return color !== null && color in ANSI_FOREGROUND_CLASSES
}

function AnsiText({ segments }: { segments: AnsiSegment[] }) {
  return segments.map((segment, index) => {
    const classes = [logsStyles.ansiSegment]
    if (segment.style.bold) classes.push(logsStyles.ansiBold)
    if (segment.style.dim) classes.push(logsStyles.ansiDim)
    if (segment.style.italic) classes.push(logsStyles.ansiItalic)
    if (segment.style.underline) classes.push(logsStyles.ansiUnderline)
    if (segment.style.inverse) classes.push(logsStyles.ansiInverse)
    if (segment.style.strikethrough) classes.push(logsStyles.ansiStrikethrough)

    const foreground = segment.style.inverse
      ? segment.style.background
      : segment.style.foreground
    const background = segment.style.inverse
      ? segment.style.foreground
      : segment.style.background
    const inlineStyle: { color?: string; backgroundColor?: string } = {}
    if (namedAnsiColor(foreground)) {
      classes.push(ANSI_FOREGROUND_CLASSES[foreground])
    } else if (foreground) {
      inlineStyle.color = foreground
    }
    if (namedAnsiColor(background)) {
      classes.push(ANSI_BACKGROUND_CLASSES[background])
    } else if (background) {
      inlineStyle.backgroundColor = background
    }

    return (
      <span key={index} className={classes.join(' ')} style={inlineStyle}>
        {segment.text}
      </span>
    )
  })
}

function EntryDetails({ entry }: { entry: LogEntry }) {
  const extraKeys = Object.keys(entry.extra)
  const contextJson = extraKeys.length > 0 ? JSON.stringify(entry.extra, null, 2) : null
  const stackSegments = entry.stack ? parseAnsi(entry.stack) : null
  return (
    <div className={logsStyles.entryDetails}>
      {stackSegments ? (
        <div className={logsStyles.detailSection}>
          <div className={logsStyles.detailSectionHead}>
            <p className={logsStyles.detailLabel}>Stack trace</p>
            <CopyButton text={ansiToPlainText(entry.stack ?? '')} label="Copy stack trace" />
          </div>
          <pre className={styles.miniCode}><AnsiText segments={stackSegments} /></pre>
        </div>
      ) : null}
      {contextJson ? (
        <div className={logsStyles.detailSection}>
          <div className={logsStyles.detailSectionHead}>
            <p className={logsStyles.detailLabel}>Context</p>
            <CopyButton text={contextJson} label="Copy context JSON" />
          </div>
          <pre className={styles.miniCode}>{contextJson}</pre>
        </div>
      ) : null}
    </div>
  )
}

interface EntryRowProps {
  entry: LogEntry
  rowId: string
}

function EntryRow({ entry, rowId }: EntryRowProps) {
  const [expanded, setExpanded] = useState(false)
  const expandable = hasDetails(entry)
  const messageSegments = entry.message ? parseAnsi(entry.message) : null
  const plainMessage = entry.message ? ansiToPlainText(entry.message) : null

  return (
    <>
      <tr
        className={expandable ? logsStyles.expandableRow : undefined}
      >
        <td className={`${styles.muted} ${logsStyles.tsCell}`}>{fmtTs(entry.ts)}</td>
        <td>
          <span
            className={styles.badge}
            data-variant={levelVariant(entry.level)}
          >
            {entry.level ?? '—'}
          </span>
        </td>
        <td className={logsStyles.serviceCell}>
          {entry.service ? (
            <code className={logsStyles.mono}>{entry.service}</code>
          ) : (
            <span className={styles.muted}>—</span>
          )}
        </td>
        <td className={logsStyles.msgCell}>
          <div className={logsStyles.msgRow}>
            <span className={logsStyles.msgText}>
              {messageSegments ? <AnsiText segments={messageSegments} /> : '—'}
            </span>
            {plainMessage ? (
              <CopyButton text={plainMessage} label="Copy message" className={logsStyles.msgCopyBtn} />
            ) : null}
          </div>
          {entry.requestId ? (
            <span className={logsStyles.metaChip}>req:{entry.requestId.slice(0, 8)}</span>
          ) : null}
          {entry.queue ? (
            <span className={logsStyles.metaChip}>q:{entry.queue}</span>
          ) : null}
          {entry.jobId ? (
            <span className={logsStyles.metaChip}>job:{entry.jobId.slice(0, 8)}</span>
          ) : null}
          {entry.sourceId ? (
            <span className={logsStyles.metaChip}>src:{entry.sourceId.slice(0, 8)}</span>
          ) : null}
        </td>
        <td className={logsStyles.expandCell}>
          {expandable ? (
            <button
              type="button"
              className={logsStyles.expandBtn}
              aria-label={expanded ? `Collapse details for ${fmtTs(entry.ts)}` : `Expand details for ${fmtTs(entry.ts)}`}
              aria-expanded={expanded}
              aria-controls={rowId}
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? '▲' : '▼'}
            </button>
          ) : null}
        </td>
      </tr>
      {expandable ? (
        <tr id={rowId} className={logsStyles.detailRow} hidden={!expanded}>
          <td colSpan={5}>
            <EntryDetails entry={entry} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

export function LogsClient({ apiBaseUrl, initialSearch = '' }: LogsClientProps) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [services, setServices] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [liveStatus, setLiveStatus] = useState('')

  const [serviceFilter, setServiceFilter] = useState<string>('all')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [search, setSearch] = useState(initialSearch)
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoadedOnce = useRef(false)

  // Debounce the search input — only fire query after 400 ms idle
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setUnavailable(false)
    if (hasLoadedOnce.current) setLiveStatus('Refreshing logs…')

    const params = new URLSearchParams({ limit: '200' })
    if (serviceFilter !== 'all') params.set('service', serviceFilter)
    if (debouncedSearch) params.set('search', debouncedSearch)

    try {
      const res = await fetch(`${apiBaseUrl}/admin/logs?${params.toString()}`, { cache: 'no-store' })
      if (res.status === 503) {
        setUnavailable(true)
        setEntries(null)
        setLiveStatus('Log backend unavailable')
        return
      }
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: { entries: LogEntry[]; services: string[] } }
      setEntries(body.data.entries)
      hasLoadedOnce.current = true
      setLiveStatus(`Loaded ${body.data.entries.length} ${body.data.entries.length === 1 ? 'entry' : 'entries'}`)
      setServices(prev => {
        // Merge new services into existing known set
        const merged = new Set([...prev, ...body.data.services])
        return [...merged].sort()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
      setLiveStatus('Failed to load logs')
    } finally {
      setIsLoading(false)
    }
  }, [apiBaseUrl, serviceFilter, debouncedSearch])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!entries) return null
    if (levelFilter === 'all') return entries
    return entries.filter(e => {
      if (!e.level) return false
      const priority = LEVEL_PRIORITY[e.level] ?? 99
      const threshold = LEVEL_PRIORITY[levelFilter] ?? 99
      return priority <= threshold
    })
  }, [entries, levelFilter])

  const counts = useMemo(() => {
    if (!entries) return { error: 0, warn: 0, info: 0 }
    return {
      error: entries.filter(e => e.level === 'error' || e.level === 'fatal').length,
      warn: entries.filter(e => e.level === 'warn').length,
      info: entries.filter(e => e.level === 'info').length,
    }
  }, [entries])

  return (
    <main id="main-content" className={`${styles.main} ${logsStyles.logsPage}`}>
      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{liveStatus}</p>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Logs</h1>
            <p className={styles.pageIntro}>Search recent application events across services by source, severity, and message text.</p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        {/* Controls bar */}
        <div className={styles.controlsBar}>
          {/* Service filter */}
          <label className={styles.srOnly} htmlFor="service-select">Filter by service</label>
          <select
            id="service-select"
            className={styles.select}
            value={serviceFilter}
            onChange={e => setServiceFilter(e.target.value)}
          >
            <option value="all">All services</option>
            {services.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Level filter pills */}
          <div className={styles.filterGroup} role="group" aria-label="Filter by log level">
            {(['all', 'error', 'warn', 'info', 'debug'] as LevelFilter[]).map(lvl => (
              <button
                key={lvl}
                type="button"
                className={styles.filterPill}
                data-active={levelFilter === lvl ? 'true' : 'false'}
                aria-pressed={levelFilter === lvl}
                onClick={() => setLevelFilter(lvl)}
              >
                {lvl === 'all' ? `All (${entries?.length ?? 0})` : null}
                {lvl === 'error' ? `Errors (${counts.error})` : null}
                {lvl === 'warn' ? `Warn (${counts.warn})` : null}
                {lvl === 'info' ? `Info (${counts.info})` : null}
                {lvl === 'debug' ? 'Debug+' : null}
              </button>
            ))}
          </div>

          <div className={styles.controlsBarRight}>
            {/* Search */}
            <label className={styles.srOnly} htmlFor="log-search">Search messages</label>
            <input
              id="log-search"
              type="search"
              className={styles.input}
              placeholder="Search messages…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '14rem' }}
            />
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
            >
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        <OpsRunbooks ids={LOG_RUNBOOK_IDS} />

        {/* Status messages */}
        {unavailable ? (
          <div className={logsStyles.unavailable} role="status">
            <strong>Log backend unavailable.</strong>
            {' '}Start the observability stack, then refresh this page to query application logs:{' '}
            <code className={logsStyles.mono}>docker compose --profile obs up</code>
          </div>
        ) : error ? (
          <p className={styles.error} role="alert">Logs could not load: {error}. Check the API and observability stack, then refresh.</p>
        ) : !filtered ? (
          <p className={styles.empty} role="status">Loading recent logs. If this does not finish, confirm the API and observability stack are running.</p>
        ) : filtered.length === 0 ? (
          <p className={styles.empty} role="status">
            No log entries found
            {levelFilter !== 'all' ? ` at ${levelFilter} level or above` : ''}
            {debouncedSearch ? ` matching "${debouncedSearch}"` : ''}
            {serviceFilter !== 'all' ? ` for service "${serviceFilter}"` : ''}
            {'.'} Clear filters or widen the search to inspect more events.
          </p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table} aria-label="Application log entries">
              <caption className={styles.srOnly}>
                {filtered.length} log {filtered.length === 1 ? 'entry' : 'entries'}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Level</th>
                  <th scope="col">Service</th>
                  <th scope="col">Message</th>
                  <th scope="col"><span className={styles.srOnly}>Details</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, i) => (
                  // Entries don't have a stable unique id, use ts+index
                  <EntryRow key={`${entry.ts}-${i}`} entry={entry} rowId={`log-detail-${i}`} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className={styles.helpPanel}>
          <summary>About this page</summary>
          <div className={styles.helpBody}>
            <p>
              This page queries <strong>Loki</strong> (the local log aggregation backend) for the most recent
              200 log lines across all services. Logs are structured JSON emitted by <code>pino</code> in the
              API, scraper, and queue worker processes, then collected by Grafana Alloy.
            </p>
            <ul>
              <li><strong>Service</strong> — the process that emitted the line (api, scraper, worker, etc.)</li>
              <li><strong>requestId</strong> — correlates multiple lines from a single HTTP request</li>
              <li><strong>queue / jobId</strong> — correlates lines from a BullMQ job execution</li>
              <li><strong>sourceId</strong> — the data source being scraped when the line was emitted</li>
            </ul>
            <p>
              For historical queries and dashboards use{' '}
              <a href="http://localhost:3003" target="_blank" rel="noreferrer" style={{ color: 'var(--clr-primary)' }}>
                Grafana<span className={styles.srOnly}> (opens in new tab)</span>
              </a>
              {' '}(available when the obs profile is running).
            </p>
          </div>
        </details>
      </div>
    </main>
  )
}
