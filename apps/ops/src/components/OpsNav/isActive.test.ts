import { describe, expect, it } from 'vitest'
import { isNavItemActive } from './isActive'

describe('isNavItemActive', () => {
  it('marks /ops active only for an exact match', () => {
    expect(isNavItemActive('/ops', '/ops')).toBe(true)
    expect(isNavItemActive('/ops/sources', '/ops')).toBe(false)
  })

  it('marks a route active for an exact href match', () => {
    expect(isNavItemActive('/ops/sources', '/ops/sources')).toBe(true)
  })

  it('marks a route active for a nested child path', () => {
    expect(isNavItemActive('/ops/sources/123', '/ops/sources')).toBe(true)
  })

  it('does not match unrelated sibling routes with a shared prefix', () => {
    expect(isNavItemActive('/ops/sources-extra', '/ops/sources')).toBe(false)
  })

  it('does not match a different route entirely', () => {
    expect(isNavItemActive('/status', '/ops/sources')).toBe(false)
  })
})
