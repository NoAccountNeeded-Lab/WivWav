import { apiBaseUrl, composeDown, runDockerCompose, webBaseUrl } from './compose.js'
import { cleanupReusedStackFixture } from './fixture-cleanup.js'
import {
  poll,
  seedSmokeFixture,
  syncSearchIndex,
  waitForFixtureInSearch,
  waitForSyncJobToComplete,
} from './fixture.js'

export default async function globalSetup(): Promise<void> {
  const skipCompose = process.env['WIVWAV_E2E_SKIP_COMPOSE'] === '1'
  const shouldBuild = process.env['WIVWAV_E2E_COMPOSE_BUILD'] !== '0'

  try {
    if (!skipCompose) {
      composeDown()
      runDockerCompose([
        'up',
        shouldBuild ? '--build' : '--no-build',
        '--detach',
        '--wait',
        '--wait-timeout',
        '360',
        'postgres',
        'valkey',
        'meilisearch',
        'api',
        'web',
      ])
    }

    await poll(async () => {
      const response = await fetch(`${apiBaseUrl()}/health`).catch(() => null)
      return response?.ok ?? false
    }, 'API health endpoint')

    await poll(async () => {
      const response = await fetch(webBaseUrl()).catch(() => null)
      return response?.ok ?? false
    }, 'web home page')

    await seedSmokeFixture()
    const syncJobId = await syncSearchIndex()
    // Wait on the reindex job's own status first (waiting/active/failed/
    // completed) rather than blind-polling the search API against a fixed
    // wall-clock timeout — see #740. Once the job is confirmed complete,
    // waitForFixtureInSearch only has to absorb Meilisearch's own indexing
    // latency, not CI queue-worker cold-start/contention as well.
    await waitForSyncJobToComplete(syncJobId)
    await waitForFixtureInSearch()
  } catch (error) {
    if (process.env['WIVWAV_E2E_KEEP_STACK'] !== '1') {
      if (skipCompose) {
        // Global teardown does not run when setup throws, and a reused stack
        // has no volumes to drop, so remove any fixture seeded before the failure.
        await cleanupReusedStackFixture().catch((cleanupError: unknown) => {
          console.error('E2E fixture cleanup after setup failure failed:', cleanupError)
        })
      } else {
        composeDown()
      }
    }
    throw error
  }
}
