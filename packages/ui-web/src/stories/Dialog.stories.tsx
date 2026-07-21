import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
// `storybook/test`'s `expect` doesn't wire in `@vitest/browser`'s
// `toMatchScreenshot` matcher; use Vitest's own `expect` for that assertion.
import { expect as expectScreenshot } from 'vitest'
import { Button } from '../Button'
import { Dialog, DialogActions, DialogContent, DialogTitle } from '../Overlays'

function DialogHarness() {
  const [open, setOpen] = React.useState(false)
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Delete run</Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Delete this run?</DialogTitle>
        <DialogContent>This cannot be undone.</DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setOpen(false)}>Confirm delete</Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

const meta: Meta<typeof DialogHarness> = {
  title: 'ui-web/Dialog',
  component: DialogHarness,
}
export default meta

type Story = StoryObj<typeof DialogHarness>

export const Closed: Story = {}

export const OpenTrapsFocusAndEscapeCloses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Delete run' })
    await userEvent.click(trigger)

    const body = within(canvasElement.ownerDocument.body)
    const dialog = await body.findByRole('dialog')
    await expect(dialog).toBeInTheDocument()
    await expect(body.getByRole('heading', { name: 'Delete this run?' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(body.queryByRole('dialog')).not.toBeInTheDocument()
    })
  },
}

export const VisualStatesOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Delete run' }))
    const body = within(canvasElement.ownerDocument.body)
    const dialog = await body.findByRole('dialog')
    await expectScreenshot(dialog).toMatchScreenshot()
  },
}
