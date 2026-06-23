import Link from 'next/link'

import styles from './ops.module.css'
import { getOpsRunbooks, type OpsRunbookId } from './runbooks'

interface OpsRunbooksProps {
  ids: readonly OpsRunbookId[]
  title?: string
}

export function OpsRunbooks({ ids, title = 'Operator runbooks' }: OpsRunbooksProps) {
  const runbooks = getOpsRunbooks(ids)

  return (
    <section className={styles.runbooks} aria-labelledby="operator-runbooks-heading">
      <div className={styles.runbooksHeader}>
        <h2 id="operator-runbooks-heading" className={styles.sectionHeading}>{title}</h2>
        <p className={styles.sectionIntro}>Short recovery steps for common ops states.</p>
      </div>
      <div className={styles.runbookGrid}>
        {runbooks.map(runbook => (
          <details key={runbook.id} className={styles.runbookItem}>
            <summary>{runbook.title}</summary>
            <div className={styles.runbookBody}>
              <p className={styles.runbookSymptom}>{runbook.symptom}</p>
              <ol className={styles.runbookSteps}>
                {runbook.steps.map(step => (
                  <li key={`${runbook.id}-${step.text}`}>
                    <span>{step.text}</span>
                    {step.href && step.actionLabel && (
                      <Link href={step.href} className={styles.runbookLink}>
                        {step.actionLabel}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
              <p className={styles.runbookEscalation}>{runbook.escalation}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
