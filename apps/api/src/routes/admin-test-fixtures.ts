import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { vi } from 'vitest'
import type { MockQueueFactory } from '@wivwav/queue'
import type { ConfigService } from '../services/config-service.js'
import type { JobRunReaper } from '../lib/job-run-reaper.js'
import { adminRoutes } from './admin.js'

export function buildDefaultListingRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn(async () => null),
    findByIdForSafety: vi.fn(async () => null),
    findVehicleModelWithSafetyData: vi.fn(async () => null),
    findManyActive: vi.fn(async () => []),
    countObservedActive: vi.fn(async () => 0),
    countActive: vi.fn(async () => 0),
    countActiveWithCoordinates: vi.fn(async () => 0),
    countActiveMissingCoordinates: vi.fn(async () => 0),
    getPublicationCountsBySource: vi.fn(async () => []),
    findPriceHistory: vi.fn(async () => []),
    findQuarantined: vi.fn(async () => []),
    countQuarantined: vi.fn(async () => 0),
    reprocessQuarantined: vi.fn(async () => true),
    findFieldConflicts: vi.fn(async () => []),
    countFieldConflicts: vi.fn(async () => 0),
    findListingReportTriage: vi.fn(async () => []),
    countListingReportTriage: vi.fn(async () => 0),
    findSemanticAnalysesForImage: vi.fn(async () => []),
    getSourcePipelineStages: vi.fn(async () => []),
    ...overrides,
  }
}

export function buildDefaultSourceRepo(overrides: Record<string, unknown> = {}) {
  return {
    count: vi.fn(async () => 0),
    countActive: vi.fn(async () => 0),
    findAll: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    findManyByIds: vi.fn(async () => []),
    findScheduledSources: vi.fn(async () => []),
    findNeedingRemapping: vi.fn(async () => []),
    disable: vi.fn(async () => true),
    enable: vi.fn(async () => true),
    updateCronExpression: vi.fn(async () => true),
    ...overrides,
  }
}

export function buildDefaultScraperRunRepo(overrides: Record<string, unknown> = {}) {
  return {
    findRecent: vi.fn(async () => []),
    findLastSuccessful: vi.fn(async () => null),
    ...overrides,
  }
}

export function buildDefaultJobRunRepo(overrides: Record<string, unknown> = {}) {
  return {
    findRunTreeForSource: vi.fn(async () => []),
    ...overrides,
  }
}

export function buildTestApp(
  sourceRepoOverrides: Record<string, unknown> = {},
  scraperRunRepoOverrides: Record<string, unknown> = {},
  factory: MockQueueFactory,
  listingRepoOverrides: Record<string, unknown> = {},
  jobRunRepoOverrides: Record<string, unknown> = {},
  operatorConfig?: ConfigService,
  jobRunReaper?: JobRunReaper,
) {
  const app = Fastify()
  void app.register(sensible)
  const listings = buildDefaultListingRepo(listingRepoOverrides)
  const sources = buildDefaultSourceRepo(sourceRepoOverrides)
  const scraperRuns = buildDefaultScraperRunRepo(scraperRunRepoOverrides)
  const jobRuns = buildDefaultJobRunRepo(jobRunRepoOverrides)
  const db = {
    configEntry: {
      create: vi.fn(async ({ data }) => ({ id: 'cfg-1', ...data })),
      findMany: vi.fn(async () => []),
    },
  }
  void app.register(adminRoutes, {
    db: db as never,
    listings: listings as never,
    sources: sources as never,
    scraperRuns: scraperRuns as never,
    jobRuns: jobRuns as never,
    queueFactory: factory as never,
    ...(operatorConfig ? { operatorConfig } : {}),
    ...(jobRunReaper ? { jobRunReaper } : {}),
  })
  return { app, listings, sources, scraperRuns, jobRuns, db }
}
