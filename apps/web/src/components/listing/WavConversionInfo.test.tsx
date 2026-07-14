// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WavConversionInfo } from './WavConversionInfo'

afterEach(() => cleanup())

describe('WavConversionInfo', () => {
  it('shows the entry banner for a resolved conversion type', () => {
    render(<WavConversionInfo conversionType="rear_entry" />)

    expect(screen.getByText('Rear-entry conversion')).toBeTruthy()
  })

  it('shows an accessible "Entry type needs verification" state instead of a definitive claim when conflicting (#499)', () => {
    render(
      <WavConversionInfo
        conversionType="unknown"
        conversionTypeStatus="conflicting"
        sourceUrl="https://dealer.example.com/listing/1"
      />,
    )

    const note = screen.getByRole('note', { name: 'Entry type needs verification' })
    expect(note).toBeTruthy()
    // Text label carries the state — not color alone (docs/BRAND.md).
    expect(screen.getByText('Entry type needs verification')).toBeTruthy()
  })

  it('does not render a definitive entry banner while conflicting', () => {
    render(<WavConversionInfo conversionType="unknown" conversionTypeStatus="conflicting" />)

    expect(screen.queryByText('Rear-entry conversion')).toBeNull()
    expect(screen.queryByText('Side-entry conversion')).toBeNull()
  })

  it('provides a source-link path without exposing internal evidence or claim text', () => {
    render(
      <WavConversionInfo
        conversionType="unknown"
        conversionTypeStatus="conflicting"
        sourceUrl="https://dealer.example.com/listing/1"
      />,
    )

    const link = screen.getByRole('link', { name: /check the original listing/i })
    expect(link.getAttribute('href')).toBe('https://dealer.example.com/listing/1')
    // No internal evidence kinds, confidence scores, or claim source text.
    expect(screen.queryByText(/structured_source|vehicle_text|confidence/i)).toBeNull()
  })

  it('renders no needs-verification state when merely unresolved (not conflicting)', () => {
    render(<WavConversionInfo conversionType="unknown" conversionTypeStatus="unknown" />)

    expect(screen.queryByRole('note', { name: 'Entry type needs verification' })).toBeNull()
  })

  it('renders neither the entry banner nor a needs-verification state with no data at all', () => {
    render(<WavConversionInfo conversionType="unknown" />)

    expect(screen.queryByText('Rear-entry conversion')).toBeNull()
    expect(screen.queryByText('Side-entry conversion')).toBeNull()
    expect(screen.queryByRole('note', { name: 'Entry type needs verification' })).toBeNull()
  })
})
