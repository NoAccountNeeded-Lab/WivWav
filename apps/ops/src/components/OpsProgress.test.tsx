// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OpsProgressDeterminate, OpsProgressIndeterminate } from './OpsProgress'

afterEach(() => {
  cleanup()
})

describe('OpsProgressDeterminate', () => {
  it('should expose role="progressbar" with aria-valuenow/min/max driven by props', () => {
    render(<OpsProgressDeterminate value={30} min={0} max={100} label="Scrape progress" />)
    const bar = screen.getByRole('progressbar', { name: 'Scrape progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('30')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
  })

  it('should derive the fill width purely from value/min/max', () => {
    const { container } = render(<OpsProgressDeterminate value={25} min={0} max={50} label="Progress" />)
    const fill = container.querySelector('[class*="fill"]') as HTMLElement
    expect(fill.style.width).toBe('50%')
  })

  it('should derive the marker position purely from value/min/max', () => {
    const { container } = render(<OpsProgressDeterminate value={25} min={0} max={50} label="Progress" />)
    const marker = container.querySelector('[class*="marker"]') as HTMLElement
    expect(marker.style.left).toBe('50%')
  })

  it('should clamp the visual fill to [0, 100] even for out-of-range values', () => {
    const over = render(<OpsProgressDeterminate value={999} min={0} max={100} label="Progress" />)
    const overFill = over.container.querySelector('[class*="fill"]') as HTMLElement
    expect(overFill.style.width).toBe('100%')
    over.unmount()

    const under = render(<OpsProgressDeterminate value={-50} min={0} max={100} label="Progress" />)
    const underFill = under.container.querySelector('[class*="fill"]') as HTMLElement
    expect(underFill.style.width).toBe('0%')
  })

  it('should still report the raw out-of-range value via aria-valuenow', () => {
    render(<OpsProgressDeterminate value={999} min={0} max={100} label="Progress" />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('999')
  })
})

describe('OpsProgressIndeterminate', () => {
  it('should show the provided status text', () => {
    render(<OpsProgressIndeterminate statusText="Fetching sources…" />)
    expect(screen.getByText('Fetching sources…')).toBeDefined()
  })

  it('should not expose a progressbar role or any aria-valuenow', () => {
    render(<OpsProgressIndeterminate statusText="Fetching sources…" />)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('should not render a percentage value anywhere in its output', () => {
    const { container } = render(<OpsProgressIndeterminate statusText="Fetching sources…" />)
    expect(container.textContent).not.toMatch(/%/)
  })
})
