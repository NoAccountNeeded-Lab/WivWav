import { PriceHistoryChart } from '@wivwav/web'

const priceDrops = [
  { id: 'p1', priceCents: 4890000, recordedAt: '2026-03-01' },
  { id: 'p2', priceCents: 4790000, recordedAt: '2026-04-01' },
  { id: 'p3', priceCents: 4590000, recordedAt: '2026-05-01' },
  { id: 'p4', priceCents: 4390000, recordedAt: '2026-06-01' },
  { id: 'p5', priceCents: 4290000, recordedAt: '2026-07-01' },
]

const priceSteady = [
  { id: 'p1', priceCents: 2650000, recordedAt: '2026-05-01' },
  { id: 'p2', priceCents: 2650000, recordedAt: '2026-06-01' },
  { id: 'p3', priceCents: 2599000, recordedAt: '2026-07-01' },
]

export function DroppingFromMsrp() {
  return <PriceHistoryChart priceHistory={priceDrops} originalMsrpCents={5895000} />
}

export function SteadyNoMsrp() {
  return <PriceHistoryChart priceHistory={priceSteady} originalMsrpCents={null} />
}
