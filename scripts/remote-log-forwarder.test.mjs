// Focused unit tests for scripts/remote-log-forwarder.mjs (#1226).
// These tests are pure: they never contact an SSH host, a Docker daemon,
// or a Loki instance. The runtime is exercised only through dependency
// injection with fake in-process dependencies.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PUSH_URL,
  parseConfig,
  dockerTsToLokiNs,
  parseLogLine,
  buildStreamLabels,
  buildLokiPayload,
  nextBackoffDelayMs,
  computeFollowArgs,
  createEntryBuffer,
  createReplayGuard,
  flushBatchesWithRetry,
  maskSensitive,
} from './remote-log-forwarder.mjs'

describe('parseConfig', () => {
  it('fails closed when WIVWAV_REMOTE_SSH_TARGET is missing', () => {
    assert.throws(() => parseConfig({}), /WIVWAV_REMOTE_SSH_TARGET/)
    assert.throws(() => parseConfig({ WIVWAV_REMOTE_SSH_TARGET: '' }), /WIVWAV_REMOTE_SSH_TARGET/)
    assert.throws(() => parseConfig({ WIVWAV_REMOTE_SSH_TARGET: '   ' }), /WIVWAV_REMOTE_SSH_TARGET/)
  })

  it('defaults LOKI_PUSH_URL to the local Loki push endpoint', () => {
    const cfg = parseConfig({ WIVWAV_REMOTE_SSH_TARGET: 'user@remote' })
    assert.equal(cfg.lokiPushUrl, DEFAULT_PUSH_URL)
    assert.equal(cfg.lokiPushUrl, 'http://127.0.0.1:3100/loki/api/v1/push')
  })

  it('reads LOKI_PUSH_URL from the environment when provided', () => {
    const cfg = parseConfig({
      WIVWAV_REMOTE_SSH_TARGET: 'user@remote',
      LOKI_PUSH_URL: 'https://loki.example.internal/loki/api/v1/push',
    })
    assert.equal(cfg.lokiPushUrl, 'https://loki.example.internal/loki/api/v1/push')
  })

  it('includes the optional host label only when supplied', () => {
    const without = parseConfig({ WIVWAV_REMOTE_SSH_TARGET: 'user@remote' })
    assert.equal(without.hostLabel, null)
    const withHost = parseConfig({
      WIVWAV_REMOTE_SSH_TARGET: 'user@remote',
      WIVWAV_LOG_HOST_LABEL: 'prod-a',
    })
    assert.equal(withHost.hostLabel, 'prod-a')
  })

  it('enforces sane bounds on tuning knobs regardless of env input', () => {
    const cfg = parseConfig({
      WIVWAV_REMOTE_SSH_TARGET: 'user@remote',
      BUFFER_MAX_ENTRIES: '1',
      REDISCOVERY_POLL_INTERVAL_MS: '0.5',
      FLUSH_INTERVAL_MS: '0.5',
      LOKI_RETRY_MAX_ATTEMPTS: '-3',
    })
    assert.ok(cfg.bufferMaxEntries >= 1)
    assert.ok(cfg.rediscoveryPollIntervalMs >= 250)
    assert.ok(cfg.flushIntervalMs >= 100)
    assert.ok(cfg.lokiRetryMaxAttempts >= 1)
  })
})

describe('dockerTsToLokiNs', () => {
  const SEC = 1719837296 // 2024-07-01T12:34:56Z

  it('parses docker --timestamps RFC3339Nano output to nanoseconds', () => {
    assert.equal(dockerTsToLokiNs('2024-07-01T12:34:56.123456789Z'), `${SEC}123456789`)
  })

  it('parses timestamps without fractional seconds', () => {
    assert.equal(dockerTsToLokiNs('2024-07-01T12:34:56Z'), `${SEC}000000000`)
  })

  it('honours numeric timezone offsets', () => {
    assert.equal(dockerTsToLokiNs('2024-07-01T12:34:56.000000001+02:00'), `${SEC - 7200}000000001`)
    assert.equal(dockerTsToLokiNs('2024-07-01T04:34:56.000000001-08:00'), `${SEC}000000001`)
  })

  it('pads short fractions as nanoseconds', () => {
    assert.equal(dockerTsToLokiNs('2024-07-01T12:34:56.5Z'), `${SEC}500000000`)
  })

  it('returns null for malformed values instead of throwing', () => {
    assert.equal(dockerTsToLokiNs(''), null)
    assert.equal(dockerTsToLokiNs('not-a-timestamp'), null)
    assert.equal(dockerTsToLokiNs('2024-07-01 12:34:56Z'), null)
    assert.equal(dockerTsToLokiNs('1719837296000'), null)
  })

  it('rejects impossible calendar dates rather than rolling them over', () => {
    assert.equal(dockerTsToLokiNs('2024-02-30T00:00:00.000000000Z'), null)
    assert.equal(dockerTsToLokiNs('2024-13-01T00:00:00.000000000Z'), null)
  })
})

