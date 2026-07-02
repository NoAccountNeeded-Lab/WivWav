import { describe, expect, it } from 'vitest'
import LocaleHomePage from './page'
import DiscoverRoute from './discover/page'

describe('localized home page', () => {
  it('should render the same Discover route at locale roots', () => {
    expect(LocaleHomePage).toBe(DiscoverRoute)
  })
})
