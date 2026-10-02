import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveRun } from './output.js'
import type { AgentRun } from './types.js'

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    task: 'Add a /health endpoint!',
    provider: 'ollama',
    status: 'success',
    revision: 1,
    maxRevisions: 3,
    startedAt: '2026-01-02T03:04:05.000Z',
    completedAt: '2026-01-02T03:10:11.000Z',
    steps: [
      { role: 'planner', status: 'completed', requestsRevision: false, artifact: { role: 'planner', content: 'Plan body', revision: 0 } },
      { role: 'reviewer', status: 'completed', requestsRevision: true, artifact: { role: 'reviewer', content: 'Review body', revision: 2 } },
      { role: 'coder', status: 'failed', requestsRevision: false, error: 'no artifact' },
    ],
    ...overrides,
  }
}

describe('saveRun', () => {
  let cwd: string
  let dir: string

  beforeEach(async () => {
    cwd = process.cwd()
    dir = await mkdtemp(join(tmpdir(), 'agents-output-'))
    process.chdir(dir)
  })

  afterEach(async () => {
    process.chdir(cwd)
    await rm(dir, { recursive: true, force: true })
  })

  it('writes a markdown report named from the timestamp and task slug', async () => {
    const rel = await saveRun(makeRun())
    expect(rel).toBe('.agents/2026-01-02-03-10-11-add-a-health-endpoint.md')

    const content = await readFile(join(dir, rel), 'utf8')
    expect(content).toContain('# Add a /health endpoint!')
    expect(content).toContain('Status: success · Revisions: 1 · Provider: ollama · Generated: 2026-01-02T03:10:11.000Z')
    expect(content).toContain('## Planner\n\nPlan body')
    expect(content).toContain('## Reviewer (revision 2)\n\nReview body\n\n> Revision requested')
  })

  it('omits steps without artifacts and falls back to startedAt', async () => {
    const { completedAt: _completedAt, ...inProgress } = makeRun()
    const rel = await saveRun(inProgress)
    expect(rel).toContain('2026-01-02-03-04-05-')
    const content = await readFile(join(dir, rel), 'utf8')
    expect(content).not.toContain('Coder')
    expect(content).toContain('Generated: 2026-01-02T03:04:05.000Z')
  })
})
