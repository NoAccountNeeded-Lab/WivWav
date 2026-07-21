import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { expect as expectScreenshot } from 'vitest'
import { DataGrid } from '../DataGrid'
import type { GridColDef } from '../DataGrid'

interface RunLogRow {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
}

const columns: GridColDef<RunLogRow>[] = [
  { field: 'timestamp', headerName: 'Time', width: 180 },
  { field: 'level', headerName: 'Level', width: 90 },
  { field: 'message', headerName: 'Message', flex: 1 },
]

const rows: RunLogRow[] = [
  { id: '1', timestamp: '12:00:01', level: 'info', message: 'Run started' },
  { id: '2', timestamp: '12:00:04', level: 'warn', message: 'Rate limited, backing off' },
  { id: '3', timestamp: '12:00:09', level: 'error', message: 'Pagination nav failed on page 2' },
]

function DataGridHarness() {
  return (
    <div style={{ height: 320, width: '100%' }}>
      <DataGrid<RunLogRow>
        rows={rows}
        columns={columns}
        density="compact"
        hideFooterSelectedRowCount
        aria-label="Run log entries"
      />
    </div>
  )
}

const meta: Meta<typeof DataGridHarness> = {
  title: 'ui-web/DataGrid',
  component: DataGridHarness,
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof DataGridHarness>

export const Loaded: Story = {}

export const KeyboardNavigationInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // MUI DataGrid uses role="gridcell" (WAI-ARIA grid pattern), not "cell".
    const cell = canvas.getByRole('gridcell', { name: '12:00:01' })
    await userEvent.click(cell)
    await expect(cell).toHaveAttribute('aria-colindex', '1')

    await userEvent.keyboard('{ArrowRight}')
    const nextCell = canvas.getByRole('gridcell', { name: 'info' })
    await expect(nextCell).toHaveAttribute('aria-colindex', '2')
  },
}

export const VisualStates: Story = {
  play: async ({ canvasElement }) => {
    await expectScreenshot(canvasElement).toMatchScreenshot()
  },
}
