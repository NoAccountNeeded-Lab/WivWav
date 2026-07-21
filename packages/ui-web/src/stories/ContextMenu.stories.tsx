import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ContextMenu } from '../Overlays'
import { MenuItem } from '../Overlays'

function ContextMenuHarness({ onCopyId }: { onCopyId: () => void }) {
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null)
  return (
    // `role="listitem"` requires a `role="list"` parent (WAI-ARIA
    // aria-required-parent) — a real run list in apps/ops would already
    // provide one; this story supplies it explicitly so the a11y check
    // reflects the primitive's own behavior, not this fixture's shape.
    <div role="list">
      <div
        role="listitem"
        aria-label="Run 1234"
        style={{ padding: 16, border: '1px dashed #999' }}
        onContextMenu={(event) => {
          event.preventDefault()
          setPosition({ top: event.clientY, left: event.clientX })
        }}
      >
        Run #1234 (right-click for actions)
        <ContextMenu anchorPosition={position} onClose={() => setPosition(null)}>
          <MenuItem
            onClick={() => {
              onCopyId()
              setPosition(null)
            }}
          >
            Copy run ID
          </MenuItem>
          <MenuItem onClick={() => setPosition(null)}>View source</MenuItem>
        </ContextMenu>
      </div>
    </div>
  )
}

const meta: Meta<typeof ContextMenuHarness> = {
  title: 'ui-web/ContextMenu',
  component: ContextMenuHarness,
  args: { onCopyId: fn() },
}
export default meta

type Story = StoryObj<typeof ContextMenuHarness>

export const Closed: Story = {}

export const OpenViaRightClick: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const target = canvas.getByRole('listitem', { name: 'Run 1234' })
    await userEvent.pointer({ keys: '[MouseRight]', target })

    const body = within(canvasElement.ownerDocument.body)
    const item = await body.findByRole('menuitem', { name: 'Copy run ID' })
    await userEvent.click(item)

    await expect(args.onCopyId).toHaveBeenCalledOnce()
  },
}
