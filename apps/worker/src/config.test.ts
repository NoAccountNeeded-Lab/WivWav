import { describe, expect, it } from 'vitest'
import { loadWorkerConfig } from './config.js'

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    COORDINATOR_URL: 'http://api:3001',
    WORKER_TOKEN: 'secret',
    ...overrides,
  } as NodeJS.ProcessEnv
}

describe('loadWorkerConfig', () => {
  it('throws when COORDINATOR_URL is missing', () => {
    expect(() => loadWorkerConfig(env({ COORDINATOR_URL: undefined }))).toThrow(/COORDINATOR_URL/)
  })

  it('throws when WORKER_TOKEN is missing', () => {
    expect(() => loadWorkerConfig(env({ WORKER_TOKEN: undefined }))).toThrow(/WORKER_TOKEN/)
  })

  it('strips a trailing slash from COORDINATOR_URL', () => {
    const config = loadWorkerConfig(env({ COORDINATOR_URL: 'http://api:3001/' }))
    expect(config.coordinatorUrl).toBe('http://api:3001')
  })

  it('defaults capabilities to chromium=true, httpEnrich=true, and maxConcurrentJobs=2', () => {
    const config = loadWorkerConfig(env())
    expect(config.capabilities).toEqual({ chromium: true, httpEnrich: true, maxConcurrentJobs: 2 })
  })

  it('parses WORKER_CAPABILITIES=chromium=false', () => {
    const config = loadWorkerConfig(env({ WORKER_CAPABILITIES: 'chromium=false' }))
    expect(config.capabilities.chromium).toBe(false)
  })

  it('parses WORKER_CAPABILITIES=httpEnrich=false', () => {
    const config = loadWorkerConfig(env({ WORKER_CAPABILITIES: 'httpEnrich=false' }))
    expect(config.capabilities.httpEnrich).toBe(false)
  })

  it('parses independent chromium and httpEnrich flags together', () => {
    const config = loadWorkerConfig(
      env({ WORKER_CAPABILITIES: 'chromium=false,httpEnrich=true' }),
    )
    expect(config.capabilities.chromium).toBe(false)
    expect(config.capabilities.httpEnrich).toBe(true)
  })

  it('parses WORKER_MAX_CONCURRENT_JOBS', () => {
    const config = loadWorkerConfig(env({ WORKER_MAX_CONCURRENT_JOBS: '5' }))
    expect(config.capabilities.maxConcurrentJobs).toBe(5)
  })

  it('falls back to the default for an invalid WORKER_MAX_CONCURRENT_JOBS', () => {
    const config = loadWorkerConfig(env({ WORKER_MAX_CONCURRENT_JOBS: 'not-a-number' }))
    expect(config.capabilities.maxConcurrentJobs).toBe(2)
  })

  it('uses WORKER_ID/WORKER_NAME when provided', () => {
    const config = loadWorkerConfig(env({ WORKER_ID: 'w-1', WORKER_NAME: 'laptop' }))
    expect(config.workerId).toBe('w-1')
    expect(config.workerName).toBe('laptop')
  })
})
