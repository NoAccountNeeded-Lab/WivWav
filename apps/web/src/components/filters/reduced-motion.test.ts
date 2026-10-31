import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')

/** Text of the first `@media (prefers-reduced-motion: reduce)` block (brace-balanced). */
function reducedMotionBlock(css: string): string {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1)
  }
  return ''
}

describe('reduced motion and touch targets', () => {
  // Each module that animates (transition/animation/transform easing) must switch it off.
  it.each([
    ['filters/FilterGroup.module.css', /animation:\s*none/, /transition:\s*none/],
    ['filters/BarsRenderer.module.css', /transition:\s*none/],
    ['filters/DonutRenderer.module.css', /transition:\s*none/],
    ['filters/SwatchesRenderer.module.css', /transition:\s*none/],
    ['filters/ChipsRenderer.module.css', /transition:\s*none/],
    ['StateHeatMap.module.css', /transition:\s*none/],
    ['ActiveFilters.module.css', /transition:\s*none/],
  ])('%s disables motion under prefers-reduced-motion', (file, ...patterns) => {
    const block = reducedMotionBlock(read(file))
    expect(block).not.toBe('')
    for (const pattern of patterns) expect(block).toMatch(pattern)
  })

  it('FilterGroup also removes the anticipatory nudge for reduced motion', () => {
    expect(reducedMotionBlock(read('filters/FilterGroup.module.css'))).toMatch(/translate:\s*none/)
  })

  it.each([
    'filters/FilterGroup.module.css',
    'filters/BarsRenderer.module.css',
    'filters/DonutRenderer.module.css',
    'filters/SwatchesRenderer.module.css',
    'filters/ChipsRenderer.module.css',
    'ActiveFilters.module.css',
  ])('%s keeps interactive rows at least 2.75rem (44px) tall', (file) => {
    expect(read(file)).toMatch(/min-height:\s*2\.75rem/)
  })
})
