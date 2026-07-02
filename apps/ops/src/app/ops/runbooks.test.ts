import { describe, expect, it } from 'vitest'

import {
  AI_RUNBOOK_IDS,
  LOG_RUNBOOK_IDS,
  OPS_RUNBOOK_IDS,
  OPS_RUNBOOKS,
  OVERVIEW_RUNBOOK_IDS,
  QUEUE_RUNBOOK_IDS,
  SCHEDULE_RUNBOOK_IDS,
  SOURCE_RUNBOOK_IDS,
  getOpsRunbooks,
  type OpsRunbookId,
} from './runbooks'

const REQUIRED_TITLES = [
  'Listings missing from map',
  'Search results look stale',
  'A source stopped working',
  'Source paused for quality drift',
  'Jobs are failing',
  'Schedules are disabled',
  'AI remapping is unavailable',
]

const CONTEXTUAL_GROUPS: Array<readonly OpsRunbookId[]> = [
  QUEUE_RUNBOOK_IDS,
  SOURCE_RUNBOOK_IDS,
  SCHEDULE_RUNBOOK_IDS,
  LOG_RUNBOOK_IDS,
  AI_RUNBOOK_IDS,
]

describe('OPS_RUNBOOKS', () => {
  it('should include every required operator runbook', () => {
    expect(getOpsRunbooks(OPS_RUNBOOK_IDS).map(runbook => runbook.title)).toEqual(REQUIRED_TITLES)
  })

  it('should link every runbook step to an operator page or action', () => {
    for (const runbook of getOpsRunbooks(OPS_RUNBOOK_IDS)) {
      expect(runbook.steps.every(step => step.href?.startsWith('/'))).toBe(true)
    }
  })

  it('should expose all runbooks from the ops overview', () => {
    expect(OVERVIEW_RUNBOOK_IDS).toEqual(OPS_RUNBOOK_IDS)
  })

  it('should expose each runbook from at least one contextual ops page', () => {
    const contextualIds = new Set(CONTEXTUAL_GROUPS.flat())

    for (const id of OPS_RUNBOOK_IDS) {
      expect(contextualIds.has(id)).toBe(true)
    }
  })

  it('should keep content in operator language', () => {
    for (const runbook of Object.values(OPS_RUNBOOKS)) {
      const content = [
        runbook.symptom,
        ...runbook.steps.flatMap(step => [step.text, step.actionLabel ?? '']),
        runbook.escalation,
      ].join(' ')

      expect(content).not.toMatch(/\bPOST\b|\bcurl\b|\/admin\/queues\/:name\/jobs/)
    }
  })
})
