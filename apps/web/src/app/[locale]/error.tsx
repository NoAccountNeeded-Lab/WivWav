'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { reportError } from '@/lib/error-reporter'

/**
 * Next.js App Router error boundary for route segments.
 * Catches errors thrown by server components and client components within a
 * route segment and forwards them to the ops log collector.
 *
 * For errors in the root layout itself, see global-error.tsx.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('ErrorPage')

  useEffect(() => {
    if (process.env['NEXT_PUBLIC_SENTRY_ENABLED'] === 'true') {
      void import('@sentry/nextjs').then((Sentry) => {
        Sentry.captureException(error)
      })
    }

    reportError({
      type: 'js-error',
      message: error.message,
      ...(error.stack !== undefined ? { stack: error.stack } : {}),
    })
  }, [error])

  return (
    <div
      role="alert"
      style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#1a1a1a',
        backgroundColor: '#ffffff',
      }}
    >
      <h2>{t('heading')}</h2>
      <p id="error-description">{t('description')}</p>
      <button
        type="button"
        aria-describedby="error-description"
        onClick={reset}
        style={{ outline: '2px solid #1a1a1a', outlineOffset: '2px' }}
      >
        {t('tryAgain')}
      </button>
    </div>
  )
}
