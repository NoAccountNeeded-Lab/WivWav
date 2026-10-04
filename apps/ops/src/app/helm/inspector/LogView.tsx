'use client'

import { RelativeTimestamp } from '@/lib/relative-time'
import { useHelm } from '../helm-context'
import { Notice } from '../primitives'
import { logKey } from '../helm-url'
import type { HelmLogEntry } from '../use-source-evidence'
import { SourceEvidenceGroups } from './EvidenceGroups'
import { Facts, InspectorSection, TechnicalDetails } from './InspectorSections'
import { useSourceScope } from './SourceEvidenceScope'
import styles from './helm-inspector.module.css'

export function useSelectedLog(): { entry: HelmLogEntry | null; reason: string } {
  const { nav } = useHelm()
  const scope = useSourceScope()
  const key = nav.location.selection.log
  const logs = scope?.evidence.logs.data
  if (!key) return { entry: null, reason: 'No log line is selected.' }
  if (!logs) return { entry: null, reason: scope ? 'Logs are unavailable (the log backend may be down).' : 'Select a source to load its logs.' }
  const entry = logs.entries.find(candidate => logKey(candidate) === key) ?? null
  return { entry, reason: 'This log line is no longer in the last hour of logs for this source.' }
}

export function LogView() {
  const { entry, reason } = useSelectedLog()
  if (!entry) {
    return (
      <>
        <InspectorSection title="What happened"><Notice tone="warning">{reason}</Notice></InspectorSection>
        <InspectorSection title="Impact"><p className={styles.prose}>Impact unknown: the log line is not loaded.</p></InspectorSection>
        <InspectorSection title="Evidence"><SourceEvidenceGroups /></InspectorSection>
      </>
    )
  }
  return (
    <>
      <InspectorSection title="What happened">
        <p className={styles.prose}>{entry.message ?? '(no message)'}</p>
        <Facts
          items={[
            ['Level', entry.level ?? 'unknown'],
            ['Service', entry.service ?? 'unknown'],
            ['Time', <RelativeTimestamp key="t" value={entry.ts} />],
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Impact">
        <p className={styles.prose}>Impact unknown: a single log line does not say what changed for listings. Use the surrounding run and pipeline evidence.</p>
      </InspectorSection>
      <InspectorSection title="Evidence">
        <Facts
          items={[
            ['Queue', entry.queue ?? '—'],
            ['Job id', entry.jobId ?? '—'],
            ['Source id', entry.sourceId ?? '—'],
            ['Request id', entry.requestId ?? '—'],
          ]}
        />
        <TechnicalDetails label="Technical payload">
          <pre className={styles.pre}>{JSON.stringify(entry.extra, null, 2)}</pre>
        </TechnicalDetails>
        {entry.stack && (
          <TechnicalDetails label="Stack trace">
            <pre className={styles.pre}>{entry.stack}</pre>
          </TechnicalDetails>
        )}
        <SourceEvidenceGroups />
      </InspectorSection>
    </>
  )
}
