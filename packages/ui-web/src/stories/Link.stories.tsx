import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { expect as expectScreenshot } from 'vitest'
import { Link } from '../Link'

const meta: Meta<typeof Link> = {
  title: 'ui-web/Link',
  component: Link,
}
export default meta

type Story = StoryObj<typeof Link>

export const Default: Story = {
  args: { href: '/vehicle/1234', children: 'View vehicle detail' },
}

export const AlwaysUnderlined: Story = {
  args: { href: '/vehicle/1234', children: 'View vehicle detail', underline: 'always' },
}

export const AccessibleNameInteraction: Story = {
  args: { href: '/vehicle/1234', children: 'View vehicle detail' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', { name: 'View vehicle detail' })
    await expect(link).toHaveAttribute('href', '/vehicle/1234')
  },
}

export const VisualStates: Story = {
  args: { href: '/vehicle/1234', children: 'View vehicle detail' },
  play: async ({ canvasElement }) => {
    await expectScreenshot(canvasElement).toMatchScreenshot()
  },
}
