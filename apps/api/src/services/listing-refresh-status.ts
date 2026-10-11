import type { JobRecord, JobStats, QueueAdapter } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import type {
  ListingPublicationCountRow,
  ListingRepository,
  ScraperRunRepository,
  SourceRepository,
  SourceRow,
} from '../repositories/index.js'
import { getQueueOrThrow, latestByCreatedAt } from './admin-queue-helpers.js'

const LISTING_REFRESH_QUEUES = [
  QUEUES.SOURCE_SCRAPE,
  QUEUES.DETAIL_CRAWL,
  QUEUES.DETAIL_EXTRACT,
  QUEUES.GEOCODE,
] as const

type RefreshQueueName = (typeof LISTING_REFRESH_QUEUES)[number]

interface ListingRefreshQueueState {
  name: RefreshQueueName
  paused: boolean
  stats: JobStats
  lastJobAt: Date | null
  lastFinishedAt: Date | null
  lastStatus: JobRecord['status'] | null
  recentFailureCount: number
  recentFailureReason: string | null
}

export interface ListingRefreshStatusDeps {
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  listings: ListingRepository
  queues: Map<string, QueueAdapter>
}

/**
 * Aggregates source, listing, scrape-run and queue readiness for the guided
 * refresh workflow. Throws when any dependency is unavailable; the route maps
 * that to 503.
 */
export async function buildListingRefreshStatus({ sources, scraperRuns, listings, queues }: ListingRefreshStatusDeps) {
  const [
    sourceList,
    recentRuns,
    observedActiveListings,
    eligibleListings,
    mapReadyListings,
    missingLocationListings,
    publicationCounts,
    queueStates,
  ] = await Promise.all([
    sources.findAll(),
    scraperRuns.findRecent(20),
    listings.countObservedActive(),
    listings.countActive(),
    listings.countActiveWithCoordinates(),
    listings.countActiveMissingCoordinates(),
    listings.getPublicationCountsBySource(),
    Promise.all(
      LISTING_REFRESH_QUEUES.map(async (name): Promise<ListingRefreshQueueState> => {
        const q = getQueueOrThrow(queues, name)
        const [stats, paused, jobs] = await Promise.all([
          q.getStats(),
          q.isPaused(),
          q.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed']),
        ])
        const latestJob = latestByCreatedAt(jobs)
        const failedJobs = jobs.filter(job => job.status === 'failed')
        const latestFailure = latestByCreatedAt(failedJobs)
        return {
          name,
          paused,
          stats,
          lastJobAt: latestJob?.createdAt ?? null,
          lastFinishedAt: latestJob?.finishedAt ?? null,
          lastStatus: latestJob?.status ?? null,
          recentFailureCount: failedJobs.length,
          recentFailureReason: latestFailure?.failedReason ?? null,
        }
      }),
    ),
  ])
  const sourceIds = [...new Set(recentRuns.map(run => run.sourceId))]
  const sourceRows = await sources.findManyByIds(sourceIds)
  const nameById = new Map(sourceRows.map(source => [source.id, source.name]))
  const latestScrapeRun = recentRuns[0] ?? null
  const countedSources = withPublicationCounts(sourceList, publicationCounts)

  return {
    generatedAt: new Date(),
    sources: {
      total: sourceList.length,
      active: sourceList.filter(source => source.status === 'active').length,
      needsAttention: sourceList.filter(source => source.status === 'error' || source.status === 'needs_remapping').length,
      totalListings: sourceList.reduce((sum, source) => sum + source.listingCount, 0),
      observedActiveListings: countedSources.reduce((sum, source) => sum + source.observedActiveCount, 0),
      eligibleListings: countedSources.reduce((sum, source) => sum + source.eligibleActiveCount, 0),
      lastScrapedAt: latestDate(sourceList.map(source => source.lastScrapedAt)),
    },
    listings: {
      active: observedActiveListings,
      observedActive: observedActiveListings,
      eligible: eligibleListings,
      mapReady: mapReadyListings,
      missingLocations: missingLocationListings,
    },
    latestScrapeRun: latestScrapeRun
      ? {
          ...latestScrapeRun,
          sourceName: nameById.get(latestScrapeRun.sourceId) ?? null,
        }
      : null,
    queues: queueStates,
  }
}


export function withPublicationCounts(
  sources: SourceRow[],
  counts: ListingPublicationCountRow[],
): Array<SourceRow & { observedActiveCount: number; eligibleActiveCount: number; possiblyGoneCount: number }> {
  const countBySource = new Map(counts.map(count => [count.sourceId, count]))
  return sources.map(source => ({
    ...source,
    observedActiveCount: countBySource.get(source.id)?.observedActive ?? 0,
    eligibleActiveCount: countBySource.get(source.id)?.eligibleActive ?? 0,
    possiblyGoneCount: countBySource.get(source.id)?.possiblyGoneCount ?? 0,
  }))
}

function latestDate(values: Array<Date | null>): Date | null {
  const dates = values.filter((value): value is Date => value !== null)
  return dates.length > 0
    ? new Date(Math.max(...dates.map(date => date.getTime())))
    : null
}
