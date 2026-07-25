// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SafetyStatusBadge } from './SafetyStatusBadge'

afterEach(() => cleanup())

describe('SafetyStatusBadge', () => {
  it('shows the open recall count when recalls are open, regardless of rating', () => {
    render(<SafetyStatusBadge openRecallCount={2} overallRating={5} />)

    const status = screen.getByRole('status')
    expect(status.textContent).toBe('2 open recalls')
  })

  it('shows a caution status for a low rating with no open recalls', () => {
    render(<SafetyStatusBadge openRecallCount={0} overallRating={2} />)

    expect(screen.getByRole('status').textContent).toBe('No open recalls · 2/5 NHTSA rating')
  })

  it('shows a good status with the rating when clean', () => {
    render(<SafetyStatusBadge openRecallCount={0} overallRating={5} />)

    expect(screen.getByRole('status').textContent).toBe('No open recalls · 5/5 NHTSA rating')
  })

  it('falls back to a bare "no open recalls" status when no rating is available', () => {
    render(<SafetyStatusBadge openRecallCount={0} overallRating={null} />)

    expect(screen.getByRole('status').textContent).toBe('No open recalls')
  })
})
