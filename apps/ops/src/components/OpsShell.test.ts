import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// #735 (E8): back/forward scroll restoration (an epic acceptance criterion)
// works today because Next.js's native, window-level scroll restoration
// applies — which only holds as long as `.mainSlot` scrolls with the window
// rather than being its own `overflow`/scroll container. If a future change
// gives `.mainSlot` (or `.shell`) an independent scrollbar, the browser stops
// restoring the real scrolling element's position and every route silently
// resets to the top on back/forward. This is a tripwire against that
// regression, not a behavioral test — jsdom can't exercise real scroll
// restoration end-to-end.
describe('OpsShell scroll container', () => {
  it('does not give .mainSlot or .shell an independent overflow/scroll container', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'OpsShell.module.css'), 'utf8')
    const mainSlotBlock = css.match(/\.mainSlot\s*\{[^}]*\}/)?.[0] ?? ''
    const shellBlock = css.match(/(?<!\.\w)\.shell\s*\{[^}]*\}/)?.[0] ?? ''

    expect(mainSlotBlock, 'mainSlot must not declare its own overflow').not.toMatch(/overflow/)
    expect(shellBlock, 'shell must not declare its own overflow').not.toMatch(/overflow/)
  })
})
