import { apiBaseUrl, composeDown, runDockerCompose, webBaseUrl } from './compose.js'
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
    if (!skipCompose && process.env['WIVWAV_E2E_KEEP_STACK'] !== '1') {
      composeDown()
    }
    throw error
  }
}
