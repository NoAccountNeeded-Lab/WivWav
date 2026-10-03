// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SafetyData } from '@/app/[locale]/listings/[id]/types'
import { renderWithIntl } from '@/test-utils/intl'
import { RecallsList } from './RecallsList'

afterEach(() => cleanup())

const safety: SafetyData = {
  vehicleModel: { id: 'vm-1', make: 'Toyota', model: 'Sienna', year: 2022, trim: null, bodyType: 'Minivan' },
  recalls: [
    {
      id: 'recall-1',
      nhtsaCampaignId: '22V123',
      component: 'Ramp',
      summary: 'Ramp may not deploy.',
      remedy: null,
      reportedAt: '2026-03-14T12:00:00Z',
      status: 'open',
    },
    {
      id: 'recall-2',
      nhtsaCampaignId: '21V456',
      component: 'Airbag',
      summary: 'Airbag inflator.',
      remedy: 'Dealer will replace the inflator.',
      reportedAt: '2026-01-05T12:00:00Z',
      status: 'remedied',
    },
  ],
  complaints: [],
  safetyRatings: [],
  safetyFreshnessDate: null,
  investigations: [],
  manufacturerCommunications: [],
}

describe('RecallsList', () => {
  it('renders open and closed recall copy in English', () => {
    renderWithIntl(<RecallsList vin="1HGCM82633A004352" safety={safety} />)

    expect(screen.getByText('1 open recall')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Open recall campaigns' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Closed recall campaigns' })).toBeTruthy()
    expect(screen.getByText('Issued Mar 14, 2026')).toBeTruthy()
    expect(screen.getByText('Remedy open — schedule service')).toBeTruthy()
  })

  it('renders the same safety flow in Spanish, including accessible names', () => {
    renderWithIntl(<RecallsList vin="1HGCM82633A004352" safety={safety} />, 'es')

    expect(screen.getByText('1 retiro abierto')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Campañas de retiro abiertas' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Campañas de retiro cerradas' })).toBeTruthy()
    expect(screen.getByText('Emitido el 14 mar 2026')).toBeTruthy()
    expect(screen.getByText('Reparación abierta: programe el servicio')).toBeTruthy()
    expect(screen.getAllByText(/se abre en una pestaña nueva/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Open recalls')).toBeNull()
  })

  it('shows the Spanish empty state when safety data is unavailable', () => {
    renderWithIntl(<RecallsList vin={null} safety={null} />, 'es')

    expect(screen.getByText(/Los datos de seguridad de este vehículo aún no están disponibles/)).toBeTruthy()
  })
})
