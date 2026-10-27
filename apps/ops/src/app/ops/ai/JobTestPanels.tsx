'use client'

import { IntakeTestPanel } from './IntakeTestPanel'

export { IntakeTestPanel }

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function JobTestPanel({ jobId }: { jobId: string }) {
  switch (jobId) {
    case 'intake':           return <IntakeTestPanel />
    default:                 return null
  }
}
