'use client'

import { ActivitySection } from './ActivitySection'
import { FlowSection } from './FlowSection'
import { InventorySection } from './InventorySection'
import { OverviewSection } from './OverviewSection'
import { ProblemsSection } from './ProblemsSection'
import { SectionFrame } from './SectionFrame'
import { useHelm } from './helm-context'

/** All five sections of the shared overview, in reading order. Navigation selects among them. */
export function HelmOverview() {
  const { data, nav } = useHelm()
  const current = nav.location.section
  return (
    <>
      <SectionFrame section="overview" title="Overview" current={current === 'overview'}>
        <OverviewSection />
      </SectionFrame>
      <SectionFrame section="inventory" title="Inventory" current={current === 'inventory'}>
        <InventorySection summary={data.summary.data} freshness={data.freshness.summary} error={data.summary.error} />
      </SectionFrame>
      <SectionFrame section="flow" title="Flow" current={current === 'flow'}>
        <FlowSection queues={data.resources.queues.data} freshness={data.freshness.queues} updatedAt={data.resources.queues.updatedAt} />
      </SectionFrame>
      <SectionFrame section="problems" title="Problems" current={current === 'problems'}>
        <ProblemsSection />
      </SectionFrame>
      <SectionFrame section="activity" title="Activity" current={current === 'activity'}>
        <ActivitySection />
      </SectionFrame>
    </>
  )
}
