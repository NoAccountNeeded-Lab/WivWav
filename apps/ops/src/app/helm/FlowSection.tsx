import { OpsStatusChip, type OpsStatusVariant } from '@/components/OpsStatusChip'
import type { QueueRow } from '../ops/overview-helpers'
import { BacklogBars } from './BacklogBars'
import { buildBacklogRows, buildFlowStages, flowStateLabel, FLOW_LINEAGE_CAVEAT, type FlowStageState } from './flow-model'
import type { Freshness } from './helm-freshness'
import { FreshnessChip, Notice } from './primitives'
import styles from './helm-sections.module.css'

const STATE_VARIANT: Record<FlowStageState, OpsStatusVariant> = {
  unavailable: 'muted',
  paused: 'paused',
  exceptions: 'danger',
  working: 'neutral',
  idle: 'success',
}

interface FlowSectionProps {
  queues: QueueRow[] | null
  freshness: Freshness
  updatedAt: Date | null
}

export function FlowSection({ queues, freshness, updatedAt }: FlowSectionProps) {
  const stages = buildFlowStages(queues)
  return (
    <>
      <div className={styles.sectionHeader}>
        <FreshnessChip freshness={freshness} />
      </div>
      <Notice>{FLOW_LINEAGE_CAVEAT}</Notice>
      <ul className={styles.stageList} aria-label="Pipeline stages (grouped queues, not a serial path)">
        {stages.map(stage => (
          <li key={stage.definition.id} className={styles.stage} data-state={stage.state}>
            <h3 className={styles.stageName}>{stage.definition.label}</h3>
            <OpsStatusChip variant={STATE_VARIANT[stage.state]} label={flowStateLabel(stage.state)} />
            <p className={styles.note}>{stage.definition.description}</p>
            <dl className={styles.stageFacts}>
              <dt>Work</dt>
              <dd>{stage.work === null ? 'unknown' : `${stage.work.toLocaleString()} waiting, active or delayed`}</dd>
              <dt>Exceptions</dt>
              <dd>{stage.failed === null ? 'unknown' : `${stage.failed.toLocaleString()} failed`}</dd>
            </dl>
            {stage.missingQueues.length > 0 && (
              <p className={styles.cardMeta}>Not reported: {stage.missingQueues.join(', ')}</p>
            )}
          </li>
        ))}
      </ul>
      <BacklogBars rows={buildBacklogRows(queues)} asOf={updatedAt} />
    </>
  )
}
