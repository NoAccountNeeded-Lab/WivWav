'use client'

import { AgentsTestPanel } from './AgentsTestPanel'
import { IntakeTestPanel } from './IntakeTestPanel'
import { RemapTestPanel } from './RemapTestPanel'
import { StructureTestPanel } from './StructureTestPanel'

export { AgentsTestPanel, IntakeTestPanel, RemapTestPanel, StructureTestPanel }

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function JobTestPanel({ jobId }: { jobId: string }) {
  switch (jobId) {
    case 'intake':           return <IntakeTestPanel />
    case 'scraper.structure': return <StructureTestPanel />
    case 'scraper.remap':    return <RemapTestPanel />
    case 'agents':           return <AgentsTestPanel />
    default:                 return null
  }
}
