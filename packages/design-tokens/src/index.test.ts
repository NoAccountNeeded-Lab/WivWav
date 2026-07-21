import { describe, expect, it } from 'vitest'
import { tokens } from './index.js'

const COLOR_ROLE_KEYS = [
  'primary',
  'onPrimary',
  'surface',
  'onSurface',
  'border',
  'danger',
  'onDanger',
  'success',
  'onSuccess',
  'warning',
  'onWarning',
  'neutral',
  'onNeutral',
] as const

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

describe('@wivwav/design-tokens', () => {
  it('defines every color role for both light and dark modes', () => {
    for (const key of COLOR_ROLE_KEYS) {
      expect(tokens.color.light[key]).toBeTruthy()
      expect(tokens.color.dark[key]).toBeTruthy()
    }
  })

  it('uses valid hex colors for every role in both modes', () => {
    for (const key of COLOR_ROLE_KEYS) {
      expect(isHexColor(tokens.color.light[key])).toBe(true)
      expect(isHexColor(tokens.color.dark[key])).toBe(true)
    }
  })

  it('does not reuse the same hex value across light and dark for a given role', () => {
    // A token accidentally copy-pasted across modes would silently defeat
    // the point of having a dark mode at all; catch that class of mistake.
    for (const key of COLOR_ROLE_KEYS) {
      expect(tokens.color.light[key].toLowerCase()).not.toBe(tokens.color.dark[key].toLowerCase())
    }
  })

  it('defines a monotonically increasing spacing scale', () => {
    const { xs, sm, md, lg, xl } = tokens.spacing
    expect(xs).toBeLessThan(sm)
    expect(sm).toBeLessThan(md)
    expect(md).toBeLessThan(lg)
    expect(lg).toBeLessThan(xl)
  })

  it('defines a heading size larger than the body size, with positive line heights', () => {
    expect(tokens.type.headingSize).toBeGreaterThan(tokens.type.bodySize)
    expect(tokens.type.bodyLineHeight).toBeGreaterThan(0)
    expect(tokens.type.headingLineHeight).toBeGreaterThan(0)
  })

  it('defines a medium motion duration longer than the short one', () => {
    expect(tokens.motion.durationMediumMs).toBeGreaterThan(tokens.motion.durationShortMs)
  })
})
