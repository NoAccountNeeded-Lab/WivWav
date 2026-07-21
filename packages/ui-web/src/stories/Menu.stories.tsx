import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button } from '../Button'
import { Menu, MenuItem } from '../Overlays'

function MenuHarness({ onSelect }: { onSelect: () => void }) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null)
  return (
    <div>
      <Button
        aria-haspopup="menu"
        aria-expanded={Boolean(anchorEl)}
        onClick={(event) => setAnchorEl(event.currentTarget)}
      >
        Run actions
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={() => {
            onSelect()
            setAnchorEl(null)
          }}
        >
          Retry run
        </MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)}>Cancel run</MenuItem>
      </Menu>
    </div>
  )
}

const meta: Meta<typeof MenuHarness> = {
  title: 'ui-web/Menu',
  component: MenuHarness,
  args: { onSelect: fn() },
}
export default meta

type Story = StoryObj<typeof MenuHarness>

export const Closed: Story = {}

export const OpenViaClickAndSelect: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Run actions' })
    await userEvent.click(trigger)

    const body = within(canvasElement.ownerDocument.body)
    const item = await body.findByRole('menuitem', { name: 'Retry run' })
    await userEvent.click(item)

    await expect(args.onSelect).toHaveBeenCalledOnce()
  },
}

export const OpenViaKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Run actions' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')

    const body = within(canvasElement.ownerDocument.body)
    const menu = await body.findByRole('menu')
    await expect(menu).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
  },
}
