import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '../Button'
import { Tooltip } from '../Overlays'

function TooltipHarness() {
  return (
    <Tooltip title="View related source">
      <Button size="small" variant="outlined">
        Source: blvd
      </Button>
    </Tooltip>
  )
}

const meta: Meta<typeof TooltipHarness> = {
  title: 'ui-web/Tooltip',
  component: TooltipHarness,
}
export default meta

type Story = StoryObj<typeof TooltipHarness>

export const Default: Story = {}

export const ShowsOnFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // MUI's Tooltip sets the child's `aria-label` from `title`, so the
    // button's accessible name is the tooltip text, not its visible label.
    const trigger = canvas.getByRole('button', { name: 'View related source' })
    trigger.focus()

    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => {
      expect(body.getByText('View related source')).toBeInTheDocument()
    })
  },
}
