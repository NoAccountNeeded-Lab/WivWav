import { RecallsList } from '@wivwav/web'

const vehicleModel = { id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2021, trim: 'XLE', bodyType: 'minivan' }

const safetyWithOpenAndHistorical = {
  vehicleModel,
  recalls: [
    {
      id: 'r1',
      nhtsaCampaignId: '24V512000',
      component: 'FUEL SYSTEM, GASOLINE',
      summary: 'The fuel pump may fail, increasing the risk of a stall while driving.',
      remedy: 'Dealers will replace the fuel pump assembly free of charge.',
      reportedAt: '2024-07-12',
      status: 'open' as const,
    },
    {
      id: 'r2',
      nhtsaCampaignId: '21V308000',
      component: 'ELECTRICAL SYSTEM',
      summary: 'A wiring harness connector may corrode, causing the rear camera image to fail.',
      remedy: 'Dealers replaced the rear camera wiring harness.',
      reportedAt: '2021-05-04',
      status: 'remedied' as const,
    },
  ],
  complaints: [],
  safetyRatings: [],
  safetyFreshnessDate: '2026-06-30',
  investigations: [],
  manufacturerCommunications: [],
}

const safetyClean = {
  vehicleModel: { ...vehicleModel, make: 'Honda', model: 'Odyssey', year: 2022, trim: 'EX-L' },
  recalls: [],
  complaints: [],
  safetyRatings: [],
  safetyFreshnessDate: '2026-07-01',
  investigations: [],
  manufacturerCommunications: [],
}

export function OpenAndHistorical() {
  return <RecallsList vin="5TDYZ3DC1MS123456" safety={safetyWithOpenAndHistorical} />
}

export function NoRecallsFound() {
  return <RecallsList vin="5FNRL6H97NB098765" safety={safetyClean} />
}

export function DataNotYetAvailable() {
  return <RecallsList vin="1FMHK8D83CGA45231" safety={null} />
}
