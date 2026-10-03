// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/intl'
import { afterEach, describe, expect, it } from 'vitest'
import { SafetyStatusBadge } from './SafetyStatusBadge'

afterEach(() => cleanup())

describe('SafetyStatusBadge', () => {
  it('shows the open recall count when recalls are open, regardless of rating', () => {
    renderWithIntl(<SafetyStatusBadge openRecallCount={2} overallRating={5} />)

    const status = screen.getByRole('status')
    expect(status.textContent).toBe('2 open recalls')
  })

  it('shows a caution status for a low rating with no open recalls', () => {
    renderWithIntl(<SafetyStatusBadge openRecallCount={0} overallRating={2} />)

    expect(screen.getByRole('status').textContent).toBe('No open recalls · 2/5 NHTSA rating')
  })

  it('shows a good status with the rating when clean', () => {
    renderWithIntl(<SafetyStatusBadge openRecallCount={0} overallRating={5} />)

    expect(screen.getByRole('status').textContent).toBe('No open recalls · 5/5 NHTSA rating')
  })

  it('falls back to a bare "no open recalls" status when no rating is available', () => {
    renderWithIntl(<SafetyStatusBadge openRecallCount={0} overallRating={null} />)

    expect(screen.getByRole('status').textContent).toBe('No open recalls')
  })

  it('renders the status in Spanish when the locale is es', () => {
    renderWithIntl(<SafetyStatusBadge openRecallCount={2} overallRating={5} />, 'es')

    expect(screen.getByRole('status').textContent).toBe('2 retiros abiertos')
  })
})
