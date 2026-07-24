// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceGrid } from './WorkspaceGrid'
import type { WorkspaceApi } from './useWorkspaceState'
import type { WorkspacePanelState } from './workspace-types'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const RUN_PANEL: WorkspacePanelState = { id: 'run:1234', entityType: 'run', entityId: '1234', span: 1 }
const SOURCE_PANEL: WorkspacePanelState = { id: 'source:blvd', entityType: 'source', entityId: 'blvd', span: 2 }

function buildWorkspace(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    panels: [RUN_PANEL],
    maximizedId: null,
    minimizedId: null,
    isOpen: () => true,
    openPanel: vi.fn(() => 'run:1234' as const),
    closePanel: vi.fn(),
    setSpan: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    minimize: vi.fn(),
    restoreMinimized: vi.fn(),
    replacePanels: vi.fn(),
    focusTarget: null,
    consumeFocusTarget: vi.fn(),
    ...overrides,
  }
}

function renderPanel(panel: WorkspacePanelState) {
  return { title: `${panel.entityType} · ${panel.entityId}`, content: <p>Content for {panel.id}</p> }
}

describe('WorkspaceGrid', () => {
  it('renders the emptyState when no panels are open', () => {
    render(<WorkspaceGrid workspace={buildWorkspace({ panels: [] })} renderPanel={renderPanel} emptyState={<p>No panels open</p>} />)
    expect(screen.getByText('No panels open')).toBeDefined()
  })

  it('renders every open panel as a landmark region', () => {
    render(<WorkspaceGrid workspace={buildWorkspace({ panels: [RUN_PANEL, SOURCE_PANEL] })} renderPanel={renderPanel} />)

    expect(screen.getByRole('region', { name: 'run · 1234' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'source · blvd' })).toBeDefined()
  })

  it('applies the panel span as a data attribute for the grid layout', () => {
    render(<WorkspaceGrid workspace={buildWorkspace({ panels: [RUN_PANEL, SOURCE_PANEL] })} renderPanel={renderPanel} />)

    const runItem = screen.getByRole('region', { name: 'run · 1234' }).closest('[data-span]')
    const sourceItem = screen.getByRole('region', { name: 'source · blvd' }).closest('[data-span]')
    expect(runItem?.getAttribute('data-span')).toBe('1')
    expect(sourceItem?.getAttribute('data-span')).toBe('2')
  })

  it('renders only the maximized panel, removing every other panel from the DOM', () => {
    render(
      <WorkspaceGrid
        workspace={buildWorkspace({ panels: [RUN_PANEL, SOURCE_PANEL], maximizedId: 'run:1234' })}
        renderPanel={renderPanel}
      />,
    )

    expect(screen.getByRole('region', { name: 'run · 1234' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'source · blvd' })).toBeNull()
  })

  it('restores on Escape while a panel is maximized', () => {
    const restore = vi.fn()
    render(
      <WorkspaceGrid
        workspace={buildWorkspace({ panels: [RUN_PANEL], maximizedId: 'run:1234', restore })}
        renderPanel={renderPanel}
      />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('does not restore on Escape when nothing is maximized', () => {
    const restore = vi.fn()
    render(<WorkspaceGrid workspace={buildWorkspace({ panels: [RUN_PANEL], restore })} renderPanel={renderPanel} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(restore).not.toHaveBeenCalled()
  })

  it('calls closePanel/maximize with the clicked panel id', () => {
    const closePanel = vi.fn()
    const maximize = vi.fn()
    render(
      <WorkspaceGrid workspace={buildWorkspace({ panels: [RUN_PANEL], closePanel, maximize })} renderPanel={renderPanel} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Maximize run · 1234' }))
    expect(maximize).toHaveBeenCalledWith('run:1234')

    fireEvent.click(screen.getByRole('button', { name: 'Close run · 1234' }))
    expect(closePanel).toHaveBeenCalledWith('run:1234')
  })

  it('focuses the focusTarget panel heading and consumes it', () => {
    const consumeFocusTarget = vi.fn()
    render(
      <WorkspaceGrid
        workspace={buildWorkspace({ panels: [RUN_PANEL, SOURCE_PANEL], focusTarget: 'source:blvd', consumeFocusTarget })}
        renderPanel={renderPanel}
      />,
    )

    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'source · blvd' }))
    expect(consumeFocusTarget).toHaveBeenCalledTimes(1)
  })

  it('calls minimize with the clicked panel id from the normal grid', () => {
    const minimize = vi.fn()
    render(<WorkspaceGrid workspace={buildWorkspace({ panels: [RUN_PANEL], minimize })} renderPanel={renderPanel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Minimize run · 1234' }))
    expect(minimize).toHaveBeenCalledWith('run:1234')
  })

  it('docks a minimized panel to a title-bar strip, keeping its content mounted but hidden, and excludes it from the grid layout', () => {
    render(
      <WorkspaceGrid
        workspace={buildWorkspace({ panels: [RUN_PANEL, SOURCE_PANEL], minimizedId: 'run:1234' })}
        renderPanel={renderPanel}
      />,
    )

    // The minimized panel's region still exists (content mounted)...
    const minimizedRegion = screen.getByRole('region', { name: 'run · 1234' })
    expect(minimizedRegion).toBeDefined()
    // ...but its body content is hidden rather than removed.
    expect(screen.getByText('Content for run:1234').closest('[hidden]')).not.toBeNull()
    // It is not laid out as a normal grid item alongside the other open panel.
    expect(minimizedRegion.closest('[data-span]')).toBeNull()
    // The other, non-minimized panel renders normally in the grid.
    expect(screen.getByText('Content for source:blvd').closest('[hidden]')).toBeNull()
  })

  it('restores a minimized panel when its strip control is activated', () => {
    const restoreMinimized = vi.fn()
    render(
      <WorkspaceGrid
        workspace={buildWorkspace({ panels: [RUN_PANEL], minimizedId: 'run:1234', restoreMinimized })}
        renderPanel={renderPanel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Restore run · 1234' }))
    expect(restoreMinimized).toHaveBeenCalledWith('run:1234')
  })
})
