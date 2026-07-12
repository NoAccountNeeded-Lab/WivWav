// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUsePathname = vi.fn<() => string>()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

const { OpsHeader } = await import('./OpsHeader')

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
})

describe('OpsHeader', () => {
  it('derives the section label from the active nav item for the current route', () => {
    mockUsePathname.mockReturnValue('/ops/queues')
    render(<OpsHeader />)

    expect(screen.getByText('Queue diagnostics')).toBeDefined()
  })

  it('shows no section label on the overview root, which has no nav entry', () => {
    mockUsePathname.mockReturnValue('/ops')
    render(<OpsHeader />)

    expect(screen.queryByText('/')).toBeNull()
  })

  it('lets an explicit section prop override the derived title', () => {
    mockUsePathname.mockReturnValue('/ops/queues')
    render(<OpsHeader section="System Status" />)

    expect(screen.getByText('System Status')).toBeDefined()
    expect(screen.queryByText('Queue diagnostics')).toBeNull()
  })

  it('omits the menu button when no onMenuClick handler is supplied', () => {
    mockUsePathname.mockReturnValue('/ops')
    render(<OpsHeader />)

    expect(screen.queryByRole('button', { name: /navigation menu/ })).toBeNull()
  })

  it('renders an accessible, state-reflecting menu button when onMenuClick is supplied', () => {
    mockUsePathname.mockReturnValue('/ops')
    render(<OpsHeader onMenuClick={() => {}} menuOpen={false} />)

    const button = screen.getByRole('button', { name: 'Open navigation menu' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('reflects an open drawer in the menu button label and aria-expanded', () => {
    mockUsePathname.mockReturnValue('/ops')
    render(<OpsHeader onMenuClick={() => {}} menuOpen={true} />)

    const button = screen.getByRole('button', { name: 'Close navigation menu' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })
})
