// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavColumn } from './NavColumn'

const STORAGE_KEY = 'ops-nav-collapsed'

const { usePathnameMock, useRouterMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(() => ({ push: vi.fn() })),
}))

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
}))

// jsdom's built-in Storage is unavailable for the opaque test origin here
// (mirrors ThemePicker.test.tsx's #762 workaround), so stub a minimal
// in-memory implementation for both global access patterns.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size },
  } as Storage
}

beforeEach(() => {
  const memoryStorage = makeMemoryStorage()
  vi.stubGlobal('localStorage', memoryStorage)
  Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
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

  it('starts expanded, with a toggle exposing "Collapse navigation" as its accessible name', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<NavColumn />)

    const toggle = screen.getByRole('button', { name: 'Collapse navigation' })
    expect(screen.getByRole('navigation').getAttribute('data-collapsed')).toBeNull()

    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeDefined()
    expect(screen.getByRole('navigation').getAttribute('data-collapsed')).toBe('true')
  })

  it('clicking the toggle a second time reopens the full labeled column', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<NavColumn />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand navigation' }))

    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeDefined()
    expect(screen.getByRole('navigation').getAttribute('data-collapsed')).toBeNull()
  })

  it('persists the toggled state to localStorage', () => {
    usePathnameMock.mockReturnValue('/ops')
    render(<NavColumn />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('reads localStorage on mount and renders collapsed markup immediately — no flash of the expanded state', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    usePathnameMock.mockReturnValue('/ops')
    render(<NavColumn />)

    // Correct on the very first render, before any click.
    expect(screen.getByRole('navigation').getAttribute('data-collapsed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Advanced' })).toBeNull()
  })

  it('every nav item keeps its role, accessible name, and keyboard focusability in both states', () => {
    usePathnameMock.mockReturnValue('/ops/sources')
    render(<NavColumn />)

    const expandedNames = ['Operations overview', 'Source health', 'Bull Board diagnostics']
    for (const name of expandedNames) {
      const link = screen.getByRole('link', { name: new RegExp(name) })
      expect(link.tabIndex).not.toBe(-1)
    }

    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))

    for (const name of expandedNames) {
      const link = screen.getByRole('link', { name: new RegExp(name) })
      expect(link.tabIndex).not.toBe(-1)
    }

    const activeLink = screen.getByRole('link', { name: /Source health/ })
    expect(activeLink.getAttribute('aria-current')).toBe('page')
  })
})
