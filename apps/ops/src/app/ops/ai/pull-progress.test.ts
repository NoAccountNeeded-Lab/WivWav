import { describe, it, expect } from 'vitest'
import {
  parsePullLine, applyPullLine, initialPullState, splitNdjsonChunk,
} from './pull-progress'

describe('parsePullLine', () => {
  it('returns null for a blank line', () => {
    expect(parsePullLine('')).toBeNull()
    expect(parsePullLine('   \n')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parsePullLine('{not json')).toBeNull()
  })

  it('returns null for a JSON value that is not an object', () => {
    expect(parsePullLine('42')).toBeNull()
    expect(parsePullLine('"hello"')).toBeNull()
  })

  it('returns null when status is missing and there is no error field', () => {
    expect(parsePullLine('{"digest":"sha256:abc"}')).toBeNull()
  })

  it('parses a manifest status line', () => {
    expect(parsePullLine('{"status":"pulling manifest"}')).toEqual({ status: 'pulling manifest' })
  })

  it('parses a layer progress line', () => {
    const line = parsePullLine('{"status":"pulling sha256:abc","digest":"sha256:abc","total":1000,"completed":250}')
    expect(line).toEqual({ status: 'pulling sha256:abc', digest: 'sha256:abc', total: 1000, completed: 250 })
  })

  it('parses a success line', () => {
    expect(parsePullLine('{"status":"success"}')).toEqual({ status: 'success' })
  })

  it('parses an error line even without a status field', () => {
    expect(parsePullLine('{"error":"model not found"}')).toEqual({ status: '', error: 'model not found' })
  })

  it('prefers the error field over status when both are present', () => {
    expect(parsePullLine('{"status":"pulling manifest","error":"boom"}'))
      .toEqual({ status: 'pulling manifest', error: 'boom' })
  })
})

describe('applyPullLine', () => {
  it('sets an error and marks done when the line has an error', () => {
    const state = applyPullLine(initialPullState(), { status: '', error: 'pull model manifest: file does not exist' })
    expect(state.error).toBe('pull model manifest: file does not exist')
    expect(state.done).toBe(true)
  })

  it('records status-only lines without touching layers or percent', () => {
    const state = applyPullLine(initialPullState(), { status: 'pulling manifest' })
    expect(state.status).toBe('pulling manifest')
    expect(state.layers).toEqual({})
    expect(state.overallPercent).toBeNull()
    expect(state.done).toBe(false)
  })

  it('tracks a single layer progress and computes percent', () => {
    let state = initialPullState()
    state = applyPullLine(state, { status: 'pulling sha256:a', digest: 'sha256:a', total: 1000, completed: 250 })
    expect(state.overallPercent).toBe(25)
    expect(state.layers['sha256:a']).toEqual({ total: 1000, completed: 250 })
  })

  it('aggregates percent across multiple layers', () => {
    let state = initialPullState()
    state = applyPullLine(state, { status: 'pulling sha256:a', digest: 'sha256:a', total: 1000, completed: 1000 })
    state = applyPullLine(state, { status: 'pulling sha256:b', digest: 'sha256:b', total: 1000, completed: 0 })
    // 1000 completed of 2000 total across both layers
    expect(state.overallPercent).toBe(50)
  })

  it('updates an existing layer in place rather than duplicating it', () => {
    let state = initialPullState()
    state = applyPullLine(state, { status: 'pulling sha256:a', digest: 'sha256:a', total: 1000, completed: 100 })
    state = applyPullLine(state, { status: 'pulling sha256:a', digest: 'sha256:a', total: 1000, completed: 900 })
    expect(Object.keys(state.layers)).toHaveLength(1)
    expect(state.overallPercent).toBe(90)
  })

  it('marks done and clamps percent to 100 on success', () => {
    let state = initialPullState()
    state = applyPullLine(state, { status: 'pulling sha256:a', digest: 'sha256:a', total: 1000, completed: 500 })
    state = applyPullLine(state, { status: 'success' })
    expect(state.done).toBe(true)
    expect(state.overallPercent).toBe(100)
    expect(state.error).toBeNull()
  })

  it('carries the previous percent forward when a line has no digest/total', () => {
    let state = initialPullState()
    state = applyPullLine(state, { status: 'pulling sha256:a', digest: 'sha256:a', total: 1000, completed: 500 })
    state = applyPullLine(state, { status: 'verifying sha256 digest' })
    expect(state.overallPercent).toBe(50)
    expect(state.status).toBe('verifying sha256 digest')
  })
})

describe('splitNdjsonChunk', () => {
  it('returns no lines and buffers a partial chunk with no newline', () => {
    const { lines, buffer } = splitNdjsonChunk('', '{"status":"pulling ma')
    expect(lines).toEqual([])
    expect(buffer).toBe('{"status":"pulling ma')
  })

  it('splits a chunk containing multiple complete lines', () => {
    const { lines, buffer } = splitNdjsonChunk('', '{"status":"a"}\n{"status":"b"}\n')
    expect(lines).toEqual(['{"status":"a"}', '{"status":"b"}'])
    expect(buffer).toBe('')
  })

  it('joins a carried-over buffer with the start of the next chunk', () => {
    const first = splitNdjsonChunk('', '{"status":"pull')
    const second = splitNdjsonChunk(first.buffer, 'ing manifest"}\n')
    expect(second.lines).toEqual(['{"status":"pulling manifest"}'])
    expect(second.buffer).toBe('')
  })
})
