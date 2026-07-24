import { describe, expect, it } from 'vitest'
import { decodeWorkspaceState, encodeWorkspaceState } from './workspace-url'
import type { WorkspaceState } from './workspace-types'

describe('decodeWorkspaceState', () => {
  it('returns an empty workspace when the param is absent', () => {
    expect(decodeWorkspaceState(new URLSearchParams(''))).toEqual({ panels: [], maximizedId: null, minimizedId: null })
  })

  it('decodes panel order, entity identity, and span', () => {
    const state = decodeWorkspaceState(new URLSearchParams('panels=run:1234:2,source:blvd:1'))

    expect(state.panels).toEqual([
      { id: 'run:1234', entityType: 'run', entityId: '1234', span: 2 },
      { id: 'source:blvd', entityType: 'source', entityId: 'blvd', span: 1 },
    ])
    expect(state.maximizedId).toBeNull()
  })

  it('decodes minimizedId only when it names a currently-open panel', () => {
    const withMatch = decodeWorkspaceState(new URLSearchParams('panels=run:1234:1&min=run:1234'))
    expect(withMatch.minimizedId).toBe('run:1234')

    const withoutMatch = decodeWorkspaceState(new URLSearchParams('panels=run:1234:1&min=source:blvd'))
    expect(withoutMatch.minimizedId).toBeNull()
  })

  it('decodes "full" span', () => {
    const state = decodeWorkspaceState(new URLSearchParams('panels=queue:scrape:full'))
    expect(state.panels[0]?.span).toBe('full')
  })

  it('decodes maximizedId only when it names a currently-open panel', () => {
    const withMatch = decodeWorkspaceState(new URLSearchParams('panels=run:1234:1&max=run:1234'))
    expect(withMatch.maximizedId).toBe('run:1234')

    const withoutMatch = decodeWorkspaceState(new URLSearchParams('panels=run:1234:1&max=source:blvd'))
    expect(withoutMatch.maximizedId).toBeNull()
  })

  it('drops malformed entries instead of throwing', () => {
    const state = decodeWorkspaceState(new URLSearchParams('panels=run:1234:1,not-enough-fields,run:5678:9'))
    // "run:5678:9" has an unrecognized span and is dropped too.
    expect(state.panels).toEqual([{ id: 'run:1234', entityType: 'run', entityId: '1234', span: 1 }])
  })

  it('keeps only the first occurrence of a duplicate id, preserving order', () => {
    const state = decodeWorkspaceState(new URLSearchParams('panels=run:1234:1,source:blvd:2,run:1234:full'))
    expect(state.panels.map(p => p.id)).toEqual(['run:1234', 'source:blvd'])
    expect(state.panels[0]?.span).toBe(1)
  })

  it('round-trips entity ids that contain reserved separator characters', () => {
    const encoded = encodeWorkspaceState(
      { panels: [{ id: 'source:a:b', entityType: 'source', entityId: 'a:b', span: 1 }], maximizedId: null, minimizedId: null },
      new URLSearchParams(''),
    )
    const decoded = decodeWorkspaceState(encoded)
    expect(decoded.panels).toEqual([{ id: 'source:a:b', entityType: 'source', entityId: 'a:b', span: 1 }])
  })
})

describe('encodeWorkspaceState', () => {
  it('removes all params when the workspace has no open panels', () => {
    const next = encodeWorkspaceState(
      { panels: [], maximizedId: null, minimizedId: null },
      new URLSearchParams('panels=run:1&max=run:1&min=run:1&other=1'),
    )
    expect(next.toString()).toBe('other=1')
  })

  it('preserves unrelated existing params', () => {
    const state: WorkspaceState = { panels: [{ id: 'run:1234', entityType: 'run', entityId: '1234', span: 1 }], maximizedId: null, minimizedId: null }
    const next = encodeWorkspaceState(state, new URLSearchParams('status=failed'))
    expect(next.get('status')).toBe('failed')
    expect(next.get('panels')).toBe('run:1234:1')
  })

  it('drops the max param when maximizedId does not name an open panel', () => {
    const state: WorkspaceState = {
      panels: [{ id: 'run:1234', entityType: 'run', entityId: '1234', span: 1 }],
      maximizedId: 'source:blvd',
      minimizedId: null,
    }
    const next = encodeWorkspaceState(state, new URLSearchParams(''))
    expect(next.get('max')).toBeNull()
  })

  it('drops the min param when minimizedId does not name an open panel', () => {
    const state: WorkspaceState = {
      panels: [{ id: 'run:1234', entityType: 'run', entityId: '1234', span: 1 }],
      maximizedId: null,
      minimizedId: 'source:blvd',
    }
    const next = encodeWorkspaceState(state, new URLSearchParams(''))
    expect(next.get('min')).toBeNull()
  })

  it('round-trips through decode, including maximizedId', () => {
    const state: WorkspaceState = {
      panels: [
        { id: 'run:1234', entityType: 'run', entityId: '1234', span: 2 },
        { id: 'queue:scrape', entityType: 'queue', entityId: 'scrape', span: 'full' },
      ],
      maximizedId: 'queue:scrape',
      minimizedId: null,
    }
    const roundTripped = decodeWorkspaceState(encodeWorkspaceState(state, new URLSearchParams('')))
    expect(roundTripped).toEqual(state)
  })

  it('round-trips through decode, including minimizedId', () => {
    const state: WorkspaceState = {
      panels: [
        { id: 'run:1234', entityType: 'run', entityId: '1234', span: 2 },
        { id: 'source:blvd', entityType: 'source', entityId: 'blvd', span: 1 },
      ],
      maximizedId: null,
      minimizedId: 'source:blvd',
    }
    const roundTripped = decodeWorkspaceState(encodeWorkspaceState(state, new URLSearchParams('')))
    expect(roundTripped).toEqual(state)
  })
})
