// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUsePathname = vi.fn<() => string>()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

const { OpsShell } = await import('./OpsShell')

// OpsShell renders OpsHeader, which mounts ThemePicker; ThemePicker reads
// the OS colour-scheme preference on mount via matchMedia, which jsdom
// doesn't implement.
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
})

describe('OpsShell mobile drawer', () => {
  it('is closed by default and opens when the header menu button is activated', () => {
    mockUsePathname.mockReturnValue('/ops/sources')
    render(<OpsShell><p>page content</p></OpsShell>)

    expect(screen.queryByRole('dialog', { name: 'Ops navigation' })).toBeNull()

    const menuButton = screen.getByRole('button', { name: 'Open navigation menu' })
    fireEvent.click(menuButton)

    expect(screen.getByRole('dialog', { name: 'Ops navigation' })).toBeDefined()
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on Escape and returns focus to the menu button', () => {
    mockUsePathname.mockReturnValue('/ops/sources')
    render(<OpsShell><p>page content</p></OpsShell>)

    const menuButton = screen.getByRole('button', { name: 'Open navigation menu' })
    fireEvent.click(menuButton)
    expect(screen.getByRole('dialog', { name: 'Ops navigation' })).toBeDefined()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Ops navigation' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open navigation menu' }))
  })

  it('closes when a nav link inside the drawer is activated', () => {
    mockUsePathname.mockReturnValue('/ops/sources')
    render(<OpsShell><p>page content</p></OpsShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    const dialog = screen.getByRole('dialog', { name: 'Ops navigation' })
    const { getByRole: getByRoleInDialog } = within(dialog)

    fireEvent.click(getByRoleInDialog('link', { name: 'Application logs' }))

    expect(screen.queryByRole('dialog', { name: 'Ops navigation' })).toBeNull()
  })

  it('closes when the backdrop is clicked', () => {
    mockUsePathname.mockReturnValue('/ops/sources')
    const { container } = render(<OpsShell><p>page content</p></OpsShell>)

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    expect(screen.getByRole('dialog', { name: 'Ops navigation' })).toBeDefined()

    const backdrop = container.querySelector('[aria-hidden="true"]')
    fireEvent.click(backdrop!)

    expect(screen.queryByRole('dialog', { name: 'Ops navigation' })).toBeNull()
  })

  it('locks background scroll while open and restores it on close', () => {
    mockUsePathname.mockReturnValue('/ops/sources')
    render(<OpsShell><p>page content</p></OpsShell>)

    expect(document.body.style.overflow).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('')
  })

  it('renders the persistent sidebar nav landmark alongside the routed content', () => {
    mockUsePathname.mockReturnValue('/ops/sources')
    render(<OpsShell><p>page content</p></OpsShell>)

    expect(screen.getByRole('navigation', { name: 'Ops sections' })).toBeDefined()
    expect(screen.getByText('page content')).toBeDefined()
  })
})