describe('parseLogLine', () => {
  it('splits docker timestamped lines, preserving the source timestamp', () => {
    const parsed = parseLogLine('2024-07-01T12:34:56.123456789Z api listening on :3000')
    assert.equal(parsed.tsNs, '1719837296123456789')
    assert.equal(parsed.message, 'api listening on :3000')
  })

  it('falls back to a null timestamp for unparseable lines without losing data', () => {
    const parsed = parseLogLine('not a timestamped line at all')
    assert.equal(parsed.tsNs, null)
    assert.equal(parsed.message, 'not a timestamped line at all')
  })

  it('does not treat message text with an arbitrary clock prefix as a timestamp', () => {
    const parsed = parseLogLine('12:34:56 something happened')
    assert.equal(parsed.tsNs, null)
    assert.equal(parsed.message, '12:34:56 something happened')
  })

  it('keeps a line whose timestamp prefix is malformed intact', () => {
    const raw = '2024-02-30T00:00:00.000000000Z actually emitted by the container'
    const parsed = parseLogLine(raw)
    assert.equal(parsed.tsNs, null)
    assert.equal(parsed.message, raw)
  })

  it('handles empty lines safely', () => {
    const parsed = parseLogLine('')
    assert.equal(parsed.tsNs, null)
    assert.equal(parsed.message, '')
  })
})

describe('buildStreamLabels', () => {
  it('labels every push with the wivwav project and compose service', () => {
    assert.deepEqual(buildStreamLabels({ service: 'api' }), { project: 'wivwav', service: 'api' })
  })

  it('adds the host label when configured', () => {
    assert.deepEqual(
      buildStreamLabels({ service: 'worker', hostLabel: 'prod-a' }),
      { project: 'wivwav', service: 'worker', host: 'prod-a' },
    )
  })

  it('refuses to serialize streams without a service label', () => {
    assert.throws(() => buildStreamLabels({ service: '' }), /service/)
    assert.throws(() => buildStreamLabels({ service: '   ' }), /service/)
  })
})

describe('buildLokiPayload', () => {
  const entry = (service, line, tsNs) => ({
    labels: buildStreamLabels({ service }),
    line,
    tsNs,
  })

  it('serializes entries into one stream per label set', () => {
    const payload = buildLokiPayload([
      entry('api', 'line-a', '1719837296123456789'),
      entry('worker', 'line-b', '1719837296200000000'),
      entry('api', 'line-c', '1719837296300000000'),
    ])
    const parsed = JSON.parse(payload)
    assert.equal(parsed.streams.length, 2)
    const byService = Object.fromEntries(
      parsed.streams.map((s) => [s.stream.service, s.values.map(([ts, line]) => [ts, line])]),
    )
    assert.deepEqual(byService.api, [
      ['1719837296123456789', 'line-a'],
      ['1719837296300000000', 'line-c'],
    ])
    assert.deepEqual(byService.worker, [['1719837296200000000', 'line-b']])
  })

  it('sorts values oldest-first even when entries arrive out of order', () => {
    const payload = buildLokiPayload([
      entry('api', 'late', '1719837296300000000'),
      entry('api', 'early', '1719837296100000000'),
    ])
    const parsed = JSON.parse(payload)
    assert.deepEqual(parsed.streams[0].values.map(([, line]) => line), ['early', 'late'])
  })

  it('preserves malformed lines inside the stream body with a fallback timestamp', () => {
    const payload = buildLokiPayload([
      {
        labels: buildStreamLabels({ service: 'api' }),
        line: 'bad line',
        tsNs: '1719837296000000000',
      },
    ])
    const parsed = JSON.parse(payload)
    assert.deepEqual(parsed.streams[0].values, [['1719837296000000000', 'bad line']])
  })
})

describe('nextBackoffDelayMs', () => {
  it('grows exponentially and is capped', () => {
    assert.equal(nextBackoffDelayMs(1, 1000, 8000), 1000)
    assert.equal(nextBackoffDelayMs(2, 1000, 8000), 2000)
    assert.equal(nextBackoffDelayMs(3, 1000, 8000), 4000)
    assert.equal(nextBackoffDelayMs(4, 1000, 8000), 8000)
    assert.equal(nextBackoffDelayMs(5, 1000, 8000), 8000)
    assert.equal(nextBackoffDelayMs(50, 1000, 8000), 8000)
  })

  it('stays bounded for zero or negative attempts', () => {
    assert.equal(nextBackoffDelayMs(0, 1000, 8000), 1000)
    assert.equal(nextBackoffDelayMs(-2, 1000, 8000), 1000)
  })
})

