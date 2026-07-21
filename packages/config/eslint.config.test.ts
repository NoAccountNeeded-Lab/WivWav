import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import sharedConfig from './eslint.config.js'

const linter = new Linter()

function jsxA11yRuleIds(code: string): (string | null)[] {
  const messages = linter.verify(code, sharedConfig, { filename: 'virtual.tsx' })
  return messages.filter((message) => message.ruleId?.startsWith('jsx-a11y/')).map((message) => message.ruleId)
}

function sqlRuleIds(code: string): (string | null)[] {
  const messages = linter.verify(code, sharedConfig, { filename: 'virtual.ts' })
  return messages.filter((message) => message.ruleId?.startsWith('wivwav/')).map((message) => message.ruleId)
}

// This suite is the machine-enforced version of acceptance criterion "A seeded
// jsx-a11y violation in apps/web fails lint in CI; current main passes."
// Rather than committing a permanently-broken component to apps/web, it lints
// an in-memory snippet against the exact shared config apps/web and apps/ops
// consume, so a regression (plugin removed, rule disabled, config drift)
// fails this test instead of silently reopening the gate.
describe('shared eslint config: jsx-a11y gate', () => {
  it('should flag a seeded violation (image missing alt text)', () => {
    const ruleIds = jsxA11yRuleIds(
      'export function Broken() { return <img src="/x.png" /> }',
    )

    expect(ruleIds).toContain('jsx-a11y/alt-text')
  })

  it('should pass accessible JSX with no jsx-a11y violations', () => {
    const ruleIds = jsxA11yRuleIds(
      'export function Ok() { return <img src="/x.png" alt="A descriptive label" /> }',
    )

    expect(ruleIds).toEqual([])
  })

  it('should allow explicit role="list" on <ul> (Safari/VoiceOver list-style workaround)', () => {
    const ruleIds = jsxA11yRuleIds(
      'export function List() { return <ul role="list"><li>Item</li></ul> }',
    )

    expect(ruleIds).toEqual([])
  })

  it('should not register jsx-a11y rules for non-JSX files', () => {
    const messages = linter.verify('export function Broken() { return null }', sharedConfig, {
      filename: 'virtual.ts',
    })

    expect(messages.filter((message) => message.ruleId?.startsWith('jsx-a11y/'))).toEqual([])
  })
})

describe('shared eslint config: fully qualified SQL gate', () => {
  it('should flag an unqualified ambiguous column in a joined raw SQL query', () => {
    const ruleIds = sqlRuleIds(`
      export async function broken(db: { $queryRaw: Function }) {
        return db.$queryRaw\`
          SELECT id
          FROM listings
          INNER JOIN sources ON sources.id = listings."sourceId"
          WHERE status = 'active'
        \`
      }
    `)

    expect(ruleIds).toContain('wivwav/require-qualified-sql-columns')
  })

  it('should allow fully qualified ambiguous columns in a joined raw SQL query', () => {
    const ruleIds = sqlRuleIds(`
      export async function ok(db: { $queryRaw: Function }) {
        return db.$queryRaw\`
          SELECT listings.id
          FROM listings
          INNER JOIN sources ON sources.id = listings."sourceId"
          WHERE listings.status = 'active'
        \`
      }
    `)

    expect(ruleIds).toEqual([])
  })

  it('should not flag single-relation raw SQL with no join', () => {
    const ruleIds = sqlRuleIds(`
      export async function ok(db: { $queryRaw: Function }) {
        return db.$queryRaw\`
          SELECT id, "updatedAt"
          FROM listings
          ORDER BY "updatedAt", id
        \`
      }
    `)

    expect(ruleIds).toEqual([])
  })
})

function restrictedImportRuleIds(code: string): (string | null)[] {
  const messages = linter.verify(code, sharedConfig, { filename: 'virtual.ts' })
  return messages.filter((message) => message.ruleId === 'no-restricted-imports').map((message) => message.ruleId)
}

// Machine-enforced version of #853's acceptance criterion: apps/web and
// apps/ops must not import the MUI/emotion vendor directly, only through
// @wivwav/ui-web. See the scoping note on this rule in eslint.config.js for
// why this is asserted against the shared config directly rather than
// against a real apps/web/apps/ops file.
describe('shared eslint config: component-vendor import restriction', () => {
  it('should flag a direct @mui/* import', () => {
    expect(restrictedImportRuleIds("import Button from '@mui/material/Button'")).toContain('no-restricted-imports')
  })

  it('should flag a direct @emotion/* import', () => {
    expect(restrictedImportRuleIds("import { css } from '@emotion/react'")).toContain('no-restricted-imports')
  })

  it('should allow importing from @wivwav/ui-web', () => {
    expect(restrictedImportRuleIds("import { Button } from '@wivwav/ui-web'")).toEqual([])
  })
})
