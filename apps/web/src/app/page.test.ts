import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }))

vi.mock('next/navigation', () => ({ redirect }))

import RootPage from './page'

describe('root page', () => {
  beforeEach(() => {
    redirect.mockClear()
  })

  it('should resolve the root URL to the default localized home page', () => {
    RootPage()

    expect(redirect).toHaveBeenCalledWith('/en')
  })
})
