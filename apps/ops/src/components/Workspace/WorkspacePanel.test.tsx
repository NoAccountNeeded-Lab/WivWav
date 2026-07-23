// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePanel, type WorkspacePanelHandle } from './WorkspacePanel'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspacePanel', () => {
  it('renders as a labeled landmark region with a heading and the supplied content', () => {
    render(
      <WorkspacePanel title="Run · blvd" isMaximized={false} onClose={vi.fn()} onMaximize={vi.fn()} onRestore={vi.fn()}>
        <p>Run payload</p>
      </WorkspacePanel>,
    )

    expect(screen.getByRole('region', { name: 'Run · blvd' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Run · blvd', level: 2 })).toBeDefined()
    expect(screen.getByText('Run payload')).toBeDefined()
  })

  it('calls onClose from the close button', () => {
    const onClose = vi.fn()
    render(
      <WorkspacePanel title="Run · blvd" isMaximized={false} onClose={onClose} onMaximize={vi.fn()} onRestore={vi.fn()}>
        <p>Body</p>
      </WorkspacePanel>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close Run · blvd' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a maximize button when not maximized and calls onMaximize', () => {
    const onMaximize = vi.fn()
    render(
      <WorkspacePanel title="Run · blvd" isMaximized={false} onClose={vi.fn()} onMaximize={onMaximize} onRestore={vi.fn()}>
        <p>Body</p>
      </WorkspacePanel>,
    )

    const button = screen.getByRole('button', { name: 'Maximize Run · blvd' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(onMaximize).toHaveBeenCalledTimes(1)
  })

  it('shows a restore button when maximized and calls onRestore', () => {
    const onRestore = vi.fn()
    render(
      <WorkspacePanel title="Run · blvd" isMaximized onClose={vi.fn()} onMaximize={vi.fn()} onRestore={onRestore}>
        <p>Body</p>
      </WorkspacePanel>,
    )

    const button = screen.getByRole('button', { name: 'Restore Run · blvd' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('exposes actions as visible buttons (first two) and via the overflow menu (all)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()
    render(
      <WorkspacePanel
        title="Run · blvd"
        isMaximized={false}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
        onRestore={vi.fn()}
        actions={[
          { id: 'a', label: 'First action', onSelect: first },
          { id: 'b', label: 'Second action', onSelect: second },
          { id: 'c', label: 'Third action', onSelect: third },
        ]}
      >
        <p>Body</p>
      </WorkspacePanel>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'First action' }))
    expect(first).toHaveBeenCalledTimes(1)

    // The third action has no visible button, only overflow/context menu access.
    expect(screen.queryByRole('button', { name: 'Third action' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Run · blvd' }))
    const menu = screen.getByRole('menu', { name: 'Run · blvd actions' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Third action' }))
    expect(third).toHaveBeenCalledTimes(1)
  })

  it('opens the context menu with all actions on right-click', () => {
    const onSelect = vi.fn()
    render(
      <WorkspacePanel
        title="Run · blvd"
        isMaximized={false}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
        onRestore={vi.fn()}
        actions={[{ id: 'a', label: 'Only action', onSelect }]}
      >
        <p>Body</p>
      </WorkspacePanel>,
    )

    fireEvent.contextMenu(screen.getByRole('region', { name: 'Run · blvd' }))
    const menu = screen.getByRole('menu', { name: 'Run · blvd context menu' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Only action' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('opens the context menu via the keyboard (Shift+F10)', () => {
    render(
      <WorkspacePanel
        title="Run · blvd"
        isMaximized={false}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
        onRestore={vi.fn()}
        actions={[{ id: 'a', label: 'Only action', onSelect: vi.fn() }]}
      >
        <p>Body</p>
      </WorkspacePanel>,
    )

    fireEvent.keyDown(screen.getByRole('region', { name: 'Run · blvd' }), { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menu', { name: 'Run · blvd context menu' })).toBeDefined()
  })

  it('exposes an imperative focusHeading() handle used to focus an already-open panel', () => {
    const ref = createRef<WorkspacePanelHandle>()
    render(
      <WorkspacePanel ref={ref} title="Run · blvd" isMaximized={false} onClose={vi.fn()} onMaximize={vi.fn()} onRestore={vi.fn()}>
        <p>Body</p>
      </WorkspacePanel>,
    )

    ref.current?.focusHeading()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Run · blvd' }))
  })
})
