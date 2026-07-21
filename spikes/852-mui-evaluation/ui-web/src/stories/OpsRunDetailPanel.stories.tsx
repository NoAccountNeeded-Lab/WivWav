import type { Meta, StoryObj } from '@storybook/react-vite'
import { OpsRunDetailPanel } from './OpsRunDetailPanel'
import type { RunLogRow } from './OpsRunDetailPanel'

// SPIKE PROTOTYPE for issue #852.
const sampleLogs: RunLogRow[] = [
  { id: '1', timestamp: '12:00:01', level: 'info', message: 'Run started' },
  { id: '2', timestamp: '12:00:04', level: 'warn', message: 'Rate limited, backing off' },
  { id: '3', timestamp: '12:00:09', level: 'error', message: 'Pagination nav failed on page 2' },
]

const meta: Meta<typeof OpsRunDetailPanel> = {
  title: 'apps-ops/Run detail panel',
  component: OpsRunDetailPanel,
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof OpsRunDetailPanel>

export const Loading: Story = { args: { state: 'loading' } }
export const ErrorState: Story = { args: { state: 'error' } }
export const Running: Story = { args: { state: 'running', logRows: sampleLogs.slice(0, 2) } }
export const Complete: Story = { args: { state: 'complete', logRows: sampleLogs } }

export const RunningNarrow: Story = {
  args: { state: 'running', logRows: sampleLogs },
  parameters: { viewport: { defaultViewport: 'narrow' } },
}
export const RunningWide: Story = {
  args: { state: 'running', logRows: sampleLogs },
  parameters: { viewport: { defaultViewport: 'wide' } },
}
