// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GridPanel, type PanelSize } from './GridPanel'

afterEach(() => {
  cleanup()
})

/** Stateful wrapper so a size selection round-trips into the `data-size`
 *  attribute the CSS module maps to a grid column/row span — `GridPanel`
 *  itself is a controlled component, so this is how a real caller
 *  (`DashboardGridClient`) would apply a preset. */
function ControlledPanel({ initialSize = 'small' as PanelSize, onClose = vi.fn() }) {
  const [size, setSize] = useState<PanelSize>(initialSize)
  const [collapsed, setCollapsed] = useState(false)
  return (
    <GridPanel
      title="Service health"
      size={size}
      collapsed={collapsed}
      onSizeChange={setSize}
      onToggleCollapse={() => setCollapsed(v => !v)}
      onClose={onClose}
    >
      <p>panel content</p>
    </GridPanel>
  )
}

function openMenu(title: string) {
  fireEvent.click(screen.getByRole('button', { name: `${title} size options` }))
}

describe('GridPanel — size presets', () => {
  it('applies the small preset span by default', () => {
    render(<ControlledPanel />)
    const panel = screen.getByRole('region', { name: 'Service health' })
    expect(panel.getAttribute('data-size')).toBe('small')
  })

  it('switches the applied span to medium when Medium is selected from the menu', () => {
    render(<ControlledPanel />)
    openMenu('Service health')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Medium' }))

    const panel = screen.getByRole('region', { name: 'Service health' })
    expect(panel.getAttribute('data-size')).toBe('medium')
  })

  it('switches the applied span to large when Large is selected from the menu', () => {
    render(<ControlledPanel />)
    openMenu('Service health')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }))

    const panel = screen.getByRole('region', { name: 'Service health' })
    expect(panel.getAttribute('data-size')).toBe('large')
  })

  it('marks the currently-applied preset as checked in the menu', () => {
    render(<ControlledPanel initialSize="medium" />)
    openMenu('Service health')
    const mediumItem = screen.getByRole('menuitemradio', { name: 'Medium' })
    const largeItem = screen.getByRole('menuitemradio', { name: 'Large' })
    expect(mediumItem.getAttribute('aria-checked')).toBe('true')
    expect(largeItem.getAttribute('aria-checked')).toBe('false')
  })
})

describe('GridPanel — menu focus management (WCAG 2.1 AA keyboard operability)', () => {
  it('moves focus to the first preset option when the menu opens', () => {
    render(<ControlledPanel />)
    openMenu('Service health')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Small' }))
  })

  it('closes the menu and returns focus to the trigger button on Escape', () => {
    render(<ControlledPanel />)
    const trigger = screen.getByRole('button', { name: 'Service health size options' })
    openMenu('Service health')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('returns focus to the trigger button after selecting a preset', () => {
    render(<ControlledPanel />)
    const trigger = screen.getByRole('button', { name: 'Service health size options' })
    openMenu('Service health')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }))
    expect(document.activeElement).toBe(trigger)
  })
})

describe('GridPanel — collapse/expand', () => {
  it('unmounts content and keeps the header when collapsed, then remounts it on expand', () => {
    render(<ControlledPanel />)
    expect(screen.getByText('panel content')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Service health' }))
    expect(screen.queryByText('panel content')).toBeNull()
    expect(screen.getByRole('region', { name: 'Service health' }).getAttribute('data-collapsed')).toBe('true')
    // Header title survives collapse — it's the title-bar-only strip.
    expect(screen.getByText('Service health')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Service health' }))
    expect(screen.getByText('panel content')).not.toBeNull()
    expect(screen.getByRole('region', { name: 'Service health' }).getAttribute('data-collapsed')).toBe('false')
  })
})

describe('GridPanel — close', () => {
  it('calls onClose when the close control is activated', () => {
    const onClose = vi.fn()
    render(<ControlledPanel onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close Service health' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
