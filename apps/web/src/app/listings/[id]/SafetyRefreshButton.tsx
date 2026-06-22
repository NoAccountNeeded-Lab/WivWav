'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import styles from './tabs.module.css'

interface RefreshResult {
  enqueued: boolean
  reason?: string
  retryAfter?: number
  jobIds?: { recalls: string; complaints: string; ratings: string }
}

interface SafetyRefreshButtonProps {
  listingId: string
  apiBaseUrl: string
}

export function SafetyRefreshButton({ listingId, apiBaseUrl }: SafetyRefreshButtonProps) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'rate-limited' | 'error'>('idle')
  const [retryAfterMinutes, setRetryAfterMinutes] = useState<number | null>(null)

  async function handleRefresh() {
    setState('loading')
    try {
      const res = await fetch(`${apiBaseUrl}/v1/listings/${listingId}/refresh-safety`, { method: 'POST' })
      if (!res.ok) {
        setState('error')
        return
      }
      const json = (await res.json()) as { data: RefreshResult }
      const result = json.data
      if (!result.enqueued && result.reason === 'rate-limited') {
        setRetryAfterMinutes(result.retryAfter != null ? Math.ceil(result.retryAfter / 60) : null)
        setState('rate-limited')
        return
      }
      setState('done')
      // Re-fetch server data after a short delay for the jobs to complete
      setTimeout(() => router.refresh(), 15_000)
    } catch {
      setState('error')
    }
  }

  if (state === 'rate-limited') {
    return (
      <span className={styles.staleWarning}>
        Refresh requested recently
        {retryAfterMinutes != null ? ` — check back in ~${retryAfterMinutes}m` : ''}
      </span>
    )
  }

  if (state === 'done' || state === 'loading') {
    return (
      <span className={styles.refreshingText}>
        <RefreshCw size={11} aria-hidden className={state === 'loading' ? styles.spinning : undefined} />
        {state === 'loading' ? ' Refreshing…' : ' Refresh queued'}
      </span>
    )
  }

  if (state === 'error') {
    return <span className={styles.staleWarning}>Refresh failed — try again later</span>
  }

  return (
    <button type="button" onClick={handleRefresh} className={styles.refreshButton}>
      <RefreshCw size={11} aria-hidden />
      Refresh safety data
    </button>
  )
}
