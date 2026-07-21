import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '../Button'
import { Drawer } from '../Overlays'

function DrawerHarness() {
  const [open, setOpen] = React.useState(false)
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Source: blvd</Button>
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <div style={{ padding: 16, width: 320 }}>
          <h2>Source: blvd</h2>
          <p>Adapter details would render here.</p>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </div>
      </Drawer>
    </div>
  )
}

const meta: Meta<typeof DrawerHarness> = {
  title: 'ui-web/Drawer',
  component: DrawerHarness,
}
export default meta

type Story = StoryObj<typeof DrawerHarness>

export const Closed: Story = {}

export const OpenAndCloseInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Source: blvd' }))

    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('heading', { name: 'Source: blvd' })).toBeInTheDocument()

    await userEvent.click(body.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(body.queryByRole('heading', { name: 'Source: blvd' })).not.toBeInTheDocument()
    })
  },
}
