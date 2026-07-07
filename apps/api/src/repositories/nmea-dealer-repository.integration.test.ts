import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaNmeaDealerRepository } from './nmea-dealer-repository.js'
import { closeIntegrationDb, integrationDb, resetIntegrationDb } from '../test-support/integration-db.js'

// Exercises the Haversine $queryRaw path against real Postgres — the mocked
// unit test never verifies the math functions actually compute distance or
// that the radius filter/ordering behave correctly (#599).
describe('PrismaNmeaDealerRepository.findNearby (integration)', () => {
  const db = integrationDb()
  const repo = new PrismaNmeaDealerRepository(db)

  beforeEach(async () => {
    await resetIntegrationDb(db)
  })

  afterAll(async () => {
    await resetIntegrationDb(db)
    await closeIntegrationDb()
  })

  it('returns dealers within radius, ordered by distance, excluding those without coordinates', async () => {
    // Times Square, NYC.
    const origin = { lat: 40.758, lng: -73.9855 }

    await db.nmeaDealer.create({
      data: { name: 'Nearby Dealer', lat: 40.7128, lng: -74.006, qapCertified: true },
    })
    await db.nmeaDealer.create({
      data: { name: 'Far Dealer', lat: 34.0522, lng: -118.2437, qapCertified: false },
    })
    await db.nmeaDealer.create({
      data: { name: 'No Coordinates Dealer', qapCertified: false },
    })

    const results = await repo.findNearby(origin.lat, origin.lng, 50, 10)

    expect(results.map((r) => r.name)).toEqual(['Nearby Dealer'])
    expect(results[0]!.distanceMiles).not.toBeNull()
    expect(results[0]!.distanceMiles!).toBeGreaterThan(0)
    expect(results[0]!.distanceMiles!).toBeLessThan(50)
  })

  it('respects the limit parameter', async () => {
    const origin = { lat: 40.758, lng: -73.9855 }
    for (let i = 0; i < 3; i += 1) {
      await db.nmeaDealer.create({
        data: { name: `Dealer ${i}`, lat: 40.758 + i * 0.001, lng: -73.9855, qapCertified: false },
      })
    }

    const results = await repo.findNearby(origin.lat, origin.lng, 500, 2)

    expect(results).toHaveLength(2)
  })
})
