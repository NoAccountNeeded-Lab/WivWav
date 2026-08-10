import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { QUEUES } from '@wivwav/queue'
import { GATEWAY_OWNED_QUEUES, SCRAPER_WORKER_QUEUES } from './worker-registration.js'

describe('worker registration', () => {
  it('registers no in-process worker for any gateway-owned queue', () => {
    const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const queueConstants = ['SOURCE_SCRAPE', 'DETAIL_CRAWL', 'DETAIL_EXTRACT']

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

  it('lists SOURCE_SCRAPE, DETAIL_CRAWL, and DETAIL_EXTRACT as gateway-owned', () => {
    expect(GATEWAY_OWNED_QUEUES).toEqual([
      QUEUES.SOURCE_SCRAPE,
      QUEUES.DETAIL_CRAWL,
      QUEUES.DETAIL_EXTRACT,
    ])
  })

  it('has no duplicate queue names in the worker list', () => {
    expect(new Set(SCRAPER_WORKER_QUEUES).size).toBe(SCRAPER_WORKER_QUEUES.length)
  })
})
