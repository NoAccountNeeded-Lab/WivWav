import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
// `storybook/test`'s `expect` deliberately doesn't wire in
// `@vitest/browser`'s `toMatchScreenshot` matcher (Storybook only
// guarantees Vitest core + jest-dom matchers there); use Vitest's own
// `expect` for screenshot assertions instead.
import { expect as expectScreenshot } from 'vitest'
import { Button } from '../Button'

const meta: Meta<typeof Button> = {
  title: 'ui-web/Button',
  component: Button,
  args: { onClick: fn() },
}
export default meta

type Story = StoryObj<typeof Button>

export const Default: Story = {
  args: { children: 'Save changes' },
}

export const Disabled: Story = {
  args: { children: 'Save changes', disabled: true },
}

export const Outlined: Story = {
  args: { children: 'Cancel', variant: 'outlined' },
}

export const ClickInteraction: Story = {
  args: { children: 'Click me' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Click me' })
    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const VisualStates: Story = {
  args: { children: 'Visual regression baseline' },
  parameters: { viewport: { defaultViewport: 'narrow' } },
  play: async ({ canvasElement }) => {
    await expectScreenshot(canvasElement).toMatchScreenshot()
  },
}
