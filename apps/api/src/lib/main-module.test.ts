import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it, expect } from 'vitest'
import { isMainModule } from './main-module.js'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'main-module-')))
const spaced = join(root, 'my checkout')
mkdirSync(spaced)
const script = join(spaced, 'script.ts')
writeFileSync(script, '')
const link = join(root, 'link.ts')
symlinkSync(script, link)

describe('isMainModule', () => {
  it('matches a path containing a space (percent-encoded in import.meta.url)', () => {
    const url = pathToFileURL(script).href
    expect(url).toContain('%20')
    expect(isMainModule(url, script)).toBe(true)
  })

  it('matches when started through a symlink', () => {
    expect(isMainModule(pathToFileURL(script).href, link)).toBe(true)
  })

  it('matches an extensionless argv entry (tsx path/to/job)', () => {
    expect(isMainModule(pathToFileURL(script).href, script.replace(/\.ts$/, ''))).toBe(true)
  })

  it('does not match a different script, a missing path or no argv', () => {
    const other = join(root, 'other.ts')
    writeFileSync(other, '')
    expect(isMainModule(pathToFileURL(script).href, other)).toBe(false)
    expect(isMainModule(pathToFileURL(script).href, join(root, 'missing.ts'))).toBe(false)
    expect(isMainModule(pathToFileURL(script).href, undefined)).toBe(false)
  })
})
