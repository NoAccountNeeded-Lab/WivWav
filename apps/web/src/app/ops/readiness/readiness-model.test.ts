import { describe, expect, it } from 'vitest'
import type { HealthResponse } from '@wivwav/types'
import { buildReadinessReport, type ReadinessInputs } from './readiness-model.js'

const now = new Date('2026-06-18T12:00:00.000Z')

const healthyHealth: HealthResponse = {
  status: 'ok',
  timestamp: now.toISOString(),
  services: {
    postgres: { status: 'up', latencyMs: 12 },
    meilisearch: { status: 'up', latencyMs: 18 },
    valkey: { status: 'up', latencyMs: 4 },
    ollama: { status: 'optional_offline' },
    scraper: { status: 'up', lastRunAt: '2026-06-18T11:30:00.000Z' },
  },
}

function loaded<T>(data: T) {
  return { status: 'loaded' as const, data }
}

function baseInputs(): ReadinessInputs {
  return {
    now,
    health: loaded(healthyHealth),
    queues: loaded([
      { name: 'source-scrape', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'detail-crawl', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'detail-extract', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'deduplicate', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'vin-enrich', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'nhtsa-recalls', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'nhtsa-complaints', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
      { name: 'nhtsa-safety-ratings', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 } },
    ]),
    sources: loaded([
      { id: 'source-1', name: 'BLVD.com', status: 'active', lastScrapedAt: '2026-06-18T11:00:00.000Z', listingCount: 12 },
    ]),
    schedules: loaded([
      { id: 'blvd', queue: 'source-scrape', label: 'BLVD.com scrape', enabled: true },
      { id: 'detail-crawl', queue: 'detail-crawl', label: 'Detail crawl', enabled: true },
      { id: 'detail-extract', queue: 'detail-extract', label: 'Detail extract', enabled: true },
      { id: 'geocode', queue: 'geocode', label: 'Geocode', enabled: true },
      { id: 'deduplicate', queue: 'deduplicate', label: 'Deduplicate', enabled: true },
      { id: 'vin-enrich', queue: 'vin-enrich', label: 'VIN enrichment', enabled: true },
      { id: 'nhtsa-recalls', queue: 'nhtsa-recalls', label: 'NHTSA recalls refresh', enabled: true },
      { id: 'nhtsa-complaints', queue: 'nhtsa-complaints', label: 'NHTSA complaints refresh', enabled: true },
      { id: 'nhtsa-safety-ratings', queue: 'nhtsa-safety-ratings', label: 'NHTSA safety ratings refresh', enabled: true },
    ]),
    runs: loaded([
      { startedAt: '2026-06-18T10:55:00.000Z', finishedAt: '2026-06-18T11:00:00.000Z', success: true },
    ]),
    listingSearch: loaded({ pagination: { total: 12 } }),
  }
}

describe('buildReadinessReport', () => {
  it('should pass every check when operational data is healthy', () => {
    expect(buildReadinessReport(baseInputs()).overallStatus).toBe('pass')
  })

  it('should fail when launch-blocking operations are broken', () => {
    const inputs = baseInputs()
    inputs.queues = loaded([
      { name: 'source-scrape', paused: false, stats: { waiting: 0, active: 0, completed: 10, failed: 2, delayed: 0 } },
    ])
    inputs.sources = loaded([
      { id: 'source-1', name: 'BLVD.com', status: 'needs_remapping', lastScrapedAt: null, listingCount: 0 },
    ])
    inputs.schedules = loaded([
      { id: 'blvd', queue: 'source-scrape', label: 'BLVD.com scrape', enabled: false },
      { id: 'geocode', queue: 'geocode', label: 'Geocode', enabled: false },
    ])
    inputs.runs = loaded([])

    expect(buildReadinessReport(inputs).totals.fail).toBeGreaterThanOrEqual(5)
  })

  it('should mark individual checks unavailable when upstream data cannot be loaded', () => {
    const inputs = baseInputs()
    inputs.health = { status: 'unavailable', error: 'API returned 503' }
    inputs.listingSearch = { status: 'unavailable', error: 'Search timed out' }

    expect(buildReadinessReport(inputs).totals.unavailable).toBe(5)
  })

  it('should warn when the search index is reachable but empty', () => {
    const inputs = baseInputs()
    inputs.listingSearch = loaded({ pagination: { total: 0 } })

    expect(buildReadinessReport(inputs).checks.find(check => check.id === 'search-index')?.status).toBe('warn')
  })
})
