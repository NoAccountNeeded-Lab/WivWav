import type { BarDatum } from '@/components/category-facets'

// Compact family list. Raw source colors are never rewritten: a family selects all of its raw members,
// and a raw color that matches no family stays its own item.
const FAMILY_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['black', ['black', 'onyx', 'ebony', 'jet']],
  ['white', ['white', 'pearl', 'ivory', 'snow']],
  ['silver', ['silver', 'platinum', 'aluminum']],
  ['gray', ['gray', 'grey', 'charcoal', 'graphite', 'gunmetal', 'slate']],
  ['blue', ['blue', 'navy', 'azure', 'cobalt']],
  ['red', ['red', 'burgundy', 'maroon', 'crimson', 'ruby', 'cherry']],
  ['green', ['green', 'olive', 'emerald', 'forest']],
  ['brown', ['brown', 'bronze', 'chocolate', 'mocha', 'copper']],
  ['beige', ['beige', 'tan', 'cream', 'champagne', 'sand']],
  ['gold', ['gold']],
  ['orange', ['orange']],
  ['yellow', ['yellow']],
  ['purple', ['purple', 'violet', 'plum']],
  ['pink', ['pink']],
  ['teal', ['teal', 'turquoise']],
]

const FAMILY_BY_WORD = new Map(FAMILY_KEYWORDS.flatMap(([family, words]) => words.map((word) => [word, family] as const)))

/** Family of a raw color: the first whole word that names a family wins ("Titanium Gray" is gray, not tan). */
export function colorFamily(raw: string): string | null {
  for (const word of raw.toLowerCase().split(/[^a-z]+/)) {
    const family = FAMILY_BY_WORD.get(word)
    if (family) return family
  }
  return null
}

export interface ColorFamilies {
  bars: BarDatum[]
  /** family (or unmatched raw value) -> raw source values it selects */
  members: Record<string, string[]>
}

/** Collapses raw color counts into families, adding selected raw values that have no count. */
export function groupColors(bars: BarDatum[], selectedRaw: string[]): ColorFamilies {
  const totals = new Map<string, number>()
  const members: Record<string, string[]> = {}
  const add = (raw: string, count: number) => {
    const key = colorFamily(raw) ?? raw
    totals.set(key, (totals.get(key) ?? 0) + count)
    const list = (members[key] ??= [])
    if (!list.includes(raw)) list.push(raw)
  }
  // Zero-count ghosts from the previous query are not members; selected values always are.
  for (const bar of bars) if (bar.count > 0 || selectedRaw.includes(bar.value)) add(bar.value, bar.count)
  for (const raw of selectedRaw) if (!bars.some((b) => b.value === raw)) add(raw, 0)
  return {
    bars: [...totals].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    members,
  }
}

/** Next selection after toggling a family or single value: all members in, or all members out. */
export function toggleMembers(current: string[], value: string, members?: string[]): string[] {
  const group = members ?? [value]
  const active = group.some((m) => current.includes(m))
  if (active) return current.filter((v) => !group.includes(v))
  return [...current, ...group]
}
