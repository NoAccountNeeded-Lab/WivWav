// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { WAV_FEATURES } from '@wivwav/types'
import type { WavFeatures } from '@wivwav/types'
import { afterEach, describe, expect, it } from 'vitest'
import { WavDetailsGrid } from './WavDetailsGrid'

afterEach(() => cleanup())

function makeWav(overrides: Partial<WavFeatures> = {}): WavFeatures {
  return {
    conversionType: 'unknown',
    conversionManufacturer: null,
    floorLoweringInches: null,
    rampType: 'unknown',
    conversionStatus: 'unknown',
    wavFeatures: [],
    wheelchairCapacity: null,
    ...overrides,
  }
}

describe('WavDetailsGrid', () => {
  it('shows every detected WAV feature using the canonical labels', () => {
    render(
      <WavDetailsGrid
        wav={makeWav({ wavFeatures: Object.keys(WAV_FEATURES) as (keyof typeof WAV_FEATURES)[] })}
      />,
    )

    const list = screen.getByRole('list', { name: 'WAV details and accessibility features' })
    for (const label of Object.values(WAV_FEATURES)) {
      expect(within(list).getByText(label)).toBeTruthy()
    }
  })

  it('omits the details list when no values were observed', () => {
    render(<WavDetailsGrid wav={makeWav()} />)

    expect(screen.queryByRole('list')).toBeNull()
  })

  it('never renders a not-included value', () => {
    render(<WavDetailsGrid wav={makeWav({ wavFeatures: ['power_ramp'] })} />)

    expect(screen.queryByText(/not included/i)).toBeNull()
  })

  it('shows non-null measurements and a proposed conversion status', () => {
    render(
      <WavDetailsGrid
        wav={makeWav({
          floorLoweringInches: 0,
          rampType: 'fold_out',
          wheelchairCapacity: 1,
          conversionStatus: 'proposed',
        })}
      />,
    )

    expect(screen.getByText('0 inches')).toBeTruthy()
    expect(screen.getByText('Fold-out ramp')).toBeTruthy()
    expect(screen.getByText('1 chair')).toBeTruthy()
    expect(screen.getByText('Proposed')).toBeTruthy()
  })

  it('shows a complete conversion status', () => {
    render(<WavDetailsGrid wav={makeWav({ conversionStatus: 'complete' })} />)

    expect(screen.getByText('Complete')).toBeTruthy()
  })

  it('omits unknown conversion and ramp statuses', () => {
    render(<WavDetailsGrid wav={makeWav({ wavFeatures: ['kneel_system'] })} />)

    expect(screen.queryByText('Conversion status')).toBeNull()
    expect(screen.queryByText('Ramp type')).toBeNull()
  })

  it('shows an accessible "needs verification" ramp-type row when the field is conflicting (#499)', () => {
    render(<WavDetailsGrid wav={makeWav({ rampType: 'unknown' })} rampTypeStatus="conflicting" />)

    expect(screen.getByText('Ramp type')).toBeTruthy()
    expect(screen.getByText(/needs verification/i)).toBeTruthy()
  })

  it('does not show a needs-verification row when rampType is merely unresolved (not conflicting)', () => {
    render(<WavDetailsGrid wav={makeWav({ rampType: 'unknown' })} rampTypeStatus="unknown" />)

    expect(screen.queryByText('Ramp type')).toBeNull()
  })

  it('prefers the real ramp value over the conflicting row when a value is present', () => {
    render(<WavDetailsGrid wav={makeWav({ rampType: 'in_floor' })} rampTypeStatus="conflicting" />)

    expect(screen.getByText('In-floor ramp')).toBeTruthy()
    expect(screen.queryByText(/needs verification/i)).toBeNull()
  })
})
