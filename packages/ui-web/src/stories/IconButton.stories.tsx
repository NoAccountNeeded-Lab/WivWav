import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { expect as expectScreenshot } from 'vitest'
import { IconButton } from '../Button'

const meta: Meta<typeof IconButton> = {
  title: 'ui-web/IconButton',
  component: IconButton,
  args: { onClick: fn() },
}
export default meta

type Story = StoryObj<typeof IconButton>

export const Default: Story = {
  args: {
    'aria-label': 'Delete run',
    children: <span aria-hidden="true">✕</span>,
  },
}

export const Disabled: Story = {
  args: {
    'aria-label': 'Delete run',
    disabled: true,
    children: <span aria-hidden="true">✕</span>,
  },
}

export const ClickInteraction: Story = {
  args: {
    'aria-label': 'Delete run',
    children: <span aria-hidden="true">✕</span>,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Delete run' })
    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const VisualStates: Story = {
  args: {
    'aria-label': 'Delete run',
    children: <span aria-hidden="true">✕</span>,
  },
  play: async ({ canvasElement }) => {
    await expectScreenshot(canvasElement).toMatchScreenshot()
  },
}
