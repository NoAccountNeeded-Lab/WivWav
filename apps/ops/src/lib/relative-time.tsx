import type { ReactNode } from 'react'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const TWO_MONTHS_MS = 60 * DAY_MS

const absoluteFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export interface RelativeTimestampParts {
  label: string
  title: string
}

interface RelativeTimestampOptions {
  now?: Date
}

interface RelativeTimestampProps extends RelativeTimestampOptions {
  value: string | number | Date | null | undefined
  fallback?: ReactNode
  className?: string
}

export function formatAbsoluteTimestamp(value: string | number | Date | null | undefined): string | null {
  const date = parseTimestamp(value)
  if (!date) return null
  return absoluteFormatter.format(date)
}

export function getRelativeTimestampParts(
  value: string | number | Date | null | undefined,
  options: RelativeTimestampOptions = {},
): RelativeTimestampParts | null {
  const date = parseTimestamp(value)
  if (!date) return null

  const title = absoluteFormatter.format(date)
  const now = options.now ?? new Date()
  const diffMs = date.getTime() - now.getTime()
  const absMs = Math.abs(diffMs)

  if (absMs < MINUTE_MS) {
    return { label: diffMs < 0 ? 'less than 1 minute ago' : 'in less than 1 minute', title }
  }

  if (absMs < HOUR_MS) {
    return { label: relativeFormatter.format(toRelativeValue(diffMs, MINUTE_MS), 'minute'), title }
  }

  if (absMs < DAY_MS) {
    return { label: relativeFormatter.format(toRelativeValue(diffMs, HOUR_MS), 'hour'), title }
  }

  if (absMs < MONTH_MS) {
    return { label: relativeFormatter.format(toRelativeValue(diffMs, DAY_MS), 'day'), title }
  }

  if (absMs < TWO_MONTHS_MS) {
    return { label: relativeFormatter.format(toRelativeValue(diffMs, MONTH_MS), 'month'), title }
  }

  return { label: title, title }
}

export function formatRelativeTimestamp(
  value: string | number | Date | null | undefined,
  options: RelativeTimestampOptions = {},
): string | null {
  return getRelativeTimestampParts(value, options)?.label ?? null
}

export function RelativeTimestamp({
  value,
  fallback = '—',
  className,
  now,
}: RelativeTimestampProps) {
  const parts = getRelativeTimestampParts(value, now ? { now } : {})
  if (!parts) return <>{fallback}</>
  return <span className={className} title={parts.title}>{parts.label}</span>
}

function parseTimestamp(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toRelativeValue(diffMs: number, unitMs: number): number {
  const magnitude = Math.max(1, Math.round(Math.abs(diffMs) / unitMs))
  return diffMs < 0 ? -magnitude : magnitude
}
