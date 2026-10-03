import { describe, expect, it } from 'vitest'
import { getMessagesForLocale } from './messages'

type Leaves = Map<string, string>

function flatten(value: unknown, prefix = '', out: Leaves = new Map()): Leaves {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      // "//name" keys are translator annotations (e.g. why a term stays in English).
      if (key.startsWith('//')) continue
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
  } else {
    out.set(prefix, String(value))
  }
  return out
}

/** Names of ICU arguments and rich-text tags used by a message. */
function placeholders(message: string): string[] {
  const names = new Set<string>()
  for (const match of message.matchAll(/\{\s*([A-Za-z0-9_]+)/g)) names.add(match[1] as string)
  for (const match of message.matchAll(/<\/?([A-Za-z0-9_]+)>/g)) names.add(`<${match[1]}>`)
  return [...names].sort()
}

const en = flatten(getMessagesForLocale('en'))
const es = flatten(getMessagesForLocale('es'))
const zz = flatten(getMessagesForLocale('zz'))

describe('message catalog parity', () => {
  it('has the same keys in English and Spanish', () => {
    const enKeys = [...en.keys()].sort()
    const esKeys = [...es.keys()].sort()
    expect(esKeys.filter((k) => !en.has(k)), 'keys only in es').toEqual([])
    expect(enKeys.filter((k) => !es.has(k)), 'keys missing from es').toEqual([])
  })

  it('has no empty messages', () => {
    for (const [locale, catalog] of [['en', en], ['es', es]] as const) {
      const empty = [...catalog].filter(([, v]) => v.trim() === '').map(([k]) => k)
      expect(empty, `empty ${locale} messages`).toEqual([])
    }
  })

  it('uses the same ICU arguments and rich-text tags in English and Spanish', () => {
    const mismatched = [...en]
      .filter(([key]) => es.has(key))
      .filter(([key, value]) => placeholders(value).join() !== placeholders(es.get(key) as string).join())
      .map(([key]) => key)
    expect(mismatched).toEqual([])
  })

  it('does not define pseudo-locale keys that English lacks', () => {
    expect([...zz.keys()].filter((k) => !en.has(k))).toEqual([])
  })
})
