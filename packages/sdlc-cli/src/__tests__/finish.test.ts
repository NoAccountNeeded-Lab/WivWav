import { describe, expect, it } from 'vitest'
import { deriveScope, titleToDescription } from '../commands/finish.js'

describe('deriveScope', () => {
  it('returns api for api route files', () => {
    expect(deriveScope(['apps/api/src/routes/listings.ts'])).toBe('api')
  })

  it('returns web for web app files', () => {
    expect(deriveScope(['apps/web/src/app/page.tsx'])).toBe('web')
  })

  it('picks the most frequently changed scope', () => {
    const files = [
      'apps/api/src/routes/listings.ts',
      'apps/api/src/plugins/auth.ts',
      'apps/web/src/app/page.tsx',
    ]
    expect(deriveScope(files)).toBe('api')
  })

  it('returns sdlc for .claude files', () => {
    expect(deriveScope(['.claude/skills/wivwav-finish.md'])).toBe('sdlc')
  })

  it('returns misc when no prefix matches', () => {
    expect(deriveScope(['random/unknown/path.ts'])).toBe('misc')
  })

  it('returns sdlc for an empty list', () => {
    expect(deriveScope([])).toBe('sdlc')
  })
})

describe('titleToDescription', () => {
  it('strips conventional-commit prefix and lowercases first char', () => {
    expect(titleToDescription('feat(api): Add listing search endpoint')).toBe(
      'add listing search endpoint',
    )
  })

  it('strips plain prefix without scope', () => {
    expect(titleToDescription('fix: Correct pagination offset')).toBe(
      'correct pagination offset',
    )
  })

  it('passes through plain titles unchanged (except case)', () => {
    expect(titleToDescription('Add wheelchair listing page')).toBe(
      'add wheelchair listing page',
    )
  })
})
