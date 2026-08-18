import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { QUEUES } from '@wivwav/queue'
import { GATEWAY_OWNED_QUEUES, SCRAPER_WORKER_QUEUES } from './worker-registration.js'

describe('worker registration', () => {
  it('registers no in-process worker for any gateway-owned queue', () => {
    const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const queueConstants = [
      'SOURCE_SCRAPE',
      'DETAIL_CRAWL',
      'DETAIL_EXTRACT',
      'NHTSA_RECALLS',
      'NHTSA_COMPLAINTS',
      'NHTSA_SAFETY_RATINGS',
      'NHTSA_INVESTIGATIONS',
      'NHTSA_MANUFACTURER_COMMUNICATIONS',
      'VIN_ENRICH',
      'MODEL_RESEARCH',
      'FUELECONOMY_MSRP',
      'DEALER_ENRICH',
    ]

    for (const queueConstant of queueConstants) {
      expect(indexSource).not.toMatch(
        new RegExp(
          `queueFactory\\.createWorker(?:<[^>]+>)?\\(\\s*QUEUES\\.${queueConstant}\\b`,
        ),
      )
    }
  })

  it('keeps the documented scraper worker list disjoint from gateway queues', () => {
    for (const queue of GATEWAY_OWNED_QUEUES) expect(SCRAPER_WORKER_QUEUES).not.toContain(queue)
  })

  it('lists the three chromium jobs and the 9 outbound-HTTP jobs as gateway-owned', () => {
    expect(GATEWAY_OWNED_QUEUES).toEqual([
      QUEUES.SOURCE_SCRAPE,
      QUEUES.DETAIL_CRAWL,
      QUEUES.DETAIL_EXTRACT,
      QUEUES.NHTSA_RECALLS,
      QUEUES.NHTSA_COMPLAINTS,
      QUEUES.NHTSA_SAFETY_RATINGS,
      QUEUES.NHTSA_INVESTIGATIONS,
      QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS,
      QUEUES.VIN_ENRICH,
      QUEUES.MODEL_RESEARCH,
      QUEUES.FUELECONOMY_MSRP,
      QUEUES.DEALER_ENRICH,
    ])
  })

  it('has no duplicate queue names in the worker list', () => {
    expect(new Set(SCRAPER_WORKER_QUEUES).size).toBe(SCRAPER_WORKER_QUEUES.length)
  })
})