describe('computeFollowArgs', () => {
  it('follows without --since on a first observation', () => {
    const args = computeFollowArgs({ containerId: 'abc123', cursor: null, tail: 100 })
    assert.equal(args.indexOf('--since'), -1)
    assert.equal(args.at(-1), 'abc123')
    assert.ok(args.includes('--follow'))
    assert.ok(args.includes('--timestamps'))
    assert.ok(args.includes('--tail'))
  })

  it('resumes from the recorded cursor after a restart', () => {
    const args = computeFollowArgs({
      containerId: 'abc123',
      cursor: '2024-07-01T12:34:56.123456789Z',
      tail: 100,
    })
    const sinceIndex = args.indexOf('--since')
    assert.notEqual(sinceIndex, -1)
    assert.equal(args[sinceIndex + 1], '2024-07-01T12:34:56.123456789Z')
  })

  it('caps the catch-up tail so a first observation cannot flood Loki', () => {
    const args = computeFollowArgs({ containerId: 'abc123', cursor: null, tail: 10_000_000 })
    assert.ok(Number(args[args.indexOf('--tail') + 1]) <= 1000)
  })
})

describe('createEntryBuffer', () => {
  it('drains entries and clears the buffer', () => {
    const buffer = createEntryBuffer(5)
    buffer.push([{ line: 'a', tsNs: '1', service: 'api' }])
    buffer.push([{ line: 'b', tsNs: '2', service: 'api' }])
    const drained = buffer.drain()
    assert.equal(drained.length, 2)
    assert.equal(buffer.drain().length, 0)
    assert.equal(drained[0].line, 'a')
  })

  it('is bounded: drops oldest entries instead of growing without limit', () => {
    const buffer = createEntryBuffer(3)
    buffer.push([
      { line: 'a', tsNs: '1', service: 'api' },
      { line: 'b', tsNs: '2', service: 'api' },
      { line: 'c', tsNs: '3', service: 'api' },
      { line: 'd', tsNs: '4', service: 'api' },
      { line: 'e', tsNs: '5', service: 'api' },
    ])
    const drained = buffer.drain()
    assert.equal(drained.length, 3)
    assert.deepEqual(drained.map((e) => e.line), ['c', 'd', 'e'])
    assert.equal(buffer.droppedCount, 2)
  })
})

describe('flushBatchesWithRetry', () => {
  const sleep = async () => {}
  const group = (line) => ({ labels: buildStreamLabels({ service: 'api' }), entries: [{ line, tsNs: '1719837296000000000' }] })

  it('retries a failed Loki push as one batch and gives up after the cap', async () => {
    const calls = []
    const pushFn = async () => {
      calls.push(1)
      throw new Error('loki unavailable')
    }
    await assert.rejects(
      flushBatchesWithRetry(pushFn, [group('line')], { maxAttempts: 3, sleepFn: sleep }),
      /loki unavailable/,
    )
    assert.equal(calls.length, 3)
  })

  it('succeeds and pushes the whole batch when a retry recovers', async () => {
    let attempts = 0
    const seenBodies = []
    await flushBatchesWithRetry(
      async (body) => {
        attempts += 1
        if (attempts < 2) throw new Error('temporary')
        seenBodies.push(body)
      },
      [group('whole-batch')],
      { maxAttempts: 3, sleepFn: sleep },
    )
    assert.equal(attempts, 2)
    assert.equal(seenBodies.length, 1)
    assert.equal(JSON.parse(seenBodies[0]).streams[0].values[0][1], 'whole-batch')
  })
})

describe('createReplayGuard', () => {
  it('skips the exact boundary line replayed after a restart, exactly once', () => {
    const guard = createReplayGuard()
    guard.arm({ tsNs: '1719837296123456789', line: 'api listening' })
    assert.equal(guard.shouldSkip('1719837296123456789', 'api listening'), true)
    assert.equal(guard.shouldSkip('1719837296123456789', 'api listening'), false)
  })

  it('never skips distinct lines, even repeated after restart', () => {
    const guard = createReplayGuard()
    guard.arm({ tsNs: '1719837296123456789', line: 'api listening' })
    assert.equal(guard.shouldSkip('1719837296123456789', 'new line after restart'), false)
  })

  it('is inert for a fresh first observation without a cursor', () => {
    const guard = createReplayGuard()
    assert.equal(guard.shouldSkip('1719837296123456789', 'anything'), false)
  })
})

describe('maskSensitive', () => {
  it('redacts anything resembling the SSH target from diagnostic text', () => {
    assert.equal(maskSensitive('connect failed: user@some-host: ssh died', 'user@some-host'), 'connect failed: <redacted>: ssh died')
  })
})
