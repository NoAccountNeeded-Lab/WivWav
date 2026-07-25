// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WavConversionHistory, buildConversionChangelog } from './WavConversionHistory'
import type { ConversionHistoryEntry } from '@/app/[locale]/listings/[id]/types'

afterEach(() => cleanup())

function entry(overrides: Partial<ConversionHistoryEntry> & Pick<ConversionHistoryEntry, 'id' | 'recordedAt'>): ConversionHistoryEntry {
  return {
    conversionStatus: 'proposed',
    wavFeatures: [],
    ...overrides,
  }
}

describe('buildConversionChangelog', () => {
  it('returns no changes for a single snapshot (the common case)', () => {
    const history = [entry({ id: '1', recordedAt: '2026-01-01T00:00:00Z' })]

    expect(buildConversionChangelog(history)).toEqual([])
  })

  it('returns no changes when repeated ingest passes produced identical snapshots', () => {
    const history = [
      entry({ id: '1', recordedAt: '2026-01-01T00:00:00Z', conversionStatus: 'complete', wavFeatures: ['power_ramp'] }),
      entry({ id: '2', recordedAt: '2026-01-08T00:00:00Z', conversionStatus: 'complete', wavFeatures: ['power_ramp'] }),
      entry({ id: '3', recordedAt: '2026-01-15T00:00:00Z', conversionStatus: 'complete', wavFeatures: ['power_ramp'] }),
    ]

    expect(buildConversionChangelog(history)).toEqual([])
  })

  it('collapses duplicate consecutive snapshots and reports only the actual changes, in chronological order', () => {
    const history = [
      // Out-of-order input; the function must sort by recordedAt first.
      entry({ id: '3', recordedAt: '2026-03-01T00:00:00Z', conversionStatus: 'complete', wavFeatures: ['power_ramp', 'transfer_seat'] }),
      entry({ id: '1', recordedAt: '2026-01-01T00:00:00Z', conversionStatus: 'proposed', wavFeatures: ['power_ramp'] }),
      entry({ id: '1b', recordedAt: '2026-01-08T00:00:00Z', conversionStatus: 'proposed', wavFeatures: ['power_ramp'] }),
      entry({ id: '2', recordedAt: '2026-02-01T00:00:00Z', conversionStatus: 'complete', wavFeatures: ['power_ramp'] }),
    ]

    const changes = buildConversionChangelog(history)

    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({
      id: '2',
      recordedAt: '2026-02-01T00:00:00Z',
      statusChange: { from: 'proposed', to: 'complete' },
      featuresAdded: [],
      featuresRemoved: [],
    })
    expect(changes[1]).toMatchObject({
      id: '3',
      recordedAt: '2026-03-01T00:00:00Z',
      statusChange: null,
      featuresAdded: ['transfer_seat'],
      featuresRemoved: [],
    })
  })

  it('reports removed features and treats reordered feature lists as unchanged', () => {
    const history = [
      entry({ id: '1', recordedAt: '2026-01-01T00:00:00Z', conversionStatus: 'complete', wavFeatures: ['power_ramp', 'transfer_seat'] }),
      // Same set, different order — must not count as a change.
      entry({ id: '1b', recordedAt: '2026-01-08T00:00:00Z', conversionStatus: 'complete', wavFeatures: ['transfer_seat', 'power_ramp'] }),
      entry({ id: '2', recordedAt: '2026-02-01T00:00:00Z', conversionStatus: 'complete', wavFeatures: ['power_ramp'] }),
    ]

    const changes = buildConversionChangelog(history)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      id: '2',
      featuresAdded: [],
      featuresRemoved: ['transfer_seat'],
    })
  })
})

describe('WavConversionHistory', () => {
  it('renders nothing for a listing with only one snapshot', () => {
    const { container } = render(
      <WavConversionHistory history={[entry({ id: '1', recordedAt: '2026-01-01T00:00:00Z' })]} />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when there is no history at all', () => {
    const { container } = render(<WavConversionHistory history={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders a changelog entry describing a conversion-status change', () => {
    render(
      <WavConversionHistory
        history={[
          entry({ id: '1', recordedAt: '2026-01-01T00:00:00Z', conversionStatus: 'proposed' }),
          entry({ id: '2', recordedAt: '2026-02-01T00:00:00Z', conversionStatus: 'complete' }),
        ]}
      />,
    )

    expect(screen.getByText('Conversion history')).toBeTruthy()
    expect(screen.getByText('Proposed', { exact: false })).toBeTruthy()
    expect(screen.getByText('Complete', { exact: false })).toBeTruthy()
  })

  it('renders a changelog entry describing a WAV feature addition', () => {
    render(
      <WavConversionHistory
        history={[
          entry({ id: '1', recordedAt: '2026-01-01T00:00:00Z', wavFeatures: [] }),
          entry({ id: '2', recordedAt: '2026-02-01T00:00:00Z', wavFeatures: ['power_ramp'] }),
        ]}
      />,
    )

    expect(screen.getByText('Power Ramp', { exact: false })).toBeTruthy()
    expect(screen.getByText('added', { exact: false })).toBeTruthy()
  })
})
