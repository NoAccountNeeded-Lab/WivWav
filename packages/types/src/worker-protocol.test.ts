import { describe, expect, it } from 'vitest'
import { issuePaths } from './test-helpers/issue-paths.js'
import {
  buildCorrelationId,
  coordinatorToWorkerMessageSchema,
  workerHelloSchema,
  workerToCoordinatorMessageSchema,
  wsHeartbeatMessageSchema,
  wsJobAckMessageSchema,
  wsJobDispatchMessageSchema,
} from './worker-protocol.js'

const validHello = {
  type: 'hello',
  workerId: 'worker-abc',
  workerName: 'laptop-job-runner',
  capabilities: { chromium: true, maxConcurrentJobs: 2 },
}

describe('workerHelloSchema', () => {
  it('should parse a valid hello', () => {
    expect(workerHelloSchema.parse(validHello)).toEqual(validHello)
  })

  it('should reject a missing capability field with a field-level path', () => {
    const result = workerHelloSchema.safeParse({
      ...validHello,
      capabilities: { chromium: true },
    })
    expect(issuePaths(result)).toContain('capabilities.maxConcurrentJobs')
  })

  it('should reject a non-positive maxConcurrentJobs', () => {
    const result = workerHelloSchema.safeParse({
      ...validHello,
      capabilities: { chromium: false, maxConcurrentJobs: 0 },
    })
    expect(issuePaths(result)).toContain('capabilities.maxConcurrentJobs')
  })

  it('should reject a mistyped chromium capability', () => {
    const result = workerHelloSchema.safeParse({
      ...validHello,
      capabilities: { chromium: 'yes', maxConcurrentJobs: 2 },
    })
    expect(issuePaths(result)).toContain('capabilities.chromium')
  })
})

describe('wsJobDispatchMessageSchema', () => {
  it('should parse a dispatch with a payload', () => {
    const message = {
      type: 'job-dispatch',
      correlationId: buildCorrelationId('detail-crawl', '42'),
      queueName: 'detail-crawl',
      payload: { sourceId: 'src-1' },
    }
    expect(wsJobDispatchMessageSchema.parse(message)).toEqual(message)
  })

  it('should parse a dispatch without a payload (payload-less jobs)', () => {
    const message = {
      type: 'job-dispatch',
      correlationId: 'q:1',
      queueName: 'q',
    }
    expect(wsJobDispatchMessageSchema.parse(message)).toMatchObject(message)
  })

  it('should reject an empty queueName', () => {
    const result = wsJobDispatchMessageSchema.safeParse({
      type: 'job-dispatch',
      correlationId: 'q:1',
      queueName: '',
    })
    expect(issuePaths(result)).toContain('queueName')
  })
})

describe('wsJobAckMessageSchema', () => {
  it('should parse an accepted ack without a reason', () => {
    const message = { type: 'job-ack', correlationId: 'q:1', accepted: true }
    expect(wsJobAckMessageSchema.parse(message)).toEqual(message)
  })

  it('should parse a refusal with a reason', () => {
    const message = {
      type: 'job-ack',
      correlationId: 'q:1',
      accepted: false,
      reason: 'at capacity',
    }
    expect(wsJobAckMessageSchema.parse(message)).toEqual(message)
  })

  it('should reject a refusal without a reason', () => {
    const result = wsJobAckMessageSchema.safeParse({
      type: 'job-ack',
      correlationId: 'q:1',
      accepted: false,
    })
    expect(issuePaths(result)).toContain('reason')
  })

  it('should reject a missing accepted flag', () => {
    const result = wsJobAckMessageSchema.safeParse({ type: 'job-ack', correlationId: 'q:1' })
    expect(issuePaths(result)).toContain('accepted')
  })
})

describe('wsHeartbeatMessageSchema', () => {
  it('should parse an ISO string sentAt into a Date', () => {
    const parsed = wsHeartbeatMessageSchema.parse({
      type: 'heartbeat',
      sentAt: '2026-08-08T12:00:00.000Z',
    })
    expect(parsed.sentAt).toEqual(new Date('2026-08-08T12:00:00.000Z'))
  })

  it('should reject an unparseable sentAt', () => {
    const result = wsHeartbeatMessageSchema.safeParse({ type: 'heartbeat', sentAt: 'not-a-date' })
    expect(issuePaths(result)).toContain('sentAt')
  })

  it('should reject a numeric sentAt (no epoch-millisecond coercion)', () => {
    const result = wsHeartbeatMessageSchema.safeParse({ type: 'heartbeat', sentAt: 1754650000000 })
    expect(issuePaths(result)).toContain('sentAt')
  })
})

describe('direction unions', () => {
  it('should route a hello on the worker→coordinator direction', () => {
    expect(workerToCoordinatorMessageSchema.parse(validHello).type).toBe('hello')
  })

  it('should route an ack on the worker→coordinator direction', () => {
    expect(
      workerToCoordinatorMessageSchema.parse({
        type: 'job-ack',
        correlationId: 'q:1',
        accepted: true,
      }).type,
    ).toBe('job-ack')
  })

  it('should reject a dispatch on the worker→coordinator direction', () => {
    const result = workerToCoordinatorMessageSchema.safeParse({
      type: 'job-dispatch',
      correlationId: 'q:1',
      queueName: 'q',
    })
    expect(result.success).toBe(false)
  })

  it('should reject a hello on the coordinator→worker direction', () => {
    expect(coordinatorToWorkerMessageSchema.safeParse(validHello).success).toBe(false)
  })
})

describe('buildCorrelationId', () => {
  it('should join queue name and job id with a colon', () => {
    expect(buildCorrelationId('source-scrape', 'job-7')).toBe('source-scrape:job-7')
  })
})
