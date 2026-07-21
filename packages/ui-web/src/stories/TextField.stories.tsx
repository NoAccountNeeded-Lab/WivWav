import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { expect as expectScreenshot } from 'vitest'
import { TextField } from '../FormControls'
import { MenuItem } from '../Overlays'

const meta: Meta<typeof TextField> = {
  title: 'ui-web/TextField',
  component: TextField,
}
export default meta

type Story = StoryObj<typeof TextField>

export const Default: Story = {
  args: { label: 'Listing title' },
}

export const ErrorState: Story = {
  args: { label: 'Listing title', error: true, helperText: 'Title is required.' },
}

export const Disabled: Story = {
  args: { label: 'Listing title', disabled: true, value: 'Read-only value' },
}

// MUI's own recommended pattern for a select control is a `TextField` with
// `select` — so this wrapper's required-`label` policy covers "Select"
// without a separate wrapper component.
export const AsSelect: Story = {
  args: {
    label: 'Source',
    select: true,
    defaultValue: 'blvd',
    children: [
      <MenuItem key="blvd" value="blvd">
        blvd
      </MenuItem>,
      <MenuItem key="carfax" value="carfax">
        carfax
      </MenuItem>,
    ],
  },
}

export const TypeInteraction: Story = {
  args: { label: 'Listing title' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText('Listing title')
    await userEvent.type(input, '2020 Toyota Sienna')
    await expect(input).toHaveValue('2020 Toyota Sienna')
  },
}

export const VisualStates: Story = {
  args: { label: 'Listing title' },
  play: async ({ canvasElement }) => {
    await expectScreenshot(canvasElement).toMatchScreenshot()
  },
}
