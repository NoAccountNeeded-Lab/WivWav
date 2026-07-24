'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { HealthResponse, OverallHealthStatus } from '@wivwav/types'
import { getPublicApiBaseUrl } from '../lib/api-url'
import { useViewTransitionNav } from './OpsNav/useViewTransitionNav'
import { ThemePicker } from './ThemePicker'
import styles from './OpsHeader.module.css'

const REFRESH_INTERVAL_MS = 30_000
const ANNOUNCEMENT_THROTTLE_MS = 12_000

type HeaderStatus = OverallHealthStatus | 'unknown'

interface OpsHeaderProps {
  sectionTitle?: string
}

const SECTION_TITLES: ReadonlyArray<{ prefix: string, title: string }> = [
  { prefix: '/ops/refresh-listings', title: 'Refresh listings' },
  { prefix: '/ops/readiness', title: 'Site readiness' },
  { prefix: '/ops/schedules', title: 'Recurring jobs' },
  { prefix: '/ops/sources/', title: 'Source pipeline' },
  { prefix: '/ops/sources', title: 'Source health' },
  { prefix: '/ops/queues', title: 'Advanced queue diagnostics' },
  { prefix: '/ops/config', title: 'AI provider settings' },
  { prefix: '/ops/logs', title: 'Logs' },
  { prefix: '/ops/runs', title: 'Listing import activity' },
  { prefix: '/ops/ai', title: 'Source repair' },
  { prefix: '/status', title: 'System status' },
  { prefix: '/ops', title: 'WivWav Health' },
]

export function OpsHeader({ sectionTitle }: OpsHeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const viewTransitionNav = useViewTransitionNav()
  const [status, setStatus] = useState<HeaderStatus>('unknown')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [announcement, setAnnouncement] = useState('Checking live operations status.')
  const lastAnnouncementAt = useRef(0)
  const queuedAnnouncement = useRef<string | null>(null)
  const timeoutId = useRef<number | null>(null)

  const queueAnnouncement = useCallback((message: string) => {
    const now = Date.now()
    const delay = getAnnouncementDelay(now, lastAnnouncementAt.current)

    if (delay === 0) {
      lastAnnouncementAt.current = now
      setAnnouncement(message)
      queuedAnnouncement.current = null
      if (timeoutId.current != null) {
        window.clearTimeout(timeoutId.current)
        timeoutId.current = null
      }
      return
    }

    queuedAnnouncement.current = message
    if (timeoutId.current != null) return

    timeoutId.current = window.setTimeout(() => {
      timeoutId.current = null
      const pending = queuedAnnouncement.current
      if (!pending) return
      queuedAnnouncement.current = null
      lastAnnouncementAt.current = Date.now()
      setAnnouncement(pending)
    }, delay)
  }, [])

  useEffect(() => {
    return () => {
      if (timeoutId.current != null) {
        window.clearTimeout(timeoutId.current)
      }
    }
  }, [])

  useEffect(() => {
    async function refresh() {
      setIsRefreshing(true)
      const now = new Date()

      try {
        const response = await fetch(`${getPublicApiBaseUrl()}/health`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`Health check failed with ${response.status}`)
        const health = await response.json() as HealthResponse
        setStatus(health.status)
        setUpdatedAt(now)
        queueAnnouncement(
          `Operations status updated ${formatTime(now)}. ${statusAnnouncementLabel(health.status)}.`
        )
      } catch {
        setStatus('unknown')
        setUpdatedAt(now)
        queueAnnouncement(`Operations status unavailable as of ${formatTime(now)}.`)
      } finally {
        setIsRefreshing(false)
      }
    }

    void refresh()
    const intervalId = window.setInterval(() => {
      void refresh()
    }, REFRESH_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [queueAnnouncement])

  const logout = useCallback(async () => {
    setIsLoggingOut(true)
    try {
      await fetch('/api/logout', { method: 'POST' })
    } finally {
      router.push('/login')
    }
  }, [router])

  const title = sectionTitle ?? sectionTitleForPath(pathname)
  const statusLabel = formatStatus(status)
  const liveMeta = isRefreshing
    ? 'Refreshing status…'
    : updatedAt
      ? `Updated ${formatTime(updatedAt)}`
      : 'Checking status…'

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <Link
            href="/ops"
            className={styles.brand}
            aria-label="WivWav Ops — go to ops overview"
            onClick={event => viewTransitionNav(event, '/ops')}
          >
            WivWav Ops
          </Link>
          {title && (
            <>
              <span className={styles.divider} aria-hidden="true">/</span>
              <span className={styles.section}>{title}</span>
            </>
          )}
        </div>

        <div className={styles.right}>
          <Link
            href="/ops/readiness"
            className={styles.statusPill}
            data-status={status}
            aria-label={`Overall operational status: ${statusLabel}. Open site readiness.`}
            onClick={event => viewTransitionNav(event, '/ops/readiness')}
          >
            <span className={styles.statusDot} aria-hidden="true" />
            <span className={styles.statusText}>{statusLabel}</span>
          </Link>

          <div className={styles.liveState} data-state={isRefreshing ? 'refreshing' : status === 'unknown' ? 'unknown' : 'live'}>
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} aria-hidden="true" />
              Live
            </span>
            <span className={styles.liveMeta}>{liveMeta}</span>
            <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
              {announcement}
            </span>
          </div>

          <ThemePicker />

          <button
            type="button"
            className={styles.logoutButton}
            onClick={() => void logout()}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? 'Signing out…' : 'Log out'}
          </button>
        </div>
      </div>
    </header>
  )
}

function sectionTitleForPath(pathname: string | null): string | undefined {
  if (!pathname) return undefined
  return SECTION_TITLES.find(entry => pathname.startsWith(entry.prefix))?.title
}

function formatStatus(status: HeaderStatus): string {
  if (status === 'ok') return 'Operational'
  if (status === 'degraded') return 'Degraded'
  if (status === 'down') return 'Disruption'
  return 'Status unavailable'
}

function statusAnnouncementLabel(status: OverallHealthStatus): string {
  if (status === 'ok') return 'All systems operational'
  if (status === 'degraded') return 'Some systems are degraded'
  return 'A service disruption is active'
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export function getAnnouncementDelay(now: number, lastAnnouncementAt: number, throttleMs = ANNOUNCEMENT_THROTTLE_MS): number {
  const elapsed = now - lastAnnouncementAt
  if (elapsed >= throttleMs) return 0
  return throttleMs - elapsed
}
