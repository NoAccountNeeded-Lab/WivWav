import type * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Checkbox, FormControlLabel } from '../FormControls'

function CheckboxHarness(props: React.ComponentProps<typeof Checkbox>) {
  return <FormControlLabel control={<Checkbox {...props} />} label="Include sold listings" />
}

const meta: Meta<typeof CheckboxHarness> = {
  title: 'ui-web/Checkbox',
  component: CheckboxHarness,
  args: { onChange: fn() },
}
export default meta

type Story = StoryObj<typeof CheckboxHarness>

export const Unchecked: Story = {}

export const Checked: Story = {
  args: { checked: true },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const ToggleInteraction: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = canvas.getByRole('checkbox', { name: 'Include sold listings' })
    await userEvent.click(checkbox)
    await expect(args.onChange).toHaveBeenCalledOnce()
  },
}
