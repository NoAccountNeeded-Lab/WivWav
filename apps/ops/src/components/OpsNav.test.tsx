// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockUsePathname = vi.fn<() => string>()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

const { OpsNav } = await import('./OpsNav')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OpsNav', () => {
  it('marks the item matching the current pathname as the active page', () => {
    mockUsePathname.mockReturnValue('/ops/sources')
    render(<OpsNav variant="sidebar" />)

    expect(screen.getByRole('link', { name: 'Source health' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Application logs' }).getAttribute('aria-current')).toBeNull()
  })

  it('marks the matching item active for a nested dynamic child route', () => {
    mockUsePathname.mockReturnValue('/ops/sources/abc123')
    render(<OpsNav variant="sidebar" />)

    expect(screen.getByRole('link', { name: 'Source health' }).getAttribute('aria-current')).toBe('page')
  })

  it('renders API-origin destinations as plain external links, not Next.js Links', () => {
    mockUsePathname.mockReturnValue('/ops/queues')
    render(<OpsNav variant="sidebar" />)

    const bullBoard = screen.getByRole('link', { name: 'Bull Board diagnostics' })
    expect(bullBoard.getAttribute('href')).toBe('/admin/board')
    expect(bullBoard.getAttribute('target')).toBe('_blank')
    expect(bullBoard.getAttribute('rel')).toBe('noopener noreferrer')
    expect(bullBoard.getAttribute('aria-current')).toBeNull()
  })

  it('calls onNavigate when an in-app link is activated, so the mobile drawer can close', () => {
    mockUsePathname.mockReturnValue('/ops/sources')
    const onNavigate = vi.fn()
    render(<OpsNav variant="drawer" onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('link', { name: 'Application logs' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('renders every nav group as a labeled section', () => {
    mockUsePathname.mockReturnValue('/ops')
    render(<OpsNav variant="sidebar" />)

    for (const title of ['Overview', 'Inventory', 'Sources', 'Workflows', 'Failures', 'Schedules', 'Logs', 'Advanced']) {
      expect(screen.getByText(title)).toBeDefined()
    }
  })
})
