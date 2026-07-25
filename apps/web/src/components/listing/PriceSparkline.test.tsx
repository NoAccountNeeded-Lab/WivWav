// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PriceSparkline } from './PriceSparkline'
import type { PricePoint } from '@/app/[locale]/listings/[id]/types'

afterEach(() => cleanup())

function point(priceCents: number, recordedAt: string): PricePoint {
  return { id: recordedAt, priceCents, recordedAt }
}

describe('PriceSparkline', () => {
  it('renders nothing with fewer than two price points', () => {
    const { container } = render(<PriceSparkline priceHistory={[]} />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('describes a downward trend in its accessible label', () => {
    render(
      <PriceSparkline
        priceHistory={[point(25_000_00, '2026-01-01'), point(20_000_00, '2026-02-01')]}
      />,
    )
    expect(screen.getByRole('img', { name: /down to \$20,000 from \$25,000/ })).toBeTruthy()
  })

  it('describes an upward trend in its accessible label', () => {
    render(
      <PriceSparkline
        priceHistory={[point(20_000_00, '2026-01-01'), point(25_000_00, '2026-02-01')]}
      />,
    )
    expect(screen.getByRole('img', { name: /up to \$25,000 from \$20,000/ })).toBeTruthy()
  })

  it('describes a steady price when there is no change', () => {
    render(
      <PriceSparkline
        priceHistory={[point(20_000_00, '2026-01-01'), point(20_000_00, '2026-02-01')]}
      />,
    )
    expect(screen.getByRole('img', { name: /holding steady at \$20,000/ })).toBeTruthy()
  })
})
