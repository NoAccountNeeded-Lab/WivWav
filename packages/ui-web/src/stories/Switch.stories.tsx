import type * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { FormControlLabel, Switch } from '../FormControls'

function SwitchHarness(props: React.ComponentProps<typeof Switch>) {
  return <FormControlLabel control={<Switch {...props} />} label="Auto-refresh" />
}

const meta: Meta<typeof SwitchHarness> = {
  title: 'ui-web/Switch',
  component: SwitchHarness,
  args: { onChange: fn() },
}
export default meta

type Story = StoryObj<typeof SwitchHarness>

export const Off: Story = {}

export const On: Story = {
  args: { checked: true },
}

export const ToggleInteraction: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    // MUI's Switch renders `role="switch"` (WAI-ARIA switch pattern), not "checkbox".
    const toggle = canvas.getByRole('switch', { name: 'Auto-refresh' })
    await userEvent.click(toggle)
    await expect(args.onChange).toHaveBeenCalledOnce()
  },
}
