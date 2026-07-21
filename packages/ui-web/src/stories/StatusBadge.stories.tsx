import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { expect as expectScreenshot } from 'vitest'
import { StatusBadge } from '../StatusBadge'

const meta: Meta<typeof StatusBadge> = {
  title: 'ui-web/StatusBadge',
  component: StatusBadge,
}
export default meta

type Story = StoryObj<typeof StatusBadge>

export const Success: Story = {
  args: { status: 'success', label: 'Complete' },
}

export const Warning: Story = {
  args: { status: 'warning', label: 'Rate limited' },
}

export const Danger: Story = {
  args: { status: 'danger', label: 'Failed' },
}

export const Neutral: Story = {
  args: { status: 'neutral', label: 'Queued' },
}

export const AccessibleLabelInteraction: Story = {
  args: { status: 'success', label: 'Complete' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Complete')).toBeInTheDocument()
  },
}

export const VisualStates: Story = {
  args: { status: 'danger', label: 'Failed' },
  play: async ({ canvasElement }) => {
    await expectScreenshot(canvasElement).toMatchScreenshot()
  },
}
