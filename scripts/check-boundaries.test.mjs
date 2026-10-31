// Unit tests for scripts/check-boundaries.mjs (#1225). Pure: no git or file access.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { scanFiles, scanCompose } from './check-boundaries.mjs'

const scan = (file, text) => scanFiles([{ file, text }])

describe('scanFiles', () => {
  it('flags retired /admin and /api/bff literals with file:line', () => {
    assert.deepEqual(scan('apps/ops/src/x.ts', 'ok\nfetch(`${base}/admin/runs`)'), [
      'apps/ops/src/x.ts:2: retired /admin or /api/bff URL literal',
    ])
    assert.equal(scan('apps/ops/src/x.ts', "fetch('/api/bff/queues')").length, 1)
    assert.equal(scan('docs/ops/x.md', 'GET /admin').length, 1)
  })
  it('does not flag the new namespaces, other hosts or lookalikes', () => {
    assert.deepEqual(scan('apps/ops/src/x.ts', "'/internal/ops/runs' '/ops/api/x' 'https://blvd.com/admin/' '/administrator' 'my/admin/x'"), [])
  })
  it('allows tests, plans, fixtures and exact allowlisted files only', () => {
    assert.deepEqual(scan('apps/api/src/app.test.ts', "'/admin/runs'"), [])
    assert.deepEqual(scan('docs/plans/p.md', '/admin/runs'), [])
    assert.deepEqual(scan('packages/s/src/fixtures/gold/a.html', '/admin/x'), [])
    assert.deepEqual(scan('docs/design/eliminate-admin-urls-private-ops-control-plane.md', '/admin/x'), [])
    assert.equal(scan('apps/api/src/new-allow.ts', '/admin/x').length, 1)
  })
  it('flags OPS_API_SECRET anywhere in apps/web, including tests', () => {
    assert.equal(scan('apps/web/src/lib/a.ts', 'process.env.OPS_API_SECRET').length, 1)
    assert.equal(scan('apps/web/src/lib/a.test.ts', 'OPS_API_SECRET').length, 1)
    assert.deepEqual(scan('apps/ops/src/lib/a.ts', 'process.env.OPS_API_SECRET'), [])
  })
})

const GOOD = `services:
  api:
    image: x
    environment:
      A: b
  ops:
    image: y
    profiles: [ops]
    environment:
      OPS_API_SECRET: z
  web:
    image: w
    environment:
      INTERNAL_API_SECRET: i
`

describe('scanCompose', () => {
  it('accepts a private api, profiled ops and a web without the ops secret', () => {
    assert.deepEqual(scanCompose(GOOD), [])
  })
  it('flags a host-published api port', () => {
    const bad = GOOD.replace('    image: x\n', '    image: x\n    ports:\n      - "3001:3001"\n')
    assert.match(scanCompose(bad).join('\n'), /api must not host-publish/)
  })
  it('flags ops that starts by default', () => {
    assert.match(scanCompose(GOOD.replace('    profiles: [ops]\n', '')).join('\n'), /stopped-by-default/)
  })
  it('flags OPS_API_SECRET injected into web', () => {
    const bad = GOOD.replace('      INTERNAL_API_SECRET: i', '      OPS_API_SECRET: leaked')
    assert.match(scanCompose(bad).join('\n'), /web must not receive OPS_API_SECRET/)
  })
  it('flags a missing api or ops service', () => {
    assert.equal(scanCompose('services:\n  web:\n    image: w\n').length, 2)
  })
})
