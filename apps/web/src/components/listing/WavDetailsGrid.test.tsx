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
})
