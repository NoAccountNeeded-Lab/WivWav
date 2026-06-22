import { describe, it, expect } from 'vitest'

// LanguageSwitcher is a 'use client' component with React hook dependencies.
// The handleChange logic is duplicated here as computeLocaleSwitch to test
// what arguments are actually passed to router.replace.
// If the implementation changes, update both.

// Mirrors the handleChange body in LanguageSwitcher.tsx.
function computeLocaleSwitch(
  rawPathname: string,  // from next/navigation usePathname — always includes locale prefix
  currentLocale: string,
  nextLocale: string,
): { href: string; locale: string } {
  const localePrefix = '/' + currentLocale
  const pathWithoutLocale = rawPathname.startsWith(localePrefix)
    ? rawPathname.slice(localePrefix.length) || '/'
    : rawPathname
  return { href: pathWithoutLocale, locale: nextLocale }
}

// Mirrors the locale-gate logic in routing.ts.
function getLocalesForEnv(nodeEnv: string): string[] {
  const allLocales = ['en', 'es', 'zz']
  return allLocales.filter((l) => l !== 'zz' || nodeEnv === 'development')
}

describe('computeLocaleSwitch', () => {
  describe('switching from the locale root', () => {
    it('returns / when on the en root and switching to es', () => {
      expect(computeLocaleSwitch('/en', 'en', 'es')).toEqual({ href: '/', locale: 'es' })
    })

    it('returns / when on the es root and switching to en', () => {
      expect(computeLocaleSwitch('/es', 'es', 'en')).toEqual({ href: '/', locale: 'en' })
    })

    // This is the /es/es doubling bug: if rawPathname were passed directly to
    // router.replace without stripping, calling router.replace('/es', { locale: 'es' })
    // would navigate to /es/es.
    it('returns / when on the es root and re-selecting es — prevents /es/es', () => {
      expect(computeLocaleSwitch('/es', 'es', 'es')).toEqual({ href: '/', locale: 'es' })
    })

    it('returns / for the zz test locale root', () => {
      expect(computeLocaleSwitch('/zz', 'zz', 'en')).toEqual({ href: '/', locale: 'en' })
    })
  })

  describe('switching from a sub-path', () => {
    it('strips the locale prefix and keeps the rest of the path', () => {
      expect(computeLocaleSwitch('/en/discover', 'en', 'es')).toEqual({ href: '/discover', locale: 'es' })
    })

    it('works on a deep path', () => {
      expect(computeLocaleSwitch('/en/listings/abc-123', 'en', 'es')).toEqual({
        href: '/listings/abc-123',
        locale: 'es',
      })
    })

    it('strips /es prefix when switching to en', () => {
      expect(computeLocaleSwitch('/es/filters', 'es', 'en')).toEqual({ href: '/filters', locale: 'en' })
    })

    it('strips /es prefix when switching to zz', () => {
      expect(computeLocaleSwitch('/es/discover', 'es', 'zz')).toEqual({ href: '/discover', locale: 'zz' })
    })
  })

  describe('paths without a locale prefix (defensive)', () => {
    it('returns the path unchanged when no locale prefix is present', () => {
      expect(computeLocaleSwitch('/discover', 'en', 'es')).toEqual({ href: '/discover', locale: 'es' })
    })

    it('does not strip a different locale prefix', () => {
      // Pathname has /es but currentLocale is en — should not strip.
      expect(computeLocaleSwitch('/es/discover', 'en', 'es')).toEqual({ href: '/es/discover', locale: 'es' })
    })
  })
})

describe('locale gate', () => {
  it('includes zz in development', () => {
    expect(getLocalesForEnv('development')).toContain('zz')
  })

  it('excludes zz in production', () => {
    expect(getLocalesForEnv('production')).not.toContain('zz')
  })

  it('excludes zz in test (vitest runs as NODE_ENV=test)', () => {
    expect(getLocalesForEnv('test')).not.toContain('zz')
  })

  it('always includes en and es regardless of environment', () => {
    for (const env of ['development', 'test', 'production']) {
      const locales = getLocalesForEnv(env)
      expect(locales).toContain('en')
      expect(locales).toContain('es')
    }
  })
})
