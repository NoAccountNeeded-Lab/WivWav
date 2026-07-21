import type * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { expect as expectScreenshot } from 'vitest'
import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup } from '../FormControls'

function RadioGroupHarness(props: React.ComponentProps<typeof RadioGroup>) {
  return (
    <FormControl>
      <FormLabel id="conversion-type-label">Conversion type</FormLabel>
      <RadioGroup aria-labelledby="conversion-type-label" defaultValue="lease" {...props}>
        <FormControlLabel value="lease" control={<Radio />} label="Lease" />
        <FormControlLabel value="finance" control={<Radio />} label="Finance" />
        <FormControlLabel value="cash" control={<Radio />} label="Cash" />
      </RadioGroup>
    </FormControl>
  )
}

const meta: Meta<typeof RadioGroupHarness> = {
  title: 'ui-web/RadioGroup',
  component: RadioGroupHarness,
  args: { onChange: fn() },
}
export default meta

type Story = StoryObj<typeof RadioGroupHarness>

export const Default: Story = {}

export const SelectInteraction: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const financeOption = canvas.getByRole('radio', { name: 'Finance' })
    await userEvent.click(financeOption)
    await expect(financeOption).toBeChecked()
    await expect(args.onChange).toHaveBeenCalledOnce()
  },
}

export const VisualStates: Story = {
  play: async ({ canvasElement }) => {
    await expectScreenshot(canvasElement).toMatchScreenshot()
  },
}
