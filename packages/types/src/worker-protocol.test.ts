import { describe, expect, it } from 'vitest'
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
  it('parses a valid hello', () => {
    expect(workerHelloSchema.parse(validHello)).toEqual(validHello)
  })

  it('rejects a missing capability field with a field-level path', () => {
    const result = workerHelloSchema.safeParse({
      ...validHello,
      capabilities: { chromium: true },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(
      'capabilities.maxConcurrentJobs',
    )
  })

  it('rejects a non-positive maxConcurrentJobs', () => {
    const result = workerHelloSchema.safeParse({
      ...validHello,
      capabilities: { chromium: false, maxConcurrentJobs: 0 },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(
      'capabilities.maxConcurrentJobs',
    )
  })

  it('rejects a mistyped chromium capability', () => {
    const result = workerHelloSchema.safeParse({
      ...validHello,
      capabilities: { chromium: 'yes', maxConcurrentJobs: 2 },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(
      'capabilities.chromium',
    )
  })
})

describe('wsJobDispatchMessageSchema', () => {
  it('parses a dispatch with a payload', () => {
    const message = {
      type: 'job-dispatch',
      correlationId: buildCorrelationId('detail-crawl', '42'),
      queueName: 'detail-crawl',
      payload: { sourceId: 'src-1' },
    }
    expect(wsJobDispatchMessageSchema.parse(message)).toEqual(message)
  })

  it('parses a dispatch without a payload (payload-less jobs)', () => {
    const message = {
      type: 'job-dispatch',
      correlationId: 'q:1',
      queueName: 'q',
    }
    expect(wsJobDispatchMessageSchema.parse(message)).toMatchObject(message)
  })

  it('rejects an empty queueName', () => {
    const result = wsJobDispatchMessageSchema.safeParse({
      type: 'job-dispatch',
      correlationId: 'q:1',
      queueName: '',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('queueName')
  })
})

describe('wsJobAckMessageSchema', () => {
  it('parses an accepted ack without a reason', () => {
    const message = { type: 'job-ack', correlationId: 'q:1', accepted: true }
    expect(wsJobAckMessageSchema.parse(message)).toEqual(message)
  })

  it('parses a refusal with a reason', () => {
    const message = {
      type: 'job-ack',
      correlationId: 'q:1',
      accepted: false,
      reason: 'at capacity',
    }
    expect(wsJobAckMessageSchema.parse(message)).toEqual(message)
  })

  it('rejects a missing accepted flag', () => {
    const result = wsJobAckMessageSchema.safeParse({ type: 'job-ack', correlationId: 'q:1' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('accepted')
  })
})

describe('wsHeartbeatMessageSchema', () => {
  it('coerces an ISO string sentAt into a Date', () => {
    const parsed = wsHeartbeatMessageSchema.parse({
      type: 'heartbeat',
      sentAt: '2026-08-08T12:00:00.000Z',
    })
    expect(parsed.sentAt).toBeInstanceOf(Date)
    expect(parsed.sentAt.toISOString()).toBe('2026-08-08T12:00:00.000Z')
  })

  it('rejects an unparseable sentAt', () => {
    const result = wsHeartbeatMessageSchema.safeParse({ type: 'heartbeat', sentAt: 'not-a-date' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('sentAt')
  })
})

describe('direction unions', () => {
  it('routes worker→coordinator messages by type', () => {
    expect(workerToCoordinatorMessageSchema.parse(validHello).type).toBe('hello')
    expect(
      workerToCoordinatorMessageSchema.parse({
        type: 'job-ack',
        correlationId: 'q:1',
        accepted: true,
      }).type,
    ).toBe('job-ack')
  })

  it('rejects a dispatch on the worker→coordinator direction', () => {
    const result = workerToCoordinatorMessageSchema.safeParse({
      type: 'job-dispatch',
      correlationId: 'q:1',
      queueName: 'q',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a hello on the coordinator→worker direction', () => {
    expect(coordinatorToWorkerMessageSchema.safeParse(validHello).success).toBe(false)
  })
})

describe('buildCorrelationId', () => {
  it('joins queue name and job id with a colon', () => {
    expect(buildCorrelationId('source-scrape', 'job-7')).toBe('source-scrape:job-7')
  })
})
