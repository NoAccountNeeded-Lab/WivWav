import { unstable_cache } from 'next/cache'
import { fetchHomeSnapshot } from './home-snapshot'
import type { HomeSnapshot, HomeSnapshotResult } from './home-snapshot'

// apiFetch adds a random x-request-id per call; Next puts request headers in the fetch
// cache key, so a revalidate option on it never hits. Cache the derived snapshot with
// unstable_cache and call the API with only the stable server credential.
function plainFetch(url: string): Promise<Response> {
  const secret = process.env['INTERNAL_API_SECRET']
  return fetch(url, secret ? { headers: { authorization: `Bearer ${secret}` } } : {})
}

export const HOME_SNAPSHOT_REVALIDATE_SECONDS = 300

export function createHomeSnapshotLoader(
  cache: typeof unstable_cache,
  fetcher: (url: string) => Promise<Response> = plainFetch,
) {
  const load = cache(
    async (base: string): Promise<HomeSnapshot> => {
      const result = await fetchHomeSnapshot(base, fetcher)
      // Throwing keeps an unavailable result out of the cache, so the next request retries.
      if (result.status !== 'ok') throw new Error('home snapshot unavailable')
      return result.snapshot
    },
    ['home-snapshot-v1'],
    { revalidate: HOME_SNAPSHOT_REVALIDATE_SECONDS },
  )
  return async (base: string): Promise<HomeSnapshotResult> => {
    try {
      return { status: 'ok', snapshot: await load(base) }
    } catch {
      return { status: 'unavailable' }
    }
  }
}

export const getHomeSnapshot = createHomeSnapshotLoader(unstable_cache)
