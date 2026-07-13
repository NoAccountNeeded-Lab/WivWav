// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
  RelativeTimestamp,
} from './relative-time'

const NOW = new Date('2026-07-12T12:00:00.000Z')

describe('formatRelativeTimestamp', () => {
  it('renders recent past timestamps as minutes ago', () => {
    expect(formatRelativeTimestamp('2026-07-12T11:50:00.000Z', { now: NOW })).toBe('10 minutes ago')
  })

  it('renders one-day-old timestamps as yesterday', () => {
    expect(formatRelativeTimestamp('2026-07-11T12:00:00.000Z', { now: NOW })).toBe('yesterday')
  })

  it('renders one-month-old timestamps as last month', () => {
    expect(formatRelativeTimestamp('2026-06-12T12:00:00.000Z', { now: NOW })).toBe('last month')
  })

  it('renders future timestamps relatively for upcoming schedules', () => {
    expect(formatRelativeTimestamp('2026-07-12T14:00:00.000Z', { now: NOW })).toBe('in 2 hours')
  })

  it('falls back to absolute text for older timestamps', () => {
    expect(formatRelativeTimestamp('2026-05-01T12:00:00.000Z', { now: NOW })).toBe(
      formatAbsoluteTimestamp('2026-05-01T12:00:00.000Z'),
    )
  })
})

describe('RelativeTimestamp', () => {
  it('renders the relative label with an absolute title tooltip', () => {
    render(<RelativeTimestamp value="2026-07-12T11:50:00.000Z" now={NOW} />)

    expect(screen.getByText('10 minutes ago').getAttribute('title')).toBe(
      formatAbsoluteTimestamp('2026-07-12T11:50:00.000Z'),
    )
  })

  it('renders the provided fallback for missing timestamps', () => {
    render(<RelativeTimestamp value={null} fallback="No recent run" now={NOW} />)

    expect(screen.getByText('No recent run')).toBeDefined()
  })
})
