import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { config } = vi.hoisted(() => ({ config: vi.fn() }))

vi.mock('dotenv', () => ({ config }))

const jobsDirectory = fileURLToPath(new URL('../jobs', import.meta.url))
const documentedJobFiles = readdirSync(jobsDirectory)
  .filter((fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.test.ts'))
  .filter((fileName) =>
    readFileSync(`${jobsDirectory}/${fileName}`, 'utf8').includes(
      `pnpm tsx apps/api/src/jobs/${fileName}`,
    ),
  )

describe('scraper environment bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    config.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads apps/api/.env without resolving from process.cwd()', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/unrelated/working-directory')

    await import('./load-env.js')

    expect(config).toHaveBeenCalledWith({
      path: fileURLToPath(new URL('../../.env', import.meta.url)),
      quiet: true,
    })
  })

  it.each(documentedJobFiles)('%s imports the shared environment bootstrap', (fileName) => {
    const source = readFileSync(`${jobsDirectory}/${fileName}`, 'utf8')

    expect(source).toContain("import '../lib/load-env.js'")
  })
})
