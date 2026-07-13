import { Tabs } from '@wivwav/web'

const vehicleTabs = [
  { id: 'overview', label: 'Overview', content: <p>2021 Toyota Sienna Autobot VMI conversion, 34,200 miles.</p> },
  { id: 'accessibility', label: 'Accessibility', content: <p>In-floor ramp, 6-way power transfer seat, lowered floor.</p> },
  { id: 'history', label: 'History', content: <p>1 owner, clean title, no accidents reported.</p> },
]

export function Default() {
  return <Tabs tabs={vehicleTabs} />
}

export function SecondTabActive() {
  return <Tabs tabs={vehicleTabs} defaultTab="accessibility" />
}
