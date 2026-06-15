import { describe, expect, it } from 'vitest'
import { slugify, deriveBranchPrefix, buildBranchName } from '../commands/start.js'

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Add Listing Search')).toBe('add-listing-search')
  })

  it('strips special characters', () => {
    expect(slugify('fix: price calc! (v2)')).toBe('fix-price-calc-v2')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar')
  })

  it('truncates at 50 characters', () => {
    const long = 'a'.repeat(60)
    expect(slugify(long).length).toBeLessThanOrEqual(50)
  })

  it('does not end with a hyphen after truncation', () => {
    const title = 'feat add some really long description that goes on and on and on'
    const slug = slugify(title)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('deriveBranchPrefix', () => {
  it('returns feat for feature titles', () => {
    expect(deriveBranchPrefix('feat(api): add search')).toBe('feat')
    expect(deriveBranchPrefix('Add new listing page')).toBe('feat')
  })

  it('returns fix for bug/fix titles', () => {
    expect(deriveBranchPrefix('fix(web): correct price display')).toBe('fix')
    expect(deriveBranchPrefix('bug: geocode fails on retry')).toBe('fix')
  })

  it('returns docs for doc titles', () => {
    expect(deriveBranchPrefix('docs(agents): update workflow')).toBe('docs')
  })

  it('returns chore for chore/refactor titles', () => {
    expect(deriveBranchPrefix('chore(ci): upgrade turbo')).toBe('chore')
    expect(deriveBranchPrefix('refactor(api): extract route helpers')).toBe('chore')
  })
})

describe('buildBranchName', () => {
  it('produces the correct branch name format', () => {
    const name = buildBranchName(304, 'feat(agents): add repo-native SDLC CLI for issue start, review, and finish')
    expect(name).toMatch(/^feat\/issue-304-/)
    expect(name).not.toContain('feat(agents)')
  })

  it('uses fix prefix for fix issues', () => {
    const name = buildBranchName(99, 'fix(api): correct pagination offset')
    expect(name).toMatch(/^fix\/issue-99-/)
  })

  it('handles plain titles without conventional-commit prefix', () => {
    const name = buildBranchName(10, 'Add wheelchair listing page')
    expect(name).toMatch(/^feat\/issue-10-add-wheelchair/)
  })
})
