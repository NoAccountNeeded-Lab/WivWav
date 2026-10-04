'use client'

import Link from 'next/link'
import { RelativeTimestamp } from '@/lib/relative-time'
import { useHelm } from '../helm-context'
import { briefProblem } from '../problem-impact'
import { Notice } from '../primitives'
import { SeverityMark } from '../severity'
import { isAcknowledged } from '../../ops/problem-presentation'
import { Facts, InspectorSection, TechnicalDetails } from './InspectorSections'
import styles from './helm-inspector.module.css'

export function problemTitle(fingerprint: string, brief: ReturnType<typeof briefProblem> | null): string {
  return brief ? brief.presentation.title : `Problem ${fingerprint}`
}

export function useSelectedProblem() {
  const { data, nav } = useHelm()
  const fingerprint = nav.location.selection.problem
  const problem = fingerprint ? (data.problems.data?.problems.find(candidate => candidate.fingerprint === fingerprint) ?? null) : null
  const brief = problem ? briefProblem(problem, { health: data.resources.health.data, sources: data.resources.sources.data }) : null
  return { fingerprint, problem, brief, loaded: data.problems.data !== null }
}

export function ProblemView() {
  const { problem, brief, loaded, fingerprint } = useSelectedProblem()

  if (!problem || !brief) {
    return (
      <>
        <InspectorSection title="What happened">
          <Notice tone="warning">
            {loaded
              ? 'This problem is not in the current problem list. It may have cleared, but a problem disappearing is not proof it was fixed. Check the source evidence.'
              : 'Problem data is unavailable, so the current state of this problem is unknown.'}
          </Notice>
          <Facts items={[['Fingerprint', <span key="f">{fingerprint}</span>]]} />
        </InspectorSection>
        <InspectorSection title="Impact">
          <p className={styles.prose}>Impact unknown: the problem is not currently loaded.</p>
        </InspectorSection>
      </>
    )
  }

  return (
    <>
      <InspectorSection title="What happened">
        <p className={styles.prose}><SeverityMark severity={problem.severity} /> {brief.presentation.title}</p>
        <p className={styles.prose}>{brief.summary}</p>
        <Facts
          items={[
            ['Detail', problem.detail],
            ['First seen', <RelativeTimestamp key="f" value={problem.firstSeen} fallback="unknown" />],
            ['Last seen', <RelativeTimestamp key="l" value={problem.lastSeen} fallback="unknown" />],
            ['Review', isAcknowledged(problem) ? `Reviewed${problem.acknowledgedBy ? ` by ${problem.acknowledgedBy}` : ''} (acknowledged; not necessarily repaired)` : 'Not reviewed'],
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Impact">
        <p className={styles.prose} data-impact-known={brief.impact.known ? 'true' : 'false'}>{brief.impact.text}</p>
        <p className={styles.reason}>{brief.scope.label}</p>
        <p className={styles.reason}><strong>Next:</strong> {brief.nextAction}</p>
      </InspectorSection>
      <InspectorSection title="Evidence">
        <p className={styles.reason}>
          {brief.presentation.external
            ? <a href={brief.presentation.href} target="_blank" rel="noreferrer">Open in {problem.source} (new tab)</a>
            : <Link href={brief.presentation.href}>Open the related legacy ops page</Link>}
        </p>
        <TechnicalDetails>
          <pre className={styles.pre}>{JSON.stringify(problem, null, 2)}</pre>
        </TechnicalDetails>
      </InspectorSection>
    </>
  )
}
