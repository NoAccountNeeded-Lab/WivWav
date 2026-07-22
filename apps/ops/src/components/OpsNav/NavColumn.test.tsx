// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NavColumn } from './NavColumn'

const { usePathnameMock, useRouterMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(() => ({ push: vi.fn() })),
}))

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NavColumn', () => {
  it('renders only the Advanced group heading — the primary list has no heading', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<NavColumn />)

    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Advanced' })).toBeDefined()
  })

  it('marks the active route with aria-current="page" and a visible active state', () => {
    usePathnameMock.mockReturnValue('/ops/sources')
    render(<NavColumn />)

    const activeLink = screen.getByRole('link', { name: /Source health/ })
    expect(activeLink.getAttribute('aria-current')).toBe('page')
    expect(activeLink.getAttribute('data-active')).toBe('true')

    const inactiveLink = screen.getByRole('link', { name: /Operations overview/ })
    expect(inactiveLink.getAttribute('aria-current')).toBeNull()
  })

  it('renders the Bull Board entry as a real anchor to the API origin, not a Next Link', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<NavColumn />)

    const bullBoardLink = screen.getByRole('link', { name: /Bull Board diagnostics/ })
    expect(bullBoardLink.tagName).toBe('A')
    expect(bullBoardLink.getAttribute('href')).toBe('/admin/board')
    expect(bullBoardLink.getAttribute('target')).toBe('_blank')
    expect(bullBoardLink.getAttribute('rel')).toContain('noopener')
    expect(bullBoardLink.textContent).toContain('(opens in new tab)')
  })
})
